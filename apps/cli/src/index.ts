#!/usr/bin/env node
/**
 * @packageDocumentation
 * @codepol/cli - Command-line interface for codepol policy enforcement.
 */

import path from 'node:path';
import chokidar from 'chokidar';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import {
  configGet,
  configGetFromPath,
  diagnosticsRuntimeSetConfig,
  environmentNameParse,
  environmentNamesList,
  policyPluginsGet,
  policyRuleTargetsResolve,
  policyViolationsGetOutputPretty,
  ruleMatchesGet,
  type CodepolConfig,
  type DiagnosticSinkKind,
  type DiagnosticsConfigPatch,
  type DiagnosticsOverridePatch,
  type EnvironmentName,
  type EscalationRuleInput,
  type LogLevel,
  type PolicyFile,
} from '@codepol/core';
import {
  builtinPluginsRefresh,
  ensureWorkspaceRuntimeReady,
  policyCheck as workspacePolicyCheck,
  type WorkspaceDaemonConnectFn,
  type WorkspacePolicyCheckOptions,
  type WorkspacePolicyCheckResult,
} from '@codepol/workspace-service';
import {
  cliPolicyCheckerResolve,
  type CliWorkspaceServiceResolvedInfo,
} from './serviceFactory';

type CliOptions = {
  fix: boolean;
  watch: boolean;
  checkPlugins: boolean;
  configPath: string;
  config: CodepolConfig;
  diagnosticsPatch?: DiagnosticsConfigPatch;
};

const CLI_LOG_LEVELS: readonly LogLevel[] = [
  'error',
  'warn',
  'info',
  'debug',
  'trace',
];

const CLI_SINK_KINDS: readonly DiagnosticSinkKind[] = [
  'console',
  'file',
  'memory',
  'stdout',
  'otel',
];

function logLevelParse(value: string | undefined): LogLevel | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().toLowerCase();
  return (CLI_LOG_LEVELS as readonly string[]).includes(trimmed)
    ? (trimmed as LogLevel)
    : undefined;
}

function sinkKindsParse(raw: string): readonly DiagnosticSinkKind[] | undefined {
  const kinds: DiagnosticSinkKind[] = [];
  for (const token of raw.split(',')) {
    const trimmed = token.trim().toLowerCase();
    if ((CLI_SINK_KINDS as readonly string[]).includes(trimmed)) {
      kinds.push(trimmed as DiagnosticSinkKind);
    }
  }
  return kinds.length > 0 ? kinds : undefined;
}

function booleanParse(raw: string): boolean | undefined {
  const trimmed = raw.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(trimmed)) return true;
  if (['false', '0', 'no', 'off'].includes(trimmed)) return false;
  return undefined;
}

function numberParse(raw: string): number | undefined {
  const parsed = Number(raw.trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Parses a single `--override <dimension=value>` token into a patch fragment.
 * Supported dimensions:
 *   level=<LogLevel>
 *   scopes.<name>=<LogLevel|clear>
 *   tracing.enabled=<bool>
 *   tracing.sampleRate=<number>
 *   metrics.enabled=<bool>
 *   snapshots.enabled=<bool>
 *   snapshots.maxBytes=<number>
 *   checks.invariants=<off|cheap|full>
 *   redaction.mode=<strict|standard|off>
 *   sinks=<kind,kind,...>
 *   logFilePath=<path|clear>
 *   otelEndpoint=<url|clear>
 */
function overrideTokenApply(
  patch: DiagnosticsOverridePatch,
  token: string,
): void {
  const eq = token.indexOf('=');
  if (eq === -1) return;
  const dimension = token.slice(0, eq).trim();
  const raw = token.slice(eq + 1);
  if (dimension === 'level') {
    const level = logLevelParse(raw);
    if (level) patch.level = level;
    return;
  }
  if (dimension.startsWith('scopes.')) {
    const key = dimension.slice('scopes.'.length).trim();
    if (!key) return;
    const nextScopes = { ...(patch.scopes ?? {}) };
    if (raw.trim().toLowerCase() === 'clear') {
      nextScopes[key] = null;
    } else {
      const level = logLevelParse(raw);
      if (!level) return;
      nextScopes[key] = level;
    }
    patch.scopes = nextScopes;
    return;
  }
  if (dimension === 'tracing.enabled') {
    const bool = booleanParse(raw);
    if (bool !== undefined) patch.tracing = { ...(patch.tracing ?? {}), enabled: bool };
    return;
  }
  if (dimension === 'tracing.sampleRate') {
    const num = numberParse(raw);
    if (num !== undefined) patch.tracing = { ...(patch.tracing ?? {}), sampleRate: num };
    return;
  }
  if (dimension === 'metrics.enabled') {
    const bool = booleanParse(raw);
    if (bool !== undefined) patch.metrics = { enabled: bool };
    return;
  }
  if (dimension === 'snapshots.enabled') {
    const bool = booleanParse(raw);
    if (bool !== undefined) patch.snapshots = { ...(patch.snapshots ?? {}), enabled: bool };
    return;
  }
  if (dimension === 'snapshots.maxBytes') {
    const num = numberParse(raw);
    if (num !== undefined) patch.snapshots = { ...(patch.snapshots ?? {}), maxBytes: num };
    return;
  }
  if (dimension === 'checks.invariants') {
    const trimmed = raw.trim().toLowerCase();
    if (trimmed === 'off' || trimmed === 'cheap' || trimmed === 'full') {
      patch.checks = { invariants: trimmed };
    }
    return;
  }
  if (dimension === 'redaction.mode') {
    const trimmed = raw.trim().toLowerCase();
    if (trimmed === 'strict' || trimmed === 'standard' || trimmed === 'off') {
      patch.redaction = { mode: trimmed };
    }
    return;
  }
  if (dimension === 'sinks') {
    const kinds = sinkKindsParse(raw);
    if (kinds) patch.sinks = kinds;
    return;
  }
  if (dimension === 'logFilePath') {
    patch.logFilePath = raw.trim().toLowerCase() === 'clear' ? null : raw.trim();
    return;
  }
  if (dimension === 'otelEndpoint') {
    patch.otelEndpoint = raw.trim().toLowerCase() === 'clear' ? null : raw.trim();
    return;
  }
}

function overridesBuild(
  raw: string[] | undefined,
): DiagnosticsOverridePatch | undefined {
  if (!raw || raw.length === 0) return undefined;
  const patch: DiagnosticsOverridePatch = {};
  for (const token of raw) {
    overrideTokenApply(patch, token);
  }
  return Object.keys(patch).length > 0 ? patch : undefined;
}

/**
 * Parses `--escalate <scope=level@ttlSec:reason>`.
 *   scope       := `global` | `scope:<dotted>` | `request:<id>` | `workspace:<id>`
 *   level       := error|warn|info|debug|trace
 *   ttlSec      := integer seconds
 *   reason      := free text
 */
function escalationTokenParse(
  token: string,
  actor: string,
): EscalationRuleInput | undefined {
  const colon = token.lastIndexOf(':');
  const atSign = token.lastIndexOf('@', colon === -1 ? token.length : colon);
  const eq = token.indexOf('=');
  if (eq === -1 || atSign === -1 || colon === -1 || atSign < eq || colon < atSign) {
    return undefined;
  }
  const scopeRaw = token.slice(0, eq).trim();
  const level = logLevelParse(token.slice(eq + 1, atSign));
  const ttlSec = numberParse(token.slice(atSign + 1, colon));
  const reason = token.slice(colon + 1).trim();
  if (!level || ttlSec === undefined || ttlSec <= 0) return undefined;

  let scope: EscalationRuleInput['scope'];
  if (scopeRaw === 'global') {
    scope = { kind: 'global' };
  } else if (scopeRaw.startsWith('scope:')) {
    scope = { kind: 'scope', scope: scopeRaw.slice('scope:'.length) };
  } else if (scopeRaw.startsWith('request:')) {
    scope = { kind: 'request', requestId: scopeRaw.slice('request:'.length) };
  } else if (scopeRaw.startsWith('workspace:')) {
    scope = { kind: 'workspace', workspaceId: scopeRaw.slice('workspace:'.length) };
  } else {
    scope = { kind: 'scope', scope: scopeRaw };
  }
  return {
    scope,
    level,
    ttlMs: Math.floor(ttlSec * 1000),
    reason: reason || 'cli_escalation',
    actor,
  };
}

function escalationsBuild(raw: string[] | undefined): EscalationRuleInput[] {
  if (!raw || raw.length === 0) return [];
  const actor = `cli-${process.pid}`;
  const escalations: EscalationRuleInput[] = [];
  for (const token of raw) {
    const parsed = escalationTokenParse(token, actor);
    if (parsed) escalations.push(parsed);
  }
  return escalations;
}

function interactiveSinkOverrideApply(
  patch: DiagnosticsOverridePatch | undefined,
): DiagnosticsOverridePatch | undefined {
  if (patch?.sinks) return patch;
  if (!process.stdout.isTTY) return patch;
  return {
    ...(patch ?? {}),
    sinks: ['console'],
  };
}

function diagnosticsPatchBuild(args: {
  env?: string;
  overrides?: string[];
  escalations?: string[];
}): {
  patch?: DiagnosticsConfigPatch;
  escalations: EscalationRuleInput[];
} {
  const environment = environmentNameParse(args.env);
  const overridesRaw = overridesBuild(args.overrides);
  const overrides = interactiveSinkOverrideApply(overridesRaw);
  const escalations = escalationsBuild(args.escalations);

  if (!environment && !overrides && escalations.length === 0) {
    // Still apply interactive sink override on its own if we're on a TTY
    return interactiveOnlyBuild();
  }

  const patch: DiagnosticsConfigPatch = {};
  if (environment) patch.environment = environment;
  if (overrides) patch.overrides = overrides;
  return { patch, escalations };
}

function interactiveOnlyBuild(): {
  patch?: DiagnosticsConfigPatch;
  escalations: EscalationRuleInput[];
} {
  if (!process.stdout.isTTY) return { escalations: [] };
  return {
    patch: { overrides: { sinks: ['console'] } },
    escalations: [],
  };
}

function errorAsError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function daemonBuiltinPluginFallbackNeeded(
  config: CodepolConfig | undefined,
  allowInProcessFallback: boolean | undefined,
  error: unknown,
): boolean {
  if (config === undefined || allowInProcessFallback === false) {
    return false;
  }
  return /Builtin plugin .+ is not registered\./.test(errorAsError(error).message);
}

export async function policyCheck(options: {
  config?: CodepolConfig;
  configPath: string;
  fix: boolean;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  clientInstanceId?: string;
  connect?: WorkspaceDaemonConnectFn;
  startDaemon?: () => Promise<void> | void;
  allowInProcessFallback?: boolean;
  onResolved?: (info: CliWorkspaceServiceResolvedInfo) => void;
  diagnosticsPatch?: DiagnosticsConfigPatch;
  diagnosticsEscalations?: readonly EscalationRuleInput[];
}): Promise<WorkspacePolicyCheckResult> {
  const checker = await cliPolicyCheckerResolve({
    env: options.env,
    clientInstanceId: options.clientInstanceId,
    connect: options.connect,
    startDaemon: options.startDaemon,
    allowInProcessFallback: options.allowInProcessFallback,
    onResolved: options.onResolved,
  });

  if (options.diagnosticsPatch && checker.setDiagnosticsConfig) {
    try {
      await checker.setDiagnosticsConfig(options.diagnosticsPatch);
    } catch (err) {
      console.warn(
        `Failed to forward diagnostics config to daemon: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  if (options.diagnosticsEscalations && checker.setDiagnosticsEscalation) {
    for (const rule of options.diagnosticsEscalations) {
      try {
        await checker.setDiagnosticsEscalation(rule);
      } catch (err) {
        console.warn(
          `Failed to forward diagnostics escalation to daemon: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  const policyCheckOptions: WorkspacePolicyCheckOptions = {
    config: options.config,
    configPath: options.configPath,
    fix: options.fix,
    cwd: options.cwd,
  };

  try {
    return await checker.policyCheck(policyCheckOptions);
  } catch (error) {
    if (!daemonBuiltinPluginFallbackNeeded(options.config, options.allowInProcessFallback, error)) {
      throw error;
    }
    return await workspacePolicyCheck(policyCheckOptions);
  } finally {
    await checker.close?.();
  }
}

async function policyCheckAndPrintOutput(
  options: CliOptions,
  escalations: readonly EscalationRuleInput[],
): Promise<boolean> {
  const cwd = process.cwd();
  const result = await policyCheck({
    config: options.config,
    configPath: options.configPath,
    fix: options.fix,
    cwd,
    diagnosticsPatch: options.diagnosticsPatch,
    diagnosticsEscalations: escalations,
  });

  const output = policyViolationsGetOutputPretty(result.violations, cwd);
  if (output) {
    console.log(output);
  } else {
    console.log('✔ Policy checks passed');
  }

  return result.violations.length === 0;
}

async function policyPluginsValidateAndPrint(options: CliOptions): Promise<void> {
  const cwd = process.cwd();
  const policy = options.config as PolicyFile;
  const policyPluginsResult = await policyPluginsGet(policy, cwd, {
    configPath: options.configPath,
  });
  if ('Err' in policyPluginsResult) {
    throw new Error(policyPluginsResult.Err);
  }

  const rulePluginIds = Array.from(policyPluginsResult.Ok.keys()).sort();
  console.log(`✔ Config loaded from: ${options.configPath}`);
  console.log('✔ Plugins validated');
  console.log(`Rule plugins (${rulePluginIds.length}): ${rulePluginIds.join(', ') || 'none'}`);
}

function fsSubNew(
  options: CliOptions,
  files: string[],
  patterns: string[],
  escalations: readonly EscalationRuleInput[],
): void {
  const watchItems = new Set<string>([options.configPath]);
  for (const file of files) {
    watchItems.add(file);
  }
  for (const pattern of patterns) {
    watchItems.add(path.resolve(pattern));
  }

  const watcher = chokidar.watch(Array.from(watchItems), {
    ignoreInitial: true,
  });

  let running = false;
  let pending = false;

  const policyChecksRunOnces = async () => {
    if (running) {
      pending = true;
      return;
    }
    running = true;
    console.log('\nRunning policy checks...');
    await policyCheckAndPrintOutput(options, escalations);
    running = false;
    if (pending) {
      pending = false;
      void policyChecksRunOnces();
    }
  };

  watcher.on('all', () => {
    void policyChecksRunOnces();
  });

  console.log('Watching for changes...');
  void policyChecksRunOnces();
}

async function main(): Promise<void> {
  await ensureWorkspaceRuntimeReady();
  builtinPluginsRefresh();

  const cwd = process.cwd();
  const envChoices = [...environmentNamesList()];
  const argv = await yargs(hideBin(process.argv))
    .scriptName('codepol')
    .usage('$0 [options]')
    .option('fix', {
      type: 'boolean',
      default: false,
      describe: 'Apply available fixes where possible',
    })
    .option('watch', {
      type: 'boolean',
      default: false,
      describe: 'Run policy checks in watch mode',
    })
    .option('config', {
      type: 'string',
      describe: 'Path to config file (auto-discovered if not specified)',
    })
    .option('check-plugins', {
      type: 'boolean',
      default: false,
      describe: 'Validate policy and rule plugins, then exit',
    })
    .option('env', {
      type: 'string',
      choices: envChoices as EnvironmentName[],
      describe:
        'Diagnostics environment preset to apply (defaults to $CODEPOL_ENV or "user").',
    })
    .option('override', {
      type: 'array',
      string: true,
      describe:
        'Override one diagnostics dimension. Format: dimension=value. Repeatable. Examples: --override level=trace --override sinks=console,file --override logFilePath=/tmp/x.log --override scopes.parser=trace',
    })
    .option('escalate', {
      type: 'array',
      string: true,
      describe:
        'Add a time-bounded escalation. Format: scope=level@ttlSec:reason. Scope is `global`, `scope:<dotted>`, `request:<id>`, or `workspace:<id>`. Repeatable.',
    })
    .example('$0', 'Run policy checks once (auto-discovers config)')
    .example('$0 --fix', 'Run checks and apply fixes')
    .example('$0 --watch', 'Watch for changes and re-run checks')
    .example('$0 --env dev', 'Apply the dev preset to this run and the daemon')
    .example(
      '$0 --env dev --override sinks=console,file --override logFilePath=/tmp/codepol.log',
      'Dev preset with a file sink added',
    )
    .example(
      '$0 --escalate scope:parser=trace@600:reproduce_wasm_abort',
      'Elevate the parser scope to trace for 10 minutes',
    )
    .help()
    .version()
    .parseAsync();

  const configResult = argv.config
    ? await configGetFromPath(argv.config as string)
    : await configGet(cwd);
  const { config, configPath } = configResult;

  const { patch: diagnosticsPatch, escalations } = diagnosticsPatchBuild({
    env: argv.env as string | undefined,
    overrides: argv.override as string[] | undefined,
    escalations: argv.escalate as string[] | undefined,
  });
  if (diagnosticsPatch) {
    diagnosticsRuntimeSetConfig(diagnosticsPatch);
  }

  const options: CliOptions = {
    fix: argv.fix ?? false,
    watch: argv.watch ?? false,
    checkPlugins: argv['check-plugins'] ?? false,
    configPath,
    config,
    diagnosticsPatch,
  };

  if (options.checkPlugins) {
    await policyPluginsValidateAndPrint(options);
    return;
  }

  const policy = config as PolicyFile;
  const matches = await ruleMatchesGet(policy, cwd);
  const files = Array.from(new Set(matches.flatMap((match) => match.files)));
  const patterns = Array.from(
    new Set(
      policy.rules.flatMap((rule) =>
        policyRuleTargetsResolve(rule, policy).flatMap((target) => target.files),
      ),
    ),
  );

  if (options.watch) {
    fsSubNew(options, files, patterns, escalations);
    return;
  }

  const success = await policyCheckAndPrintOutput(options, escalations);
  if (!success) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
