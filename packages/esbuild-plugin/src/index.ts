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
 * import { esbuildPluginNew } from '@codepol/esbuild-plugin';
 *
 * await build({
 *   entryPoints: ['src/index.ts'],
 *   bundle: true,
 *   outfile: 'dist/bundle.js',
 *   plugins: [
 *     esbuildPluginNew({
 *       policyPath: './policy.json',
 *       fix: false, // Set to true to auto-fix violations
 *     }),
 *   ],
 * });
 * ```
 */

import path from 'path';
import type { Plugin } from 'esbuild';
import { ESLint } from 'eslint';
import {
  parserInit,
  policyFileGet,
  ruleMatchesGet,
  policyViolationsGetFromDir,
  policyViolationsGetOutputPretty,
  type PolicyFile,
  type PolicyViolation,
} from '@codepol/core';
import eslintPlugin from '@codepol/eslint-plugin';

/**
 * Options for the esbuild policy plugin.
 */
export type PolicyPluginOptions = {
  /** Path to the policy.json file (default: './policy.json') */
  policyPath?: string;
  /** Path to the ESLint config file (default: './.eslintrc.cjs') */
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

function pathResolve(valueGet: string | undefined, cwd: string, fallback: string): string {
  if (valueGet === undefined) {
    return path.resolve(cwd, fallback);
  }
  return path.isAbsolute(valueGet) ? valueGet : path.resolve(cwd, valueGet);
}

async function policyCheck(options: {
  policyPath: string;
  eslintConfigPath: string;
  fix?: boolean;
  cwd: string;
}): Promise<PolicyCheckResult> {
  const policyPath = options.policyPath;
  const eslintConfigPath = options.eslintConfigPath;
  const fix = options.fix;
  const cwd = options.cwd;

  // Initialize web-tree-sitter WASM parser
  await parserInit();

  const policy = policyFileGet(policyPath);
  const matches = await ruleMatchesGet(policy, cwd);
  const files = Array.from(new Set(matches.flatMap(matchGet => matchGet.files)));

  const eslint = new ESLint({
    overrideConfigFile: eslintConfigPath,
    plugins: {
      codepol: eslintPlugin as unknown as ESLint.Plugin,
    },
    fix: fix ?? false,
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
 * @example Basic usage
 * ```typescript
 * import { esbuildPluginNew } from '@codepol/esbuild-plugin';
 *
 * plugins: [esbuildPluginNew()]
 * ```
 *
 * @example With custom paths
 * ```typescript
 * plugins: [
 *   esbuildPluginNew({
 *     policyPath: './config/policy.json',
 *     eslintConfigPath: './config/eslint.config.js',
 *   })
 * ]
 * ```
 *
 * @example With autofix enabled
 * ```typescript
 * plugins: [
 *   esbuildPluginNew({ fix: true })
 * ]
 * ```
 */
export function esbuildPluginNew(options: PolicyPluginOptions = {}): Plugin {
  return {
    name: 'codepol-policy',
    setup(build) {
      build.onStart(async () => {
        const cwd = options.cwd
          ? path.resolve(options.cwd)
          : build.initialOptions.absWorkingDir
            ? path.resolve(build.initialOptions.absWorkingDir)
            : process.cwd();

        const policyPath = pathResolve(options.policyPath, cwd, 'policy.json');
        const eslintConfigPath = pathResolve(options.eslintConfigPath, cwd, '.eslintrc.cjs');

        const result = await policyCheck({
          policyPath: policyPath,
          eslintConfigPath: eslintConfigPath,
          fix: options.fix,
          cwd: cwd,
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

export default esbuildPluginNew;
