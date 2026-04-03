/**
 * @packageDocumentation
 * Subprocess runner for `biome lint`.
 *
 * Executes Biome as a child process, parses its RDJSON output into
 * codepol PolicyViolation[], and supports --write mode.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { PolicyViolation } from '@codepol/core';
import { Ok, Err, type Result } from '@codepol/core';
import type {
  BiomeDiagnostic,
  BiomeProviderConfig,
  BiomeReport,
} from './biomeTypes';

type ExecFileError = {
  status?: number;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
  message?: string;
};

function outputToString(output: string | Buffer | undefined): string {
  if (typeof output === 'string') {
    return output;
  }
  if (output == null) {
    return '';
  }
  return output.toString('utf8');
}

function biomeBinGet(config?: BiomeProviderConfig): string {
  return config?.biomeBin ?? 'biome';
}

function biomeArgsGet(
  files: string[],
  config?: BiomeProviderConfig,
  extra?: string[]
): string[] {
  const args = [
    'lint',
    '--reporter=rdjson',
    '--files-ignore-unknown=true',
    '--no-errors-on-unmatched',
  ];

  if (config?.configPath) {
    args.push(`--config-path=${config.configPath}`);
  }
  if (config?.extraArgs?.length) {
    args.push(...config.extraArgs);
  }
  if (extra?.length) {
    args.push(...extra);
  }

  args.push(...files);
  return args;
}

/**
 * Maps a single Biome diagnostic to a codepol PolicyViolation.
 */
function biomeDiagnosticToViolation(diag: BiomeDiagnostic): PolicyViolation | null {
  const diagnosticPath = diag.location?.path;
  if (!diagnosticPath) {
    return null;
  }

  const start = diag.location?.range?.start;
  const end = diag.location?.range?.end;
  const filePath = path.isAbsolute(diagnosticPath)
    ? diagnosticPath
    : path.resolve(diagnosticPath);

  const violation: PolicyViolation = {
    ruleId: diag.code?.value ?? 'biome',
    filePath,
    message: diag.message,
    line: (start?.line ?? 0) + 1,
    column: (start?.column ?? 0) + 1,
  };

  if (end) {
    violation.endLine = end.line + 1;
    violation.endColumn = end.column + 1;
  }

  return violation;
}

/**
 * Runs `biome lint --reporter=rdjson` on the given files and returns
 * the diagnostics as PolicyViolation[].
 */
export function biomeCheck(
  files: string[],
  config?: BiomeProviderConfig
): Result<PolicyViolation[], string> {
  if (files.length === 0) {
    return Ok([]);
  }

  const bin = biomeBinGet(config);
  const args = biomeArgsGet(files, config);

  let stdout: string;
  try {
    stdout = execFileSync(bin, args, {
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err: unknown) {
    const execErr = err as ExecFileError;
    const recoveredStdout = outputToString(execErr.stdout).trim();
    if (recoveredStdout) {
      stdout = recoveredStdout;
    } else {
      const stderr = outputToString(execErr.stderr).trim();
      return Err(`Failed to execute biome: ${stderr || execErr.message || String(err)}`);
    }
  }

  const trimmed = stdout.trim();
  if (!trimmed) {
    return Ok([]);
  }

  let report: BiomeReport;
  try {
    report = JSON.parse(trimmed) as BiomeReport;
  } catch {
    return Err(`Failed to parse biome RDJSON output: ${trimmed.slice(0, 200)}`);
  }

  const diagnostics = Array.isArray(report.diagnostics) ? report.diagnostics : [];
  const violations = diagnostics
    .map((diagnostic) => biomeDiagnosticToViolation(diagnostic))
    .filter((violation): violation is PolicyViolation => violation !== null);

  return Ok(violations);
}

/**
 * Runs `biome lint --write` on the given files.
 * Returns Ok(true) if Biome reported remaining diagnostics after writing,
 * Ok(false) on a clean exit, or Err on execution failure.
 */
export function biomeFix(
  files: string[],
  config?: BiomeProviderConfig
): Result<boolean, string> {
  if (files.length === 0) {
    return Ok(false);
  }

  const bin = biomeBinGet(config);
  const args = biomeArgsGet(files, config, ['--write']);

  try {
    execFileSync(bin, args, {
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return Ok(false);
  } catch (err: unknown) {
    const execErr = err as ExecFileError;
    if (execErr.status === 1) {
      return Ok(true);
    }
    const stderr = outputToString(execErr.stderr).trim();
    return Err(`Failed to execute biome --write: ${stderr || execErr.message || String(err)}`);
  }
}

export { biomeDiagnosticToViolation };
