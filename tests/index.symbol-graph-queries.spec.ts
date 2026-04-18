/**
 * Phase 7 tests for symbol-level graph queries living in
 * `packages/core/src/index/symbolGraphQueries.ts`.
 *
 * Covered behavior:
 *
 * - `symbolCallGraphCompute` walks callers / callees / both, respects
 *   bounded depth, returns deterministic output, and is cycle-tolerant.
 * - `symbolTypeHierarchyCompute` walks supertypes / subtypes / both,
 *   respects bounded depth, returns deterministic output, and is
 *   cycle-tolerant.
 *
 * All tests operate on in-memory `SymbolCallGraphView` /
 * `SymbolTypeHierarchyView` fakes so the helpers are exercised
 * independently from tree-sitter parsing, the workspace service, and
 * disk I/O. The `ProjectIndex → view` adapter that the workspace layer
 * builds is covered separately by the workspace-service integration
 * suite.
 */

import { describe, expect, it } from 'vitest';
import type {
  SymbolCallGraphView,
  SymbolTypeHierarchyView,
} from '@codepol/core';
import {
  symbolCallGraphCompute,
  symbolTypeHierarchyCompute,
} from '@codepol/core';

// ============================================================================
// In-memory view builders
// ============================================================================

function callGraphViewCreate(input: {
  edges: Array<[string, string]>;
}): SymbolCallGraphView {
  const callees = new Map<string, Set<string>>();
  const callers = new Map<string, Set<string>>();
  for (const [caller, callee] of input.edges) {
    if (!callees.has(caller)) callees.set(caller, new Set());
    if (!callers.has(callee)) callers.set(callee, new Set());
    callees.get(caller)!.add(callee);
    callers.get(callee)!.add(caller);
  }
  return {
    callersGet(symbolId) {
      return [...(callers.get(symbolId) ?? [])].sort();
    },
    calleesGet(symbolId) {
      return [...(callees.get(symbolId) ?? [])].sort();
    },
  };
}

function typeHierarchyViewCreate(input: {
  /** [child, parent] pairs (e.g. `class Dog extends Animal` => [Dog, Animal]) */
  edges: Array<[string, string]>;
}): SymbolTypeHierarchyView {
  const supers = new Map<string, Set<string>>();
  const subs = new Map<string, Set<string>>();
  for (const [child, parent] of input.edges) {
    if (!supers.has(child)) supers.set(child, new Set());
    if (!subs.has(parent)) subs.set(parent, new Set());
    supers.get(child)!.add(parent);
    subs.get(parent)!.add(child);
  }
  return {
    superTypesGet(symbolId) {
      return [...(supers.get(symbolId) ?? [])].sort();
    },
    subTypesGet(symbolId) {
      return [...(subs.get(symbolId) ?? [])].sort();
    },
  };
}

// ============================================================================
// symbolCallGraphCompute
// ============================================================================

describe('symbolCallGraphCompute', () => {
  it('returns only the seed symbol when nothing calls it and it calls nothing', () => {
    const view = callGraphViewCreate({ edges: [] });
    expect(
      symbolCallGraphCompute(view, { symbolId: 'a', direction: 'both' }),
    ).toEqual({ symbols: ['a'], edges: [] });
  });

  it('walks callees as the forward direction', () => {
    // a -> b -> c (a calls b, b calls c)
    const view = callGraphViewCreate({
      edges: [
        ['a', 'b'],
        ['b', 'c'],
      ],
    });
    expect(
      symbolCallGraphCompute(view, { symbolId: 'a', direction: 'callees' }),
    ).toEqual({
      symbols: ['a', 'b', 'c'],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
      ],
    });
  });

  it('walks callers as the reverse direction', () => {
    // a -> b -> c, asking callers of c reaches b and a
    const view = callGraphViewCreate({
      edges: [
        ['a', 'b'],
        ['b', 'c'],
      ],
    });
    expect(
      symbolCallGraphCompute(view, { symbolId: 'c', direction: 'callers' }),
    ).toEqual({
      symbols: ['a', 'b', 'c'],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
      ],
    });
  });

  it('combines callers and callees when direction is "both"', () => {
    // a -> b -> c, focus b with depth 1 includes a + c
    const view = callGraphViewCreate({
      edges: [
        ['a', 'b'],
        ['b', 'c'],
      ],
    });
    expect(
      symbolCallGraphCompute(view, {
        symbolId: 'b',
        direction: 'both',
        depth: 1,
      }),
    ).toEqual({
      symbols: ['a', 'b', 'c'],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
      ],
    });
  });

  it('caps the traversal at the requested depth', () => {
    const view = callGraphViewCreate({
      edges: [
        ['a', 'b'],
        ['b', 'c'],
        ['c', 'd'],
      ],
    });
    expect(
      symbolCallGraphCompute(view, {
        symbolId: 'a',
        direction: 'callees',
        depth: 0,
      }),
    ).toEqual({ symbols: ['a'], edges: [] });

    expect(
      symbolCallGraphCompute(view, {
        symbolId: 'a',
        direction: 'callees',
        depth: 1,
      }),
    ).toEqual({
      symbols: ['a', 'b'],
      edges: [{ from: 'a', to: 'b' }],
    });

    expect(
      symbolCallGraphCompute(view, {
        symbolId: 'a',
        direction: 'callees',
        depth: 2,
      }),
    ).toEqual({
      symbols: ['a', 'b', 'c'],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
      ],
    });
  });

  it('is cycle-tolerant — recursion does not explode the traversal', () => {
    // a -> b -> a (mutual recursion), plus b -> c
    const view = callGraphViewCreate({
      edges: [
        ['a', 'b'],
        ['b', 'a'],
        ['b', 'c'],
      ],
    });
    expect(
      symbolCallGraphCompute(view, { symbolId: 'a', direction: 'callees' }),
    ).toEqual({
      symbols: ['a', 'b', 'c'],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
        { from: 'b', to: 'c' },
      ],
    });
  });

  it('orients induced edges as caller -> callee even when traversed backward', () => {
    // a -> b: walking callers from b should still emit "a -> b" not "b -> a".
    const view = callGraphViewCreate({
      edges: [['a', 'b']],
    });
    expect(
      symbolCallGraphCompute(view, { symbolId: 'b', direction: 'callers' }),
    ).toEqual({
      symbols: ['a', 'b'],
      edges: [{ from: 'a', to: 'b' }],
    });
  });
});

// ============================================================================
// symbolTypeHierarchyCompute
// ============================================================================

describe('symbolTypeHierarchyCompute', () => {
  it('returns only the seed symbol when it has no super or subtypes', () => {
    const view = typeHierarchyViewCreate({ edges: [] });
    expect(
      symbolTypeHierarchyCompute(view, {
        symbolId: 'Animal',
        direction: 'both',
      }),
    ).toEqual({ symbols: ['Animal'], edges: [] });
  });

  it('walks supertypes as the forward direction', () => {
    // Dog extends Animal, Animal extends Living
    const view = typeHierarchyViewCreate({
      edges: [
        ['Dog', 'Animal'],
        ['Animal', 'Living'],
      ],
    });
    expect(
      symbolTypeHierarchyCompute(view, {
        symbolId: 'Dog',
        direction: 'supertypes',
      }),
    ).toEqual({
      symbols: ['Animal', 'Dog', 'Living'],
      edges: [
        { from: 'Animal', to: 'Living' },
        { from: 'Dog', to: 'Animal' },
      ],
    });
  });

  it('walks subtypes as the reverse direction', () => {
    // Dog/Cat extends Animal
    const view = typeHierarchyViewCreate({
      edges: [
        ['Dog', 'Animal'],
        ['Cat', 'Animal'],
      ],
    });
    expect(
      symbolTypeHierarchyCompute(view, {
        symbolId: 'Animal',
        direction: 'subtypes',
      }),
    ).toEqual({
      symbols: ['Animal', 'Cat', 'Dog'],
      edges: [
        { from: 'Cat', to: 'Animal' },
        { from: 'Dog', to: 'Animal' },
      ],
    });
  });

  it('combines super and subtype directions when "both" is requested', () => {
    // Living <- Animal <- Dog, plus Cat <- Animal (Cat is a sibling of Dog)
    const view = typeHierarchyViewCreate({
      edges: [
        ['Animal', 'Living'],
        ['Dog', 'Animal'],
        ['Cat', 'Animal'],
      ],
    });
    expect(
      symbolTypeHierarchyCompute(view, {
        symbolId: 'Animal',
        direction: 'both',
        depth: 1,
      }),
    ).toEqual({
      symbols: ['Animal', 'Cat', 'Dog', 'Living'],
      edges: [
        { from: 'Animal', to: 'Living' },
        { from: 'Cat', to: 'Animal' },
        { from: 'Dog', to: 'Animal' },
      ],
    });
  });

  it('caps the traversal at the requested depth', () => {
    // Linear chain: A extends B extends C extends D
    const view = typeHierarchyViewCreate({
      edges: [
        ['A', 'B'],
        ['B', 'C'],
        ['C', 'D'],
      ],
    });
    expect(
      symbolTypeHierarchyCompute(view, {
        symbolId: 'A',
        direction: 'supertypes',
        depth: 1,
      }),
    ).toEqual({
      symbols: ['A', 'B'],
      edges: [{ from: 'A', to: 'B' }],
    });
    expect(
      symbolTypeHierarchyCompute(view, {
        symbolId: 'A',
        direction: 'supertypes',
        depth: 2,
      }),
    ).toEqual({
      symbols: ['A', 'B', 'C'],
      edges: [
        { from: 'A', to: 'B' },
        { from: 'B', to: 'C' },
      ],
    });
  });

  it('is cycle-tolerant under pathological inputs (e.g. self-extends)', () => {
    // Pathological: A extends B, B extends A. Real codebases never have
    // this but the helper still must terminate.
    const view = typeHierarchyViewCreate({
      edges: [
        ['A', 'B'],
        ['B', 'A'],
      ],
    });
    expect(
      symbolTypeHierarchyCompute(view, {
        symbolId: 'A',
        direction: 'both',
      }),
    ).toEqual({
      symbols: ['A', 'B'],
      edges: [
        { from: 'A', to: 'B' },
        { from: 'B', to: 'A' },
      ],
    });
  });
});
