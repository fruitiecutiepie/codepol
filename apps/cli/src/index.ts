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
  policyPluginsGet,
  policyRuleTargetsResolve,
  policyViolationsGetOutputPretty,
  ruleMatchesGet,
  type CodepolConfig,
  type PolicyFile,
} from '@codepol/core';
import {
  builtinPluginsRefresh,
  ensureWorkspaceRuntimeReady,
  eslintConfigPathDetect,
  type WorkspaceDaemonConnectFn,
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
  eslintConfig: string;
  config: CodepolConfig;
};

export async function policyCheck(options: {
  config?: CodepolConfig;
  configPath: string;
  eslintConfigPath?: string;
  fix: boolean;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  clientInstanceId?: string;
  connect?: WorkspaceDaemonConnectFn;
  startDaemon?: () => Promise<void> | void;
  allowInProcessFallback?: boolean;
  onResolved?: (info: CliWorkspaceServiceResolvedInfo) => void;
}): Promise<WorkspacePolicyCheckResult> {
  const checker = await cliPolicyCheckerResolve({
    env: options.env,
    clientInstanceId: options.clientInstanceId,
    connect: options.connect,
    startDaemon: options.startDaemon,
    allowInProcessFallback: options.allowInProcessFallback,
    onResolved: options.onResolved,
  });

  try {
    return await checker.policyCheck({
      config: options.config,
      configPath: options.configPath,
      eslintConfigPath: options.eslintConfigPath,
      fix: options.fix,
      cwd: options.cwd,
    });
  } finally {
    await checker.close?.();
  }
}

async function policyCheckAndPrintOutput(options: CliOptions): Promise<boolean> {
  const cwd = process.cwd();
  const result = await policyCheck({
    config: options.config,
    configPath: options.configPath,
    eslintConfigPath: options.eslintConfig,
    fix: options.fix,
    cwd,
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

function fsSubNew(options: CliOptions, files: string[], patterns: string[]): void {
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
    await policyCheckAndPrintOutput(options);
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
    .option('eslint-config', {
      type: 'string',
      describe: 'Path to the ESLint config file (uses config file value or auto-detects)',
    })
    .option('check-plugins', {
      type: 'boolean',
      default: false,
      describe: 'Validate policy and rule plugins, then exit',
    })
    .example('$0', 'Run policy checks once (auto-discovers config)')
    .example('$0 --fix', 'Run checks and apply fixes')
    .example('$0 --watch', 'Watch for changes and re-run checks')
    .example('$0 --config ./config/codepol.toml', 'Use specific config file')
    .example('$0 --check-plugins', 'Validate plugins for the config file')
    .help()
    .version()
    .parseAsync();

  const configResult = argv.config
    ? await configGetFromPath(argv.config as string)
    : await configGet(cwd);
  const { config, configPath } = configResult;

  const eslintConfigPath = argv['eslint-config']
    ? path.resolve(argv['eslint-config'] as string)
    : config.eslintConfigPath
      ? path.resolve(path.dirname(configPath), config.eslintConfigPath)
      : eslintConfigPathDetect(cwd);

  const options: CliOptions = {
    fix: argv.fix ?? false,
    watch: argv.watch ?? false,
    checkPlugins: argv['check-plugins'] ?? false,
    configPath,
    eslintConfig: eslintConfigPath,
    config,
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
    fsSubNew(options, files, patterns);
    return;
  }

  const success = await policyCheckAndPrintOutput(options);
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
