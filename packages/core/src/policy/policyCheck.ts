import path from 'node:path';
import type { PolicyFile, PolicyViolation } from './policyTypes';
import { ruleMatchesGet, policyFileGet } from './policyGet';
import { policyViolationsGetFromDir } from './policyScan';
import { Result, Ok, isErr } from '../result/result';

export type PolicyCheckOptions = {
  policyPath: string;
  cwd?: string;
};

export type PolicyCheckResult = {
  policy: PolicyFile;
  files: string[];
  treeViolations: PolicyViolation[];
};

/**
 * Runs policy checks (Tree-sitter scanning) for a policy file.
 * @returns Result containing the check result or an error message
 */
export async function policyCheck(options: PolicyCheckOptions): Promise<Result<PolicyCheckResult, string>> {
  let cwd = process.cwd();
  if (options.cwd != null) {
    cwd = options.cwd;
  }
  const policyPath = path.resolve(cwd, options.policyPath);
  const policy = policyFileGet(policyPath);
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
    lines.push(`${file}:`);
    for (const violation of fileViolations) {
      lines.push(
        `  - [${violation.ruleId}] ${violation.message} (${violation.line}:${violation.column})`
      );
    }
  }
  return lines.join('\n');
}

