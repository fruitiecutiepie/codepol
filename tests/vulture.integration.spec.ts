import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { vultureCheck } from '@codepol/plugin-vulture';
import { isOk } from '@codepol/core';
import path from 'node:path';

function vultureAvailable(): boolean {
  try {
    execFileSync('vulture', ['--version'], { encoding: 'utf8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures', 'py');

const describeIfVulture = vultureAvailable() ? describe : describe.skip;

describeIfVulture('vulture integration (real binary + fixtures)', () => {
  it('detects dead code in the fixture project', () => {
    const result = vultureCheck([FIXTURE_DIR]);

    expect(isOk(result)).toBe(true);

    const violations = result.Ok!;
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.every(v => v.ruleId === 'python-dead-code')).toBe(true);
    expect(violations.every(v => v.line > 0)).toBe(true);
    expect(violations.every(v => v.column === 1)).toBe(true);
  });

  it('detects unused import in standalone.py', () => {
    const file = path.join(FIXTURE_DIR, 'standalone.py');
    const result = vultureCheck([file]);

    expect(isOk(result)).toBe(true);

    const violations = result.Ok!;
    const importViolation = violations.find(v => v.message.includes("'models'"));
    expect(importViolation).toBeDefined();
    expect(importViolation!.message).toContain('unused import');
    expect(importViolation!.message).toContain('90% confidence');
  });

  it('detects unused function in commands.py', () => {
    const file = path.join(FIXTURE_DIR, 'myapp', 'cli', 'commands.py');
    const result = vultureCheck([file]);

    expect(isOk(result)).toBe(true);

    const violations = result.Ok!;
    const names = violations.map(v => v.message);
    expect(names.some(m => m.includes("'run_command'"))).toBe(true);
    expect(names.some(m => m.includes("'list_users'"))).toBe(true);
  });

  it('detects unused class in user.py', () => {
    const file = path.join(FIXTURE_DIR, 'myapp', 'models', 'user.py');
    const result = vultureCheck([file]);

    expect(isOk(result)).toBe(true);

    const violations = result.Ok!;
    const classViolation = violations.find(v => v.message.includes("unused class 'Meta'"));
    expect(classViolation).toBeDefined();
  });

  it('respects --min-confidence filtering', () => {
    const file = path.join(FIXTURE_DIR, 'standalone.py');

    const lowConf = vultureCheck([file], { minConfidence: 60 });
    const highConf = vultureCheck([file], { minConfidence: 100 });

    expect(isOk(lowConf)).toBe(true);
    expect(isOk(highConf)).toBe(true);
    expect(highConf.Ok!.length).toBeLessThanOrEqual(lowConf.Ok!.length);
  });

  it('respects --ignore-names filtering', () => {
    const file = path.join(FIXTURE_DIR, 'myapp', 'cli', 'commands.py');

    const unfiltered = vultureCheck([file]);
    const filtered = vultureCheck([file], { ignoreNames: ['run_command'] });

    expect(isOk(unfiltered)).toBe(true);
    expect(isOk(filtered)).toBe(true);
    expect(filtered.Ok!.length).toBeLessThan(unfiltered.Ok!.length);
    expect(filtered.Ok!.every(v => !v.message.includes("'run_command'"))).toBe(true);
  });

  it('respects --exclude filtering', () => {
    const allResult = vultureCheck([FIXTURE_DIR]);
    const excludeResult = vultureCheck([FIXTURE_DIR], { exclude: ['cli'] });

    expect(isOk(allResult)).toBe(true);
    expect(isOk(excludeResult)).toBe(true);

    const allHasCli = allResult.Ok!.some(v => v.filePath.includes('cli'));
    const excludeHasCli = excludeResult.Ok!.some(v => v.filePath.includes('cli'));

    expect(allHasCli).toBe(true);
    expect(excludeHasCli).toBe(false);
  });

  it('returns Ok([]) for a clean Python file', () => {
    const file = path.join(FIXTURE_DIR, 'myapp', '__init__.py');
    const result = vultureCheck([file]);

    expect(isOk(result)).toBe(true);
    expect(result.Ok!).toHaveLength(0);
  });
});
