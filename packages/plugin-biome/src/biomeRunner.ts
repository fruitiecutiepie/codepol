/**
 * @packageDocumentation
 * Subprocess runner for `biome lint`.
 *
 * Executes Biome as a child process, parses its RDJSON output into
 * codepol PolicyViolation[], and supports --write mode.
 */

import { execFile, execFileSync, type ExecFileException } from 'node:child_process';
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
  name?: string;
  code?: string;
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

function execFileAbortedIs(error: unknown): boolean {
  return error instanceof Error &&
    ((error as ExecFileError).name === 'AbortError' ||
      (error as ExecFileError).code === 'ABORT_ERR');
}

/**
 * Normalizes a Node `execFile` (async) error so its shape matches `execFileSync`'s.
 *
 * Node's `execFile` callback sets the exit code on `error.code` (as a number).
 * Node's `execFileSync` throws an error with the exit code on `error.status`.
 * All downstream checks in this module read `.status`, so we copy numeric
 * `.code` values onto `.status` here. Non-numeric `.code` (e.g. 'ENOENT',
 * 'ABORT_ERR') is preserved as-is so the spawn-failure and abort paths still
 * behave correctly.
 */
function execFileAsyncErrorNormalize(error: ExecFileException): ExecFileError {
  const execErr = error as ExecFileError;
  if (execErr.status === undefined) {
    const codeValue = (error as { code?: unknown }).code;
    if (typeof codeValue === 'number') {
      execErr.status = codeValue;
    }
  }
  return execErr;
}

function execFileTextRun(
  file: string,
  args: string[],
  options: {
    signal?: AbortSignal;
  } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    try {
      execFile(
        file,
        args,
        {
          encoding: 'utf8' as const,
          maxBuffer: 50 * 1024 * 1024,
          signal: options.signal,
        },
        (
          error: ExecFileException | null,
          stdout: string,
          stderr: string,
        ) => {
          if (error) {
            const execErr = execFileAsyncErrorNormalize(error);
            execErr.stdout = stdout;
            execErr.stderr = stderr;
            reject(execErr);
            return;
          }
          resolve({
            stdout: outputToString(stdout),
            stderr: outputToString(stderr),
          });
        },
      );
    } catch (error) {
      reject(error);
    }
  });
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

export async function biomeCheckAsync(
  files: string[],
  config?: BiomeProviderConfig,
  options: {
    signal?: AbortSignal;
  } = {},
): Promise<Result<PolicyViolation[], string>> {
  if (files.length === 0) {
    return Ok([]);
  }

  const bin = biomeBinGet(config);
  const args = biomeArgsGet(files, config);

  let stdout: string;
  try {
    const result = await execFileTextRun(bin, args, options);
    stdout = result.stdout;
  } catch (err: unknown) {
    if (execFileAbortedIs(err)) {
      throw err;
    }
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

export async function biomeFixAsync(
  files: string[],
  config?: BiomeProviderConfig,
  options: {
    signal?: AbortSignal;
  } = {},
): Promise<Result<boolean, string>> {
  if (files.length === 0) {
    return Ok(false);
  }

  const bin = biomeBinGet(config);
  const args = biomeArgsGet(files, config, ['--write']);

  try {
    await execFileTextRun(bin, args, options);
    return Ok(false);
  } catch (err: unknown) {
    if (execFileAbortedIs(err)) {
      throw err;
    }
    const execErr = err as ExecFileError;
    if (execErr.status === 1) {
      return Ok(true);
    }
    const stderr = outputToString(execErr.stderr).trim();
    return Err(`Failed to execute biome --write: ${stderr || execErr.message || String(err)}`);
  }
}

export { biomeDiagnosticToViolation };
