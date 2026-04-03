import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { projectIndexSnapshotCreate, type ProjectIndexSnapshot } from '../index/indexSnapshot';
import type {
  FixProviderContext,
  PolicyCheckContext,
  PolicyPluginDeclaration,
  PolicyProcessPluginSource,
  PolicyRule,
  PolicyRuleTarget,
  PolicyRuleTargetContext,
  PolicyViolation,
  PolicyViolationFix,
} from './policyTypes';

export const PROCESS_PLUGIN_PROTOCOL_VERSION = 1 as const;
const PROCESS_PLUGIN_TIMEOUT_DEFAULT_MS = 10_000;
const PROCESS_PLUGIN_MAX_BUFFER_BYTES = 10 * 1024 * 1024;

export type ProcessPluginRuntimeContext = {
  declaration: PolicyPluginDeclaration;
  cwd: string;
  configPath?: string;
};

export type ProcessPluginRuleDescriptor = {
  id: string;
  languages?: string[];
  hasFixProvider?: boolean;
  requiresProjectIndex?: boolean;
};

export type ProcessPluginDescribeResult = {
  pluginId?: string;
  rules: ProcessPluginRuleDescriptor[];
};

export type ProcessPluginCheckContext = {
  filePath: string;
  source: string;
  policy: {
    targets: Record<string, PolicyRuleTarget>;
    rules: PolicyRule[];
    exclude?: string[];
    plugins?: PolicyPluginDeclaration[];
  };
  dir: string;
  configPath?: string;
  target: PolicyRuleTarget;
  ruleArgs?: unknown;
  projectIndex?: ProjectIndexSnapshot;
};

export type ProcessPluginFixContext = {
  cwd: string;
  policy: {
    targets: Record<string, PolicyRuleTarget>;
    rules: PolicyRule[];
    exclude?: string[];
    plugins?: PolicyPluginDeclaration[];
  };
  configPath: string;
  files: string[];
  ruleTargets?: PolicyRuleTargetContext[];
};

export type ProcessPluginRequest =
  | {
      protocolVersion: typeof PROCESS_PLUGIN_PROTOCOL_VERSION;
      method: 'describe';
      pluginId: string;
    }
  | {
      protocolVersion: typeof PROCESS_PLUGIN_PROTOCOL_VERSION;
      method: 'check';
      pluginId: string;
      ruleId: string;
      rule: PolicyRule;
      context: ProcessPluginCheckContext;
    }
  | {
      protocolVersion: typeof PROCESS_PLUGIN_PROTOCOL_VERSION;
      method: 'fix';
      pluginId: string;
      ruleId: string;
      context: ProcessPluginFixContext;
    };

export type ProcessPluginResponse<T> =
  | {
      protocolVersion: typeof PROCESS_PLUGIN_PROTOCOL_VERSION;
      ok: true;
      result: T;
    }
  | {
      protocolVersion: typeof PROCESS_PLUGIN_PROTOCOL_VERSION;
      ok: false;
      error: string;
    };

type ProcessInvocationResolved = {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  cacheKey: string;
};

const describeCache = new Map<string, ProcessPluginDescribeResult>();

function valueTypeGet(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function recordIs(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordExpect(value: unknown, pathLabel: string): Record<string, unknown> {
  if (!recordIs(value)) {
    throw new Error(`Invalid process plugin response at ${pathLabel}: expected object, received ${valueTypeGet(value)}`);
  }
  return value;
}

function stringExpect(value: unknown, pathLabel: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid process plugin response at ${pathLabel}: expected non-empty string`);
  }
  return value;
}

function stringArrayExpect(value: unknown, pathLabel: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid process plugin response at ${pathLabel}: expected array`);
  }
  return value.map((entry, index) => stringExpect(entry, `${pathLabel}[${index}]`));
}

function stringArrayOptional(value: unknown, pathLabel: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  return stringArrayExpect(value, pathLabel);
}

function booleanOptional(value: unknown, pathLabel: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid process plugin response at ${pathLabel}: expected boolean`);
  }
  return value;
}

function numberExpect(value: unknown, pathLabel: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid process plugin response at ${pathLabel}: expected number`);
  }
  return value;
}

function fixParse(value: unknown, pathLabel: string): PolicyViolationFix | undefined {
  if (value === undefined) {
    return undefined;
  }
  const record = recordExpect(value, pathLabel);
  const byteRange = recordExpect(record.byteRange, `${pathLabel}.byteRange`);
  return {
    byteRange: {
      start: numberExpect(byteRange.start, `${pathLabel}.byteRange.start`),
      end: numberExpect(byteRange.end, `${pathLabel}.byteRange.end`),
    },
    text: stringExpect(record.text, `${pathLabel}.text`),
  };
}

function violationParse(value: unknown, pathLabel: string): PolicyViolation {
  const record = recordExpect(value, pathLabel);
  return {
    ruleId: stringExpect(record.ruleId, `${pathLabel}.ruleId`),
    filePath: stringExpect(record.filePath, `${pathLabel}.filePath`),
    message: stringExpect(record.message, `${pathLabel}.message`),
    line: numberExpect(record.line, `${pathLabel}.line`),
    column: numberExpect(record.column, `${pathLabel}.column`),
    fix: fixParse(record.fix, `${pathLabel}.fix`),
  };
}

function describeResultParse(value: unknown): ProcessPluginDescribeResult {
  const record = recordExpect(value, 'result');
  const rawRules = record.rules;
  if (!Array.isArray(rawRules)) {
    throw new Error('Invalid process plugin response at result.rules: expected array');
  }
  return {
    pluginId: record.pluginId === undefined ? undefined : stringExpect(record.pluginId, 'result.pluginId'),
    rules: rawRules.map((rule, index) => {
      const ruleRecord = recordExpect(rule, `result.rules[${index}]`);
      return {
        id: stringExpect(ruleRecord.id, `result.rules[${index}].id`),
        languages: stringArrayOptional(ruleRecord.languages, `result.rules[${index}].languages`),
        hasFixProvider: booleanOptional(
          ruleRecord.hasFixProvider,
          `result.rules[${index}].hasFixProvider`
        ),
        requiresProjectIndex: booleanOptional(
          ruleRecord.requiresProjectIndex,
          `result.rules[${index}].requiresProjectIndex`
        ),
      };
    }),
  };
}

function checkResultParse(value: unknown): PolicyViolation[] {
  const record = recordExpect(value, 'result');
  const rawViolations = record.violations;
  if (!Array.isArray(rawViolations)) {
    throw new Error('Invalid process plugin response at result.violations: expected array');
  }
  return rawViolations.map((violation, index) => violationParse(violation, `result.violations[${index}]`));
}

function processSourceResolve(context: ProcessPluginRuntimeContext): ProcessInvocationResolved {
  const source = context.declaration.source;
  if (source.kind !== 'process') {
    throw new Error(`Plugin ${context.declaration.id} is not configured as a process plugin`);
  }

  const baseDir = context.configPath ? path.dirname(context.configPath) : context.cwd;
  const processCwd = source.cwd ? path.resolve(baseDir, source.cwd) : baseDir;
  const command = source.command.startsWith('.') || source.command.startsWith('/')
    ? path.resolve(processCwd, source.command)
    : source.command;

  return {
    command,
    args: source.args ?? [],
    cwd: processCwd,
    env: {
      ...process.env,
      ...(source.env ?? {}),
    } as Record<string, string>,
    timeoutMs: source.timeoutMs ?? PROCESS_PLUGIN_TIMEOUT_DEFAULT_MS,
    cacheKey: JSON.stringify({
      id: context.declaration.id,
      command,
      args: source.args ?? [],
      cwd: processCwd,
      env: source.env ?? {},
      timeoutMs: source.timeoutMs ?? PROCESS_PLUGIN_TIMEOUT_DEFAULT_MS,
    }),
  };
}

function processResponseParse<T>(
  raw: string,
  parseResult: (value: unknown) => T,
): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse process plugin JSON response: ${message}`);
  }

  const record = recordExpect(parsed, 'response');
  const protocolVersion = numberExpect(record.protocolVersion, 'response.protocolVersion');
  if (protocolVersion !== PROCESS_PLUGIN_PROTOCOL_VERSION) {
    throw new Error(
      `Unsupported process plugin protocol version ${protocolVersion}. ` +
        `Expected ${PROCESS_PLUGIN_PROTOCOL_VERSION}.`
    );
  }

  if (record.ok === false) {
    throw new Error(stringExpect(record.error, 'response.error'));
  }
  if (record.ok !== true) {
    throw new Error('Invalid process plugin response at response.ok: expected boolean');
  }
  return parseResult(record.result);
}

function processInvokeSync<T>(
  context: ProcessPluginRuntimeContext,
  request: ProcessPluginRequest,
  parseResult: (value: unknown) => T,
): T {
  const resolved = processSourceResolve(context);
  const result = spawnSync(resolved.command, resolved.args, {
    cwd: resolved.cwd,
    env: resolved.env,
    input: JSON.stringify(request),
    encoding: 'utf8',
    timeout: resolved.timeoutMs,
    maxBuffer: PROCESS_PLUGIN_MAX_BUFFER_BYTES,
    windowsHide: true,
  });

  if (result.error) {
    throw new Error(
      `Failed to execute process plugin ${context.declaration.id}: ${result.error.message}`
    );
  }

  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    const stdout = result.stdout.trim();
    const detail = stderr || stdout || `exit status ${result.status}`;
    throw new Error(`Process plugin ${context.declaration.id} failed: ${detail}`);
  }

  const stdout = result.stdout.trim();
  if (!stdout) {
    throw new Error(`Process plugin ${context.declaration.id} produced no response`);
  }

  return processResponseParse(stdout, parseResult);
}

function projectIndexSnapshotOptional(context: PolicyCheckContext): ProjectIndexSnapshot | undefined {
  if (!context.projectIndex) {
    return undefined;
  }
  return projectIndexSnapshotCreate(context.projectIndex);
}

function processCheckContextCreate(context: PolicyCheckContext): ProcessPluginCheckContext {
  return {
    filePath: context.filePath,
    source: context.source,
    policy: context.policy,
    dir: context.dir,
    configPath: context.configPath,
    target: context.target,
    ruleArgs: context.ruleArgs,
    projectIndex: projectIndexSnapshotOptional(context),
  };
}

function processFixContextCreate(context: FixProviderContext): ProcessPluginFixContext {
  return {
    cwd: context.cwd,
    policy: context.policy,
    configPath: context.configPath,
    files: context.files,
    ruleTargets: context.ruleTargets,
  };
}

export function processPluginCacheClear(): void {
  describeCache.clear();
}

export function processPluginDescribeGet(
  context: ProcessPluginRuntimeContext,
): ProcessPluginDescribeResult {
  const resolved = processSourceResolve(context);
  const cached = describeCache.get(resolved.cacheKey);
  if (cached) {
    return cached;
  }

  const described = processInvokeSync(
    context,
    {
      protocolVersion: PROCESS_PLUGIN_PROTOCOL_VERSION,
      method: 'describe',
      pluginId: context.declaration.id,
    },
    describeResultParse,
  );

  if (described.pluginId && described.pluginId !== context.declaration.id) {
    throw new Error(
      `Process plugin ${context.declaration.id} reported mismatched pluginId ${described.pluginId}`
    );
  }

  describeCache.set(resolved.cacheKey, described);
  return described;
}

export function processPluginRuleCheck(
  context: ProcessPluginRuntimeContext,
  ruleId: string,
  rule: PolicyRule,
  checkContext: PolicyCheckContext,
): PolicyViolation[] {
  return processInvokeSync(
    context,
    {
      protocolVersion: PROCESS_PLUGIN_PROTOCOL_VERSION,
      method: 'check',
      pluginId: context.declaration.id,
      ruleId,
      rule,
      context: processCheckContextCreate(checkContext),
    },
    checkResultParse,
  );
}

export function processPluginRuleFix(
  context: ProcessPluginRuntimeContext,
  ruleId: string,
  fixContext: FixProviderContext,
): void {
  processInvokeSync(
    context,
    {
      protocolVersion: PROCESS_PLUGIN_PROTOCOL_VERSION,
      method: 'fix',
      pluginId: context.declaration.id,
      ruleId,
      context: processFixContextCreate(fixContext),
    },
    () => undefined,
  );
}

/** Parse a `describe` response body (the `result` object). Exported for tests and tooling. */
export { describeResultParse as processPluginDescribeResultParse };
