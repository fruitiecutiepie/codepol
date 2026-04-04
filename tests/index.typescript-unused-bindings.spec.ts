import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  langAdd,
  parserInit,
  projectIndexBuildSync,
  ReferenceUsage,
} from '@codepol/core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('typescript unused-binding index facts', () => {
  let testDir: string;

  beforeAll(async () => {
    langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
    langAdd({ langId: 'tsx', fileExtensions: ['.tsx'] });
    await parserInit();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-unused-bindings-'));
  });

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('extracts parameter and catch binding metadata from nested patterns', () => {
    const file = path.join(testDir, 'params.ts');
    fs.writeFileSync(file, `
function demo(a, { b = c, d }, [e], ...rest) {
  try {
    work();
  } catch (err) {
    console.log(err);
  }

  return a + b + c + d + e + rest.length;
}
`);

    const { index } = projectIndexBuildSync({ files: [file], dir: testDir });
    const symbols = index.symbolsInFileGet(file);

    const a = symbols.find((symbol) => symbol.name === 'a' && symbol.kind === 'parameter');
    const b = symbols.find((symbol) => symbol.name === 'b' && symbol.kind === 'parameter');
    const d = symbols.find((symbol) => symbol.name === 'd' && symbol.kind === 'parameter');
    const e = symbols.find((symbol) => symbol.name === 'e' && symbol.kind === 'parameter');
    const rest = symbols.find((symbol) => symbol.name === 'rest' && symbol.kind === 'parameter');
    const err = symbols.find((symbol) => symbol.name === 'err' && symbol.binding?.bindingKind === 'catch');

    expect(a?.binding?.parameterIndex).toBe(0);
    expect(a?.binding?.pattern).toBe('identifier');
    expect(b?.binding).toMatchObject({
      bindingKind: 'parameter',
      parameterIndex: 1,
      pattern: 'object',
      initialized: true,
    });
    expect(d?.binding).toMatchObject({
      bindingKind: 'parameter',
      parameterIndex: 1,
      pattern: 'object',
    });
    expect(e?.binding).toMatchObject({
      bindingKind: 'parameter',
      parameterIndex: 2,
      pattern: 'array',
    });
    expect(rest?.binding).toMatchObject({
      bindingKind: 'parameter',
      parameterIndex: 3,
      isRest: true,
    });
    expect(err?.binding?.bindingKind).toBe('catch');
  });

  it('resolves named function-expression self references without falling back to the outer binding', () => {
    const file = path.join(testDir, 'shadowing.ts');
    fs.writeFileSync(file, `
let foo = 1;
const bar = function foo() {
  return foo;
};

console.log(bar);
`);

    const { index } = projectIndexBuildSync({ files: [file], dir: testDir });
    const symbols = index.symbolsInFileGet(file).filter((symbol) => symbol.name === 'foo');
    const outerFoo = symbols.find((symbol) => symbol.binding?.bindingKind !== 'function-expression-name');
    const innerFoo = symbols.find((symbol) => symbol.binding?.bindingKind === 'function-expression-name');
    const refs = index.referencesInFileGet(file).filter((ref) => ref.name === 'foo');

    expect(outerFoo).toBeDefined();
    expect(innerFoo).toBeDefined();
    expect(refs).toHaveLength(1);
    expect(refs[0]?.resolvedSymbolId).toBe(innerFoo?.id);
  });

  it('documents resolveLocal behavior for a read before a same-scope const (lexical shadowing)', () => {
    const file = path.join(testDir, 'shadow-before-inner-const.ts');
    fs.writeFileSync(file, `
const outer = 1;
function demo() {
  console.log(outer);
  const outer = 2;
  return outer;
}

demo();
`);

    const { index } = projectIndexBuildSync({ files: [file], dir: testDir });
    const outers = index
      .symbolsInFileGet(file)
      .filter((symbol) => symbol.name === 'outer')
      .sort((a, b) => a.byteRange.start - b.byteRange.start);
    expect(outers).toHaveLength(2);
    const outerModule = outers[0];
    const innerBlock = outers[1];

    const outerRefs = index
      .referencesInFileGet(file)
      .filter((ref) => ref.name === 'outer')
      .sort((a, b) => a.byteRange.start - b.byteRange.start);
    expect(outerRefs.length).toBeGreaterThanOrEqual(2);

    const readBeforeInnerDecl = outerRefs.find(
      (ref) => ref.byteRange.start < innerBlock.byteRange.start,
    );
    expect(readBeforeInnerDecl).toBeDefined();

    // JavaScript binds this name to the inner `const` for the whole block (TDZ).
    // When resolveLocal is TDZ-aware, expect readBeforeInnerDecl.resolvedSymbolId === innerBlock.id.
    expect(readBeforeInnerDecl?.resolvedSymbolId).toBe(outerModule?.id);
  });

  it('marks write-only, self-update, and type-only references distinctly', () => {
    const file = path.join(testDir, 'usage.ts');
    fs.writeFileSync(file, `
let x = 1;
x = foo(x);
x++;
type T = typeof x;
`);

    const { index } = projectIndexBuildSync({ files: [file], dir: testDir });
    const refs = index.referencesInFileGet(file).filter((ref) => ref.name === 'x');

    expect(refs).toHaveLength(4);
    expect(refs.some((ref) => (ref.usage ?? 0) === ReferenceUsage.Write)).toBe(true);
    expect(refs.some((ref) => ((ref.usage ?? 0) & ReferenceUsage.SelfUpdate) !== 0)).toBe(true);
    expect(refs.some((ref) => ((ref.usage ?? 0) & ReferenceUsage.Type) !== 0)).toBe(true);
  });

  it('preserves local import usage when cross-file resolution rewrites the target symbol', () => {
    const exporterFile = path.join(testDir, 'utils.ts');
    const consumerFile = path.join(testDir, 'consumer.ts');

    fs.writeFileSync(exporterFile, `export const alpha = 1;`);
    fs.writeFileSync(consumerFile, `
import * as utils from './utils';

console.log(utils.alpha);
`);

    const { index } = projectIndexBuildSync({
      files: [exporterFile, consumerFile],
      dir: testDir,
    });

    const consumerSymbols = index.symbolsInFileGet(consumerFile);
    const namespaceImport = consumerSymbols.find((symbol) => symbol.name === 'utils');
    const exportedAlpha = index.symbolsInFileGet(exporterFile).find((symbol) => symbol.name === 'alpha');
    const dottedRef = index.referencesInFileGet(consumerFile).find((ref) => ref.name === 'utils.alpha');

    expect(namespaceImport).toBeDefined();
    expect(exportedAlpha).toBeDefined();
    expect(dottedRef?.localSymbolId).toBe(namespaceImport?.id);
    expect(dottedRef?.resolvedSymbolId).toBe(exportedAlpha?.id);
  });
});
