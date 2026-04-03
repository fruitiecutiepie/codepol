import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { vultureFindingMatchesFile } from './vulturePathMatch';

describe('vultureFindingMatchesFile', () => {
  let dir: string;

  it('matches identical absolute paths', () => {
    expect(vultureFindingMatchesFile('/a/b/c.py', '/a/b/c.py')).toBe(true);
  });

  it('matches relative finding path against absolute target', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-vpm-'));
    const full = path.join(dir, 'm.py');
    fs.writeFileSync(full, 'x=1\n', 'utf8');
    expect(vultureFindingMatchesFile('m.py', full)).toBe(true);
  });

  afterAll(() => {
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
