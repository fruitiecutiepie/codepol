/**
 * @packageDocumentation
 * Subprocess runner for `ruff check`.
 *
 * Executes ruff as a child process, parses its JSON output into
 * codepol PolicyViolation[], and supports --fix mode.
 */

import { execFileSync } from 'node:child_process';
import type { PolicyViolation } from '@codepol/core';
import { Ok, Err, type Result } from '@codepol/core';
import type { RuffDiagnostic, RuffProviderConfig } from './ruffTypes';

function ruffBinGet(config?: RuffProviderConfig): string {
  return config?.ruffBin ?? 'ruff';
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
  return {
    ruleId: diag.code ?? 'ruff',
    filePath: diag.filename,
    message: diag.message,
    line: diag.location.row,
    column: diag.location.column,
  };
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

export { ruffDiagnosticToViolation };
