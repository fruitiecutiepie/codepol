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
 * import { policyPlugin } from '@codepol/esbuild-plugin';
 *
 * await build({
 *   entryPoints: ['src/index.ts'],
 *   bundle: true,
 *   outfile: 'dist/bundle.js',
 *   plugins: [
 *     policyPlugin({
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
  initParser,
  loadPolicy,
  collectRuleMatches,
  scanWithPolicy,
  formatTreeViolations,
  type PolicyFile,
  type PolicyViolation,
} from '@codepol/core';
import eslintPlugin from '@codepol/eslint-plugin';

/**
 * Options for the esbuild policy plugin.
 */
export interface PolicyPluginOptions {
  /** Path to the policy.json file (default: './policy.json') */
  policyPath?: string;
  /** Path to the ESLint config file (default: './.eslintrc.cjs') */
  eslintConfigPath?: string;
  /** Whether to apply ESLint fixes (default: false) */
  fix?: boolean;
  /** Working directory for resolving paths (default: esbuild's absWorkingDir or cwd) */
  cwd?: string;
}

interface PolicyRunResult {
  policy: PolicyFile;
  files: string[];
  eslintOutput: string;
  eslintHasErrors: boolean;
  treeViolations: PolicyViolation[];
}

function resolvePath(value: string | undefined, cwd: string, fallback: string): string {
  if (value === undefined) {
    return path.resolve(cwd, fallback);
  }
  return path.isAbsolute(value) ? value : path.resolve(cwd, value);
}

async function runPolicyChecks(options: {
  policyPath: string;
  eslintConfigPath: string;
  fix?: boolean;
  cwd: string;
}): Promise<PolicyRunResult> {
  const { policyPath, eslintConfigPath, fix, cwd } = options;

  // Initialize web-tree-sitter WASM parser
  await initParser();

  const policy = loadPolicy(policyPath);
  const matches = await collectRuleMatches(policy, cwd);
  const files = Array.from(new Set(matches.flatMap(match => match.files)));

  const eslint = new ESLint({
    overrideConfigFile: eslintConfigPath,
    plugins: {
      codepol: eslintPlugin as unknown as ESLint.Plugin,
    },
    fix: fix ?? false,
    cwd,
  });

  const lintResults = files.length > 0 ? await eslint.lintFiles(files) : [];
  if (fix) {
    await ESLint.outputFixes(lintResults);
  }
  const formatter = await eslint.loadFormatter('stylish');
  const eslintOutput = lintResults.length > 0 ? (await formatter.format(lintResults)).trim() : '';
  const eslintHasErrors = lintResults.some(result => result.errorCount > 0);

  const treeViolations = await scanWithPolicy(policy, cwd);

  return {
    policy,
    files,
    eslintOutput,
    eslintHasErrors,
    treeViolations,
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
 * import { policyPlugin } from '@codepol/esbuild-plugin';
 *
 * plugins: [policyPlugin()]
 * ```
 *
 * @example With custom paths
 * ```typescript
 * plugins: [
 *   policyPlugin({
 *     policyPath: './config/policy.json',
 *     eslintConfigPath: './config/eslint.config.js',
 *   })
 * ]
 * ```
 *
 * @example With autofix enabled
 * ```typescript
 * plugins: [
 *   policyPlugin({ fix: true })
 * ]
 * ```
 */
export function policyPlugin(options: PolicyPluginOptions = {}): Plugin {
  return {
    name: 'codepol-policy',
    setup(build) {
      build.onStart(async () => {
        const cwd = options.cwd
          ? path.resolve(options.cwd)
          : build.initialOptions.absWorkingDir
            ? path.resolve(build.initialOptions.absWorkingDir)
            : process.cwd();

        const policyPath = resolvePath(options.policyPath, cwd, 'policy.json');
        const eslintConfigPath = resolvePath(options.eslintConfigPath, cwd, '.eslintrc.cjs');

        const result = await runPolicyChecks({
          policyPath,
          eslintConfigPath,
          fix: options.fix,
          cwd,
        });

        const outputs: string[] = [];
        if (result.eslintOutput.length > 0) {
          outputs.push(result.eslintOutput);
        }
        const treeOutput = formatTreeViolations(result.treeViolations, cwd);
        if (treeOutput) {
          outputs.push('Tree-sitter policy violations:');
          outputs.push(treeOutput);
        }

        if (result.eslintHasErrors || result.treeViolations.length > 0) {
          const message = outputs.join('\n\n') || 'Policy enforcement failed';
          throw new Error(message);
        }

        if (options.fix && outputs.length > 0) {
          console.log(outputs.join('\n\n'));
        }
      });
    },
  };
}

export default policyPlugin;
