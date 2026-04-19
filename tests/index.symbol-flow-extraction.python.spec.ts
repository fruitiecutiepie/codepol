/**
 * Python symbol-flow extraction tests (Phase 9.1 / Gap 1 follow-up).
 *
 * Mirrors the TypeScript extraction matrix one-for-one so the two
 * language packs stay in lockstep. Same MVP rules apply:
 *
 * - Bare named callback emits one flow with the right `argumentIndex`.
 * - Unresolved member-call receivers leave `receivingCallSymbolId`
 *   undefined.
 * - Inline `lambda` expressions emit nothing — out of scope for the
 *   MVP.
 * - Keyword arguments (`f(x=handler)`) emit nothing — also out of MVP
 *   scope; the bare-identifier-only rule keeps `argumentIndex`
 *   unambiguous.
 * - Nested calls attribute the flow to the inner-call site.
 * - Multiple positional arguments at different indices are all
 *   emitted.
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
  langAdd({ langId: 'python', fileExtensions: ['.py'] });
  await parserInit();
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-py-symflow-'));
});

afterAll(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

function fileWrite(name: string, content: string): string {
  const file = path.join(testDir, name);
  fs.writeFileSync(file, content);
  return file;
}

describe('python symbol-flow extraction', () => {
  it('emits one flow with argumentIndex 0 for a bare named callback', () => {
    const file = fileWrite('bare_named_callback.py', `
def handler():
    pass

def register(cb):
    pass

def run():
    register(handler)
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
    const file = fileWrite('unresolved_receiver.py', `
def handler():
    pass

def run():
    unknown.foo(handler)
`);
    const { index } = projectIndexBuildSync({ files: [file], dir: testDir });

    const handlerSymbols = index.symbolsGetByName('handler');
    const flows = index.symbolFlowsForSymbolGet(handlerSymbols[0].id);
    expect(flows).toHaveLength(1);
    expect(flows[0].receivingCallSymbolId).toBeUndefined();
    expect(flows[0].argumentIndex).toBe(0);
  });

  it('emits nothing for inline lambda arguments', () => {
    const file = fileWrite('inline_lambda.py', `
def run(xs):
    list(map(lambda x: x + 1, xs))
    sorted(xs, key=lambda x: -x)
`);
    const { index } = projectIndexBuildSync({ files: [file], dir: testDir });

    const flows = index.symbolFlowsInFileGet(file);
    expect(flows).toEqual([]);
  });

  it('attributes a callable passed to an inner call to the inner-call site', () => {
    const file = fileWrite('nested_calls.py', `
def handler():
    pass

def outer(arg):
    pass

def inner(cb):
    return cb

def run():
    outer(inner(handler))
`);
    const { index } = projectIndexBuildSync({ files: [file], dir: testDir });

    const handlerSymbols = index.symbolsGetByName('handler');
    const innerSymbols = index.symbolsGetByName('inner');
    const flows = index.symbolFlowsForSymbolGet(handlerSymbols[0].id);
    expect(flows).toHaveLength(1);
    expect(flows[0].receivingCallSymbolId).toBe(innerSymbols[0].id);
  });

  it('records every positional argument when multiple callables are passed', () => {
    const file = fileWrite('multiple_arguments.py', `
def handler_a():
    pass

def handler_b():
    pass

def combine(a, b):
    pass

def run():
    combine(handler_a, handler_b)
`);
    const { index } = projectIndexBuildSync({ files: [file], dir: testDir });

    const flowsA = index.symbolFlowsForSymbolGet(
      index.symbolsGetByName('handler_a')[0].id,
    );
    const flowsB = index.symbolFlowsForSymbolGet(
      index.symbolsGetByName('handler_b')[0].id,
    );
    expect(flowsA).toHaveLength(1);
    expect(flowsB).toHaveLength(1);
    expect(flowsA[0].argumentIndex).toBe(0);
    expect(flowsB[0].argumentIndex).toBe(1);
  });

  it('skips keyword arguments (out of MVP scope)', () => {
    // Per the Python query header: keyword arguments wrap the bare
    // identifier in a `keyword_argument` node, so the bare-identifier
    // capture pattern does not match. Pinning this prevents an
    // accidental scope expansion that would make `argumentIndex`
    // ambiguous (positional vs keyword).
    const file = fileWrite('keyword_arguments.py', `
def handler(x):
    return -x

def run(xs):
    sorted(xs, key=handler)
`);
    const { index } = projectIndexBuildSync({ files: [file], dir: testDir });

    const flows = index.symbolFlowsInFileGet(file);
    expect(flows).toEqual([]);
  });

  it('produces deterministic edge ordering across re-runs', () => {
    const file = fileWrite('determinism.py', `
def a():
    pass

def b():
    pass

def combine(p, q):
    pass

def run():
    combine(a, b)
    combine(b, a)
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

  it('exposes IndexCapabilities.symbolFlow=true for python-only workspaces', () => {
    const file = fileWrite('capability.py', `
def handler():
    pass
`);
    const { index } = projectIndexBuildSync({ files: [file], dir: testDir });
    expect(index.capabilities.symbolFlow).toBe(true);
  });
});
