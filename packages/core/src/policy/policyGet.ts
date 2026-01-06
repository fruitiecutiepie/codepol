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
export function policyFileGet(policyPathValue: string): PolicyFile {
  const absolutePathValue = path.resolve(policyPathValue);
  const cachedValue = policyCacheStore.get(absolutePathValue);
  if (cachedValue) {
    return cachedValue;
  }
  const rawValue = fs.readFileSync(absolutePathValue, 'utf8');
  const parsedValue = JSON.parse(rawValue) as PolicyFile;
  policyCacheStore.set(absolutePathValue, parsedValue);
  return parsedValue;
}

/**
 * Checks if any pattern in the list matches the given file path.
 *
 * @param patterns - Array of glob patterns to match against
 * @param relativeFile - Relative file path to check
 * @returns True if any pattern matches
 */
export function globPatternsGetMatchAny(patternsValue: string[] | undefined, relativeFileValue: string): boolean {
  if (!patternsValue || patternsValue.length === 0) {
    return false;
  }
  return patternsValue.some(patternValue => minimatch(relativeFileValue, patternValue, { dot: true }));
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
  policyValue: PolicyFile,
  filePathValue: string,
  cwdValue: string
): boolean {
  const relativeValue = path.relative(cwdValue, filePathValue);
  if (globPatternsGetMatchAny(policyValue.exclude, relativeValue)) {
    return false;
  }
  for (const ruleValue of policyValue.rules) {
    if (globPatternsGetMatchAny(ruleValue.files, relativeValue)) {
      if (globPatternsGetMatchAny(ruleValue.exclude, relativeValue)) {
        continue;
      }
      const isTsValue = relativeValue.endsWith('.ts') || relativeValue.endsWith('.tsx');
      if (!isTsValue) {
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
export async function ruleMatchesGet(policyValue: PolicyFile, cwdValue: string): Promise<RuleMatch[]> {
  const matchesValue: RuleMatch[] = [];
  const globalExcludeValue = policyValue.exclude ?? [];
  for (const ruleValue of policyValue.rules) {
    const ignoreValue = [...globalExcludeValue, ...(ruleValue.exclude ?? [])];
    const filesValue = await fg(ruleValue.files, {
      cwd: cwdValue,
      absolute: true,
      ignore: ignoreValue,
      onlyFiles: true,
    });
    const filteredValue = filesValue.filter(fileValue => {
      if (ruleValue.language === 'tsx') {
        return fileValue.endsWith('.tsx');
      }
      return fileValue.endsWith('.ts') || fileValue.endsWith('.tsx');
    });
    matchesValue.push({ rule: ruleValue, files: filteredValue });
  }
  return matchesValue;
}

