/**
 * @packageDocumentation
 * Subprocess runner for `vulture`.
 *
 * Executes vulture as a child process, parses its text output into
 * codepol PolicyViolation[], and returns a Result.
 */

import { execFileSync } from 'node:child_process';
import type { PolicyViolation } from '@codepol/core';
import { Ok, Err, isErr, type Result } from '@codepol/core';
import type { VultureFinding, VultureProviderConfig } from './vultureTypes';

const VULTURE_RULE_ID = 'python-dead-code';

/**
 * Regex for Vulture's text output lines.
 * Format: `filepath:line: unused type 'name' (confidence% confidence)`
 *
 * Examples:
 *   app.py:4: unused function 'greet' (60% confidence)
 *   models/user.py:12: unused class 'LegacyUser' (60% confidence)
 *   app.py:1: unused import 'os' (90% confidence)
 */
const FINDING_PATTERN =
  /^(.+?):(\d+): unused ([\w][\w\s]*?) '([^']+)' \((\d+)% confidence\)$/;

function vultureBinGet(config?: VultureProviderConfig): string {
  return config?.vultureBin ?? 'vulture';
}

function vultureArgsGet(
  files: string[],
  config?: VultureProviderConfig
): string[] {
  const args: string[] = [...files];

  if (config?.whitelistPaths?.length) {
    args.push(...config.whitelistPaths);
  }
  if (config?.minConfidence !== undefined) {
    args.push(`--min-confidence=${config.minConfidence}`);
  }
  if (config?.exclude?.length) {
    args.push(`--exclude=${config.exclude.join(',')}`);
  }
  if (config?.ignoreNames?.length) {
    args.push(`--ignore-names=${config.ignoreNames.join(',')}`);
  }
  if (config?.configPath) {
    args.push(`--config=${config.configPath}`);
  }

  return args;
}

/**
 * Parses a single line of Vulture text output into a VultureFinding.
 * Returns undefined if the line does not match the expected format.
 */
export function vultureLineParse(line: string): VultureFinding | undefined {
  const match = FINDING_PATTERN.exec(line);
  if (!match) {
    return undefined;
  }
  return {
    filePath: match[1],
    line: parseInt(match[2], 10),
    type: match[3],
    name: match[4],
    confidence: parseInt(match[5], 10),
  };
}

/**
 * Parses the full text output from Vulture into an array of findings.
 */
export function vultureOutputParse(stdout: string): VultureFinding[] {
  return stdout
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .map(vultureLineParse)
    .filter((f): f is VultureFinding => f !== undefined);
}

/**
 * Maps a VultureFinding to a codepol PolicyViolation.
 */
export function vultureFindingToViolation(
  finding: VultureFinding,
  ruleId: string = VULTURE_RULE_ID,
): PolicyViolation {
  return {
    ruleId,
    filePath: finding.filePath,
    message: `unused ${finding.type} '${finding.name}' (${finding.confidence}% confidence)`,
    line: finding.line,
    column: 1,
  };
}

/**
 * Runs `vulture` and returns structured findings (for fixers and policy checks).
 *
 * Vulture exit codes:
 *   0 – no dead code found
 *   1 – dead code found
 *   2 – invalid CLI usage / config error
 *   3 – dead code found AND syntax errors in some files
 *
 * Codes 1 and 3 are treated as success (findings in stdout).
 * A missing vulture binary or invalid config is reported via Result.Err.
 */
export function vultureFindingsGet(
  files: string[],
  config?: VultureProviderConfig
): Result<VultureFinding[], string> {
  if (files.length === 0) {
    return Ok([]);
  }

  const bin = vultureBinGet(config);
  const args = vultureArgsGet(files, config);

  let stdout: string;
  try {
    stdout = execFileSync(bin, args, {
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err: unknown) {
    const execErr = err as { status?: number; stdout?: string; stderr?: string; message?: string };
    if ((execErr.status === 1 || execErr.status === 3) && execErr.stdout) {
      stdout = execErr.stdout;
    } else if (execErr.status === 2) {
      return Err(`vulture configuration or usage error: ${execErr.stderr ?? execErr.message}`);
    } else {
      return Err(`Failed to execute vulture: ${execErr.message ?? String(err)}`);
    }
  }

  const trimmed = stdout.trim();
  if (!trimmed) {
    return Ok([]);
  }

  return Ok(vultureOutputParse(trimmed));
}

/**
 * Runs `vulture` on the given files and returns the findings as PolicyViolation[].
 */
export function vultureCheck(
  files: string[],
  config?: VultureProviderConfig
): Result<PolicyViolation[], string> {
  const findings = vultureFindingsGet(files, config);
  if (isErr(findings)) {
    return findings;
  }
  return Ok(findings.Ok.map(f => vultureFindingToViolation(f)));
}
