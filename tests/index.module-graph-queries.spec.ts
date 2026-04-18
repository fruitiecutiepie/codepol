/**
 * Phase 2 tests for narrow graph queries living in
 * `packages/core/src/index/moduleGraphQueries.ts`.
 *
 * Covered behavior:
 *
 * - `moduleImpactRadiusCompute` returns the correct neighborhood under
 *   each direction, respects bounded depth, and is cycle-tolerant.
 * - `moduleDependencyPathCompute` finds the shortest path, enumerates
 *   simple paths deterministically, caps at `maxPaths`, and signals
 *   truncation — without looping on cycles.
 * - `moduleDeadModulesCompute` identifies unreachable files and lets the
 *   caller pick which entry points to anchor reachability on.
 *
 * All tests operate on an in-memory `ModuleGraph` fake so the helpers
 * are exercised independently from tree-sitter parsing and disk I/O.
 */

import { describe, expect, it } from 'vitest';
import type { ModuleGraph } from '@codepol/core';
import {
  moduleDeadModulesCompute,
  moduleDependencyPathCompute,
  moduleImpactRadiusCompute,
} from '@codepol/core';

// ============================================================================
// In-memory ModuleGraph builder
// ============================================================================

/**
 * Minimal ModuleGraph fake backed by forward adjacency lists. Reverse
 * edges and cycle detection are derived so that callers can write a
 * graph once and exercise every ModuleGraph method.
 */
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
    const index = new Map<string, number>();
    const lowLink = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    let counter = 0;

    const strongConnect = (file: string) => {
      index.set(file, counter);
      lowLink.set(file, counter);
      counter += 1;
      stack.push(file);
      onStack.add(file);
      const targets = forward.get(file);
      if (targets) {
        for (const target of targets) {
          if (!index.has(target)) {
            strongConnect(target);
            lowLink.set(
              file,
              Math.min(lowLink.get(file)!, lowLink.get(target)!),
            );
          } else if (onStack.has(target)) {
            lowLink.set(
              file,
              Math.min(lowLink.get(file)!, index.get(target)!),
            );
          }
        }
      }
      if (lowLink.get(file) === index.get(file)) {
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
      if (!index.has(file)) strongConnect(file);
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
// moduleImpactRadiusCompute
// ============================================================================

describe('moduleImpactRadiusCompute', () => {
  it('returns only the seed file when the graph has no edges touching it', () => {
    const graph = moduleGraphFakeCreate({
      files: ['/app/a.ts', '/app/b.ts'],
      edges: [],
    });
    const result = moduleImpactRadiusCompute(graph, {
      file: '/app/a.ts',
      direction: 'both',
    });
    expect(result).toEqual({
      files: ['/app/a.ts'],
      edges: [],
    });
  });

  it('walks downstream to the full transitive closure when depth is omitted', () => {
    // a -> b -> c -> d (linear chain)
    const graph = moduleGraphFakeCreate({
      files: ['/a.ts', '/b.ts', '/c.ts', '/d.ts'],
      edges: [
        ['/a.ts', '/b.ts'],
        ['/b.ts', '/c.ts'],
        ['/c.ts', '/d.ts'],
      ],
    });
    const result = moduleImpactRadiusCompute(graph, {
      file: '/a.ts',
      direction: 'downstream',
    });
    expect(result.files).toEqual(['/a.ts', '/b.ts', '/c.ts', '/d.ts']);
    expect(result.edges).toEqual([
      { from: '/a.ts', to: '/b.ts' },
      { from: '/b.ts', to: '/c.ts' },
      { from: '/c.ts', to: '/d.ts' },
    ]);
  });

  it('caps downstream traversal at the requested depth', () => {
    const graph = moduleGraphFakeCreate({
      files: ['/a.ts', '/b.ts', '/c.ts', '/d.ts'],
      edges: [
        ['/a.ts', '/b.ts'],
        ['/b.ts', '/c.ts'],
        ['/c.ts', '/d.ts'],
      ],
    });
    const depthZero = moduleImpactRadiusCompute(graph, {
      file: '/a.ts',
      direction: 'downstream',
      depth: 0,
    });
    expect(depthZero.files).toEqual(['/a.ts']);
    expect(depthZero.edges).toEqual([]);

    const depthOne = moduleImpactRadiusCompute(graph, {
      file: '/a.ts',
      direction: 'downstream',
      depth: 1,
    });
    expect(depthOne.files).toEqual(['/a.ts', '/b.ts']);
    expect(depthOne.edges).toEqual([{ from: '/a.ts', to: '/b.ts' }]);

    const depthTwo = moduleImpactRadiusCompute(graph, {
      file: '/a.ts',
      direction: 'downstream',
      depth: 2,
    });
    expect(depthTwo.files).toEqual(['/a.ts', '/b.ts', '/c.ts']);
    expect(depthTwo.edges).toEqual([
      { from: '/a.ts', to: '/b.ts' },
      { from: '/b.ts', to: '/c.ts' },
    ]);
  });

  it('walks upstream via reverse edges', () => {
    // a -> b -> c, asking upstream from c
    const graph = moduleGraphFakeCreate({
      files: ['/a.ts', '/b.ts', '/c.ts'],
      edges: [
        ['/a.ts', '/b.ts'],
        ['/b.ts', '/c.ts'],
      ],
    });
    const result = moduleImpactRadiusCompute(graph, {
      file: '/c.ts',
      direction: 'upstream',
    });
    expect(result.files).toEqual(['/a.ts', '/b.ts', '/c.ts']);
    expect(result.edges).toEqual([
      { from: '/a.ts', to: '/b.ts' },
      { from: '/b.ts', to: '/c.ts' },
    ]);
  });

  it('combines importer and importee sides when direction is "both"', () => {
    // a -> b -> c, focus b with direction both and depth 1 should include a + c
    const graph = moduleGraphFakeCreate({
      files: ['/a.ts', '/b.ts', '/c.ts'],
      edges: [
        ['/a.ts', '/b.ts'],
        ['/b.ts', '/c.ts'],
      ],
    });
    const result = moduleImpactRadiusCompute(graph, {
      file: '/b.ts',
      direction: 'both',
      depth: 1,
    });
    expect(result.files).toEqual(['/a.ts', '/b.ts', '/c.ts']);
    expect(result.edges).toEqual([
      { from: '/a.ts', to: '/b.ts' },
      { from: '/b.ts', to: '/c.ts' },
    ]);
  });

  it('is cycle-tolerant and terminates on strongly-connected components', () => {
    // a -> b -> c -> a (cycle of size 3), plus d imported by c
    const graph = moduleGraphFakeCreate({
      files: ['/a.ts', '/b.ts', '/c.ts', '/d.ts'],
      edges: [
        ['/a.ts', '/b.ts'],
        ['/b.ts', '/c.ts'],
        ['/c.ts', '/a.ts'],
        ['/c.ts', '/d.ts'],
      ],
    });
    const result = moduleImpactRadiusCompute(graph, {
      file: '/a.ts',
      direction: 'downstream',
    });
    expect(result.files).toEqual(['/a.ts', '/b.ts', '/c.ts', '/d.ts']);
    // All four cycle-involved edges appear, sorted deterministically.
    expect(result.edges).toEqual([
      { from: '/a.ts', to: '/b.ts' },
      { from: '/b.ts', to: '/c.ts' },
      { from: '/c.ts', to: '/a.ts' },
      { from: '/c.ts', to: '/d.ts' },
    ]);
  });
});

// ============================================================================
// moduleDependencyPathCompute
// ============================================================================

describe('moduleDependencyPathCompute', () => {
  it('returns a single zero-length path when the source equals the destination', () => {
    const graph = moduleGraphFakeCreate({
      files: ['/a.ts'],
      edges: [],
    });
    const result = moduleDependencyPathCompute(graph, {
      fromFile: '/a.ts',
      toFile: '/a.ts',
    });
    expect(result).toEqual({
      paths: [['/a.ts']],
      shortestLength: 0,
      truncated: false,
    });
  });

  it('reports no path when the destination is unreachable', () => {
    const graph = moduleGraphFakeCreate({
      files: ['/a.ts', '/b.ts'],
      edges: [],
    });
    const result = moduleDependencyPathCompute(graph, {
      fromFile: '/a.ts',
      toFile: '/b.ts',
    });
    expect(result).toEqual({
      paths: [],
      shortestLength: 0,
      truncated: false,
    });
  });

  it('computes the shortest path in edges even when longer alternatives exist', () => {
    //   a -> b -> d
    //    \-> c -> d
    //   a -> e -> f -> d  (length 3 via e)
    const graph = moduleGraphFakeCreate({
      files: ['/a.ts', '/b.ts', '/c.ts', '/d.ts', '/e.ts', '/f.ts'],
      edges: [
        ['/a.ts', '/b.ts'],
        ['/b.ts', '/d.ts'],
        ['/a.ts', '/c.ts'],
        ['/c.ts', '/d.ts'],
        ['/a.ts', '/e.ts'],
        ['/e.ts', '/f.ts'],
        ['/f.ts', '/d.ts'],
      ],
    });
    const result = moduleDependencyPathCompute(graph, {
      fromFile: '/a.ts',
      toFile: '/d.ts',
    });
    expect(result.shortestLength).toBe(2);
    expect(result.truncated).toBe(false);
    // Sorted by (length, lexicographic tuple). The two length-2 paths
    // appear before the length-3 path.
    expect(result.paths).toEqual([
      ['/a.ts', '/b.ts', '/d.ts'],
      ['/a.ts', '/c.ts', '/d.ts'],
      ['/a.ts', '/e.ts', '/f.ts', '/d.ts'],
    ]);
  });

  it('caps the returned paths at maxPaths and flags truncation', () => {
    // Fan-out bridge: a -> {b1,b2,b3,b4,b5,b6} -> d
    const middles = ['/b1.ts', '/b2.ts', '/b3.ts', '/b4.ts', '/b5.ts', '/b6.ts'];
    const graph = moduleGraphFakeCreate({
      files: ['/a.ts', ...middles, '/d.ts'],
      edges: [
        ...middles.map((middle): [string, string] => ['/a.ts', middle]),
        ...middles.map((middle): [string, string] => [middle, '/d.ts']),
      ],
    });
    const result = moduleDependencyPathCompute(graph, {
      fromFile: '/a.ts',
      toFile: '/d.ts',
      maxPaths: 3,
    });
    expect(result.shortestLength).toBe(2);
    expect(result.paths).toHaveLength(3);
    expect(result.truncated).toBe(true);
    // The first three paths must be the lexicographically smallest.
    expect(result.paths).toEqual([
      ['/a.ts', '/b1.ts', '/d.ts'],
      ['/a.ts', '/b2.ts', '/d.ts'],
      ['/a.ts', '/b3.ts', '/d.ts'],
    ]);
  });

  it('does not loop on cycles and only returns simple paths', () => {
    // a -> b -> c -> a  cycle, plus c -> d
    const graph = moduleGraphFakeCreate({
      files: ['/a.ts', '/b.ts', '/c.ts', '/d.ts'],
      edges: [
        ['/a.ts', '/b.ts'],
        ['/b.ts', '/c.ts'],
        ['/c.ts', '/a.ts'],
        ['/c.ts', '/d.ts'],
      ],
    });
    const result = moduleDependencyPathCompute(graph, {
      fromFile: '/a.ts',
      toFile: '/d.ts',
    });
    expect(result.shortestLength).toBe(3);
    expect(result.truncated).toBe(false);
    expect(result.paths).toEqual([
      ['/a.ts', '/b.ts', '/c.ts', '/d.ts'],
    ]);
  });

  it('defaults maxPaths to 5 when unspecified', () => {
    // Build 7 disjoint length-2 paths a -> bN -> d
    const middles = ['/b1.ts', '/b2.ts', '/b3.ts', '/b4.ts', '/b5.ts', '/b6.ts', '/b7.ts'];
    const graph = moduleGraphFakeCreate({
      files: ['/a.ts', ...middles, '/d.ts'],
      edges: [
        ...middles.map((middle): [string, string] => ['/a.ts', middle]),
        ...middles.map((middle): [string, string] => [middle, '/d.ts']),
      ],
    });
    const result = moduleDependencyPathCompute(graph, {
      fromFile: '/a.ts',
      toFile: '/d.ts',
    });
    expect(result.paths).toHaveLength(5);
    expect(result.truncated).toBe(true);
    expect(result.shortestLength).toBe(2);
  });
});

// ============================================================================
// moduleDeadModulesCompute
// ============================================================================

describe('moduleDeadModulesCompute', () => {
  it('treats every file as unreachable when the graph has no entry points', () => {
    // Two files each importing the other — no entry points.
    const graph = moduleGraphFakeCreate({
      files: ['/a.ts', '/b.ts'],
      edges: [
        ['/a.ts', '/b.ts'],
        ['/b.ts', '/a.ts'],
      ],
    });
    expect(
      moduleDeadModulesCompute(graph, {}),
    ).toEqual({ unreachable: ['/a.ts', '/b.ts'] });
  });

  it('returns nothing unreachable when every file lives under a natural entry point', () => {
    // a -> b -> c, a is the natural entry point.
    const graph = moduleGraphFakeCreate({
      files: ['/a.ts', '/b.ts', '/c.ts'],
      edges: [
        ['/a.ts', '/b.ts'],
        ['/b.ts', '/c.ts'],
      ],
    });
    expect(moduleDeadModulesCompute(graph, {})).toEqual({
      unreachable: [],
    });
  });

  it('finds orphan modules reachable from no entry point', () => {
    // a -> b, plus orphan: c -> d (c has no importer because d is its
    // only importee).  We'll make c a natural entry point of its own
    // connected component to prove the union of components is considered.
    const graph = moduleGraphFakeCreate({
      files: ['/a.ts', '/b.ts', '/c.ts', '/d.ts'],
      edges: [['/a.ts', '/b.ts']],
    });
    // c and d have no edges. Both are natural entry points, so they are
    // reachable and therefore not dead.
    expect(moduleDeadModulesCompute(graph, {})).toEqual({
      unreachable: [],
    });

    // Now restrict entry points to just /a.ts. /c.ts and /d.ts become
    // unreachable.
    expect(
      moduleDeadModulesCompute(graph, { entryPoints: ['/a.ts'] }),
    ).toEqual({ unreachable: ['/c.ts', '/d.ts'] });
  });

  it('is cycle-tolerant when walking from entry points', () => {
    // a -> b -> c -> b (cycle b<->c). a is the entry point.
    const graph = moduleGraphFakeCreate({
      files: ['/a.ts', '/b.ts', '/c.ts', '/d.ts'],
      edges: [
        ['/a.ts', '/b.ts'],
        ['/b.ts', '/c.ts'],
        ['/c.ts', '/b.ts'],
      ],
    });
    expect(
      moduleDeadModulesCompute(graph, { entryPoints: ['/a.ts'] }),
    ).toEqual({ unreachable: ['/d.ts'] });
  });

  it('silently ignores entry points that are not in the graph', () => {
    const graph = moduleGraphFakeCreate({
      files: ['/a.ts', '/b.ts'],
      edges: [['/a.ts', '/b.ts']],
    });
    expect(
      moduleDeadModulesCompute(graph, {
        entryPoints: ['/not-in-graph.ts'],
      }),
    ).toEqual({ unreachable: ['/a.ts', '/b.ts'] });
  });
});
