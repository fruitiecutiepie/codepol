#!/usr/bin/env node
/**
 * @packageDocumentation
 * @codepol/cli - Command-line interface for codepol policy enforcement.
 *
 * Usage:
 *   codepol [options]
 *
 * Options:
 *   --fix          Apply ESLint fixes where possible
 *   --watch        Run policy checks in watch mode
 *   --config       Path to config file (auto-discovered if not specified)
 *   --eslint-config Path to the ESLint config file (uses config file value or auto-detects)
 *   --check-plugins Validate policy and rule plugins, then exit
 *   --help         Show help
 *   --version      Show version
 */

import fs from 'node:fs';
import path from 'node:path';
import chokidar from 'chokidar';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { ESLint } from 'eslint';
import {
  langAdd,
  parserInit,
  policyRuleTargetsResolve,
  ruleMatchesGet,
  policyViolationsGetFromDir,
  policyViolationsGetOutputPretty,
  policyPluginsGet,
  ESLINT_PLUGIN_NAME_DEFAULT,
  configGet,
  configGetFromPath,
  type LintProvider,
  type LintSeverity,
  type EslintProviderConfig,
  type FixProvider,
  type PolicyFile,
  type PolicyViolation,
  type PolicyRuleTargetContext,
  type CodepolConfig,
} from '@codepol/core';

type CliOptions = {
  fix: boolean;
  watch: boolean;
  checkPlugins: boolean;
  /** Resolved config path (from auto-discovery or --config flag) */
  configPath: string;
  /** Resolved ESLint config path */
  eslintConfig: string;
  /** The loaded config object */
  config: CodepolConfig;
};

type PolicyCheckResult = {
  policy: PolicyFile;
  files: string[];
  violations: PolicyViolation[];
};

type LintProviderEntry = {
  provider: LintProvider;
  ruleId: string;
  ruleArgs?: unknown;
  severity?: LintSeverity;
};

const ESLINT_CONFIG_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts'];

/**
 * Detects the ESLint config file by checking for common file names.
 * Returns the first existing config file path, or falls back to 'eslint.config.js'.
 */
function eslintConfigPathDetect(cwd: string): string {
  for (const ext of ESLINT_CONFIG_EXTENSIONS) {
    const configPath = path.join(cwd, `eslint.config${ext}`);
    if (fs.existsSync(configPath)) {
      return configPath;
    }
  }
  // Fall back to default if none found
  return path.join(cwd, 'eslint.config.js');
}

function policyRuleTargetsGet(policy: PolicyFile): PolicyRuleTargetContext[] {
  const targets: PolicyRuleTargetContext[] = [];
  for (const rule of policy.rules) {
    const resolvedTargets = policyRuleTargetsResolve(rule, policy);
    for (const target of resolvedTargets) {
      targets.push({
        ruleId: rule.ruleId,
        description: rule.description,
        args: rule.args,
        target,
      });
    }
  }
  return targets;
}

/**
 * Generates ESLint rule configurations from lint providers.
 * Note: Only returns rules, not plugins. The user's eslint config is expected
 * to have the codepol plugin already registered via eslintPluginCreate().
 * Adding plugins here would cause "Cannot redefine plugin" errors.
 */
function eslintConfigGet(
  providers: LintProviderEntry[],
  context: { policy: PolicyFile; configPath: string; cwd: string; ruleTargets: PolicyRuleTargetContext[] }
): ESLint.Options['overrideConfig'] {
  const rules: Record<string, unknown> = {};

  for (const entry of providers) {
    if (entry.provider.platform !== 'eslint') {
      continue;
    }
    const eslintConfig = entry.provider.config as EslintProviderConfig;
    // Extract short rule name from namespaced ID (e.g., "@codepol/plugin/require-logger-enter-exit" -> "require-logger-enter-exit")
    const ruleNameFull = entry.ruleId;
    const lastSlashIndex = ruleNameFull.lastIndexOf('/');
    const ruleNameShort = lastSlashIndex !== -1 ? ruleNameFull.slice(lastSlashIndex + 1) : ruleNameFull;

    const pluginName = eslintConfig.pluginName ?? ESLINT_PLUGIN_NAME_DEFAULT;
    const configKey = `${pluginName}/${ruleNameShort}`;
    if (rules[configKey]) {
      throw new Error(`Duplicate ESLint rule configuration detected: ${configKey}.`);
    }
    // Get options from provider (or empty object)
    const options = eslintConfig.ruleOptions?.({
      ...context,
      ruleId: entry.ruleId,
      ruleArgs: entry.ruleArgs,
    }) ?? {};
    // Construct [severity, options] - severity from policy.json, defaults to 'error'
    const severity = entry.severity ?? 'error';
    rules[configKey] = [severity, options];
  }

  return { rules } as ESLint.Options['overrideConfig'];
}

async function fixProvidersApply(
  providers: FixProvider[],
  context: { policy: PolicyFile; configPath: string; cwd: string; files: string[]; ruleTargets: PolicyRuleTargetContext[] }
): Promise<void> {
  for (const provider of providers) {
    await provider.apply(context);
  }
}

async function policyCheck(options: {
  config: CodepolConfig;
  configPath: string;
  eslintConfigPath: string;
  fix: boolean;
  cwd: string;
}): Promise<PolicyCheckResult> {
  const { config, configPath, eslintConfigPath, fix, cwd } = options;

  // Use the config directly (CodepolConfig extends PolicyFile)
  const policy = config as PolicyFile;
  // Use core policyPluginsGet instead of local implementation
  const pluginRulesResult = await policyPluginsGet(policy, cwd);
  if ('Err' in pluginRulesResult) {
    throw new Error(pluginRulesResult.Err);
  }
  const pluginRulesMap = pluginRulesResult.Ok;
  const pluginRules = Array.from(pluginRulesMap.values());
  const ruleTargets = policyRuleTargetsGet(policy);

  // Collect lint providers from all rule plugins
  // Args and severity come from policy rules
  const lintProviderEntries: LintProviderEntry[] = [];
  for (const entry of pluginRules) {
    const lintProviders = entry.pluginRule.capabilities.lintProviders ?? [];
    for (const provider of lintProviders) {
      // Find the policy rule that uses this plugin to get its args, severity, and providers filter
      const matchingRule = policy.rules.find(r => 
        r.ruleId === entry.pluginRule.id || 
        entry.pluginRule.id.endsWith(`/${r.ruleId}`)
      );
      
      // Skip if rule specifies providers and this provider's platform is not included
      if (matchingRule?.providers && matchingRule.providers.length > 0) {
        if (!matchingRule.providers.includes(provider.platform)) {
          continue;
        }
      }
      
      lintProviderEntries.push({
        provider,
        ruleId: entry.pluginRule.id,
        ruleArgs: matchingRule?.args,
        severity: matchingRule?.severity,
      });
    }
  }

  // Filter to ESLint providers
  const eslintProviders = lintProviderEntries.filter(
    entry => entry.provider.platform === 'eslint'
  );

  const fixProviders = pluginRules
    .map(entry => entry.pluginRule.capabilities.fixProvider)
    .filter((provider): provider is FixProvider => provider !== undefined);

  const matches = await ruleMatchesGet(policy, cwd);
  const files = Array.from(new Set(matches.flatMap(match => match.files)));

  if (fix && fixProviders.length > 0) {
    await fixProvidersApply(fixProviders, { policy, configPath, cwd, files, ruleTargets });
  }

  const eslintViolations: PolicyViolation[] = [];
  if (eslintProviders.length > 0) {
    const eslint = new ESLint({
      overrideConfigFile: eslintConfigPath,
      overrideConfig: eslintConfigGet(eslintProviders, { policy, configPath, cwd, ruleTargets }),
      fix,
      cwd,
    });

    const lintResults = files.length > 0 ? await eslint.lintFiles(files) : [];
    if (fix) {
      await ESLint.outputFixes(lintResults);
    }
    for (const result of lintResults) {
      for (const msg of result.messages) {
        eslintViolations.push({
          ruleId: msg.ruleId ?? 'unknown',
          filePath: result.filePath,
          message: msg.message,
          line: msg.line,
          column: msg.column,
        });
      }
    }
  }

  const violationsResult = await policyViolationsGetFromDir(policy, cwd);

  if ('Err' in violationsResult) {
    // Error already logged in core
    throw new Error(violationsResult.Err);
  }

  return {
    policy,
    files,
    violations: [...eslintViolations, ...violationsResult.Ok],
  };
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
  const policyPluginsResult = await policyPluginsGet(policy, cwd);
  if ('Err' in policyPluginsResult) {
    throw new Error(policyPluginsResult.Err);
  }
  
  // policyPluginsGet now returns PluginRule map, which includes ruleId directly
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
  langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
  langAdd({ langId: 'tsx', fileExtensions: ['.tsx'] });
  await parserInit();

  const cwd = process.cwd();

  const argv = await yargs(hideBin(process.argv))
    .scriptName('codepol')
    .usage('$0 [options]')
    .option('fix', {
      type: 'boolean',
      default: false,
      describe: 'Apply ESLint fixes where possible',
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
    .example('$0 --config ./config/codepol.config.ts', 'Use specific config file')
    .example('$0 --check-plugins', 'Validate plugins for the config file')
    .help()
    .version()
    .parseAsync();

  // Load config: explicit path or auto-discover
  let configResult;
  if (argv.config) {
    configResult = await configGetFromPath(argv.config as string);
  } else {
    configResult = await configGet(cwd);
  }
  const { config, configPath } = configResult;

  // Resolve ESLint config: CLI flag > config file > auto-detect
  const eslintConfigPath = argv['eslint-config']
    ? path.resolve(argv['eslint-config'] as string)
    : config.eslintConfigPath
      ? path.resolve(path.dirname(configPath), config.eslintConfigPath)
      : eslintConfigPathDetect(cwd);

  let fix = false;
  if (argv.fix != undefined) {
    fix = argv.fix;
  }
  let watch = false;
  if (argv.watch != undefined) {
    watch = argv.watch;
  }
  let checkPlugins = false;
  if (argv['check-plugins'] != undefined) {
    checkPlugins = argv['check-plugins'];
  }

  const options: CliOptions = {
    fix,
    watch,
    checkPlugins,
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
  const files = Array.from(new Set(matches.flatMap(match => match.files)));
  const patterns = Array.from(
    new Set(policy.rules.flatMap(rule => 
      policyRuleTargetsResolve(rule, policy).flatMap(target => target.files)
    ))
  );

  if (options.watch) {
    fsSubNew(options, files, patterns);
  } else {
    const success = await policyCheckAndPrintOutput(options);
    if (!success) {
      process.exitCode = 1;
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
