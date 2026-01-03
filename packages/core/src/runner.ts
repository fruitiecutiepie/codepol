import path from 'path';
import type { PolicyFile, PolicyViolation } from './types';
import { collectRuleMatches, loadPolicy } from './policy-loader';
import { scanWithPolicy } from './scanner';

/**
 * Options for running policy checks.
 */
export interface PolicyRunOptions {
  /** Path to the policy.json file (default: './policy.json') */
  policyPath?: string;
  /** Working directory for resolving paths (default: process.cwd()) */
  cwd?: string;
}

/**
 * Result of running policy checks.
 */
export interface PolicyRunResult {
  /** The loaded policy file */
  policy: PolicyFile;
  /** Array of files that were checked */
  files: string[];
  /** Tree-sitter scan violations */
  treeViolations: PolicyViolation[];
}

/**
 * Resolves a path within the given working directory.
 *
 * @param targetPath - The path to resolve (can be absolute or relative)
 * @param cwd - The working directory
 * @param fallback - Default filename if targetPath is empty
 * @returns Absolute resolved path
 */
function resolveWithinCwd(targetPath: string | undefined, cwd: string, fallback: string): string {
  if (!targetPath || targetPath.length === 0) {
    return path.resolve(cwd, fallback);
  }
  return path.isAbsolute(targetPath) ? targetPath : path.resolve(cwd, targetPath);
}

/**
 * Runs Tree-sitter policy checks on the codebase.
 * This is the core scanning function without ESLint integration.
 *
 * @param options - Configuration options for the check
 * @returns Result containing policy, matched files, and violations
 *
 * @example
 * ```typescript
 * import { runPolicyChecks } from '@codepol/core';
 *
 * const result = await runPolicyChecks({
 *   policyPath: './policy.json',
 *   cwd: process.cwd(),
 * });
 *
 * if (result.treeViolations.length > 0) {
 *   console.log('Violations found!');
 * }
 * ```
 */
export async function runPolicyChecks(options: PolicyRunOptions = {}): Promise<PolicyRunResult> {
  const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd();
  const policyPath = resolveWithinCwd(options.policyPath, cwd, 'policy.json');

  const policy = loadPolicy(policyPath);
  const matches = await collectRuleMatches(policy, cwd);
  const files = Array.from(new Set(matches.flatMap(match => match.files)));

  const treeViolations = await scanWithPolicy(policy, cwd);

  return {
    policy,
    files,
    treeViolations,
  };
}

/**
 * Formats policy violations into a human-readable string.
 *
 * @param violations - Array of violations to format
 * @param cwd - Working directory for computing relative paths
 * @returns Formatted string with one violation per line, or empty string if none
 *
 * @example
 * ```typescript
 * const output = formatTreeViolations(result.treeViolations, process.cwd());
 * if (output) {
 *   console.log(output);
 * }
 * ```
 */
export function formatTreeViolations(violations: PolicyViolation[], cwd: string): string {
  if (violations.length === 0) {
    return '';
  }
  const lines = violations.map(violation => {
    const relativePath = path.relative(cwd, violation.filePath);
    return `${relativePath}:${violation.line}:${violation.column} ${violation.message} [${violation.ruleId}]`;
  });
  return lines.join('\n');
}
