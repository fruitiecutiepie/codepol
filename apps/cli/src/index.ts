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
  type CodepolPlugin,
  type EslintRuleProvider,
  type FixProvider,
  type PolicyFile,
  type PolicyPluginDeclaration,
  type PolicyViolation,
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

const builtinPluginModules: Record<string, string> = {
  logger: '@codepol/plugin-logger',
};

async function policyPluginsGetCapabilities(
  policy: PolicyFile,
  cwd: string
): Promise<Map<string, CodepolPlugin>> {
  let declarations: PolicyPluginDeclaration[] = [];
  if (policy.plugins != null) {
    declarations = policy.plugins;
  }
  const pluginsMap = new Map<string, CodepolPlugin>();

  const pluginLoad = async (
    declaration: PolicyPluginDeclaration,
    moduleSpecifier: string
  ): Promise<CodepolPlugin> => {
    const moduleSource =
      moduleSpecifier.startsWith('.') || moduleSpecifier.startsWith('/')
        ? pathToFileURL(path.resolve(cwd, moduleSpecifier)).href
        : moduleSpecifier;
    const moduleLoaded = await import(moduleSource);
    let pluginExported;
    if (declaration.export) {
      pluginExported = moduleLoaded[declaration.export];
    } else {
      pluginExported = moduleLoaded.plugin;
      if (moduleLoaded.default != null) {
        pluginExported = moduleLoaded.default;
      }
    }
    if (!pluginExported || typeof pluginExported !== 'object') {
      throw new Error(`Invalid plugin exported by ${moduleSpecifier}.`);
    }
    const pluginValue = pluginExported as Partial<CodepolPlugin>;
    if (!pluginValue.id || !pluginValue.version) {
      throw new Error(`Plugin ${moduleSpecifier} must declare id and version.`);
    }
    let capabilities: CodepolPlugin['capabilities'] = {};
    if (pluginValue.capabilities != null) {
      capabilities = pluginValue.capabilities;
    }
    return {
      id: pluginValue.id,
      version: pluginValue.version,
      capabilities,
    };
  };

  for (const declaration of declarations) {
    let moduleSpecifier: string | undefined = declaration.builtin ? builtinPluginModules[declaration.builtin] : undefined;
    if (declaration.module != null) {
      moduleSpecifier = declaration.module;
    }
    if (!moduleSpecifier) {
      continue;
    }
    const plugin = await pluginLoad(declaration, moduleSpecifier);
    if (pluginsMap.has(plugin.id)) {
      throw new Error(`Duplicate plugin id detected: ${plugin.id}.`);
    }
    pluginsMap.set(plugin.id, plugin);
  }

  const ruleTypes = new Set(policy.rules.map(rule => {
    let ruleType = defaultPluginType;
    if (rule.type != null) {
      ruleType = rule.type;
    }
    return ruleType;
  }));
  for (const ruleType of ruleTypes) {
    if (pluginsMap.has(ruleType)) {
      continue;
    }
    const moduleSpecifier = builtinPluginModules[ruleType];
    if (!moduleSpecifier) {
      continue;
    }
    const plugin = await pluginLoad({ builtin: ruleType }, moduleSpecifier);
    if (!pluginsMap.has(plugin.id)) {
      pluginsMap.set(plugin.id, plugin);
    }
  }

  return pluginsMap;
}

function eslintConfigGet(
  providers: EslintRuleProvider[],
  context: { policy: PolicyFile; policyPath: string; cwd: string }
): ESLint.Options['overrideConfig'] {
  const plugins: Record<string, ESLint.Plugin> = {};
  const rules: Record<string, unknown> = {};

  for (const provider of providers) {
    if (plugins[provider.pluginName]) {
      throw new Error(`Duplicate ESLint plugin name detected: ${provider.pluginName}.`);
    }
    plugins[provider.pluginName] = {
      rules: provider.rules as ESLint.Plugin['rules'],
      ...(provider.configs ? { configs: provider.configs as ESLint.Plugin['configs'] } : {}),
    };
    Object.assign(rules, provider.rulesConfigGet(context));
  }

  return {
    plugins,
    rules,
  } as ESLint.Options['overrideConfig'];
}

async function fixProvidersApply(
  providers: FixProvider[],
  context: { policy: PolicyFile; policyPath: string; cwd: string; files: string[] }
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
  const capabilityPlugins = await policyPluginsGetCapabilities(policy, cwd);
  const eslintRuleProviders = Array.from(capabilityPlugins.values())
    .map(plugin => plugin.capabilities.eslintRuleProvider)
    .filter((provider): provider is EslintRuleProvider => Boolean(provider));
  const fixProviders = Array.from(capabilityPlugins.values())
    .map(plugin => plugin.capabilities.fixProvider)
    .filter((provider): provider is FixProvider => Boolean(provider));

  const matches = await ruleMatchesGet(policy, cwd);
  const files = Array.from(new Set(matches.flatMap(match => match.files)));

  if (fix && fixProviders.length > 0) {
    await fixProvidersApply(fixProviders, { policy, policyPath, cwd, files });
  }

  let eslintOutput = '';
  let eslintHasErrors = false;
  if (eslintRuleProviders.length > 0) {
    const eslint = new ESLint({
      overrideConfigFile: eslintConfigPath,
      overrideConfig: eslintConfigGet(eslintRuleProviders, { policy, policyPath, cwd }),
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

  let fixValue = false;
  if (argv.fix != null) {
    fixValue = argv.fix;
  }
  let watchValue = false;
  if (argv.watch != null) {
    watchValue = argv.watch;
  }
  const options: CliOptions = {
    fix: fixValue,
    watch: watchValue,
    policy: path.resolve(argv.policy as string),
    eslintConfig: path.resolve(argv['eslint-config'] as string),
  };

  const policy = policyFileGet(options.policy);
  const matches = await ruleMatchesGet(policy, process.cwd());
  const files = Array.from(new Set(matches.flatMap(match => match.files)));
  const patterns = Array.from(new Set(policy.rules.flatMap(rule => rule.files)));

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
