/**
 * Unit tests for the per-symbol CodeLens view-model.
 *
 * The provider is a thin shell over `symbolCodeLensViewModelsCreate`,
 * so pinning title formatting + filtering rules here covers the
 * lens behavior end-to-end without spinning up VS Code.
 */
import { describe, expect, it } from 'vitest';
import {
  symbolCodeLensViewModelCreate,
  symbolCodeLensViewModelsCreate,
} from '../extension-vscode/src/symbolCodeLensViewModels';

function itemCreate(input: {
  symbolId: string;
  name: string;
  line?: number;
  character?: number;
  callerCount: number;
  calleeCount: number;
}) {
  return {
    symbol: {
      symbolId: input.symbolId,
      name: input.name,
      kind: 'function' as const,
      declarationUri: 'file:///workspace/src/a.ts',
      declarationRange: {
        start: { line: input.line ?? 0, character: input.character ?? 0 },
        end: { line: input.line ?? 0, character: (input.character ?? 0) + input.name.length },
      },
    },
    callerCount: input.callerCount,
    calleeCount: input.calleeCount,
  };
}

describe('symbolCodeLensViewModelCreate', () => {
  it('formats single vs plural caller/callee labels', () => {
    const oneEach = symbolCodeLensViewModelCreate({
      item: itemCreate({
        symbolId: 's1',
        name: 'fn',
        callerCount: 1,
        calleeCount: 1,
      }),
    });
    expect(oneEach.title).toBe('Codepol: 1 caller \u00b7 1 callee');

    const many = symbolCodeLensViewModelCreate({
      item: itemCreate({
        symbolId: 's2',
        name: 'fn',
        callerCount: 3,
        calleeCount: 0,
      }),
    });
    expect(many.title).toBe('Codepol: 3 callers \u00b7 0 callees');
  });

  it('uses <anonymous> placeholder when the symbol has no name', () => {
    const vm = symbolCodeLensViewModelCreate({
      item: itemCreate({ symbolId: 's-anon', name: '', callerCount: 0, calleeCount: 0 }),
    });
    expect(vm.focusSymbolName).toBe('<anonymous>');
    expect(vm.tooltip).toBe('Show call graph for <anonymous>');
  });

  it('anchors the lens at the declaration start position', () => {
    const vm = symbolCodeLensViewModelCreate({
      item: itemCreate({
        symbolId: 's3',
        name: 'fn',
        line: 12,
        character: 4,
        callerCount: 0,
        calleeCount: 0,
      }),
    });
    expect(vm.line).toBe(12);
    expect(vm.character).toBe(4);
  });
});

describe('symbolCodeLensViewModelsCreate', () => {
  it('preserves the workspace-service ordering one-for-one', () => {
    const result = {
      items: [
        itemCreate({ symbolId: 's1', name: 'alpha', line: 0, callerCount: 0, calleeCount: 1 }),
        itemCreate({ symbolId: 's2', name: 'beta', line: 5, callerCount: 1, calleeCount: 0 }),
        itemCreate({ symbolId: 's3', name: 'gamma', line: 10, callerCount: 2, calleeCount: 2 }),
      ],
    };
    const vms = symbolCodeLensViewModelsCreate({ result });
    expect(vms.map((v) => v.focusSymbolName)).toEqual(['alpha', 'beta', 'gamma']);
    expect(vms.map((v) => v.line)).toEqual([0, 5, 10]);
  });

  it('drops items whose symbolId is empty (no lens to attach)', () => {
    const result = {
      items: [
        itemCreate({ symbolId: '', name: 'no-id', callerCount: 0, calleeCount: 0 }),
        itemCreate({ symbolId: 'real', name: 'fn', callerCount: 0, calleeCount: 0 }),
      ],
    };
    const vms = symbolCodeLensViewModelsCreate({ result });
    expect(vms.map((v) => v.symbolId)).toEqual(['real']);
  });
});
