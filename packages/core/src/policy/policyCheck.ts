import path from 'node:path';
import type { PolicyFile, PolicyViolation } from './policyTypes';
import { ruleMatchesGet } from './policyGet';
import { policyViolationsGetFromDir } from './policyTreeCheck';
import { policyArchitectureViolationsGetFromDir } from './policyArchitectureCheck';
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
  /**
   * Violations from per-file tree-sitter checks. For backwards
   * compatibility this also contains architecture violations so existing
   * consumers continue to see every violation through this field.
   * Architecture-specific violations are also exposed separately via
   * {@link PolicyCheckResult.architectureViolations}.
   */
  treeViolations: PolicyViolation[];
  /**
   * Project-wide violations from {@link ArchitectureCheckProvider} rules.
   * Optional so older callers ignoring this field keep working.
   */
  architectureViolations?: PolicyViolation[];
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
  let resolvedConfigPath: string;
  try {
    if (options.configPath) {
      const resolvedPath = path.isAbsolute(options.configPath)
        ? options.configPath
        : path.resolve(cwd, options.configPath);
      const result = await configGetFromPath(resolvedPath);
      config = result.config;
      resolvedConfigPath = result.configPath;
    } else {
      const result = await configGet(cwd);
      config = result.config;
      resolvedConfigPath = result.configPath;
    }
  } catch (error) {
    return Err(error instanceof Error ? error.message : String(error));
  }
  
  const policy = config as PolicyFile;
  const matches = await ruleMatchesGet(policy, cwd);
  const files = Array.from(new Set(matches.flatMap(match => match.files)));
  const treeViolationsResult = await policyViolationsGetFromDir(policy, cwd, {
    configPath: resolvedConfigPath,
  });

  if (isErr(treeViolationsResult)) {
    return treeViolationsResult;
  }

  // Architecture rules run once per matched rule against the project
  // graph. They share the project index with the tree-check pipeline
  // when one is built; for now each pipeline builds it independently to
  // avoid a refactor. Wiring them to the same index is tracked as part
  // of Phase 1 cache work.
  const architectureViolationsResult = await policyArchitectureViolationsGetFromDir(policy, cwd, {
    configPath: resolvedConfigPath,
  });
  if (isErr(architectureViolationsResult)) {
    return architectureViolationsResult;
  }

  return Ok({
    policy,
    files,
    treeViolations: [
      ...treeViolationsResult.Ok,
      ...architectureViolationsResult.Ok,
    ],
    architectureViolations: architectureViolationsResult.Ok,
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
        `${file}:${violation.line}:${violation.column}: error [${violation.ruleId}] ${violation.message}`,
      );
      if (violation.relatedLocations?.length) {
        for (const rel of violation.relatedLocations) {
          const relFile = path.relative(cwd, rel.filePath);
          const msg = rel.message ? ` ${rel.message}` : '';
          lines.push(
            `  related ${relFile}:${rel.line}:${rel.column}:${msg}`,
          );
        }
      }
    }
  }
  return lines.join('\n');
}
