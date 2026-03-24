/**
 * @packageDocumentation
 * @codepol/plugin-esbuild - esbuild plugin for enforcing codepol policies.
 *
 * This plugin runs policy checks as part of your esbuild build process,
 * failing the build if any violations are found.
 *
 * @example
 * ```typescript
 * import { build } from 'esbuild';
 * import { esbuildPluginCreate } from '@codepol/plugin-esbuild';
 *
 * await build({
 *   entryPoints: ['src/index.ts'],
 *   bundle: true,
 *   outfile: 'dist/bundle.js',
 *   plugins: [
 *     // Zero-config: auto-discovers codepol.toml
 *     esbuildPluginCreate(),
 *   ],
 * });
 * ```
 */

import fs from 'node:fs';
import path from 'path';
import type { Plugin } from 'esbuild';
import { ESLint } from 'eslint';
import {
  langAdd,
  parserInit,
  policyPluginsGet,
  pluginModuleRegister,
  policyRuleTargetsResolve,
  ruleMatchesGet,
  policyViolationsGetFromDir,
  policyViolationsGetOutputPretty,
  configGet,
  configGetFromPath,
  ESLINT_PLUGIN_NAME_DEFAULT,
  type PolicyFile,
  type PolicyViolation,
  type PolicyRuleTargetContext,
  type CodepolConfig,
  type LintProvider,
  type LintSeverity,
  type EslintProviderConfig,
} from '@codepol/core';
import { eslintPluginCreate } from '@codepol/plugin-eslint';
import codepolPlugin from '@codepol/plugin';

pluginModuleRegister('@codepol/plugin', { default: codepolPlugin });

const ESLINT_CONFIG_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts'];

/**
 * Detects the ESLint config file by checking for common file names.
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

/**
 * Options for the esbuild policy plugin.
 */
export type PolicyPluginOptions = {
  /** Path to config file (auto-discovered if not specified) */
  configPath?: string;
  /** Path to the ESLint config file (uses config value or auto-detects) */
  eslintConfigPath?: string;
  /** Whether to apply ESLint fixes (default: false) */
  fix?: boolean;
  /** Working directory for resolving paths (default: esbuild's absWorkingDir or cwd) */
  cwd?: string;
};

type LintProviderEntry = {
  provider: LintProvider;
  ruleId: string;
  ruleArgs?: unknown;
  severity?: LintSeverity;
};

type PolicyCheckResult = {
  policy: PolicyFile;
  files: string[];
  eslintOutput: string;
  eslintHasErrors: boolean;
  treeViolations: PolicyViolation[];
};

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
 * Produces an `overrideConfig` object that enables the codepol rules
 * matching the policy, so ESLint actually runs (and optionally fixes) them.
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
    const ruleNameFull = entry.ruleId;
    const lastSlashIndex = ruleNameFull.lastIndexOf('/');
    const ruleNameShort = lastSlashIndex !== -1 ? ruleNameFull.slice(lastSlashIndex + 1) : ruleNameFull;

    const pluginName = eslintConfig.pluginName ?? ESLINT_PLUGIN_NAME_DEFAULT;
    const configKey = `${pluginName}/${ruleNameShort}`;
    if (rules[configKey]) {
      throw new Error(`Duplicate ESLint rule configuration detected: ${configKey}.`);
    }
    const options = eslintConfig.ruleOptions?.({
      ...context,
      ruleId: entry.ruleId,
      ruleArgs: entry.ruleArgs,
    }) ?? {};
    const severity = entry.severity ?? 'error';
    rules[configKey] = [severity, options];
  }

  return { rules } as ESLint.Options['overrideConfig'];
}

async function policyCheck(options: {
  config: CodepolConfig;
  configPath: string;
  eslintConfigPath: string;
  fix?: boolean;
  cwd: string;
}): Promise<PolicyCheckResult> {
  const { config, configPath, eslintConfigPath, fix, cwd } = options;

  // Register languages and initialize web-tree-sitter WASM parser
  langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
  langAdd({ langId: 'tsx', fileExtensions: ['.tsx'] });
  await parserInit();

  const policy = config as PolicyFile;

  // Load plugins from policy config (dynamic, not hardcoded import)
  const pluginRulesResult = await policyPluginsGet(policy, cwd, { configPath });
  if ('Err' in pluginRulesResult) {
    throw new Error(pluginRulesResult.Err);
  }
  const pluginRulesMap = pluginRulesResult.Ok;
  const pluginRules = Array.from(pluginRulesMap.values());
  const ruleTargets = policyRuleTargetsGet(policy);

  // Collect lint providers filtered by policy rules
  const lintProviderEntries: LintProviderEntry[] = [];
  for (const entry of pluginRules) {
    const lintProviders = entry.pluginRule.capabilities.lintProviders ?? [];
    for (const provider of lintProviders) {
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

  const eslintProviders = lintProviderEntries.filter(
    entry => entry.provider.platform === 'eslint'
  );

  const matches = await ruleMatchesGet(policy, cwd);
  const files = Array.from(new Set(matches.flatMap(matchGet => matchGet.files)));

  let fixEnabled = false;
  if (fix != null) {
    fixEnabled = fix;
  }

  // Build overrideConfig so codepol ESLint rules are actually enabled
  const overrideConfig = eslintProviders.length > 0
    ? eslintConfigGet(eslintProviders, { policy, configPath, cwd, ruleTargets })
    : undefined;

  const eslint = new ESLint({
    overrideConfigFile: eslintConfigPath,
    plugins: {
      codepol: eslintPluginCreate(pluginRules.map(pr => pr.pluginRule)) as unknown as ESLint.Plugin,
    },
    ...(overrideConfig ? { overrideConfig } : {}),
    fix: fixEnabled,
    cwd: cwd,
  });

  const lintResult = files.length > 0 ? await eslint.lintFiles(files) : [];
  if (fix) {
    await ESLint.outputFixes(lintResult);
  }
  const formatter = await eslint.loadFormatter('stylish');
  const eslintOutput = lintResult.length > 0 ? (await formatter.format(lintResult)).trim() : '';
  const eslintHasErrors = lintResult.some(result => result.errorCount > 0);

  const treeViolationsResult = await policyViolationsGetFromDir(policy, cwd);

  if ('Err' in treeViolationsResult) {
    // Error already logged in core; propagate as build failure
    throw new Error(treeViolationsResult.Err);
  }

  return {
    policy,
    files,
    eslintOutput,
    eslintHasErrors,
    treeViolations: treeViolationsResult.Ok!,
  };
}

/**
 * Creates an esbuild plugin that enforces codepol policies during builds.
 *
 * The plugin runs both ESLint checks (with autofix support) and Tree-sitter
 * structural analysis. If any violations are found, the build fails with
 * a detailed error message.
 *
 * @param options - Plugin configuration options
 * @returns An esbuild Plugin instance
 *
 * @example Basic usage (auto-discovers config)
 * ```typescript
 * import { esbuildPluginCreate } from '@codepol/plugin-esbuild';
 *
 * plugins: [esbuildPluginCreate()]
 * ```
 *
 * @example With custom config path
 * ```typescript
 * plugins: [
 *   esbuildPluginCreate({
 *     configPath: './config/codepol.toml',
 *   })
 * ]
 * ```
 *
 * @example With autofix enabled
 * ```typescript
 * plugins: [
 *   esbuildPluginCreate({ fix: true })
 * ]
 * ```
 */
export function esbuildPluginCreate(options: PolicyPluginOptions = {}): Plugin {
  return {
    name: 'codepol-policy',
    setup(build) {
      build.onStart(async () => {
        const cwd = options.cwd
          ? path.resolve(options.cwd)
          : build.initialOptions.absWorkingDir
            ? path.resolve(build.initialOptions.absWorkingDir)
            : process.cwd();

        // Load config: explicit path or auto-discover
        let configResult;
        if (options.configPath) {
          // Resolve relative to cwd (which comes from absWorkingDir or process.cwd())
          const resolvedConfigPath = path.isAbsolute(options.configPath)
            ? options.configPath
            : path.resolve(cwd, options.configPath);
          configResult = await configGetFromPath(resolvedConfigPath);
        } else {
          configResult = await configGet(cwd);
        }
        const { config, configPath } = configResult;

        // Resolve ESLint config: option > config file > auto-detect
        const eslintConfigPath = options.eslintConfigPath
          ? path.resolve(cwd, options.eslintConfigPath)
          : config.eslintConfigPath
            ? path.resolve(path.dirname(configPath), config.eslintConfigPath)
            : eslintConfigPathDetect(cwd);

        const result = await policyCheck({
          config,
          configPath,
          eslintConfigPath,
          fix: options.fix,
          cwd,
        });

        const output: string[] = [];
        if (result.eslintOutput.length > 0) {
          output.push(result.eslintOutput);
        }
        const treeOutputGet = policyViolationsGetOutputPretty(result.treeViolations, cwd);
        if (treeOutputGet) {
          output.push('Tree-sitter policy violations:');
          output.push(treeOutputGet);
        }

        if (result.eslintHasErrors || result.treeViolations.length > 0) {
          const message = output.join('\n\n') || 'Policy enforcement failed';
          throw new Error(message);
        }

        if (options.fix && output.length > 0) {
          console.log(output.join('\n\n'));
        }
      });
    },
  };
}

export default esbuildPluginCreate;
