/**
 * @packageDocumentation
 * Health / shape metrics derived from a {@link ModuleGraph}.
 *
 * These helpers answer "is the architecture getting better or worse?"
 * questions that complement the existing topology queries
 * ({@link ./moduleGraphQueries}). They are pure: they never mutate the
 * graph and never reach into {@link IndexStore}. All results are
 * deterministic — every output array, map iteration, and tie-breaker is
 * stable so two runs over identical inputs produce byte-identical JSON.
 *
 * Three metrics are exposed:
 *
 * - {@link moduleInstabilityCompute} — Robert Martin's
 *   `I = Ce / (Ca + Ce)` per file. Files that import nothing and are
 *   imported by nothing (isolated nodes) have `I` undefined and are
 *   omitted from the output.
 * - {@link moduleLongestChainCompute} — longest acyclic dependency chain
 *   in the SCC condensation of the graph. Each SCC is collapsed to its
 *   lexicographically-first member so cycles do not inflate the chain
 *   length.
 * - {@link moduleSccSizeDistributionCompute} — the histogram of cycle
 *   sizes returned by {@link ModuleGraph.moduleGraphCyclesGet}. Trivial
 *   (size 1) SCCs are not counted because the underlying graph already
 *   filters them out.
 */

import type { ModuleGraph } from './moduleGraph';

// ============================================================================
// Instability (Ce / (Ca + Ce))
// ============================================================================

export type ModuleInstabilityValue = {
  file: string;
  /**
   * Robert Martin's instability metric, in `[0, 1]`.
   *
   * - `0` — completely stable: the file is depended on but depends on
   *   nothing (`Ce = 0`).
   * - `1` — completely unstable: the file depends on others but nothing
   *   depends on it (`Ca = 0`).
   *
   * Files with `Ca + Ce === 0` (no incoming and no outgoing edges) are
   * omitted from the result; instability is undefined for an isolated
   * node and surfacing a sentinel like `0` would conflate "stable" with
   * "uncoupled".
   */
  value: number;
  importerCount: number;
  importeeCount: number;
};

export type ModuleInstabilityResult = {
  /**
   * One entry per non-isolated file in the graph, sorted by
   * `(value desc, file asc)` so callers can take a top-N slice without
   * resorting first.
   */
  values: ModuleInstabilityValue[];
};

/**
 * Compute Robert Martin's instability metric per file.
 *
 * The set of "files" considered is derived from the graph's own surface
 * (entry points, cycles, dependency order) — we never reach into
 * {@link IndexStore}. The value is rounded to 6 fractional digits to
 * keep JSON output byte-stable across platforms with different
 * floating-point string formatters.
 */
export function moduleInstabilityCompute(graph: ModuleGraph): ModuleInstabilityResult {
  const files = moduleGraphFilesGet(graph);
  const values: ModuleInstabilityValue[] = [];
  for (const file of files) {
    const importerCount = graph.moduleGraphImportersGet(file).length;
    const importeeCount = graph.moduleGraphImporteesGet(file).length;
    const total = importerCount + importeeCount;
    if (total === 0) continue;
    const raw = importeeCount / total;
    const value = Math.round(raw * 1_000_000) / 1_000_000;
    values.push({ file, value, importerCount, importeeCount });
  }
  values.sort((left, right) => {
    if (left.value !== right.value) return right.value - left.value;
    return left.file < right.file ? -1 : left.file > right.file ? 1 : 0;
  });
  return { values };
}

// ============================================================================
// Longest dependency chain (over the SCC condensation)
// ============================================================================

export type ModuleLongestChainResult = {
  /**
   * Number of import hops in the longest chain, equal to
   * `path.length - 1`. `0` when the graph has at most one file or the
   * longest chain consists of a single node (no edges).
   */
  length: number;
  /**
   * Files that form the longest chain, listed from import root to leaf.
   * Each cycle in the original graph is collapsed to its
   * lexicographically-first member, so the chain never repeats a node.
   * Empty when the graph has no files at all.
   */
  path: string[];
};

/**
 * Longest acyclic chain of import edges in the graph.
 *
 * Algorithm:
 *
 * 1. Compute strongly-connected components from
 *    {@link ModuleGraph.moduleGraphCyclesGet} (size > 1 SCCs) plus the
 *    trivial SCCs implied by every other file.
 * 2. Build the condensation DAG: one node per SCC, one edge per
 *    cross-SCC import edge.
 * 3. Topological order on the DAG (Kahn's algorithm; ties broken by SCC
 *    representative for determinism).
 * 4. DP over the topological order to find the longest path. Ties are
 *    broken by lexicographic comparison of the path so the result is
 *    stable across runs that produce the same set of candidate longest
 *    chains.
 *
 * The chain reports the SCC representative (the lexicographically-first
 * member of the SCC) for each step. This keeps the result deterministic
 * and bounded — large cycles do not turn into a giant chain segment.
 */
export function moduleLongestChainCompute(graph: ModuleGraph): ModuleLongestChainResult {
  const files = moduleGraphFilesGet(graph);
  if (files.length === 0) {
    return { length: 0, path: [] };
  }

  // 1. Build SCC representative table.
  const cycles = graph.moduleGraphCyclesGet();
  const fileToScc = new Map<string, string>();
  for (const cycle of cycles) {
    if (cycle.length === 0) continue;
    const representative = cycle.reduce((min, file) => (file < min ? file : min));
    for (const member of cycle) {
      fileToScc.set(member, representative);
    }
  }
  for (const file of files) {
    if (!fileToScc.has(file)) fileToScc.set(file, file);
  }

  // 2. Build the condensation DAG. Edge set is deduplicated.
  const sccs = [...new Set(fileToScc.values())].sort();
  const condensationEdges = new Map<string, Set<string>>();
  const reverseEdges = new Map<string, Set<string>>();
  for (const scc of sccs) {
    condensationEdges.set(scc, new Set());
    reverseEdges.set(scc, new Set());
  }
  for (const file of files) {
    const fromScc = fileToScc.get(file);
    if (fromScc === undefined) continue;
    for (const importee of graph.moduleGraphImporteesGet(file)) {
      const toScc = fileToScc.get(importee);
      if (toScc === undefined || toScc === fromScc) continue;
      condensationEdges.get(fromScc)!.add(toScc);
      reverseEdges.get(toScc)!.add(fromScc);
    }
  }

  // 3. Kahn's algorithm with deterministic tie-break (sorted ready set).
  const inDegree = new Map<string, number>();
  for (const scc of sccs) {
    inDegree.set(scc, reverseEdges.get(scc)!.size);
  }
  const ready: string[] = sccs.filter((scc) => inDegree.get(scc) === 0).sort();
  const topoOrder: string[] = [];
  while (ready.length > 0) {
    const current = ready.shift()!;
    topoOrder.push(current);
    const successors = [...condensationEdges.get(current)!].sort();
    for (const next of successors) {
      const remaining = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, remaining);
      if (remaining === 0) {
        // Insert maintaining sorted order so traversal stays deterministic.
        let insertion = ready.length;
        for (let candidate = 0; candidate < ready.length; candidate += 1) {
          if (ready[candidate] > next) {
            insertion = candidate;
            break;
          }
        }
        ready.splice(insertion, 0, next);
      }
    }
  }

  // 4. Longest-path DP over the condensation. `dp[scc]` = chain in nodes
  //    ending at `scc`. Tie-break by lexicographic path so two runs that
  //    discover competing paths of equal length agree on which one wins.
  const dpPath = new Map<string, string[]>();
  for (const scc of topoOrder) {
    dpPath.set(scc, [scc]);
  }
  for (const scc of topoOrder) {
    const currentPath = dpPath.get(scc)!;
    const successors = [...condensationEdges.get(scc)!].sort();
    for (const next of successors) {
      const nextPath = [...currentPath, next];
      const existing = dpPath.get(next)!;
      if (chainPathCompare(nextPath, existing) > 0) {
        dpPath.set(next, nextPath);
      }
    }
  }

  let bestPath: string[] = [];
  for (const scc of topoOrder) {
    const candidate = dpPath.get(scc)!;
    if (chainPathCompare(candidate, bestPath) > 0) {
      bestPath = candidate;
    }
  }

  return {
    length: Math.max(0, bestPath.length - 1),
    path: bestPath,
  };
}

// ============================================================================
// SCC size distribution
// ============================================================================

export type ModuleSccSizeDistributionResult = {
  /**
   * Histogram mapping cycle size (number of files in the SCC) to the
   * number of cycles of that size. Only true cycles (size >= 2) are
   * counted because {@link ModuleGraph.moduleGraphCyclesGet} already
   * filters trivial SCCs. Sizes are inserted in ascending order so
   * `Object.keys()` iteration is deterministic.
   */
  bySize: Record<number, number>;
};

/**
 * Histogram of cycle sizes from the module graph.
 *
 * Useful as a single number for "is the cycle situation getting worse?"
 * dashboards: a project with `{ 2: 5 }` is qualitatively different from
 * one with `{ 17: 1 }` even though both report `cycleCount = 1` per
 * existing summary semantics.
 */
export function moduleSccSizeDistributionCompute(
  graph: ModuleGraph,
): ModuleSccSizeDistributionResult {
  const cycles = graph.moduleGraphCyclesGet();
  const counts = new Map<number, number>();
  for (const cycle of cycles) {
    const size = cycle.length;
    counts.set(size, (counts.get(size) ?? 0) + 1);
  }
  const sortedSizes = [...counts.keys()].sort((left, right) => left - right);
  const bySize: Record<number, number> = {};
  for (const size of sortedSizes) {
    bySize[size] = counts.get(size)!;
  }
  return { bySize };
}

// ============================================================================
// Shared helpers
// ============================================================================

/**
 * Files referenced anywhere in the graph. Mirrors the local helper in
 * {@link ./moduleGraphQueries} so this module stays independent of any
 * private export.
 */
function moduleGraphFilesGet(graph: ModuleGraph): string[] {
  const files = new Set<string>();
  for (const entry of graph.moduleGraphEntryPointsGet()) files.add(entry);
  for (const cycle of graph.moduleGraphCyclesGet()) {
    for (const file of cycle) files.add(file);
  }
  for (const file of graph.moduleGraphDependencyOrderGet()) files.add(file);
  return [...files].sort();
}

/**
 * Order chains by `(length desc, lexicographic asc)`. Returns a positive
 * number when `left` should win, negative when `right` should win, `0`
 * for identical paths.
 */
function chainPathCompare(left: string[], right: string[]): number {
  if (left.length !== right.length) return left.length - right.length;
  const length = left.length;
  for (let index = 0; index < length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === b) continue;
    return a < b ? 1 : -1;
  }
  return 0;
}
