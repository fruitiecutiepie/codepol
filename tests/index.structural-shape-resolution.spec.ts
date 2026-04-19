/**
 * Phase 9.4 / Gap 3 — cross-file structural-shape resolution.
 *
 * Drives the index end-to-end (`projectIndexBuildSync`) over fixtures
 * that exercise every row of the comparison rules:
 *
 * - declared `implements` takes precedence (no duplicate)
 * - shape match across files
 * - name + kind + arity match
 * - optional members ignored on the interface side
 * - static vs. instance separation
 * - truncated owners produce no edges
 * - paramArity super-set allowed
 * - non-match on missing member
 * - non-match on wrong member kind
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { langAdd, parserInit, projectIndexBuildSync } from '@codepol/core';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('structural shape resolution', () => {
  let testDir: string;

  beforeAll(async () => {
    langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
    langAdd({ langId: 'tsx', fileExtensions: ['.tsx'] });
    await parserInit();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-shape-resolve-'));
  });

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  function setup(prefix: string, files: Record<string, string>): {
    indexFiles: string[];
    rootDir: string;
  } {
    const rootDir = path.join(testDir, prefix);
    fs.mkdirSync(rootDir, { recursive: true });
    const indexFiles: string[] = [];
    for (const [name, content] of Object.entries(files)) {
      const file = path.join(rootDir, name);
      fs.writeFileSync(file, content);
      indexFiles.push(file);
    }
    return { indexFiles, rootDir };
  }

  it('emits a structural-shape edge for cross-file duck-typed implementer', () => {
    const { indexFiles, rootDir } = setup('cross', {
      'iface.ts': `
export interface IShape {
  area(): number;
  name: string;
}
`,
      'impl.ts': `
export class Square {
  name = '';
  area(): number { return 4; }
}
`,
    });
    const { index } = projectIndexBuildSync({ files: indexFiles, dir: rootDir });
    const [iface] = index.symbolsGetByName('IShape');
    const [square] = index.symbolsGetByName('Square');

    // Default: no structural edge surfaces.
    expect(index.subTypesGet(iface.id)).toHaveLength(0);

    // Opt-in: structural-shape edge present.
    const all = index.subTypesGet(iface.id, { confidence: 'all' });
    expect(all).toHaveLength(1);
    expect(all[0].symbolId).toBe(square.id);
    expect(all[0].confidence).toBe('structural-shape');
    expect(all[0].relationKind).toBe('implements');
  });

  it('does not duplicate an edge when class declares `implements`', () => {
    const { indexFiles, rootDir } = setup('declared', {
      'iface.ts': `
export interface IShape {
  area(): number;
}
`,
      'impl.ts': `
import { IShape } from './iface';
export class Triangle implements IShape {
  area(): number { return 1; }
}
`,
    });
    const { index } = projectIndexBuildSync({ files: indexFiles, dir: rootDir });
    const [iface] = index.symbolsGetByName('IShape');

    const declared = index.subTypesGet(iface.id);
    expect(declared).toHaveLength(1);
    expect(declared[0].confidence === 'declared' || declared[0].confidence === undefined).toBe(true);

    const all = index.subTypesGet(iface.id, { confidence: 'all' });
    expect(all).toHaveLength(1);
    expect(all[0].confidence === 'declared' || all[0].confidence === undefined).toBe(true);
  });

  it('ignores optional interface members when matching', () => {
    const { indexFiles, rootDir } = setup('optional', {
      'iface.ts': `
export interface IThing {
  required(): void;
  maybe?(): void;
}
`,
      'impl.ts': `
export class Concrete {
  required(): void { }
}
`,
    });
    const { index } = projectIndexBuildSync({ files: indexFiles, dir: rootDir });
    const [iface] = index.symbolsGetByName('IThing');
    const all = index.subTypesGet(iface.id, { confidence: 'all' });
    expect(all).toHaveLength(1);
    expect(all[0].confidence).toBe('structural-shape');
  });

  it('refuses to match when a required member is missing', () => {
    const { indexFiles, rootDir } = setup('missing', {
      'iface.ts': `
export interface ITwo {
  a(): void;
  b(): void;
}
`,
      'impl.ts': `
export class JustA {
  a(): void { }
}
`,
    });
    const { index } = projectIndexBuildSync({ files: indexFiles, dir: rootDir });
    const [iface] = index.symbolsGetByName('ITwo');
    expect(index.subTypesGet(iface.id, { confidence: 'all' })).toHaveLength(0);
  });

  it('refuses to match when member kinds differ', () => {
    const { indexFiles, rootDir } = setup('kind', {
      'iface.ts': `
export interface IDual {
  field: string;
}
`,
      'impl.ts': `
export class Methody {
  field(): string { return ''; }
}
`,
    });
    const { index } = projectIndexBuildSync({ files: indexFiles, dir: rootDir });
    const [iface] = index.symbolsGetByName('IDual');
    expect(index.subTypesGet(iface.id, { confidence: 'all' })).toHaveLength(0);
  });

  it('separates static vs instance members', () => {
    const { indexFiles, rootDir } = setup('static', {
      'iface.ts': `
export interface IFactoryShape {
  build(): number;
}
`,
      'impl.ts': `
export class FactoryStatic {
  static build(): number { return 0; }
}
`,
    });
    const { index } = projectIndexBuildSync({ files: indexFiles, dir: rootDir });
    const [iface] = index.symbolsGetByName('IFactoryShape');
    // Interface member is instance; class member is static — no match.
    expect(index.subTypesGet(iface.id, { confidence: 'all' })).toHaveLength(0);
  });

  it('allows the class to accept extra optional parameters (paramArity superset)', () => {
    const { indexFiles, rootDir } = setup('arity', {
      'iface.ts': `
export interface ICallable {
  run(x: number): void;
}
`,
      'impl.ts': `
export class CallableImpl {
  run(x: number, y?: number): void { }
}
`,
    });
    const { index } = projectIndexBuildSync({ files: indexFiles, dir: rootDir });
    const [iface] = index.symbolsGetByName('ICallable');
    const all = index.subTypesGet(iface.id, { confidence: 'all' });
    expect(all).toHaveLength(1);
    expect(all[0].confidence).toBe('structural-shape');
  });

  it('refuses to emit edges when the class shape is truncated', () => {
    const lines: string[] = ['export class Huge {'];
    for (let i = 0; i < 70; i++) {
      lines.push(`  m${i}(): void { }`);
    }
    lines.push('  needed(): void { }');
    lines.push('}');
    const { indexFiles, rootDir } = setup('truncated', {
      'iface.ts': `
export interface INeeded {
  needed(): void;
}
`,
      'impl.ts': lines.join('\n'),
    });
    const { index } = projectIndexBuildSync({ files: indexFiles, dir: rootDir });
    const [iface] = index.symbolsGetByName('INeeded');
    // Truncated owner — must not emit a structural-shape edge even
    // though the needed member is present somewhere in the captured
    // shape (because the truncated picture may have dropped a
    // contradictory member).
    expect(index.subTypesGet(iface.id, { confidence: 'all' })).toHaveLength(0);
  });

  it('preserves byte-identical default `subTypesGet` output', () => {
    const { indexFiles, rootDir } = setup('default', {
      'iface.ts': `
export interface IShape {
  area(): number;
}
`,
      'impl.ts': `
export class Duck {
  area(): number { return 0; }
}
`,
    });
    const { index } = projectIndexBuildSync({ files: indexFiles, dir: rootDir });
    const [iface] = index.symbolsGetByName('IShape');
    expect(index.subTypesGet(iface.id)).toHaveLength(0);
    expect(index.typeRelationsGet(iface.id)).toHaveLength(0);
  });
});
