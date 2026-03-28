import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isOk, isErr } from '@codepol/core';
import {
  vultureLineParse,
  vultureOutputParse,
  vultureFindingToViolation,
  vultureCheck,
} from './vultureRunner';
import type { VultureFinding } from './vultureTypes';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

import { execFileSync } from 'node:child_process';

const mockExecFileSync = vi.mocked(execFileSync);

// ---------------------------------------------------------------------------
// vultureLineParse
// ---------------------------------------------------------------------------

describe('vultureLineParse', () => {
  it('parses a dead function line', () => {
    const finding = vultureLineParse(
      "app.py:4: unused function 'greet' (60% confidence)"
    );
    expect(finding).toEqual({
      filePath: 'app.py',
      line: 4,
      type: 'function',
      name: 'greet',
      confidence: 60,
    });
  });

  it('parses a dead class line', () => {
    const finding = vultureLineParse(
      "models/user.py:12: unused class 'LegacyUser' (60% confidence)"
    );
    expect(finding).toEqual({
      filePath: 'models/user.py',
      line: 12,
      type: 'class',
      name: 'LegacyUser',
      confidence: 60,
    });
  });

  it('parses an unused import line', () => {
    const finding = vultureLineParse(
      "app.py:1: unused import 'os' (90% confidence)"
    );
    expect(finding).toEqual({
      filePath: 'app.py',
      line: 1,
      type: 'import',
      name: 'os',
      confidence: 90,
    });
  });

  it('parses an unused variable line', () => {
    const finding = vultureLineParse(
      "script.py:8: unused variable 'message' (60% confidence)"
    );
    expect(finding).toEqual({
      filePath: 'script.py',
      line: 8,
      type: 'variable',
      name: 'message',
      confidence: 60,
    });
  });

  it('parses an unused attribute line', () => {
    const finding = vultureLineParse(
      "config.py:15: unused attribute 'timeout' (60% confidence)"
    );
    expect(finding).toEqual({
      filePath: 'config.py',
      line: 15,
      type: 'attribute',
      name: 'timeout',
      confidence: 60,
    });
  });

  it('parses an unused property line', () => {
    const finding = vultureLineParse(
      "models.py:20: unused property 'full_name' (60% confidence)"
    );
    expect(finding).toEqual({
      filePath: 'models.py',
      line: 20,
      type: 'property',
      name: 'full_name',
      confidence: 60,
    });
  });

  it('parses paths with directories', () => {
    const finding = vultureLineParse(
      "src/services/auth.py:42: unused function 'validate_token' (60% confidence)"
    );
    expect(finding).toEqual({
      filePath: 'src/services/auth.py',
      line: 42,
      type: 'function',
      name: 'validate_token',
      confidence: 60,
    });
  });

  it('handles 100% confidence', () => {
    const finding = vultureLineParse(
      "app.py:1: unused import 'sys' (100% confidence)"
    );
    expect(finding).toBeDefined();
    expect(finding!.confidence).toBe(100);
  });

  it('returns undefined for non-matching lines', () => {
    expect(vultureLineParse('')).toBeUndefined();
    expect(vultureLineParse('some random text')).toBeUndefined();
    expect(vultureLineParse('SyntaxError: invalid syntax')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// vultureOutputParse
// ---------------------------------------------------------------------------

describe('vultureOutputParse', () => {
  it('parses multi-line output with mixed finding types', () => {
    const output = [
      "app.py:1: unused import 'os' (90% confidence)",
      "app.py:4: unused function 'greet' (60% confidence)",
      "models.py:12: unused class 'OldModel' (60% confidence)",
    ].join('\n');

    const findings = vultureOutputParse(output);

    expect(findings).toHaveLength(3);
    expect(findings[0].type).toBe('import');
    expect(findings[1].type).toBe('function');
    expect(findings[2].type).toBe('class');
  });

  it('returns empty array for empty output', () => {
    expect(vultureOutputParse('')).toEqual([]);
    expect(vultureOutputParse('  \n  \n  ')).toEqual([]);
  });

  it('skips non-matching lines (warnings, blank lines)', () => {
    const output = [
      '',
      "app.py:1: unused import 'os' (90% confidence)",
      'WARNING: some vulture warning',
      "app.py:4: unused function 'greet' (60% confidence)",
      '',
    ].join('\n');

    const findings = vultureOutputParse(output);
    expect(findings).toHaveLength(2);
  });

  it('handles Windows-style line endings', () => {
    const output =
      "app.py:1: unused import 'os' (90% confidence)\r\n" +
      "app.py:4: unused function 'greet' (60% confidence)\r\n";

    const findings = vultureOutputParse(output);
    expect(findings).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// vultureFindingToViolation
// ---------------------------------------------------------------------------

describe('vultureFindingToViolation', () => {
  it('maps finding fields to PolicyViolation', () => {
    const finding: VultureFinding = {
      filePath: '/src/app.py',
      line: 4,
      type: 'function',
      name: 'greet',
      confidence: 60,
    };

    const violation = vultureFindingToViolation(finding);

    expect(violation.ruleId).toBe('python-dead-code');
    expect(violation.filePath).toBe('/src/app.py');
    expect(violation.message).toBe("unused function 'greet' (60% confidence)");
    expect(violation.line).toBe(4);
    expect(violation.column).toBe(1);
  });

  it('maps unused class finding', () => {
    const finding: VultureFinding = {
      filePath: 'models.py',
      line: 12,
      type: 'class',
      name: 'LegacyUser',
      confidence: 60,
    };

    const violation = vultureFindingToViolation(finding);

    expect(violation.ruleId).toBe('python-dead-code');
    expect(violation.message).toBe("unused class 'LegacyUser' (60% confidence)");
  });

  it('maps unused import finding', () => {
    const finding: VultureFinding = {
      filePath: 'app.py',
      line: 1,
      type: 'import',
      name: 'os',
      confidence: 90,
    };

    const violation = vultureFindingToViolation(finding);

    expect(violation.ruleId).toBe('python-dead-code');
    expect(violation.message).toBe("unused import 'os' (90% confidence)");
  });

  it('always sets column to 1', () => {
    const finding: VultureFinding = {
      filePath: 'app.py',
      line: 99,
      type: 'variable',
      name: 'x',
      confidence: 60,
    };

    expect(vultureFindingToViolation(finding).column).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// vultureCheck
// ---------------------------------------------------------------------------

describe('vultureCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns Ok([]) for empty file list', () => {
    const result = vultureCheck([]);

    expect(isOk(result)).toBe(true);
    expect(result.Ok).toEqual([]);
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it('returns Ok([]) when vulture finds no dead code (exit 0, empty stdout)', () => {
    mockExecFileSync.mockReturnValue('' as any);

    const result = vultureCheck(['app.py']);

    expect(isOk(result)).toBe(true);
    expect(result.Ok).toEqual([]);
  });

  it('parses violations from exit-1 stdout (dead code found)', () => {
    const vultureOutput = [
      "app.py:1: unused import 'os' (90% confidence)",
      "app.py:4: unused function 'greet' (60% confidence)",
    ].join('\n');

    mockExecFileSync.mockImplementation(() => {
      const err = new Error('vulture exited with code 1') as any;
      err.status = 1;
      err.stdout = vultureOutput;
      throw err;
    });

    const result = vultureCheck(['app.py']);

    expect(isOk(result)).toBe(true);
    expect(result.Ok).toHaveLength(2);
    expect(result.Ok![0].ruleId).toBe('python-dead-code');
    expect(result.Ok![0].message).toBe("unused import 'os' (90% confidence)");
    expect(result.Ok![1].message).toBe("unused function 'greet' (60% confidence)");
  });

  it('returns Err for exit code 2 (config/usage error)', () => {
    mockExecFileSync.mockImplementation(() => {
      const err = new Error('bad config') as any;
      err.status = 2;
      err.stderr = 'vulture: error: invalid config';
      throw err;
    });

    const result = vultureCheck(['app.py']);

    expect(isErr(result)).toBe(true);
    expect(result.Err).toContain('configuration or usage error');
    expect(result.Err).toContain('invalid config');
  });

  it('returns Err when vulture binary is missing (ENOENT)', () => {
    mockExecFileSync.mockImplementation(() => {
      const err = new Error('spawn vulture ENOENT') as any;
      err.code = 'ENOENT';
      throw err;
    });

    const result = vultureCheck(['app.py']);

    expect(isErr(result)).toBe(true);
    expect(result.Err).toContain('Failed to execute vulture');
    expect(result.Err).toContain('ENOENT');
  });

  it('returns Err for unexpected exit codes', () => {
    mockExecFileSync.mockImplementation(() => {
      const err = new Error('segfault') as any;
      err.status = 139;
      throw err;
    });

    const result = vultureCheck(['app.py']);

    expect(isErr(result)).toBe(true);
    expect(result.Err).toContain('Failed to execute vulture');
  });

  it('uses default binary name "vulture"', () => {
    mockExecFileSync.mockReturnValue('' as any);

    vultureCheck(['app.py']);

    expect(mockExecFileSync).toHaveBeenCalledWith(
      'vulture',
      expect.any(Array),
      expect.any(Object)
    );
  });

  it('uses custom binary from config', () => {
    mockExecFileSync.mockReturnValue('' as any);

    vultureCheck(['app.py'], { vultureBin: '/usr/local/bin/vulture' });

    expect(mockExecFileSync).toHaveBeenCalledWith(
      '/usr/local/bin/vulture',
      expect.any(Array),
      expect.any(Object)
    );
  });

  it('passes --min-confidence flag', () => {
    mockExecFileSync.mockReturnValue('' as any);

    vultureCheck(['app.py'], { minConfidence: 80 });

    const args = mockExecFileSync.mock.calls[0][1] as string[];
    expect(args).toContain('--min-confidence=80');
  });

  it('passes --exclude flag with comma-separated values', () => {
    mockExecFileSync.mockReturnValue('' as any);

    vultureCheck(['app.py'], { exclude: ['tests', 'docs'] });

    const args = mockExecFileSync.mock.calls[0][1] as string[];
    expect(args).toContain('--exclude=tests,docs');
  });

  it('passes --ignore-names flag with comma-separated values', () => {
    mockExecFileSync.mockReturnValue('' as any);

    vultureCheck(['app.py'], { ignoreNames: ['visit_*', 'test_*'] });

    const args = mockExecFileSync.mock.calls[0][1] as string[];
    expect(args).toContain('--ignore-names=visit_*,test_*');
  });

  it('appends whitelist paths as positional args', () => {
    mockExecFileSync.mockReturnValue('' as any);

    vultureCheck(['app.py'], { whitelistPaths: ['whitelist.py'] });

    const args = mockExecFileSync.mock.calls[0][1] as string[];
    expect(args).toContain('app.py');
    expect(args).toContain('whitelist.py');
  });

  it('passes multiple files as positional args', () => {
    mockExecFileSync.mockReturnValue('' as any);

    vultureCheck(['app.py', 'models.py', 'utils.py']);

    const args = mockExecFileSync.mock.calls[0][1] as string[];
    expect(args).toContain('app.py');
    expect(args).toContain('models.py');
    expect(args).toContain('utils.py');
  });

  it('combines multiple config options', () => {
    mockExecFileSync.mockReturnValue('' as any);

    vultureCheck(['src/'], {
      minConfidence: 80,
      exclude: ['tests'],
      ignoreNames: ['_*'],
      whitelistPaths: ['whitelist.py'],
    });

    const args = mockExecFileSync.mock.calls[0][1] as string[];
    expect(args).toContain('src/');
    expect(args).toContain('whitelist.py');
    expect(args).toContain('--min-confidence=80');
    expect(args).toContain('--exclude=tests');
    expect(args).toContain('--ignore-names=_*');
  });

  it('handles exit-1 with stdout containing only whitespace', () => {
    mockExecFileSync.mockImplementation(() => {
      const err = new Error('exit 1') as any;
      err.status = 1;
      err.stdout = '  \n  \n  ';
      throw err;
    });

    const result = vultureCheck(['app.py']);

    expect(isOk(result)).toBe(true);
    expect(result.Ok).toEqual([]);
  });

  it('returns Err when exit code 2 and stderr is missing', () => {
    mockExecFileSync.mockImplementation(() => {
      const err = new Error('usage error') as any;
      err.status = 2;
      throw err;
    });

    const result = vultureCheck(['app.py']);

    expect(isErr(result)).toBe(true);
    expect(result.Err).toContain('usage error');
  });
});
