import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isErr, isOk } from '@codepol/core';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  execFileSync: vi.fn(),
}));

import { execFile, execFileSync } from 'node:child_process';
import {
  ruffCheck,
  ruffCheckAsync,
  ruffDiagnosticToViolation,
  ruffFix,
  ruffFixAsync,
} from './ruffRunner';

const mockExecFile = vi.mocked(execFile);
const mockExecFileSync = vi.mocked(execFileSync);

describe('ruffDiagnosticToViolation', () => {
  it('maps a Ruff diagnostic to a PolicyViolation', () => {
    expect(
      ruffDiagnosticToViolation({
        cell: null,
        code: 'F401',
        filename: '/workspace/src/app.py',
        message: '`os` imported but unused',
        location: {
          row: 1,
          column: 1,
        },
        end_location: {
          row: 1,
          column: 3,
        },
        fix: null,
        noqa_row: 0,
        url: null,
      }),
    ).toEqual({
      ruleId: 'F401',
      filePath: '/workspace/src/app.py',
      message: '`os` imported but unused',
      line: 1,
      column: 1,
      endLine: 1,
      endColumn: 3,
    });
  });
});

describe('ruffCheck', () => {
  beforeEach(() => {
    mockExecFile.mockReset();
    mockExecFileSync.mockReset();
  });

  it('parses diagnostics when Ruff exits with code 1', () => {
    const error = new Error('ruff found violations') as Error & {
      status: number;
      stdout: string;
      stderr: string;
    };
    error.status = 1;
    error.stdout = JSON.stringify([
      {
        code: 'F401',
        filename: '/workspace/src/app.py',
        message: '`os` imported but unused',
        location: {
          row: 1,
          column: 1,
        },
        end_location: {
          row: 1,
          column: 3,
        },
      },
    ]);
    error.stderr = '';
    mockExecFileSync.mockImplementationOnce(() => {
      throw error;
    });

    const result = ruffCheck(['/workspace/src/app.py'], {
      ruffBin: '/tmp/ruff',
      select: ['F401'],
    });

    expect(mockExecFileSync).toHaveBeenCalledWith(
      '/tmp/ruff',
      [
        'check',
        '--output-format=json',
        '--select=F401',
        '/workspace/src/app.py',
      ],
      expect.objectContaining({
        encoding: 'utf8',
      }),
    );
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.Ok).toEqual([
        expect.objectContaining({
          ruleId: 'F401',
          filePath: '/workspace/src/app.py',
        }),
      ]);
    }
  });

  it('supports aborting async ruff checks', async () => {
    const controller = new AbortController();
    mockExecFile.mockImplementationOnce((_file, _args, options, callback) => {
      const signal = (options as { signal?: AbortSignal }).signal;
      signal?.addEventListener('abort', () => {
        const error = Object.assign(new Error('The operation was aborted'), {
          name: 'AbortError',
          code: 'ABORT_ERR',
        });
        callback?.(error, '', '');
      }, { once: true });
      return {} as never;
    });

    const resultPromise = ruffCheckAsync(['/workspace/src/app.py'], undefined, {
      signal: controller.signal,
    });
    controller.abort();

    await expect(resultPromise).rejects.toMatchObject({
      name: 'AbortError',
      code: 'ABORT_ERR',
    });
  });

  it('ruffCheckAsync parses diagnostics when Ruff exits with code 1 via the async `.code` field', async () => {
    // Node's `execFile` callback error carries the exit code on `.code`
    // (whereas `execFileSync` carries it on `.status`). The runner must
    // recognise both so real ruff's "found violations" exit isn't dropped.
    const error = Object.assign(new Error('ruff found violations'), {
      code: 1,
      stdout: JSON.stringify([
        {
          code: 'F401',
          filename: '/workspace/src/app.py',
          message: '`os` imported but unused',
          location: { row: 1, column: 1 },
          end_location: { row: 1, column: 3 },
        },
      ]),
      stderr: '',
    });

    mockExecFile.mockImplementationOnce((_file, _args, _options, callback) => {
      callback?.(error as unknown as NodeJS.ErrnoException, error.stdout, error.stderr);
      return {} as never;
    });

    const result = await ruffCheckAsync(['/workspace/src/app.py'], {
      ruffBin: '/tmp/ruff',
      select: ['F401'],
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.Ok).toEqual([
        expect.objectContaining({
          ruleId: 'F401',
          filePath: '/workspace/src/app.py',
        }),
      ]);
    }
  });

  it('ruffCheckAsync reports configuration errors when Ruff exits with code 2 via the async `.code` field', async () => {
    const error = Object.assign(new Error('ruff usage error'), {
      code: 2,
      stdout: '',
      stderr: 'error: unrecognized arguments: --bogus',
    });

    mockExecFile.mockImplementationOnce((_file, _args, _options, callback) => {
      callback?.(error as unknown as NodeJS.ErrnoException, error.stdout, error.stderr);
      return {} as never;
    });

    const result = await ruffCheckAsync(['/workspace/src/app.py']);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.Err).toContain('ruff configuration or usage error');
      expect(result.Err).toContain('--bogus');
    }
  });

  it('ruffCheckAsync leaves non-numeric `.code` (e.g. ENOENT) on the "failed to execute" path', async () => {
    const error = Object.assign(new Error('spawn /tmp/missing ENOENT'), {
      code: 'ENOENT',
      stdout: '',
      stderr: '',
    });

    mockExecFile.mockImplementationOnce((_file, _args, _options, callback) => {
      callback?.(error as unknown as NodeJS.ErrnoException, error.stdout, error.stderr);
      return {} as never;
    });

    const result = await ruffCheckAsync(['/workspace/src/app.py'], {
      ruffBin: '/tmp/missing',
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.Err).toContain('Failed to execute ruff');
      expect(result.Err).toContain('ENOENT');
    }
  });
});

describe('ruffFix', () => {
  beforeEach(() => {
    mockExecFile.mockReset();
    mockExecFileSync.mockReset();
  });

  it('treats exit code 1 as a non-fatal fix run', () => {
    const error = new Error('remaining diagnostics') as Error & {
      status: number;
      stderr: string;
    };
    error.status = 1;
    error.stderr = '';
    mockExecFileSync.mockImplementationOnce(() => {
      throw error;
    });

    const result = ruffFix(['/workspace/src/app.py'], {
      ruffBin: '/tmp/ruff',
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.Ok).toBe(true);
    }
  });

  it('returns Err for execution failures', () => {
    const error = new Error('spawn ENOENT') as Error & {
      status: number;
      stderr: string;
    };
    error.status = 2;
    error.stderr = 'spawn ENOENT';
    mockExecFileSync.mockImplementationOnce(() => {
      throw error;
    });

    const result = ruffFix(['/workspace/src/app.py']);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.Err).toContain('ruff configuration or usage error');
    }
  });

  it('supports aborting async ruff fixes', async () => {
    const controller = new AbortController();
    mockExecFile.mockImplementationOnce((_file, _args, options, callback) => {
      const signal = (options as { signal?: AbortSignal }).signal;
      signal?.addEventListener('abort', () => {
        const error = Object.assign(new Error('The operation was aborted'), {
          name: 'AbortError',
          code: 'ABORT_ERR',
        });
        callback?.(error, '', '');
      }, { once: true });
      return {} as never;
    });

    const resultPromise = ruffFixAsync(['/workspace/src/app.py'], undefined, {
      signal: controller.signal,
    });
    controller.abort();

    await expect(resultPromise).rejects.toMatchObject({
      name: 'AbortError',
      code: 'ABORT_ERR',
    });
  });

  it('ruffFixAsync treats exit code 1 via the async `.code` field as a non-fatal fix run', async () => {
    const error = Object.assign(new Error('remaining diagnostics after fix'), {
      code: 1,
      stdout: '',
      stderr: '',
    });

    mockExecFile.mockImplementationOnce((_file, _args, _options, callback) => {
      callback?.(error as unknown as NodeJS.ErrnoException, error.stdout, error.stderr);
      return {} as never;
    });

    const result = await ruffFixAsync(['/workspace/src/app.py'], {
      ruffBin: '/tmp/ruff',
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.Ok).toBe(true);
    }
  });

  it('ruffFixAsync reports configuration errors when code 2 arrives via the async `.code` field', async () => {
    const error = Object.assign(new Error('ruff usage error'), {
      code: 2,
      stdout: '',
      stderr: 'error: unknown rule code',
    });

    mockExecFile.mockImplementationOnce((_file, _args, _options, callback) => {
      callback?.(error as unknown as NodeJS.ErrnoException, error.stdout, error.stderr);
      return {} as never;
    });

    const result = await ruffFixAsync(['/workspace/src/app.py']);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.Err).toContain('ruff configuration or usage error');
    }
  });
});
