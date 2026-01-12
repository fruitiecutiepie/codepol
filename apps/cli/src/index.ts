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

import path from 'node:path';
import { pathToFileURL } from 'node:url';
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
  defaultPluginType,
  policyPluginsGet,
  rulePluginLanguagesGet,
  type CodepolRulePlugin,
  type LintProvider,
  type EslintProviderConfig,
  type FixProvider,
  type PolicyFile,
  type PolicyPluginDeclaration,
  type PolicyPluginRuleDeclaration,
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

type RulePluginEntry = {
  rulePlugin: CodepolRulePlugin;
  args?: unknown;
  sourceLabel: string;
};

type LintProviderEntry = {
  provider: LintProvider;
  ruleId: string;
  ruleArgs?: unknown;
};


function policyRuleTargetsGet(policy: PolicyFile): PolicyRuleTargetContext[] {
  const targets: PolicyRuleTargetContext[] = [];
  for (const rule of policy.rules) {
    for (const target of rule.targets) {
      targets.push({
        ruleId: rule.id,
        semantics: rule.semantics,
        target,
      });
    }
  }
  return targets;
}

function rulePluginsNormalize(
  exported: unknown,
  sourceLabel: string
): CodepolRulePlugin[] {
  if (!exported) {
    throw new Error(`No rule plugins exported by ${sourceLabel}.`);
  }
  if (Array.isArray(exported)) {
    return exported as CodepolRulePlugin[];
  }
  if (typeof exported === 'object' && exported !== undefined) {
    const candidate = exported as { rulePlugins?: unknown };
    if (Array.isArray(candidate.rulePlugins)) {
      return candidate.rulePlugins as CodepolRulePlugin[];
    }
    return [exported as CodepolRulePlugin];
  }
  throw new Error(`Invalid rule plugin export from ${sourceLabel}.`);
}

function rulePluginValidate(rulePlugin: CodepolRulePlugin, sourceLabel: string): void {
  if (!rulePlugin || typeof rulePlugin !== 'object') {
    throw new Error(`Invalid rule plugin exported by ${sourceLabel}.`);
  }
  if (!rulePlugin.id || typeof rulePlugin.id !== 'string') {
    throw new Error(`Rule plugin from ${sourceLabel} must declare an id.`);
  }
  const capabilities = rulePlugin.capabilities;
  const hasLintProviders = capabilities.lintProviders && capabilities.lintProviders.length > 0;
  if (!hasLintProviders && !capabilities.treeCheckProvider && !capabilities.fixProvider) {
    throw new Error(`Rule plugin ${rulePlugin.id} must declare at least one capability.`);
  }
  const languages = rulePluginLanguagesGet(rulePlugin);
  if (languages.length === 0) {
    throw new Error(`Rule plugin ${rulePlugin.id} must support at least one language via its providers.`);
  }
}

async function policyRulePluginsGet(
  policy: PolicyFile,
  cwd: string
): Promise<RulePluginEntry[]> {
  const declarations = policy.plugins ?? [];
  const rulePlugins: RulePluginEntry[] = [];
  const rulePluginIds = new Set<string>();

  for (const declaration of declarations) {
    const moduleSpecifier = declaration.module;
    const moduleSource =
      moduleSpecifier.startsWith('.') || moduleSpecifier.startsWith('/')
        ? pathToFileURL(path.resolve(cwd, moduleSpecifier)).href
        : moduleSpecifier;
    const moduleLoaded = await import(moduleSource);
    const pluginExported = moduleLoaded[declaration.export];
    if (!pluginExported) {
      throw new Error(`Module ${moduleSpecifier} does not export "${declaration.export}".`);
    }

    const normalizedRules = rulePluginsNormalize(pluginExported, moduleSpecifier);
    const ruleOverrides = new Map<string, PolicyPluginRuleDeclaration>();
    if (declaration.rules != undefined) {
      for (const rule of declaration.rules) {
        ruleOverrides.set(rule.id, rule);
      }
    }
    const ruleIdsSeen = new Set<string>();

    for (const rulePlugin of normalizedRules) {
      rulePluginValidate(rulePlugin, moduleSpecifier);
      if (ruleIdsSeen.has(rulePlugin.id)) {
        throw new Error(`Duplicate rule id ${rulePlugin.id} exported by ${moduleSpecifier}.`);
      }
      ruleIdsSeen.add(rulePlugin.id);
      const override = ruleOverrides.get(rulePlugin.id);
      if (override?.enabled === false) {
        continue;
      }
      if (rulePluginIds.has(rulePlugin.id)) {
        throw new Error(`Duplicate rule id detected: ${rulePlugin.id}.`);
      }
      rulePluginIds.add(rulePlugin.id);
      rulePlugins.push({
        rulePlugin,
        args: override?.args,
        sourceLabel: moduleSpecifier,
      });
    }

    for (const ruleId of ruleOverrides.keys()) {
      if (!ruleIdsSeen.has(ruleId)) {
        throw new Error(`Plugin ${moduleSpecifier} does not export rule ${ruleId}.`);
      }
    }
  }

  return rulePlugins;
}

function eslintConfigGet(
  providers: LintProviderEntry[],
  context: { policy: PolicyFile; policyPath: string; cwd: string; ruleTargets: PolicyRuleTargetContext[] }
): ESLint.Options['overrideConfig'] {
  const plugins: Record<string, ESLint.Plugin> = {};
  const rules: Record<string, unknown> = {};
  const pluginRules: Record<string, Record<string, unknown>> = {};
  const pluginConfigs: Record<string, Record<string, unknown>> = {};

  for (const entry of providers) {
    if (entry.provider.platform !== 'eslint') {
      continue;
    }
    const eslintConfig = entry.provider.config as EslintProviderConfig;
    const ruleName = entry.ruleId;
    if (!pluginRules[eslintConfig.pluginName]) {
      pluginRules[eslintConfig.pluginName] = {};
    }
    const ruleSet = eslintConfig.rules as Record<string, unknown>;
    const ruleDefinition = ruleSet[ruleName];
    if (!ruleDefinition) {
      throw new Error(
        `ESLint provider ${eslintConfig.pluginName} did not export rule ${ruleName}.`
      );
    }
    if (pluginRules[eslintConfig.pluginName][ruleName]) {
      throw new Error(`Duplicate ESLint rule detected: ${eslintConfig.pluginName}/${ruleName}.`);
    }
    pluginRules[eslintConfig.pluginName][ruleName] = ruleDefinition;
    if (eslintConfig.configs) {
      if (!pluginConfigs[eslintConfig.pluginName]) {
        pluginConfigs[eslintConfig.pluginName] = {};
      }
      for (const [configName, configValue] of Object.entries(eslintConfig.configs)) {
        if (pluginConfigs[eslintConfig.pluginName][configName]) {
          throw new Error(`Duplicate ESLint config detected: ${eslintConfig.pluginName}/${configName}.`);
        }
        pluginConfigs[eslintConfig.pluginName][configName] = configValue;
      }
    }
    const ruleConfig = eslintConfig.rulesConfigGet({
      ...context,
      ruleId: entry.ruleId,
      ruleArgs: entry.ruleArgs,
    });
    const configKey = `${eslintConfig.pluginName}/${ruleName}`;
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

  for (const [pluginName, ruleSet] of Object.entries(pluginRules)) {
    plugins[pluginName] = {
      rules: ruleSet as ESLint.Plugin['rules'],
      ...(pluginConfigs[pluginName]
        ? { configs: pluginConfigs[pluginName] as ESLint.Plugin['configs'] }
        : {}),
    };
  }

  return {
    plugins,
    rules,
  } as ESLint.Options['overrideConfig'];
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
  const rulePlugins = await policyRulePluginsGet(policy, cwd);
  const ruleTargets = policyRuleTargetsGet(policy);

  // Collect lint providers from all rule plugins
  const lintProviderEntries: LintProviderEntry[] = [];
  for (const entry of rulePlugins) {
    const lintProviders = entry.rulePlugin.capabilities.lintProviders ?? [];
    for (const provider of lintProviders) {
      lintProviderEntries.push({
        provider,
        ruleId: entry.rulePlugin.id,
        ruleArgs: entry.args,
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
  const policyPlugins = Array.from(policyPluginsResult.Ok.values()).map(plugin => plugin.id).sort();
  const rulePlugins = await policyRulePluginsGet(policy, cwd);
  const rulePluginIds = rulePlugins.map(entry => entry.rulePlugin.id).sort();

  console.log('✔ Plugins validated');
  console.log(`Policy plugins (${policyPlugins.length}): ${policyPlugins.join(', ') || 'none'}`);
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
      default: path.resolve('eslint.config.js'),
      describe: 'Path to the ESLint config file',
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
