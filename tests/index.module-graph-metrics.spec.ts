/**
 * Phase 8 tests for the architecture health metrics living in
 * `packages/core/src/index/moduleGraphMetrics.ts`.
 *
 * Covered behavior:
 *
 * - `moduleInstabilityCompute` returns Robert Martin's `Ce / (Ca + Ce)`
 *   per non-isolated file and skips files with no edges in either
 *   direction. Sort order is `(value desc, file asc)` and both two
 *   identical inputs produce identical outputs (determinism).
 * - `moduleLongestChainCompute` returns the longest acyclic chain in
 *   the SCC condensation, collapsing cycles to one representative file
 *   per SCC. Determinism is asserted by running the same graph twice.
 * - `moduleSccSizeDistributionCompute` aggregates the cycle list into a
 *   size histogram with sorted-key insertion order so JSON output is
 *   byte-stable.
 *
 * All tests operate on an in-memory `ModuleGraph` fake so the helpers
 * are exercised independently from tree-sitter parsing and disk I/O.
 */

import { describe, expect, it } from 'vitest';
import type { ModuleGraph } from '@codepol/core';
import {
  moduleInstabilityCompute,
  moduleLongestChainCompute,
  moduleSccSizeDistributionCompute,
} from '@codepol/core';

// ============================================================================
// In-memory ModuleGraph builder (mirrors index.module-graph-queries.spec.ts).
// ============================================================================

function moduleGraphFakeCreate(input: {
  files: string[];
  edges: Array<[string, string]>;
}): ModuleGraph {
  const forward = new Map<string, Set<string>>();
  const reverse = new Map<string, Set<string>>();
  for (const file of input.files) {
    forward.set(file, new Set());
    reverse.set(file, new Set());
  }
  for (const [from, to] of input.edges) {
    forward.get(from)!.add(to);
    reverse.get(to)!.add(from);
  }

  const cyclesComputeOnce = (): string[][] => {
    const cycles: string[][] = [];
    const sccIndex = new Map<string, number>();
    const lowLink = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    let counter = 0;

    const strongConnect = (file: string) => {
      sccIndex.set(file, counter);
      lowLink.set(file, counter);
      counter += 1;
      stack.push(file);
      onStack.add(file);
      const targets = forward.get(file);
      if (targets) {
        for (const target of targets) {
          if (!sccIndex.has(target)) {
            strongConnect(target);
            lowLink.set(file, Math.min(lowLink.get(file)!, lowLink.get(target)!));
          } else if (onStack.has(target)) {
            lowLink.set(file, Math.min(lowLink.get(file)!, sccIndex.get(target)!));
          }
        }
      }
      if (lowLink.get(file) === sccIndex.get(file)) {
        const component: string[] = [];
        let popped: string;
        do {
          popped = stack.pop()!;
          onStack.delete(popped);
          component.push(popped);
        } while (popped !== file);
        if (component.length > 1) {
          component.sort();
          cycles.push(component);
        }
      }
    };

    for (const file of [...input.files].sort()) {
      if (!sccIndex.has(file)) strongConnect(file);
    }
    cycles.sort((a, b) => a[0].localeCompare(b[0]));
    return cycles;
  };

  const entryPointsCompute = (): string[] =>
    [...input.files]
      .filter((file) => (reverse.get(file)?.size ?? 0) === 0)
      .sort();

  return {
    moduleGraphImportersGet(file) {
      return [...(reverse.get(file) ?? [])].sort();
    },
    moduleGraphImporteesGet(file) {
      return [...(forward.get(file) ?? [])].sort();
    },
    moduleGraphDependencyOrderGet() {
      return [...input.files].sort();
    },
    moduleGraphCyclesGet() {
      return cyclesComputeOnce();
    },
    moduleGraphEntryPointsGet() {
      return entryPointsCompute();
    },
  };
}

// ============================================================================
// moduleInstabilityCompute
// ============================================================================

describe('moduleInstabilityCompute', () => {
  it('omits files with no incoming and no outgoing edges', () => {
    const graph = moduleGraphFakeCreate({
      files: ['/a.ts', '/isolated.ts', '/b.ts'],
      edges: [['/a.ts', '/b.ts']],
    });
    const result = moduleInstabilityCompute(graph);
    expect(result.values.map((entry) => entry.file)).toEqual(['/a.ts', '/b.ts']);
  });

  it('returns the canonical Ce / (Ca + Ce) per file', () => {
    // a -> b -> c
    // a has Ce=1 Ca=0 -> 1
    // b has Ce=1 Ca=1 -> 0.5
    // c has Ce=0 Ca=1 -> 0
    const graph = moduleGraphFakeCreate({
      files: ['/a.ts', '/b.ts', '/c.ts'],
      edges: [
        ['/a.ts', '/b.ts'],
        ['/b.ts', '/c.ts'],
      ],
    });
    const result = moduleInstabilityCompute(graph);
    expect(result.values).toEqual([
      { file: '/a.ts', value: 1, importerCount: 0, importeeCount: 1 },
      { file: '/b.ts', value: 0.5, importerCount: 1, importeeCount: 1 },
      { file: '/c.ts', value: 0, importerCount: 1, importeeCount: 0 },
    ]);
  });

  it('sorts by value desc then by file asc, breaking ties deterministically', () => {
    // Construct two files with equal instability (1.0) and two with equal 0.0
    // to assert deterministic tie-breaking.
    const graph = moduleGraphFakeCreate({
      files: ['/a.ts', '/b.ts', '/c.ts', '/d.ts'],
      edges: [
        ['/a.ts', '/c.ts'],
        ['/b.ts', '/d.ts'],
      ],
    });
    const first = moduleInstabilityCompute(graph).values.map((entry) => entry.file);
    const second = moduleInstabilityCompute(graph).values.map((entry) => entry.file);
    expect(first).toEqual(['/a.ts', '/b.ts', '/c.ts', '/d.ts']);
    expect(first).toEqual(second);
  });

  it('produces byte-stable output across runs (determinism)', () => {
    const graph = moduleGraphFakeCreate({
      files: ['/d.ts', '/c.ts', '/b.ts', '/a.ts'],
      edges: [
        ['/a.ts', '/b.ts'],
        ['/b.ts', '/c.ts'],
        ['/a.ts', '/c.ts'],
        ['/c.ts', '/d.ts'],
      ],
    });
    const a = JSON.stringify(moduleInstabilityCompute(graph));
    const b = JSON.stringify(moduleInstabilityCompute(graph));
    expect(a).toEqual(b);
  });
});

// ============================================================================
// moduleLongestChainCompute
// ============================================================================

describe('moduleLongestChainCompute', () => {
  it('returns an empty result for an empty graph', () => {
    const graph = moduleGraphFakeCreate({ files: [], edges: [] });
    expect(moduleLongestChainCompute(graph)).toEqual({ length: 0, path: [] });
  });

  it('returns a single-node chain when no edges connect the seed files', () => {
    const graph = moduleGraphFakeCreate({
      files: ['/a.ts', '/b.ts'],
      edges: [],
    });
    const result = moduleLongestChainCompute(graph);
    expect(result.length).toBe(0);
    expect(result.path).toHaveLength(1);
  });

  it('finds the longest acyclic chain in a linear DAG', () => {
    // a -> b -> c -> d  (3 hops)
    const graph = moduleGraphFakeCreate({
      files: ['/a.ts', '/b.ts', '/c.ts', '/d.ts'],
      edges: [
        ['/a.ts', '/b.ts'],
        ['/b.ts', '/c.ts'],
        ['/c.ts', '/d.ts'],
      ],
    });
    expect(moduleLongestChainCompute(graph)).toEqual({
      length: 3,
      path: ['/a.ts', '/b.ts', '/c.ts', '/d.ts'],
    });
  });

  it('collapses cycles into a single representative SCC node', () => {
    // a -> b <-> c -> d  (b and c form a 2-cycle)
    // Longest chain over the condensation: a -> [b/c] -> d  (2 hops)
    const graph = moduleGraphFakeCreate({
      files: ['/a.ts', '/b.ts', '/c.ts', '/d.ts'],
      edges: [
        ['/a.ts', '/b.ts'],
        ['/b.ts', '/c.ts'],
        ['/c.ts', '/b.ts'],
        ['/c.ts', '/d.ts'],
      ],
    });
    const result = moduleLongestChainCompute(graph);
    expect(result.length).toBe(2);
    expect(result.path).toEqual(['/a.ts', '/b.ts', '/d.ts']);
  });

  it('breaks ties on equal-length chains by picking the lexicographically smaller path', () => {
    // Two parallel chains of equal length:
    //   /a.ts -> /b.ts -> /e.ts
    //   /c.ts -> /d.ts -> /f.ts
    // Both have 2 hops. Determinism requires picking one across runs;
    // the helper picks the lexicographically smaller path.
    const graph = moduleGraphFakeCreate({
      files: ['/a.ts', '/b.ts', '/c.ts', '/d.ts', '/e.ts', '/f.ts'],
      edges: [
        ['/a.ts', '/b.ts'],
        ['/b.ts', '/e.ts'],
        ['/c.ts', '/d.ts'],
        ['/d.ts', '/f.ts'],
      ],
    });
    const first = moduleLongestChainCompute(graph);
    const second = moduleLongestChainCompute(graph);
    expect(first).toEqual({ length: 2, path: ['/a.ts', '/b.ts', '/e.ts'] });
    expect(first).toEqual(second);
  });

  it('produces byte-stable output across runs (determinism)', () => {
    // Diamond: a -> b -> d, a -> c -> d. Multiple equivalent chains.
    const graph = moduleGraphFakeCreate({
      files: ['/d.ts', '/c.ts', '/b.ts', '/a.ts'],
      edges: [
        ['/a.ts', '/b.ts'],
        ['/a.ts', '/c.ts'],
        ['/b.ts', '/d.ts'],
        ['/c.ts', '/d.ts'],
      ],
    });
    const first = JSON.stringify(moduleLongestChainCompute(graph));
    const second = JSON.stringify(moduleLongestChainCompute(graph));
    expect(first).toEqual(second);
  });
});

// ============================================================================
// moduleSccSizeDistributionCompute
// ============================================================================

describe('moduleSccSizeDistributionCompute', () => {
  it('returns an empty histogram when the graph has no cycles', () => {
    const graph = moduleGraphFakeCreate({
      files: ['/a.ts', '/b.ts'],
      edges: [['/a.ts', '/b.ts']],
    });
    expect(moduleSccSizeDistributionCompute(graph)).toEqual({ bySize: {} });
  });

  it('counts cycles by size', () => {
    // Two disjoint 2-cycles plus a 3-cycle.
    // 2-cycle 1: /a.ts <-> /b.ts
    // 2-cycle 2: /c.ts <-> /d.ts
    // 3-cycle:   /e.ts -> /f.ts -> /g.ts -> /e.ts
    const graph = moduleGraphFakeCreate({
      files: ['/a.ts', '/b.ts', '/c.ts', '/d.ts', '/e.ts', '/f.ts', '/g.ts'],
      edges: [
        ['/a.ts', '/b.ts'],
        ['/b.ts', '/a.ts'],
        ['/c.ts', '/d.ts'],
        ['/d.ts', '/c.ts'],
        ['/e.ts', '/f.ts'],
        ['/f.ts', '/g.ts'],
        ['/g.ts', '/e.ts'],
      ],
    });
    expect(moduleSccSizeDistributionCompute(graph)).toEqual({
      bySize: { 2: 2, 3: 1 },
    });
  });

  it('inserts sizes in ascending order so JSON serialization is stable', () => {
    // Mix of 4-cycle and 2-cycle. The output must list size 2 before
    // size 4 to keep `Object.keys()` order deterministic.
    const graph = moduleGraphFakeCreate({
      files: ['/a.ts', '/b.ts', '/c.ts', '/d.ts', '/e.ts', '/f.ts'],
      edges: [
        ['/a.ts', '/b.ts'],
        ['/b.ts', '/c.ts'],
        ['/c.ts', '/d.ts'],
        ['/d.ts', '/a.ts'],
        ['/e.ts', '/f.ts'],
        ['/f.ts', '/e.ts'],
      ],
    });
    const distribution = moduleSccSizeDistributionCompute(graph).bySize;
    expect(Object.keys(distribution)).toEqual(['2', '4']);
    expect(distribution).toEqual({ 2: 1, 4: 1 });
  });
});
