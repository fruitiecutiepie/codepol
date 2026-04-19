/**
 * Unit tests for the type-hierarchy CodeLens view-model.
 *
 * Phase 9.5 / Gap 3 — pins the deterministic title format so the
 * provider stays trivial. The provider's regex scanner is exercised
 * by the extension test pack against real `.ts` fixtures; this spec
 * covers the count-tallying path with canned inputs.
 */
import { describe, expect, it } from 'vitest';
import { typeHierarchyCodeLensViewModelCreate } from '../extension-vscode/src/typeHierarchyCodeLensViewModels';
import type { WorkspaceDependencyGraphResult } from '@codepol/core';

const FOCUS_SYMBOL_ID = 'iface-id';
const FOCUS_URI = `codepol-symbol://${encodeURIComponent(FOCUS_SYMBOL_ID)}`;

function resultCreate(
  edges: Array<{
    from: string;
    confidence?: 'structural-shape' | 'type-aware';
  }>,
): WorkspaceDependencyGraphResult {
  return {
    nodes: [],
    edges: edges.map((e) => {
      const edge: WorkspaceDependencyGraphResult['edges'][number] = {
        fromUri: `codepol-symbol://${encodeURIComponent(e.from)}`,
        toUri: FOCUS_URI,
      };
      if (e.confidence !== undefined) {
        edge.typeRelationConfidence = e.confidence;
      }
      return edge;
    }),
    entryPoints: [],
    cycles: [],
  };
}

describe('typeHierarchyCodeLensViewModelCreate', () => {
  it('returns null when no edges target the interface', () => {
    const view = typeHierarchyCodeLensViewModelCreate({
      result: resultCreate([]),
      focusSymbolId: FOCUS_SYMBOL_ID,
      focusSymbolName: 'IShape',
      line: 0,
      character: 17,
    });
    expect(view).toBeNull();
  });

  it('omits the suffix when only declared implementers exist', () => {
    const view = typeHierarchyCodeLensViewModelCreate({
      result: resultCreate([
        { from: 'class-a' },
        { from: 'class-b' },
        { from: 'class-c' },
      ]),
      focusSymbolId: FOCUS_SYMBOL_ID,
      focusSymbolName: 'IShape',
      line: 0,
      character: 17,
    });
    expect(view).not.toBeNull();
    expect(view!.title).toBe('Codepol: 3 implementers');
    expect(view!.declaredCount).toBe(3);
    expect(view!.shapeMatchedCount).toBe(0);
    expect(view!.typeAwareCount).toBe(0);
  });

  it('appends the shape-matched suffix when structural-shape edges exist', () => {
    const view = typeHierarchyCodeLensViewModelCreate({
      result: resultCreate([
        { from: 'class-a' },
        { from: 'class-b', confidence: 'structural-shape' },
        { from: 'class-c', confidence: 'structural-shape' },
      ]),
      focusSymbolId: FOCUS_SYMBOL_ID,
      focusSymbolName: 'IShape',
      line: 0,
      character: 17,
    });
    expect(view!.title).toBe('Codepol: 3 implementers (2 shape-matched)');
  });

  it('appends both the shape-matched and language-server suffix when both exist', () => {
    const view = typeHierarchyCodeLensViewModelCreate({
      result: resultCreate([
        { from: 'class-a' },
        { from: 'class-b', confidence: 'structural-shape' },
        { from: 'class-c', confidence: 'type-aware' },
      ]),
      focusSymbolId: FOCUS_SYMBOL_ID,
      focusSymbolName: 'IShape',
      line: 0,
      character: 17,
    });
    expect(view!.title).toBe(
      'Codepol: 3 implementers (1 shape-matched, 1 from language server)',
    );
  });

  it('uses the singular form when there is exactly one implementer', () => {
    const view = typeHierarchyCodeLensViewModelCreate({
      result: resultCreate([{ from: 'class-a' }]),
      focusSymbolId: FOCUS_SYMBOL_ID,
      focusSymbolName: 'IShape',
      line: 0,
      character: 17,
    });
    expect(view!.title).toBe('Codepol: 1 implementer');
  });

  it('ignores edges that do not target the interface', () => {
    const result: WorkspaceDependencyGraphResult = {
      nodes: [],
      edges: [
        { fromUri: 'codepol-symbol://other', toUri: 'codepol-symbol://yet-another' },
      ],
      entryPoints: [],
      cycles: [],
    };
    const view = typeHierarchyCodeLensViewModelCreate({
      result,
      focusSymbolId: FOCUS_SYMBOL_ID,
      focusSymbolName: 'IShape',
      line: 0,
      character: 17,
    });
    expect(view).toBeNull();
  });
});
