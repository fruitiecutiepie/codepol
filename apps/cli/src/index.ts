#!/usr/bin/env node
/**
 * @packageDocumentation
 * @codepol/cli - Command-line interface for codepol policy enforcement.
 *
 * Usage:
 *   codepol [options]
 *
 * Options:
 *   --fix          Apply available fixes where possible
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
import {
  langAdd,
  parserInit,
  policyRuleTargetsResolve,
  ruleMatchesGet,
  policyViolationsGetFromDir,
  policyViolationsGetOutputPretty,
  policyPluginsGet,
  pluginModuleRegister,
  ESLINT_PLUGIN_NAME_DEFAULT,
  configGet,
  configGetFromPath,
  isErr,
  type LintProvider,
  type LintSeverity,
  type EslintProviderConfig,
  type RuffProviderConfig,
  type FixProvider,
  type PolicyFile,
  type PolicyViolation,
  type PolicyWorkspaceEdit,
  type PolicyRuleTargetContext,
  type CodepolConfig,
} from '@codepol/core';
import { eslintPluginCreate } from '@codepol/plugin-eslint';
import { ruffCheck, ruffFix } from '@codepol/plugin-ruff';
import codepolPlugin from '@codepol/plugin';
import vulturePlugin from '@codepol/plugin-vulture';

pluginModuleRegister('@codepol/plugin', { default: codepolPlugin });
pluginModuleRegister('@codepol/plugin-vulture', { default: vulturePlugin });

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

function policyViolationWorkspaceEditsGet(
  violation: PolicyViolation,
): PolicyWorkspaceEdit[] {
  const fix = violation.fix;
  if (!fix) {
    return [];
  }
  if (fix.edits && fix.edits.length > 0) {
    return fix.edits;
  }
  return [
    {
      filePath: violation.filePath,
      byteRange: fix.byteRange,
      text: fix.text,
    },
  ];
}

function fileWorkspaceEditsNormalize(
  edits: PolicyWorkspaceEdit[],
): PolicyWorkspaceEdit[] {
  const sorted = [...edits].sort((a, b) => {
    if (a.byteRange.start !== b.byteRange.start) {
      return a.byteRange.start - b.byteRange.start;
    }
    if (a.byteRange.end !== b.byteRange.end) {
      return a.byteRange.end - b.byteRange.end;
    }
    return a.text.localeCompare(b.text);
  });

  const normalized: PolicyWorkspaceEdit[] = [];
  for (const edit of sorted) {
    const prev = normalized[normalized.length - 1];
    if (
      prev &&
      prev.byteRange.start === edit.byteRange.start &&
      prev.byteRange.end === edit.byteRange.end &&
      prev.text === edit.text
    ) {
      continue;
    }
    if (prev && edit.byteRange.start < prev.byteRange.end) {
      continue;
    }
    normalized.push(edit);
  }

  return normalized;
}

function fileWorkspaceEditsApply(
  source: string,
  edits: PolicyWorkspaceEdit[],
): string {
  if (edits.length === 0) {
    return source;
  }

  const input = Buffer.from(source, 'utf8');
  const chunks: Buffer[] = [];
  let cursor = 0;

  for (const edit of edits) {
    chunks.push(input.subarray(cursor, edit.byteRange.start));
    chunks.push(Buffer.from(edit.text, 'utf8'));
    cursor = edit.byteRange.end;
  }

  chunks.push(input.subarray(cursor));
  return Buffer.concat(chunks).toString('utf8');
}

function treeCheckFixesApply(violations: PolicyViolation[]): boolean {
  const editsByFile = new Map<string, PolicyWorkspaceEdit[]>();

  for (const violation of violations) {
    for (const edit of policyViolationWorkspaceEditsGet(violation)) {
      const list = editsByFile.get(edit.filePath) ?? [];
      list.push(edit);
      editsByFile.set(edit.filePath, list);
    }
  }

  let changed = false;
  for (const [filePath, fileEdits] of editsByFile) {
    const normalized = fileWorkspaceEditsNormalize(fileEdits);
    if (normalized.length === 0) {
      continue;
    }

    const source = fs.readFileSync(filePath, 'utf8');
    const next = fileWorkspaceEditsApply(source, normalized);
    if (next === source) {
      continue;
    }

    fs.writeFileSync(filePath, next, 'utf8');
    changed = true;
  }

  return changed;
}

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
 * The CLI injects the adapted codepol ESLint plugin directly at runtime, so
 * this helper only needs to return the enabled rules and their options.
 */
function eslintConfigGet(
  providers: LintProviderEntry[],
  context: { policy: PolicyFile; configPath: string; cwd: string; ruleTargets: PolicyRuleTargetContext[] }
): Record<string, unknown> {
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
    // Construct [severity, options] - severity from config, defaults to 'error'
    const severity = entry.severity ?? 'error';
    rules[configKey] = [severity, options];
  }

  return { rules };
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
  const pluginRulesResult = await policyPluginsGet(policy, cwd, { configPath });
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

      // Skip providers for plugin rules that have no matching policy rule
      if (!matchingRule) continue;
      
      // Skip if rule specifies providers and this provider's platform is not included
      if (matchingRule.providers && matchingRule.providers.length > 0) {
        if (!matchingRule.providers.includes(provider.platform)) {
          continue;
        }
      }
      
      lintProviderEntries.push({
        provider,
        ruleId: entry.pluginRule.id,
        ruleArgs: matchingRule.args,
        severity: matchingRule.severity,
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

  if (fix) {
    const treeFixViolationsResult = await policyViolationsGetFromDir(policy, cwd, {
      configPath,
    });
    if ('Err' in treeFixViolationsResult) {
      throw new Error(treeFixViolationsResult.Err);
    }
    treeCheckFixesApply(treeFixViolationsResult.Ok);
  }

  const eslintViolations: PolicyViolation[] = [];
  if (eslintProviders.length > 0) {
    let ESLint: typeof import('eslint').ESLint;
    try {
      const eslintModule = await import('eslint');
      ESLint = eslintModule.ESLint;
    } catch {
      console.warn(
        'ESLint is not installed. Skipping ESLint-based rules.\n' +
        'Install eslint to enable: npm install -D eslint'
      );
      ESLint = undefined!;
    }

    if (ESLint) {
      const eslint = new ESLint({
        overrideConfigFile: eslintConfigPath,
        plugins: {
          codepol: eslintPluginCreate(pluginRules.map((entry) => entry.pluginRule)) as unknown as import('eslint').ESLint.Plugin,
        },
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
  }

  // Run ruff on Python files
  const ruffProviders = lintProviderEntries.filter(
    entry => entry.provider.platform === 'ruff'
  );

  const ruffViolations: PolicyViolation[] = [];
  const pythonFiles = files.filter(f => f.endsWith('.py') || f.endsWith('.pyw'));
  if (pythonFiles.length > 0 && ruffProviders.length > 0) {
    const ruffConfig = ruffProviders[0]?.provider.config as RuffProviderConfig | undefined;

    if (fix) {
      ruffFix(pythonFiles, ruffConfig);
    }

    const ruffResult = ruffCheck(pythonFiles, ruffConfig);
    if (isErr(ruffResult)) {
      console.warn(`ruff check failed: ${ruffResult.Err}`);
    } else {
      ruffViolations.push(...ruffResult.Ok);
    }
  }

  const violationsResult = await policyViolationsGetFromDir(policy, cwd);

  if ('Err' in violationsResult) {
    throw new Error(violationsResult.Err);
  }

  return {
    policy,
    files,
    violations: [...eslintViolations, ...ruffViolations, ...violationsResult.Ok],
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
  const policyPluginsResult = await policyPluginsGet(policy, cwd, { configPath: options.configPath });
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
  langAdd({ langId: 'python', fileExtensions: ['.py', '.pyw'] });
  await parserInit();

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
