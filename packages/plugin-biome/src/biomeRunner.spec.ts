import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isErr, isOk } from '@codepol/core';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

import { execFileSync } from 'node:child_process';
import {
  biomeCheck,
  biomeFix,
  biomeDiagnosticToViolation,
} from './biomeRunner';
import type { BiomeDiagnostic } from './biomeTypes';

const mockExecFileSync = vi.mocked(execFileSync);

describe('biomeDiagnosticToViolation', () => {
  it('maps a Biome RDJSON diagnostic to a PolicyViolation', () => {
    const diagnostic: BiomeDiagnostic = {
      code: {
        value: 'lint/suspicious/noDoubleEquals',
        url: 'https://biomejs.dev/linter/rules/no-double-equals',
      },
      location: {
        path: 'src/app.ts',
        range: {
          start: { line: 1, column: 7 },
          end: { line: 1, column: 9 },
        },
      },
      message: 'Use === instead of ==',
    };

    const violation = biomeDiagnosticToViolation(diagnostic);

    expect(violation).toMatchObject({
      ruleId: 'lint/suspicious/noDoubleEquals',
      filePath: expect.stringMatching(/src\/app\.ts$/),
      message: 'Use === instead of ==',
      line: 2,
      column: 8,
      endLine: 2,
      endColumn: 10,
    });
  });

  it('returns null when Biome omits a file path', () => {
    const diagnostic: BiomeDiagnostic = {
      message: 'Project-level diagnostic',
    };

    expect(biomeDiagnosticToViolation(diagnostic)).toBeNull();
  });
});

describe('biomeCheck', () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  it('returns Ok([]) when there are no files', () => {
    const result = biomeCheck([]);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.Ok).toEqual([]);
    }
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it('parses RDJSON diagnostics when Biome exits with code 1', () => {
    const error = new Error('biome found diagnostics') as Error & {
      status: number;
      stdout: string;
      stderr: string;
    };
    error.status = 1;
    error.stdout = JSON.stringify({
      diagnostics: [
        {
          code: { value: 'lint/suspicious/noDoubleEquals' },
          location: {
            path: 'src/app.ts',
            range: {
              start: { line: 0, column: 15 },
              end: { line: 0, column: 17 },
            },
          },
          message: 'Use === instead of ==',
        },
      ],
    });
    error.stderr = '';
    mockExecFileSync.mockImplementationOnce(() => {
      throw error;
    });

    const result = biomeCheck(['/workspace/src/app.ts'], {
      biomeBin: '/tmp/biome',
      configPath: '/workspace/biome.json',
      extraArgs: ['--diagnostic-level=warn'],
    });

    expect(mockExecFileSync).toHaveBeenCalledWith(
      '/tmp/biome',
      [
        'lint',
        '--reporter=rdjson',
        '--files-ignore-unknown=true',
        '--no-errors-on-unmatched',
        '--config-path=/workspace/biome.json',
        '--diagnostic-level=warn',
        '/workspace/src/app.ts',
      ],
      expect.objectContaining({
        encoding: 'utf8',
      })
    );
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.Ok).toHaveLength(1);
      expect(result.Ok[0]).toMatchObject({
        ruleId: 'lint/suspicious/noDoubleEquals',
        message: 'Use === instead of ==',
        line: 1,
        column: 16,
      });
    }
  });

  it('returns Err when Biome output is not valid JSON', () => {
    mockExecFileSync.mockReturnValueOnce('not-json');

    const result = biomeCheck(['/workspace/src/app.ts']);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.Err).toContain('Failed to parse biome RDJSON output');
    }
  });
});

describe('biomeFix', () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  it('includes --write and treats exit code 1 as a non-fatal fix run', () => {
    const error = new Error('remaining diagnostics') as Error & {
      status: number;
      stderr: string;
    };
    error.status = 1;
    error.stderr = '';
    mockExecFileSync.mockImplementationOnce(() => {
      throw error;
    });

    const result = biomeFix(['/workspace/src/app.ts'], {
      biomeBin: '/tmp/biome',
    });

    expect(mockExecFileSync).toHaveBeenCalledWith(
      '/tmp/biome',
      [
        'lint',
        '--reporter=rdjson',
        '--files-ignore-unknown=true',
        '--no-errors-on-unmatched',
        '--write',
        '/workspace/src/app.ts',
      ],
      expect.objectContaining({
        encoding: 'utf8',
      })
    );
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

    const result = biomeFix(['/workspace/src/app.ts']);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.Err).toContain('Failed to execute biome --write');
    }
  });
});
