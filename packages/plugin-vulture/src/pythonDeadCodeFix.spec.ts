import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isErr, langAdd, parserGetForFile, parserInit } from '@codepol/core';
import { pythonDeadCodeFixApply } from './pythonDeadCodeFix';

function vultureAvailable(): boolean {
  try {
    execFileSync('vulture', ['--version'], { encoding: 'utf8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

const describeIfVulture = vultureAvailable() ? describe : describe.skip;

describeIfVulture('pythonDeadCodeFixApply', () => {
  let dir: string;

  beforeAll(async () => {
    langAdd({ langId: 'python', fileExtensions: ['.py', '.pyw'] });
    await parserInit();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-pyfix-'));
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('removes a top-level unused function when Vulture reports it', () => {
    const file = path.join(dir, 'unused_fn.py');
    const source = `def dead_code():\n    return 1\n\nprint(42)\n`;
    fs.writeFileSync(file, source, 'utf8');

    expect(isErr(parserGetForFile(file))).toBe(false);

    const fixed = pythonDeadCodeFixApply(file, source, { minConfidence: 50 });
    expect(fixed).not.toContain('dead_code');
    expect(fixed).toContain('print(42)');
  });
});
