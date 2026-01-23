import path from 'node:path';
import type { PolicyFile, PolicyViolation } from './policyTypes';
import { ruleMatchesGet } from './policyGet';
import { policyViolationsGetFromDir } from './policyTreeCheck';
import { Result, Ok, Err, isErr } from '../result/result';
import { configGet, configGetFromPath } from '../config/configDiscover';

export type PolicyCheckOptions = {
  /** Path to config file (auto-discovered if not specified) */
  configPath?: string;
  cwd?: string;
};

export type PolicyCheckResult = {
  policy: PolicyFile;
  files: string[];
  treeViolations: PolicyViolation[];
};

/**
 * Runs policy checks (Tree-sitter checking) for a config file.
 * @returns Result containing the check result or an error message
 */
export async function policyCheck(options: PolicyCheckOptions): Promise<Result<PolicyCheckResult, string>> {
  let cwd = process.cwd();
  if (options.cwd != null) {
    cwd = options.cwd;
  }
  
  // Load config: explicit path or auto-discover
  let config;
  try {
    if (options.configPath) {
      const resolvedPath = path.isAbsolute(options.configPath)
        ? options.configPath
        : path.resolve(cwd, options.configPath);
      const result = await configGetFromPath(resolvedPath);
      config = result.config;
    } else {
      const result = await configGet(cwd);
      config = result.config;
    }
  } catch (error) {
    return Err(error instanceof Error ? error.message : String(error));
  }
  
  const policy = config as PolicyFile;
  const matches = await ruleMatchesGet(policy, cwd);
  const files = Array.from(new Set(matches.flatMap(match => match.files)));
  const treeViolationsResult = await policyViolationsGetFromDir(policy, cwd);

  if (isErr(treeViolationsResult)) {
    return treeViolationsResult;
  }

  return Ok({
    policy,
    files,
    treeViolations: treeViolationsResult.Ok,
  });
}

/**
 * Formats policy violations in a readable tree-style output.
 */
export function policyViolationsGetOutputPretty(violations: PolicyViolation[], cwd: string): string {
  if (violations.length === 0) {
    return '';
  }
  const grouped = new Map<string, PolicyViolation[]>();
  for (const violation of violations) {
    const relative = path.relative(cwd, violation.filePath);
    let list: PolicyViolation[] = [];
    if (grouped.get(relative) != null) {
      list = grouped.get(relative)!;
    }
    list.push(violation);
    grouped.set(relative, list);
  }

  const lines: string[] = [];
  for (const [file, fileViolations] of grouped.entries()) {
    for (const violation of fileViolations) {
      lines.push(
        `${file}:${violation.line}:${violation.column}: error [${violation.ruleId}] ${violation.message}`
      );
    }
  }
  return lines.join('\n');
}
