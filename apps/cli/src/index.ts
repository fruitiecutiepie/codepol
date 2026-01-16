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
 *   --policy       Path to the policy file (default: ./policy.json)
 *   --eslint-config Path to the ESLint config file
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
  policyFileGet,
  ruleMatchesGet,
  policyViolationsGetFromDir,
  policyViolationsGetOutputPretty,
  policyPluginsGet,
  rulePluginLanguagesGet,
  type LintProvider,
  type EslintProviderConfig,
  type FixProvider,
  type PolicyFile,
  type PolicyViolation,
  type PolicyRuleTargetContext,
} from '@codepol/core';

type CliOptions = {
  fix: boolean;
  watch: boolean;
  checkPlugins: boolean;
  policy: string;
  eslintConfig: string;
};

type PolicyCheckResult = {
  policy: PolicyFile;
  files: string[];
  eslintOutput: string;
  eslintHasErrors: boolean;
  violations: PolicyViolation[];
};

type LintProviderEntry = {
  provider: LintProvider;
  ruleId: string;
  ruleArgs?: unknown;
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
    for (const target of rule.targets) {
      targets.push({
        ruleId: rule.id || rule.ruleId,
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
  context: { policy: PolicyFile; policyPath: string; cwd: string; ruleTargets: PolicyRuleTargetContext[] }
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

    const ruleConfig = eslintConfig.rulesConfigGet({
      ...context,
      ruleId: entry.ruleId,
      ruleArgs: entry.ruleArgs,
    });
    const configKey = `${eslintConfig.pluginName}/${ruleNameShort}`;
    if (!(configKey in ruleConfig)) {
      throw new Error(
        `ESLint provider ${eslintConfig.pluginName} did not return config for ${configKey}.`
      );
    }
    if (rules[configKey]) {
      throw new Error(`Duplicate ESLint rule configuration detected: ${configKey}.`);
    }
    rules[configKey] = ruleConfig[configKey];
  }

  return { rules } as ESLint.Options['overrideConfig'];
}

async function fixProvidersApply(
  providers: FixProvider[],
  context: { policy: PolicyFile; policyPath: string; cwd: string; files: string[]; ruleTargets: PolicyRuleTargetContext[] }
): Promise<void> {
  for (const provider of providers) {
    await provider.apply(context);
  }
}

async function policyCheck(options: {
  policyPath: string;
  eslintConfigPath: string;
  fix: boolean;
  cwd: string;
}): Promise<PolicyCheckResult> {
  const { policyPath, eslintConfigPath, fix, cwd } = options;

  const policy = policyFileGet(policyPath);
  // Use core policyPluginsGet instead of local implementation
  const rulePluginsResult = await policyPluginsGet(policy, cwd);
  if ('Err' in rulePluginsResult) {
    throw new Error(rulePluginsResult.Err);
  }
  const rulePluginsMap = rulePluginsResult.Ok;
  const rulePlugins = Array.from(rulePluginsMap.values());
  const ruleTargets = policyRuleTargetsGet(policy);

  // Collect lint providers from all rule plugins
  // Args are now on policy rules, not plugins - they're passed via ruleTargets
  const lintProviderEntries: LintProviderEntry[] = [];
  for (const entry of rulePlugins) {
    const lintProviders = entry.rulePlugin.capabilities.lintProviders ?? [];
    for (const provider of lintProviders) {
      // Find the policy rule that uses this plugin to get its args
      const matchingRule = policy.rules.find(r => 
        r.ruleId === entry.rulePlugin.id || 
        entry.rulePlugin.id.endsWith(`/${r.ruleId}`)
      );
      lintProviderEntries.push({
        provider,
        ruleId: entry.rulePlugin.id,
        ruleArgs: matchingRule?.args,
      });
    }
  }

  // Filter to ESLint providers
  const eslintProviders = lintProviderEntries.filter(
    entry => entry.provider.platform === 'eslint'
  );

  const fixProviders = rulePlugins
    .map(entry => entry.rulePlugin.capabilities.fixProvider)
    .filter((provider): provider is FixProvider => provider !== undefined);

  const matches = await ruleMatchesGet(policy, cwd);
  const files = Array.from(new Set(matches.flatMap(match => match.files)));

  if (fix && fixProviders.length > 0) {
    await fixProvidersApply(fixProviders, { policy, policyPath, cwd, files, ruleTargets });
  }

  let eslintOutput = '';
  let eslintHasErrors = false;
  if (eslintProviders.length > 0) {
    const eslint = new ESLint({
      overrideConfigFile: eslintConfigPath,
      overrideConfig: eslintConfigGet(eslintProviders, { policy, policyPath, cwd, ruleTargets }),
      fix,
      cwd,
    });

    const lintResults = files.length > 0 ? await eslint.lintFiles(files) : [];
    if (fix) {
      await ESLint.outputFixes(lintResults);
    }
    const formatter = await eslint.loadFormatter('stylish');
    eslintOutput = lintResults.length > 0 ? (await formatter.format(lintResults)).trim() : '';
    eslintHasErrors = lintResults.some(result => result.errorCount > 0);
  }

  const violationsResult = await policyViolationsGetFromDir(policy, cwd);

  if ('Err' in violationsResult) {
    // Error already logged in core
    throw new Error(violationsResult.Err);
  }

  return {
    policy,
    files,
    eslintOutput,
    eslintHasErrors,
    violations: violationsResult.Ok!,
  };
}

async function policyCheckAndPrintOutput(options: CliOptions): Promise<boolean> {
  const cwd = process.cwd();
  const result = await policyCheck({
    policyPath: options.policy,
    eslintConfigPath: options.eslintConfig,
    fix: options.fix,
    cwd,
  });

  const outputs: string[] = [];
  if (result.eslintOutput.length > 0) {
    outputs.push(result.eslintOutput);
  }
  const treeOutput = policyViolationsGetOutputPretty(result.violations, cwd);
  if (treeOutput) {
    outputs.push('Tree-sitter policy violations:');
    outputs.push(treeOutput);
  }

  if (outputs.length > 0) {
    console.log(outputs.join('\n\n'));
  } else {
    console.log('✔ Policy checks passed');
  }

  return !result.eslintHasErrors && result.violations.length === 0;
}

async function policyPluginsValidateAndPrint(options: CliOptions): Promise<void> {
  const cwd = process.cwd();
  const policy = policyFileGet(options.policy);
  const policyPluginsResult = await policyPluginsGet(policy, cwd);
  if ('Err' in policyPluginsResult) {
    throw new Error(policyPluginsResult.Err);
  }
  
  // policyPluginsGet now returns RulePlugin map, which includes ruleId directly
  const rulePluginIds = Array.from(policyPluginsResult.Ok.keys()).sort();

  console.log('✔ Plugins validated');
  console.log(`Rule plugins (${rulePluginIds.length}): ${rulePluginIds.join(', ') || 'none'}`);
}

function fsSubNew(options: CliOptions, files: string[], patterns: string[]): void {
  const watchItems = new Set<string>([options.policy]);
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
    .option('policy', {
      type: 'string',
      default: path.resolve('policy.json'),
      describe: 'Path to the policy file',
    })
    .option('eslint-config', {
      type: 'string',
      default: eslintConfigPathDetect(process.cwd()),
      describe: 'Path to the ESLint config file (auto-detects .js, .mjs, .cjs, .ts, .mts, .cts)',
    })
    .option('check-plugins', {
      type: 'boolean',
      default: false,
      describe: 'Validate policy and rule plugins, then exit',
    })
    .example('$0', 'Run policy checks once')
    .example('$0 --fix', 'Run checks and apply fixes')
    .example('$0 --watch', 'Watch for changes and re-run checks')
    .example('$0 --policy ./config/policy.json', 'Use custom policy file')
    .example('$0 --check-plugins', 'Validate plugins for the policy file')
    .help()
    .version()
    .parseAsync();

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
    fix: fix,
    watch: watch,
    checkPlugins: checkPlugins,
    policy: path.resolve(argv.policy as string),
    eslintConfig: path.resolve(argv['eslint-config'] as string),
  };

  if (options.checkPlugins) {
    await policyPluginsValidateAndPrint(options);
    return;
  }

  const policy = policyFileGet(options.policy);
  const matches = await ruleMatchesGet(policy, process.cwd());
  const files = Array.from(new Set(matches.flatMap(match => match.files)));
  const patterns = Array.from(
    new Set(policy.rules.flatMap(rule => rule.targets.flatMap(target => target.files)))
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
