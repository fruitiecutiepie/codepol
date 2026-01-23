import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import { minimatch } from 'minimatch';
import type { PolicyFile, PolicyRule, PolicyRuleTarget, RuleMatch } from './policyTypes';

const policyCacheStore = new Map<string, PolicyFile>();

/**
 * Loads and parses a JSON policy file from the filesystem.
 * Results are cached by absolute path for performance.
 *
 * @deprecated Use `configGet()` or `configGetFromPath()` instead, which support
 * TypeScript config files (codepol.config.ts). This function is kept for
 * backward compatibility with JSON config files.
 *
 * @param policyPath - Path to the JSON config file (absolute or relative)
 * @returns The parsed PolicyFile object
 * @throws If the file cannot be read or parsed
 *
 * @example
 * ```typescript
 * // Prefer configGet() for new code:
 * import { configGet } from '@codepol/core';
 * const { config } = await configGet();
 *
 * // Legacy JSON support:
 * import { policyFileGet } from '@codepol/core';
 * const policy = policyFileGet('./legacy-config.json');
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
 * Clears the cached policy files.
 * Useful for testing or when policy files are modified.
 */
export function policyCacheClear(): void {
  policyCacheStore.clear();
}

/**
 * Resolves the targets for a policy rule.
 * Looks up each target name in the policy's named targets map.
 *
 * @param rule - The policy rule to resolve targets for
 * @param policy - The policy file containing named targets
 * @returns Array of resolved PolicyRuleTarget objects
 * @throws If any target reference doesn't exist in policy.targets
 *
 * @example
 * ```typescript
 * const targets = policyRuleTargetsResolve(rule, policy);
 * for (const target of targets) {
 *   // process target
 * }
 * ```
 */
export function policyRuleTargetsResolve(rule: PolicyRule, policy: PolicyFile): PolicyRuleTarget[] {
  const resolved: PolicyRuleTarget[] = [];
  for (const targetName of rule.targets) {
    const namedTarget = policy.targets[targetName];
    if (!namedTarget) {
      throw new Error(
        `Rule "${rule.id ?? rule.ruleId}" references target "${targetName}" ` +
        `which is not defined in policy.targets`
      );
    }
    resolved.push(namedTarget);
  }
  return resolved;
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
    const targets = policyRuleTargetsResolve(rule, policy);
    for (const target of targets) {
      if (globPatternsGetMatchAny(target.files, relative)) {
        if (globPatternsGetMatchAny(target.exclude, relative)) {
          continue;
        }
        if (!ruleTargetMatchesLanguage(target, relative)) {
          continue;
        }
        return true;
      }
    }
  }
  return false;
}

/**
 * Checks if a file matches the language specified in the rule target.
 *
 * @param target - The policy rule target containing the language
 * @param filePath - File path to check (can be relative or absolute)
 * @returns True if the file matches the target language
 */
export function ruleTargetMatchesLanguage(target: PolicyRuleTarget, filePath: string): boolean {
  if (target.language === 'tsx') {
    return filePath.endsWith('.tsx');
  }
  if (target.language === 'typescript') {
    return filePath.endsWith('.ts') || filePath.endsWith('.tsx');
  }
  return true;
}

/**
 * Collects all files matching each policy rule.
 * Uses fast-glob for efficient file system traversal.
 *
 * @param policy - The loaded config/policy object
 * @param cwd - Working directory to resolve patterns from
 * @returns Array of RuleMatch objects mapping rules to their matched files
 *
 * @example
 * ```typescript
 * import { configGet, ruleMatchesGet } from '@codepol/core';
 *
 * const { config } = await configGet();
 * const matches = await ruleMatchesGet(config, process.cwd());
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
    const targets = policyRuleTargetsResolve(rule, policy);
    for (const target of targets) {
      const ignore = [...globalExclude, ...(target.exclude ?? [])];
      const files = await fg(target.files, {
        cwd: cwd,
        absolute: true,
        ignore: ignore,
        onlyFiles: true,
      });
      const filtered = files.filter(file => ruleTargetMatchesLanguage(target, file));
      matches.push({ rule: rule, target: target, files: filtered });
    }
  }
  return matches;
}
