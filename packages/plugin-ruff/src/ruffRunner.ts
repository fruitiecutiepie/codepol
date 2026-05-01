/**
 * @packageDocumentation
 * Subprocess runner for `ruff check`.
 *
 * Executes ruff as a child process, parses its JSON output into
 * codepol PolicyViolation[], and supports --fix mode.
 */

import { execFile, execFileSync, type ExecFileException } from 'node:child_process';
import type { PolicyViolation } from '@codepol/core';
import { Ok, Err, diagnosticsRuntimeGet, type Result } from '@codepol/core';
import type { RuffDiagnostic, RuffProviderConfig } from './ruffTypes';

function ruffBinGet(config?: RuffProviderConfig): string {
  return config?.ruffBin ?? 'ruff';
}

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

function ruffArgsGet(
  files: string[],
  config?: RuffProviderConfig,
  extra?: string[]
): string[] {
  const args = ['check', '--output-format=json'];

  if (config?.select?.length) {
    args.push(`--select=${config.select.join(',')}`);
  }
  if (config?.ignore?.length) {
    args.push(`--ignore=${config.ignore.join(',')}`);
  }
  if (config?.configPath) {
    args.push(`--config=${config.configPath}`);
  }
  if (config?.fixable?.length) {
    args.push(`--fixable=${config.fixable.join(',')}`);
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
 * Maps a single Ruff diagnostic to a codepol PolicyViolation.
 */
function ruffDiagnosticToViolation(diag: RuffDiagnostic): PolicyViolation {
  const violation: PolicyViolation = {
    ruleId: diag.code ?? 'ruff',
    filePath: diag.filename,
    message: diag.message,
    line: diag.location.row,
    column: diag.location.column,
  };
  if (diag.end_location) {
    violation.endLine = diag.end_location.row;
    violation.endColumn = diag.end_location.column;
  }
  return violation;
}

/**
 * Runs `ruff check --output-format=json` on the given files and returns
 * the diagnostics as PolicyViolation[].
 *
 * Ruff exits with code 1 when violations are found (not an error).
 * A missing ruff binary or invalid config is reported via Result.Err.
 */
export function ruffCheck(
  files: string[],
  config?: RuffProviderConfig
): Result<PolicyViolation[], string> {
  if (files.length === 0) {
    return Ok([]);
  }

  const bin = ruffBinGet(config);
  const args = ruffArgsGet(files, config);

  let stdout: string;
  try {
    stdout = execFileSync(bin, args, {
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err: unknown) {
    const execErr = err as { status?: number; stdout?: string; stderr?: string; message?: string };
    // Ruff exits 1 when it finds violations -- that's normal
    if (execErr.status === 1 && execErr.stdout) {
      stdout = execErr.stdout;
    } else if (execErr.status === 2) {
      return Err(`ruff configuration or usage error: ${execErr.stderr ?? execErr.message}`);
    } else {
      return Err(`Failed to execute ruff: ${execErr.message ?? String(err)}`);
    }
  }

  const trimmed = stdout.trim();
  if (!trimmed || trimmed === '[]') {
    return Ok([]);
  }

  let diagnostics: RuffDiagnostic[];
  try {
    diagnostics = JSON.parse(trimmed) as RuffDiagnostic[];
  } catch {
    return Err(`Failed to parse ruff JSON output: ${trimmed.slice(0, 200)}`);
  }

  return Ok(diagnostics.map(ruffDiagnosticToViolation));
}

export async function ruffCheckAsync(
  files: string[],
  config?: RuffProviderConfig,
  options: {
    signal?: AbortSignal;
  } = {},
): Promise<Result<PolicyViolation[], string>> {
  if (files.length === 0) {
    return Ok([]);
  }

  const ruffDiag = diagnosticsRuntimeGet().getDiagnostics('external.ruff');
  const startedAt = Date.now();
  ruffDiag.info('external.ruff.check.start', { fileCount: files.length });

  const bin = ruffBinGet(config);
  const args = ruffArgsGet(files, config);

  let stdout: string;
  try {
    const result = await execFileTextRun(bin, args, options);
    stdout = result.stdout;
  } catch (err: unknown) {
    if (execFileAbortedIs(err)) {
      ruffDiag.info('external.ruff.check.end', {
        durationMs: Date.now() - startedAt,
        outcome: 'aborted',
        fileCount: files.length,
      });
      throw err;
    }
    const execErr = err as ExecFileError;
    if (execErr.status === 1 && execErr.stdout) {
      stdout = outputToString(execErr.stdout);
    } else if (execErr.status === 2) {
      ruffDiag.info('external.ruff.check.end', {
        durationMs: Date.now() - startedAt,
        outcome: 'config_error',
        fileCount: files.length,
      });
      return Err(`ruff configuration or usage error: ${outputToString(execErr.stderr) || execErr.message}`);
    } else {
      ruffDiag.info('external.ruff.check.end', {
        durationMs: Date.now() - startedAt,
        outcome: 'exec_error',
        fileCount: files.length,
      });
      return Err(`Failed to execute ruff: ${execErr.message ?? String(err)}`);
    }
  }

  const trimmed = stdout.trim();
  if (!trimmed || trimmed === '[]') {
    ruffDiag.info('external.ruff.check.end', {
      durationMs: Date.now() - startedAt,
      outcome: 'empty',
      violationCount: 0,
      fileCount: files.length,
    });
    return Ok([]);
  }

  let diagnostics: RuffDiagnostic[];
  try {
    diagnostics = JSON.parse(trimmed) as RuffDiagnostic[];
  } catch {
    ruffDiag.info('external.ruff.check.end', {
      durationMs: Date.now() - startedAt,
      outcome: 'parse_error',
      fileCount: files.length,
    });
    return Err(`Failed to parse ruff JSON output: ${trimmed.slice(0, 200)}`);
  }

  const violations = diagnostics.map(ruffDiagnosticToViolation);
  ruffDiag.info('external.ruff.check.end', {
    durationMs: Date.now() - startedAt,
    outcome: 'ok',
    violationCount: violations.length,
    fileCount: files.length,
  });
  return Ok(violations);
}

/**
 * Runs `ruff check --fix` on the given files.
 * Returns Ok(true) if fixes were applied, Ok(false) if no fixes were needed,
 * or Err on failure.
 */
export function ruffFix(
  files: string[],
  config?: RuffProviderConfig
): Result<boolean, string> {
  if (files.length === 0) {
    return Ok(false);
  }

  const bin = ruffBinGet(config);
  const args = ruffArgsGet(files, config, ['--fix']);
  // For fix mode, don't use JSON output -- ruff applies fixes in-place
  const jsonIdx = args.indexOf('--output-format=json');
  if (jsonIdx !== -1) {
    args.splice(jsonIdx, 1);
  }

  try {
    execFileSync(bin, args, {
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return Ok(false);
  } catch (err: unknown) {
    const execErr = err as { status?: number; stderr?: string; message?: string };
    // Exit 1 = violations remain after fixing (some unfixable)
    if (execErr.status === 1) {
      return Ok(true);
    }
    if (execErr.status === 2) {
      return Err(`ruff configuration or usage error: ${execErr.stderr ?? execErr.message}`);
    }
    return Err(`Failed to execute ruff --fix: ${execErr.message ?? String(err)}`);
  }
}

export async function ruffFixAsync(
  files: string[],
  config?: RuffProviderConfig,
  options: {
    signal?: AbortSignal;
  } = {},
): Promise<Result<boolean, string>> {
  if (files.length === 0) {
    return Ok(false);
  }

  const bin = ruffBinGet(config);
  const args = ruffArgsGet(files, config, ['--fix']);
  const jsonIdx = args.indexOf('--output-format=json');
  if (jsonIdx !== -1) {
    args.splice(jsonIdx, 1);
  }

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
    if (execErr.status === 2) {
      return Err(`ruff configuration or usage error: ${outputToString(execErr.stderr) || execErr.message}`);
    }
    return Err(`Failed to execute ruff --fix: ${execErr.message ?? String(err)}`);
  }
}

export { ruffDiagnosticToViolation };
