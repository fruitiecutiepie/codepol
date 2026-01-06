import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import { minimatch } from 'minimatch';
import type { PolicyFile, RuleMatch } from './policyTypes';

const policyCacheStore = new Map<string, PolicyFile>();

/**
 * Loads and parses a policy file from the filesystem.
 * Results are cached by absolute path for performance.
 *
 * @param policyPath - Path to the policy.json file (absolute or relative)
 * @returns The parsed PolicyFile object
 * @throws If the file cannot be read or parsed
 *
 * @example
 * ```typescript
 * import { policyFileGet } from '@codepol/core';
 *
 * const policy = policyFileGet('./policy.json');
 * console.log(policy.rules.length);
 * ```
 */
export function policyFileGet(policyPath: string): PolicyFile {
  const absolutePath = path.resolve(policyPath);
  const cached = policyCacheStore.get(absolutePath);
  if (cached) {
    return cached;
  }
  const raw = fs.readFileSync(absolutePath, 'utf8');
  const parsed = JSON.parse(raw) as PolicyFile;
  policyCacheStore.set(absolutePath, parsed);
  return parsed;
}

/**
 * Checks if any pattern in the list matches the given file path.
 *
 * @param patterns - Array of glob patterns to match against
 * @param relativeFile - Relative file path to check
 * @returns True if any pattern matches
 */
export function globPatternsGetMatchAny(patterns: string[] | undefined, relativeFile: string): boolean {
  if (!patterns || patterns.length === 0) {
    return false;
  }
  return patterns.some(pattern => minimatch(relativeFile, pattern, { dot: true }));
}

/**
 * Determines if a file is covered by the policy (should be checked).
 *./policyViolationsGetFromDir
 * @param policy - The loaded policy file
 * @param filePath - Absolute path to the file to check
 * @param cwd - Current working directory for relative path calculation
 * @returns True if the file should be checked against the policy
 */
export function policyFileGetChecked(
  policy: PolicyFile,
  filePath: string,
  cwd: string
): boolean {
  const relative = path.relative(cwd, filePath);
  if (globPatternsGetMatchAny(policy.exclude, relative)) {
    return false;
  }
  for (const rule of policy.rules) {
    if (globPatternsGetMatchAny(rule.files, relative)) {
      if (globPatternsGetMatchAny(rule.exclude, relative)) {
        continue;
      }
      const isTs = relative.endsWith('.ts') || relative.endsWith('.tsx');
      if (!isTs) {
        continue;
      }
      return true;
    }
  }
  return false;
}

/**
 * Collects all files matching each policy rule.
 * Uses fast-glob for efficient file system traversal.
 *
 * @param policy - The loaded policy file
 * @param cwd - Working directory to resolve patterns from
 * @returns Array of RuleMatch objects mapping rules to their matched files
 *
 * @example
 * ```typescript
 * import { policyFileGet, ruleMatchesGet } from '@codepol/core';
 *
 * const policy = policyFileGet('./policy.json');
 * const matches = await ruleMatchesGet(policy, process.cwd());
 *
 * for (const match of matches) {
 *   console.log(`Rule ${match.rule.id}: ${match.files.length} files`);
 * }
 * ```
 */
export async function ruleMatchesGet(policy: PolicyFile, cwd: string): Promise<RuleMatch[]> {
  const matches: RuleMatch[] = [];
  let globalExclude: string[] = [];
  if (policy.exclude != null) {
    globalExclude = policy.exclude;
  }
  for (const rule of policy.rules) {
    let ruleExclude: string[] = [];
    if (rule.exclude != null) {
      ruleExclude = rule.exclude;
    }
    const ignore = [...globalExclude, ...ruleExclude];
    const files = await fg(rule.files, {
      cwd: cwd,
      absolute: true,
      ignore: ignore,
      onlyFiles: true,
    });
    const filtered = files.filter(file => {
      if (rule.language === 'tsx') {
        return file.endsWith('.tsx');
      }
      return file.endsWith('.ts') || file.endsWith('.tsx');
    });
    matches.push({ rule: rule, files: filtered });
  }
  return matches;
}

