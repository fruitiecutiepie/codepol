/**
 * @packageDocumentation
 * Narrow graph queries over a {@link ModuleGraph}.
 *
 * These helpers sit on top of the already-built module graph and answer
 * the "what breaks / what depends / what is unreachable" questions that
 * architecture tooling needs. They never mutate the graph and never build
 * a new index — they are pure traversals that return deterministically
 * ordered results.
 *
 * All traversals are cycle-tolerant: a visited set prevents infinite loops
 * on strongly-connected components. File paths are treated as opaque keys;
 * callers decide whether to pass absolute paths or URI strings.
 */

import type { ModuleGraph } from './moduleGraph';

// ============================================================================
// Impact radius
// ============================================================================

/**
 * Direction of a neighborhood traversal.
 *
 * - `upstream`: follow reverse edges (who imports the file, and who imports
 *   those, etc.) — answers "who breaks if I change this?"
 * - `downstream`: follow forward edges (what this file imports, transitively)
 *   — answers "what does this file pull in?"
 * - `both`: union of the two directions starting from the seed file.
 */
export type ModuleImpactRadiusDirection = 'upstream' | 'downstream' | 'both';

export type ModuleImpactRadiusInput = {
  /** Seed file. Returned unchanged even when it has no neighbors. */
  file: string;
  direction: ModuleImpactRadiusDirection;
  /**
   * Maximum BFS depth from `file`. `0` returns just the seed. Omitting or
   * passing `Infinity` walks until the graph is exhausted.
   */
  depth?: number;
};

/**
 * Subgraph induced by {@link moduleImpactRadiusCompute}.
 *
 * `files` always includes the seed file, even when it is not present in
 * the underlying graph (so callers can safely render a single-node view
 * for files that do not participate in any import). `edges` contains only
 * edges where both endpoints are in `files`, sorted lexicographically by
 * `(from, to)`.
 */
export type ModuleImpactRadiusResult = {
  files: string[];
  edges: Array<{ from: string; to: string }>;
};

/**
 * Bounded breadth-first neighborhood around a seed file.
 *
 * Uses {@link ModuleGraph.moduleGraphImportersGet} for upstream walks and
 * {@link ModuleGraph.moduleGraphImporteesGet} for downstream walks. The
 * `both` direction expands in both directions at each BFS layer, which is
 * equivalent to computing the connected component of the seed in the
 * undirected view truncated at `depth`.
 *
 * The result is deterministic: files are returned in sorted order and
 * edges are returned in sorted `(from, to)` order.
 */
export function moduleImpactRadiusCompute(
  graph: ModuleGraph,
  input: ModuleImpactRadiusInput,
): ModuleImpactRadiusResult {
  const depth = input.depth === undefined ? Infinity : Math.max(0, input.depth);

  const visited = new Set<string>();
  visited.add(input.file);
  let frontier: string[] = [input.file];
  let remaining = depth;

  while (frontier.length > 0 && remaining > 0) {
    const next: string[] = [];
    for (const file of frontier) {
      const neighbors = moduleNeighborsGet(graph, file, input.direction);
      for (const neighbor of neighbors) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        next.push(neighbor);
      }
    }
    frontier = next;
    remaining -= 1;
  }

  const files = [...visited].sort();
  const fileSet = new Set(files);
  const edges = moduleInducedEdgesGet(graph, fileSet);

  return { files, edges };
}

// ============================================================================
// Dependency path
// ============================================================================

export type ModuleDependencyPathInput = {
  fromFile: string;
  toFile: string;
  /**
   * Maximum number of simple paths to return. Default 5. Must be a
   * positive finite integer; callers that want "just the shortest path"
   * should pass `1`.
   */
  maxPaths?: number;
};

export type ModuleDependencyPathResult = {
  /**
   * Simple paths (no repeated nodes) from `fromFile` to `toFile`, sorted
   * by (length, lexicographic tuple). Each path starts with `fromFile`
   * and ends with `toFile`. Empty when no path exists.
   */
  paths: string[][];
  /**
   * Length of the shortest path in edges (i.e. `paths[0].length - 1`).
   * `0` when no path exists.
   */
  shortestLength: number;
  /**
   * `true` when the enumeration stopped because `maxPaths` was reached
   * and at least one additional simple path exists.
   */
  truncated: boolean;
};

/**
 * Default cap on simple-path enumeration. Keeps worst-case cost bounded on
 * highly connected graphs where the set of simple paths grows factorially.
 */
const MODULE_DEPENDENCY_PATH_DEFAULT_MAX = 5;

/**
 * Enumerate up to `maxPaths` simple paths from `fromFile` to `toFile` in
 * the forward (importee) direction, ordered by path length.
 *
 * Implementation notes:
 *
 * - `shortestLength` is computed by a separate BFS first so that the
 *   caller can learn "there is a path of length N" even when `maxPaths`
 *   is set to 1.
 * - Paths are enumerated via DFS with a `visited` set, so cycles do not
 *   cause infinite recursion.
 * - The DFS explores neighbors in sorted order to guarantee deterministic
 *   output across runs.
 * - `truncated` is detected by asking for one more path than `maxPaths`
 *   and trimming the result.
 */
export function moduleDependencyPathCompute(
  graph: ModuleGraph,
  input: ModuleDependencyPathInput,
): ModuleDependencyPathResult {
  const maxPaths =
    input.maxPaths === undefined
      ? MODULE_DEPENDENCY_PATH_DEFAULT_MAX
      : Math.max(1, Math.floor(input.maxPaths));

  if (input.fromFile === input.toFile) {
    return {
      paths: [[input.fromFile]],
      shortestLength: 0,
      truncated: false,
    };
  }

  const shortestLength = moduleShortestPathLengthCompute(
    graph,
    input.fromFile,
    input.toFile,
  );
  if (shortestLength === undefined) {
    return { paths: [], shortestLength: 0, truncated: false };
  }

  const collected: string[][] = [];
  const visited = new Set<string>([input.fromFile]);
  const stack: string[] = [input.fromFile];
  const limitProbe = maxPaths + 1;

  function dfs(current: string): boolean {
    if (collected.length >= limitProbe) return true;
    if (current === input.toFile) {
      collected.push([...stack]);
      return collected.length >= limitProbe;
    }
    const neighbors = [...graph.moduleGraphImporteesGet(current)].sort();
    for (const neighbor of neighbors) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      stack.push(neighbor);
      const stop = dfs(neighbor);
      stack.pop();
      visited.delete(neighbor);
      if (stop) return true;
    }
    return false;
  }

  dfs(input.fromFile);

  collected.sort(pathsOrderCompare);
  const truncated = collected.length > maxPaths;
  const paths = truncated ? collected.slice(0, maxPaths) : collected;

  return {
    paths,
    shortestLength,
    truncated,
  };
}

// ============================================================================
// Dead modules
// ============================================================================

export type ModuleDeadModulesInput = {
  /**
   * Files treated as roots for forward reachability. When omitted or
   * empty, {@link ModuleGraph.moduleGraphEntryPointsGet} is used. Unknown
   * entry points (files not present in the graph) are ignored.
   */
  entryPoints?: string[];
};

export type ModuleDeadModulesResult = {
  /**
   * Files present in the graph but unreachable from any entry point,
   * sorted lexicographically. Entry points themselves are never listed
   * as unreachable.
   */
  unreachable: string[];
};

/**
 * Files that no entry point transitively imports.
 *
 * Rules:
 *
 * - If the caller passes a non-empty `entryPoints` array, only those
 *   files are used as roots (even if the graph has other natural entry
 *   points).
 * - Unknown entry-point files silently do nothing — they contribute no
 *   reachable set. A caller that passes only unknown files therefore
 *   sees every indexed file reported as unreachable.
 * - Files are treated as "in the graph" when they appear as either a
 *   source or a target of any edge, or when the graph reports them as
 *   an entry point. This matches what the rest of the graph surface
 *   considers "indexed".
 */
export function moduleDeadModulesCompute(
  graph: ModuleGraph,
  input: ModuleDeadModulesInput,
): ModuleDeadModulesResult {
  const allFiles = moduleGraphFilesGet(graph);
  const fileSet = new Set(allFiles);

  const rawEntryPoints =
    input.entryPoints && input.entryPoints.length > 0
      ? input.entryPoints
      : graph.moduleGraphEntryPointsGet();

  const reachable = new Set<string>();
  const queue: string[] = [];
  for (const entry of rawEntryPoints) {
    if (!fileSet.has(entry)) continue;
    if (reachable.has(entry)) continue;
    reachable.add(entry);
    queue.push(entry);
  }

  while (queue.length > 0) {
    const file = queue.shift()!;
    for (const importee of graph.moduleGraphImporteesGet(file)) {
      if (reachable.has(importee)) continue;
      if (!fileSet.has(importee)) continue;
      reachable.add(importee);
      queue.push(importee);
    }
  }

  const unreachable = allFiles.filter((file) => !reachable.has(file)).sort();

  return { unreachable };
}

// ============================================================================
// Shared helpers
// ============================================================================

function moduleNeighborsGet(
  graph: ModuleGraph,
  file: string,
  direction: ModuleImpactRadiusDirection,
): string[] {
  switch (direction) {
    case 'upstream':
      return graph.moduleGraphImportersGet(file);
    case 'downstream':
      return graph.moduleGraphImporteesGet(file);
    case 'both': {
      const importers = graph.moduleGraphImportersGet(file);
      const importees = graph.moduleGraphImporteesGet(file);
      if (importers.length === 0) return importees;
      if (importees.length === 0) return importers;
      const union = new Set<string>(importers);
      for (const importee of importees) union.add(importee);
      return [...union];
    }
  }
}

function moduleInducedEdgesGet(
  graph: ModuleGraph,
  files: Set<string>,
): Array<{ from: string; to: string }> {
  const edges: Array<{ from: string; to: string }> = [];
  for (const file of files) {
    for (const importee of graph.moduleGraphImporteesGet(file)) {
      if (!files.has(importee)) continue;
      edges.push({ from: file, to: importee });
    }
  }
  edges.sort((a, b) => {
    if (a.from !== b.from) return a.from < b.from ? -1 : 1;
    if (a.to !== b.to) return a.to < b.to ? -1 : 1;
    return 0;
  });
  return edges;
}

/**
 * Files referenced anywhere in the graph, derived from entry points plus
 * every endpoint of every edge we can reach via traversal. Callers use
 * this as the canonical "known file" set without reaching into
 * {@link IndexStore}.
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

function moduleShortestPathLengthCompute(
  graph: ModuleGraph,
  from: string,
  to: string,
): number | undefined {
  if (from === to) return 0;
  const distance = new Map<string, number>();
  distance.set(from, 0);
  const queue: string[] = [from];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentDistance = distance.get(current)!;
    for (const neighbor of graph.moduleGraphImporteesGet(current)) {
      if (distance.has(neighbor)) continue;
      if (neighbor === to) return currentDistance + 1;
      distance.set(neighbor, currentDistance + 1);
      queue.push(neighbor);
    }
  }
  return undefined;
}

function pathsOrderCompare(left: string[], right: string[]): number {
  if (left.length !== right.length) return left.length - right.length;
  const length = left.length;
  for (let index = 0; index < length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a !== b) return a < b ? -1 : 1;
  }
  return 0;
}
