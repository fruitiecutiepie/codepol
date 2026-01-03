import path from 'path';
import { ESLint } from 'eslint';
import orgPlugin from './eslint-plugin-org';
import { collectRuleMatches, loadPolicy, PolicyFile, PolicyViolation, scanWithPolicy } from './policy-scan';

export interface PolicyRunOptions {
  policyPath?: string;
  eslintConfigPath?: string;
  fix?: boolean;
  cwd?: string;
}

export interface PolicyRunResult {
  policy: PolicyFile;
  files: string[];
  eslintOutput: string;
  eslintHasErrors: boolean;
  treeViolations: PolicyViolation[];
}

function resolveWithinCwd(targetPath: string | undefined, cwd: string, fallback: string): string {
  if (!targetPath || targetPath.length === 0) {
    return path.resolve(cwd, fallback);
  }
  return path.isAbsolute(targetPath) ? targetPath : path.resolve(cwd, targetPath);
}

export async function runPolicyChecks(options: PolicyRunOptions = {}): Promise<PolicyRunResult> {
  const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd();
  const policyPath = resolveWithinCwd(options.policyPath, cwd, 'policy.json');
  const eslintConfigPath = resolveWithinCwd(options.eslintConfigPath, cwd, '.eslintrc.cjs');

  const policy = loadPolicy(policyPath);
  const matches = await collectRuleMatches(policy, cwd);
  const files = Array.from(new Set(matches.flatMap(match => match.files)));

  const eslint = new ESLint({
    overrideConfigFile: eslintConfigPath,
    plugins: {
      org: orgPlugin as unknown as ESLint.Plugin,
    },
    fix: options.fix ?? false,
    cwd,
  });

  const lintResults = files.length > 0 ? await eslint.lintFiles(files) : [];
  if (options.fix) {
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
