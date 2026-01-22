/**
 * @packageDocumentation
 * @codepol/esbuild-plugin - esbuild plugin for enforcing codepol policies.
 *
 * This plugin runs policy checks as part of your esbuild build process,
 * failing the build if any violations are found.
 *
 * @example
 * ```typescript
 * import { build } from 'esbuild';
 * import { esbuildPluginCreate } from '@codepol/esbuild-plugin';
 *
 * await build({
 *   entryPoints: ['src/index.ts'],
 *   bundle: true,
 *   outfile: 'dist/bundle.js',
 *   plugins: [
 *     // Zero-config: auto-discovers codepol.config.ts
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
  ruleMatchesGet,
  policyViolationsGetFromDir,
  policyViolationsGetOutputPretty,
  configGet,
  configGetFromPath,
  type PolicyFile,
  type PolicyViolation,
  type CodepolConfig,
} from '@codepol/core';
import { eslintPluginCreate } from '@codepol/eslint-plugin';
import pluginRules from '@codepol/plugin';

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

type PolicyCheckResult = {
  policy: PolicyFile;
  files: string[];
  eslintOutput: string;
  eslintHasErrors: boolean;
  treeViolations: PolicyViolation[];
};

async function policyCheck(options: {
  config: CodepolConfig;
  eslintConfigPath: string;
  fix?: boolean;
  cwd: string;
}): Promise<PolicyCheckResult> {
  const { config, eslintConfigPath, fix, cwd } = options;

  // Register languages and initialize web-tree-sitter WASM parser
  langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
  langAdd({ langId: 'tsx', fileExtensions: ['.tsx'] });
  await parserInit();

  const policy = config as PolicyFile;
  const matches = await ruleMatchesGet(policy, cwd);
  const files = Array.from(new Set(matches.flatMap(matchGet => matchGet.files)));

  let fixEnabled = false;
  if (fix != null) {
    fixEnabled = fix;
  }
  const eslint = new ESLint({
    overrideConfigFile: eslintConfigPath,
    plugins: {
      codepol: eslintPluginCreate(pluginRules) as unknown as ESLint.Plugin,
    },
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
 * import { esbuildPluginCreate } from '@codepol/esbuild-plugin';
 *
 * plugins: [esbuildPluginCreate()]
 * ```
 *
 * @example With custom config path
 * ```typescript
 * plugins: [
 *   esbuildPluginCreate({
 *     configPath: './config/codepol.config.ts',
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
