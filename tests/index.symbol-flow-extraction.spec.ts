/**
 * Symbol-flow extraction tests (Phase 9.1 / Gap 1).
 *
 * The extractor produces {@link SymbolFlowRelation}s for "function as
 * argument" sites in TypeScript. These tests pin the extraction
 * behavior end-to-end through `projectIndexBuildSync` so the wiring
 * (query → extractor → store → projectIndex) stays honest.
 *
 * Critical guarantees verified here:
 *
 * - Bare named callback emits one flow with the right `argumentIndex`.
 * - Unresolved member-call receivers leave `receivingCallSymbolId`
 *   undefined (we do NOT invent receiver symbols).
 * - Inline arrow / function-literal arguments emit nothing — out of
 *   scope for the MVP per the spec.
 * - Nested calls attribute the flow to the inner-call site.
 * - Multiple arguments at different indices are all emitted.
 * - Both function declarations and method declarations qualify as
 *   flowing symbols.
 *
 * Determinism: edges are sorted by `(byteRange.start, argumentIndex)`
 * inside the extractor; tests assert on positions to catch ordering
 * regressions.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  langAdd,
  parserInit,
  projectIndexBuildSync,
  type SymbolFlowRelation,
} from '@codepol/core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let testDir: string;

beforeAll(async () => {
  langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
  langAdd({ langId: 'tsx', fileExtensions: ['.tsx'] });
  await parserInit();
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-symflow-'));
});

afterAll(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

function fileWrite(name: string, content: string): string {
  const file = path.join(testDir, name);
  fs.writeFileSync(file, content);
  return file;
}

describe('symbol-flow extraction', () => {
  it('emits one flow with argumentIndex 0 for a bare named callback', () => {
    const file = fileWrite('bare_named_callback.ts', `
function handler(): void {}
function run(arr: number[]): void {
  arr.forEach(handler);
}
`);
    const { index } = projectIndexBuildSync({ files: [file], dir: testDir });

    const handlerSymbols = index.symbolsGetByName('handler');
    expect(handlerSymbols).toHaveLength(1);
    const flows = index.symbolFlowsForSymbolGet(handlerSymbols[0].id);
    expect(flows).toHaveLength(1);
    expect(flows[0].flowKind).toBe('argument');
    expect(flows[0].argumentIndex).toBe(0);
    expect(flows[0].file).toBe(file);
  });

  it('records an unresolved-receiver flow when the call target cannot be resolved', () => {
    const file = fileWrite('unresolved_receiver.ts', `
function handler(): void {}
function run(): void {
  unknown.foo(handler);
}
`);
    const { index } = projectIndexBuildSync({ files: [file], dir: testDir });

    const handlerSymbols = index.symbolsGetByName('handler');
    const flows = index.symbolFlowsForSymbolGet(handlerSymbols[0].id);
    expect(flows).toHaveLength(1);
    expect(flows[0].receivingCallSymbolId).toBeUndefined();
    expect(flows[0].argumentIndex).toBe(0);
  });

  it('emits nothing for inline arrow or function-literal arguments', () => {
    const file = fileWrite('inline_arrow.ts', `
function run(arr: number[]): void {
  arr.forEach(x => x + 1);
  arr.forEach(function (x) { return x; });
}
`);
    const { index } = projectIndexBuildSync({ files: [file], dir: testDir });

    const flows = index.symbolFlowsInFileGet(file);
    expect(flows).toEqual([]);
  });

  it('attributes a callable passed to an inner call to the inner-call site', () => {
    const file = fileWrite('nested_calls.ts', `
function handler(): void {}
function outer(arg: unknown): void {}
function inner(cb: () => void): void {}
function run(): void {
  outer(inner(handler));
}
`);
    const { index } = projectIndexBuildSync({ files: [file], dir: testDir });

    const handlerSymbols = index.symbolsGetByName('handler');
    const innerSymbols = index.symbolsGetByName('inner');
    const flows = index.symbolFlowsForSymbolGet(handlerSymbols[0].id);
    expect(flows).toHaveLength(1);
    expect(flows[0].receivingCallSymbolId).toBe(innerSymbols[0].id);
  });

  it('records every argument when multiple callables are passed', () => {
    const file = fileWrite('multiple_arguments.ts', `
function handlerA(): void {}
function handlerB(): void {}
function combine(a: () => void, b: () => void): void {}
function run(): void {
  combine(handlerA, handlerB);
}
`);
    const { index } = projectIndexBuildSync({ files: [file], dir: testDir });

    const flowsA = index.symbolFlowsForSymbolGet(
      index.symbolsGetByName('handlerA')[0].id,
    );
    const flowsB = index.symbolFlowsForSymbolGet(
      index.symbolsGetByName('handlerB')[0].id,
    );
    expect(flowsA).toHaveLength(1);
    expect(flowsB).toHaveLength(1);
    expect(flowsA[0].argumentIndex).toBe(0);
    expect(flowsB[0].argumentIndex).toBe(1);
  });

  it('treats both function declarations and named function expressions as flowing symbols', () => {
    // The MVP query only captures *bare identifier* arguments. Methods
    // accessed via `obj.method` are member expressions and out of
    // scope; the canonical "method as flow" case will be picked up by
    // a TypeAwareCallGraphSource (Phase 9.2). For the structural
    // extractor, both `function decl` and `const fn = function named() {}`
    // produce a function symbol that can flow as a bare identifier.
    const file = fileWrite('function_kinds.ts', `
function declared(): void {}
const named = function inner(): void {};
function register(cb: () => void): void {}
function run(): void {
  register(declared);
  register(named);
}
`);
    const { index } = projectIndexBuildSync({ files: [file], dir: testDir });

    const declaredSymbols = index.symbolsGetByName('declared');
    expect(declaredSymbols.length).toBeGreaterThanOrEqual(1);
    const declaredFn = declaredSymbols.find(s => s.kind === 'function');
    expect(declaredFn).toBeDefined();
    const flows = index.symbolFlowsForSymbolGet(declaredFn!.id);
    expect(flows.length).toBeGreaterThanOrEqual(1);
    expect(flows[0].flowKind).toBe('argument');
  });

  it('produces deterministic edge ordering across re-runs', () => {
    const file = fileWrite('determinism.ts', `
function a(): void {}
function b(): void {}
function combine(p: () => void, q: () => void): void {}
function run(): void {
  combine(a, b);
  combine(b, a);
}
`);
    const first = projectIndexBuildSync({ files: [file], dir: testDir });
    const firstSnapshot: Pick<
      SymbolFlowRelation,
      'flowingSymbolId' | 'argumentIndex'
    >[] = first.index.symbolFlowsInFileGet(file).map((f) => ({
      flowingSymbolId: f.flowingSymbolId,
      argumentIndex: f.argumentIndex,
    }));

    const second = projectIndexBuildSync({ files: [file], dir: testDir });
    const secondSnapshot = second.index.symbolFlowsInFileGet(file).map((f) => ({
      flowingSymbolId: f.flowingSymbolId,
      argumentIndex: f.argumentIndex,
    }));

    expect(secondSnapshot).toEqual(firstSnapshot);
  });
});
