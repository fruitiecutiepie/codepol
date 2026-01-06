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
  type CodepolRulePlugin,
  type EslintRuleProvider,
  type FixProvider,
  type PolicyFile,
  type PolicyPluginDeclaration,
  type PolicyPluginRuleDeclaration,
  type PolicyPluginCapabilities,
  type PolicyViolation,
  type PolicyRuleTargetContext,
} from '@codepol/core';

type CliOptions = {
  fix: boolean;
  watch: boolean;
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
  options?: unknown;
  sourceLabel: string;
};

type EslintRuleProviderEntry = {
  provider: EslintRuleProvider;
  ruleId: string;
  ruleOptions?: unknown;
};

const builtinPluginModules: Record<string, string> = {
  logger: '@codepol/plugin-logger',
};

function rulePluginCapabilitiesGet(rulePlugin: CodepolRulePlugin): PolicyPluginCapabilities {
  if (rulePlugin.capabilities != null) {
    return rulePlugin.capabilities;
  }
  return {
    eslintRuleProvider: rulePlugin.eslintRuleProvider,
    treeScanProvider: rulePlugin.treeScanProvider,
    fixProvider: rulePlugin.fixProvider,
  };
}

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
  if (typeof exported === 'object' && exported !== null) {
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
  if (!Array.isArray(rulePlugin.languages) || rulePlugin.languages.some(lang => typeof lang !== 'string')) {
    throw new Error(`Rule plugin ${rulePlugin.id} must declare supported languages.`);
  }
  const capabilities = rulePluginCapabilitiesGet(rulePlugin);
  if (!capabilities.eslintRuleProvider && !capabilities.treeScanProvider && !capabilities.fixProvider) {
    throw new Error(`Rule plugin ${rulePlugin.id} must declare at least one capability.`);
  }
}

async function policyRulePluginsGet(
  policy: PolicyFile,
  cwd: string
): Promise<RulePluginEntry[]> {
  let declarations: PolicyPluginDeclaration[] = [];
  if (policy.plugins != null) {
    declarations = policy.plugins;
  }
  const declarationsNormalized = [...declarations];
  const declaredModules = new Set(declarations.filter(decl => decl.module).map(decl => decl.module!));
  const declaredBuiltins = new Set(declarations.filter(decl => decl.builtin).map(decl => decl.builtin!));

  const ruleTypes = new Set(policy.rules.map(rule => rule.semantics.type ?? defaultPluginType));
  for (const ruleType of ruleTypes) {
    const builtinModule = builtinPluginModules[ruleType];
    if (!builtinModule) {
      continue;
    }
    if (declaredBuiltins.has(ruleType) || declaredModules.has(builtinModule)) {
      continue;
    }
    declarationsNormalized.push({ builtin: ruleType });
  }

  const rulePlugins: RulePluginEntry[] = [];
  const rulePluginIds = new Set<string>();

  for (const declaration of declarationsNormalized) {
    let moduleSpecifier: string | undefined = declaration.builtin
      ? builtinPluginModules[declaration.builtin]
      : undefined;
    if (declaration.module != null) {
      moduleSpecifier = declaration.module;
    }
    if (!moduleSpecifier) {
      continue;
    }
    const sourceLabel = declaration.builtin ? `builtin:${declaration.builtin}` : moduleSpecifier;
    const moduleSource =
      moduleSpecifier.startsWith('.') || moduleSpecifier.startsWith('/')
        ? pathToFileURL(path.resolve(cwd, moduleSpecifier)).href
        : moduleSpecifier;
    const moduleLoaded = await import(moduleSource);
    let pluginExported: unknown;
    if (declaration.export) {
      pluginExported = moduleLoaded[declaration.export];
    } else if (moduleLoaded.rulePlugins != null) {
      pluginExported = moduleLoaded.rulePlugins;
    } else if (moduleLoaded.default != null) {
      pluginExported = moduleLoaded.default;
    } else if (moduleLoaded.plugin != null) {
      pluginExported = moduleLoaded.plugin;
    } else {
      throw new Error(`No rule plugins export found in ${moduleSpecifier}.`);
    }

    const normalizedRules = rulePluginsNormalize(pluginExported, sourceLabel);
    const ruleOverrides = new Map<string, PolicyPluginRuleDeclaration>();
    if (declaration.rules != null) {
      for (const rule of declaration.rules) {
        ruleOverrides.set(rule.id, rule);
      }
    }
    const ruleIdsSeen = new Set<string>();

    for (const rulePlugin of normalizedRules) {
      rulePluginValidate(rulePlugin, sourceLabel);
      if (ruleIdsSeen.has(rulePlugin.id)) {
        throw new Error(`Duplicate rule id ${rulePlugin.id} exported by ${sourceLabel}.`);
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
        options: override?.options,
        sourceLabel,
      });
    }

    for (const ruleId of ruleOverrides.keys()) {
      if (!ruleIdsSeen.has(ruleId)) {
        throw new Error(`Plugin ${sourceLabel} does not export rule ${ruleId}.`);
      }
    }
  }

  return rulePlugins;
}

function eslintConfigGet(
  providers: EslintRuleProviderEntry[],
  context: { policy: PolicyFile; policyPath: string; cwd: string; ruleTargets: PolicyRuleTargetContext[] }
): ESLint.Options['overrideConfig'] {
  const plugins: Record<string, ESLint.Plugin> = {};
  const rules: Record<string, unknown> = {};
  const pluginRules: Record<string, Record<string, unknown>> = {};
  const pluginConfigs: Record<string, Record<string, unknown>> = {};

  for (const entry of providers) {
    const provider = entry.provider;
    const ruleName = entry.ruleId;
    if (!pluginRules[provider.pluginName]) {
      pluginRules[provider.pluginName] = {};
    }
    const ruleSet = provider.rules as Record<string, unknown>;
    const ruleDefinition = ruleSet[ruleName];
    if (!ruleDefinition) {
      throw new Error(
        `ESLint provider ${provider.pluginName} did not export rule ${ruleName}.`
      );
    }
    if (pluginRules[provider.pluginName][ruleName]) {
      throw new Error(`Duplicate ESLint rule detected: ${provider.pluginName}/${ruleName}.`);
    }
    pluginRules[provider.pluginName][ruleName] = ruleDefinition;
    if (provider.configs) {
      if (!pluginConfigs[provider.pluginName]) {
        pluginConfigs[provider.pluginName] = {};
      }
      for (const [configName, configValue] of Object.entries(provider.configs)) {
        if (pluginConfigs[provider.pluginName][configName]) {
          throw new Error(`Duplicate ESLint config detected: ${provider.pluginName}/${configName}.`);
        }
        pluginConfigs[provider.pluginName][configName] = configValue;
      }
    }
    const ruleConfig = provider.rulesConfigGet({
      ...context,
      ruleId: entry.ruleId,
      ruleOptions: entry.ruleOptions,
    });
    const configKey = `${provider.pluginName}/${ruleName}`;
    if (!(configKey in ruleConfig)) {
      throw new Error(
        `ESLint provider ${provider.pluginName} did not return config for ${configKey}.`
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
  const eslintRuleProviders = rulePlugins
    .map((entry): EslintRuleProviderEntry | null => {
      const capabilities = rulePluginCapabilitiesGet(entry.rulePlugin);
      if (!capabilities.eslintRuleProvider) {
        return null;
      }
      return {
        provider: capabilities.eslintRuleProvider,
        ruleId: entry.rulePlugin.id,
        ruleOptions: entry.options,
      };
    })
    .filter((entry): entry is EslintRuleProviderEntry => entry !== null);
  const fixProviders = rulePlugins
    .map(entry => rulePluginCapabilitiesGet(entry.rulePlugin).fixProvider)
    .filter((provider): provider is FixProvider => Boolean(provider));

  const matches = await ruleMatchesGet(policy, cwd);
  const files = Array.from(new Set(matches.flatMap(match => match.files)));

  if (fix && fixProviders.length > 0) {
    await fixProvidersApply(fixProviders, { policy, policyPath, cwd, files, ruleTargets });
  }

  let eslintOutput = '';
  let eslintHasErrors = false;
  if (eslintRuleProviders.length > 0) {
    const eslint = new ESLint({
      overrideConfigFile: eslintConfigPath,
      overrideConfig: eslintConfigGet(eslintRuleProviders, { policy, policyPath, cwd, ruleTargets }),
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
    .example('$0', 'Run policy checks once')
    .example('$0 --fix', 'Run checks and apply fixes')
    .example('$0 --watch', 'Watch for changes and re-run checks')
    .example('$0 --policy ./config/policy.json', 'Use custom policy file')
    .help()
    .version()
    .parseAsync();

  let fix = false;
  if (argv.fix != null) {
    fix = argv.fix;
  }
  let watch = false;
  if (argv.watch != null) {
    watch = argv.watch;
  }
  const options: CliOptions = {
    fix: fix,
    watch: watch,
    policy: path.resolve(argv.policy as string),
    eslintConfig: path.resolve(argv['eslint-config'] as string),
  };

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
