/**
 * Phase 9.4 / Gap 3 — TypeScript member-shape extraction matrix.
 *
 * Drives the index end-to-end (`projectIndexBuildSync`) against
 * representative TS source so the extractor's behavior is pinned at
 * the public-API surface, not via white-box checks of internal
 * helpers.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { langAdd, parserInit, projectIndexBuildSync } from '@codepol/core';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('member shape extraction (TypeScript)', () => {
  let testDir: string;

  beforeAll(async () => {
    langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
    langAdd({ langId: 'tsx', fileExtensions: ['.tsx'] });
    await parserInit();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-membershape-'));
  });

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('extracts public methods and properties from a class', () => {
    const file = path.join(testDir, 'class_basic.ts');
    fs.writeFileSync(
      file,
      `
class Widget {
  name: string = '';
  count = 0;
  render(opts: number): string { return ''; }
  dispose(): void { }
}
`,
    );

    const { index } = projectIndexBuildSync({ files: [file], dir: testDir });
    const [widget] = index.symbolsGetByName('Widget');
    expect(widget).toBeDefined();

    const shape = index.memberShapeForSymbolGet(widget.id);
    expect(shape).toBeDefined();
    expect(shape!.memberCountTruncated).toBe(false);
    const names = shape!.members.map((m) => m.name).sort();
    expect(names).toEqual(['count', 'dispose', 'name', 'render'].sort());
    const render = shape!.members.find((m) => m.name === 'render');
    expect(render?.memberKind).toBe('method');
    expect(render?.paramArity).toBe(1);
    const name = shape!.members.find((m) => m.name === 'name');
    expect(name?.memberKind).toBe('property');
    expect(name?.isOptional).toBe(false);
  });

  it('extracts optional members from an interface', () => {
    const file = path.join(testDir, 'iface_optional.ts');
    fs.writeFileSync(
      file,
      `
interface IThing {
  readonly id: string;
  label?: string;
  open(): void;
  close?(): void;
}
`,
    );

    const { index } = projectIndexBuildSync({ files: [file], dir: testDir });
    const [iface] = index.symbolsGetByName('IThing');
    expect(iface).toBeDefined();

    const shape = index.memberShapeForSymbolGet(iface.id);
    expect(shape).toBeDefined();
    expect(shape!.members.find((m) => m.name === 'label')?.isOptional).toBe(true);
    expect(shape!.members.find((m) => m.name === 'close')?.isOptional).toBe(true);
    expect(shape!.members.find((m) => m.name === 'id')?.isOptional).toBe(false);
    expect(shape!.members.find((m) => m.name === 'open')?.isOptional).toBe(false);
  });

  it('extracts members from a type-alias-of-object', () => {
    const file = path.join(testDir, 'type_alias.ts');
    fs.writeFileSync(
      file,
      `
type IRunner = {
  run(): void;
  status: string;
};
`,
    );

    const { index } = projectIndexBuildSync({ files: [file], dir: testDir });
    const [runnerType] = index.symbolsGetByName('IRunner');
    expect(runnerType).toBeDefined();

    const shape = index.memberShapeForSymbolGet(runnerType.id);
    expect(shape).toBeDefined();
    const names = shape!.members.map((m) => m.name).sort();
    expect(names).toEqual(['run', 'status'].sort());
  });

  it('captures getters and setters distinctly from methods', () => {
    const file = path.join(testDir, 'accessors.ts');
    fs.writeFileSync(
      file,
      `
class Cell {
  private _v = 0;
  get value(): number { return this._v; }
  set value(v: number) { this._v = v; }
}
`,
    );

    const { index } = projectIndexBuildSync({ files: [file], dir: testDir });
    const [cell] = index.symbolsGetByName('Cell');
    const shape = index.memberShapeForSymbolGet(cell.id);
    expect(shape).toBeDefined();
    const accessors = shape!.members.filter((m) => m.name === 'value');
    const kinds = accessors.map((m) => m.memberKind).sort();
    expect(kinds).toEqual(['getter', 'setter']);
  });

  it('separates static from instance members', () => {
    const file = path.join(testDir, 'statics.ts');
    fs.writeFileSync(
      file,
      `
class Counter {
  static defaultValue = 0;
  static reset(): void { }
  value = 0;
  increment(): void { }
}
`,
    );

    const { index } = projectIndexBuildSync({ files: [file], dir: testDir });
    const [counter] = index.symbolsGetByName('Counter');
    const shape = index.memberShapeForSymbolGet(counter.id);
    expect(shape).toBeDefined();
    const statics = shape!.members.filter((m) => m.isStatic).map((m) => m.name).sort();
    const instances = shape!.members.filter((m) => !m.isStatic).map((m) => m.name).sort();
    expect(statics).toEqual(['defaultValue', 'reset']);
    expect(instances).toEqual(['increment', 'value']);
  });

  it('excludes private-keyword and #-prefixed members', () => {
    const file = path.join(testDir, 'private.ts');
    fs.writeFileSync(
      file,
      `
class Box {
  private secret = 'x';
  #internal = 0;
  public visible = true;
}
`,
    );

    const { index } = projectIndexBuildSync({ files: [file], dir: testDir });
    const [box] = index.symbolsGetByName('Box');
    const shape = index.memberShapeForSymbolGet(box.id);
    expect(shape).toBeDefined();
    const names = shape!.members.map((m) => m.name);
    expect(names).toContain('visible');
    expect(names).not.toContain('secret');
    expect(names).not.toContain('#internal');
  });

  // The cap is 64 — generate a class with 70 distinct methods and
  // confirm the truncation flag fires while still respecting the cap.
  it('flags memberCountTruncated when the cap is exceeded', () => {
    const file = path.join(testDir, 'truncate.ts');
    const lines: string[] = ['class Big {'];
    for (let i = 0; i < 70; i++) {
      lines.push(`  m${i}(): void { }`);
    }
    lines.push('}');
    fs.writeFileSync(file, lines.join('\n'));

    const { index } = projectIndexBuildSync({ files: [file], dir: testDir });
    const [big] = index.symbolsGetByName('Big');
    const shape = index.memberShapeForSymbolGet(big.id);
    expect(shape).toBeDefined();
    expect(shape!.memberCountTruncated).toBe(true);
    expect(shape!.members.length).toBeLessThanOrEqual(64);
  });
});
