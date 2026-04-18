/**
 * @packageDocumentation
 * Narrow graph queries over symbol-level relationships exposed by
 * `ProjectIndex` (call graph and type hierarchy).
 *
 * Phase 7 of the architecture-graph rollout. These helpers sit on top of
 * the views below — `SymbolCallGraphView` for callers/callees,
 * `SymbolTypeHierarchyView` for supertype / subtype edges — so the
 * traversals can be unit-tested against in-memory fakes without
 * tree-sitter parsing or disk I/O. The workspace layer adapts a
 * `ProjectIndex` to these views; nothing in this module reaches into
 * `IndexStore`.
 *
 * Traversals are bounded BFS, deterministic (sorted output), and
 * cycle-tolerant via a visited set. Edge direction is
 * forward-relationship oriented:
 *
 * - call-graph edges: `from = caller`, `to = callee` (so a "callees"
 *   walk is forward and a "callers" walk is backward)
 * - type-hierarchy edges: `from = child`, `to = parent` (so a
 *   "supertypes" walk is forward and a "subtypes" walk is backward,
 *   following `extends` / `implements`)
 */

import type { SymbolId } from './indexTypes';

// ============================================================================
// Views consumed by the helpers
// ============================================================================

/**
 * Minimal call-graph view. Both methods must return `SymbolId[]`
 * dedup'd by the caller; the helpers do not dedup.
 *
 * Adapters wrap `ProjectIndex.callersGet` / `ProjectIndex.calleesGet`
 * one-for-one. Both queries are heuristic — see
 * {@link SymbolCallGraphFidelity}.
 */
export type SymbolCallGraphView = {
  callersGet(symbolId: SymbolId): SymbolId[];
  calleesGet(symbolId: SymbolId): SymbolId[];
};

/**
 * Minimal type-hierarchy view. Both methods must return `SymbolId[]`.
 *
 * `superTypesGet` returns the symbols that the given symbol extends or
 * implements ("up the hierarchy"). `subTypesGet` returns the symbols
 * that extend or implement the given symbol ("down the hierarchy").
 * The default workspace adapter resolves these from
 * `ProjectIndex.typeRelationsGet` and `ProjectIndex.subTypesGet`,
 * filtering to relations that resolved to a concrete symbol target.
 */
export type SymbolTypeHierarchyView = {
  superTypesGet(symbolId: SymbolId): SymbolId[];
  subTypesGet(symbolId: SymbolId): SymbolId[];
};

// ============================================================================
// Result shape (shared between call graph and type hierarchy)
// ============================================================================

/**
 * Subgraph induced by {@link symbolCallGraphCompute} or
 * {@link symbolTypeHierarchyCompute}.
 *
 * `symbols` always includes the seed, even when the seed has no
 * neighbors. `edges` contains only edges where both endpoints are in
 * `symbols`, sorted lexicographically by `(from, to)`.
 */
export type SymbolGraphTraversalResult = {
  symbols: SymbolId[];
  edges: Array<{ from: SymbolId; to: SymbolId }>;
};

// ============================================================================
// Call graph
// ============================================================================

/**
 * Direction of a call-graph traversal.
 *
 * - `callers`: walk backward edges — answer "who calls this, transitively?"
 * - `callees`: walk forward edges — answer "what does this call, transitively?"
 * - `both`: union of the two directions starting from the seed symbol.
 */
export type SymbolCallGraphDirection = 'callers' | 'callees' | 'both';

export type SymbolCallGraphInput = {
  /** Seed symbol. Returned even when it has no callers or callees. */
  symbolId: SymbolId;
  direction: SymbolCallGraphDirection;
  /**
   * Maximum BFS depth from `symbolId`. `0` returns just the seed.
   * Omitting or passing `Infinity` walks until the call graph is
   * exhausted.
   */
  depth?: number;
};

/**
 * Bounded BFS over the call graph.
 *
 * - `callers` walks {@link SymbolCallGraphView.callersGet} (reverse edges).
 * - `callees` walks {@link SymbolCallGraphView.calleesGet} (forward edges).
 * - `both` expands in both directions at each BFS layer.
 *
 * `edges` always orient `from = caller`, `to = callee` regardless of
 * traversal direction so the result is uniform across the three modes.
 *
 * The traversal is cycle-tolerant: a symbol that ends up calling itself
 * (directly or transitively) does not loop. Output is deterministic:
 * symbols sorted lexicographically, edges sorted by `(from, to)`.
 */
export function symbolCallGraphCompute(
  view: SymbolCallGraphView,
  input: SymbolCallGraphInput,
): SymbolGraphTraversalResult {
  const depth = input.depth === undefined ? Infinity : Math.max(0, input.depth);

  const visited = new Set<SymbolId>();
  visited.add(input.symbolId);
  let frontier: SymbolId[] = [input.symbolId];
  let remaining = depth;

  while (frontier.length > 0 && remaining > 0) {
    const next: SymbolId[] = [];
    for (const symbolId of frontier) {
      for (const neighbor of symbolCallGraphNeighborsGet(view, symbolId, input.direction)) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        next.push(neighbor);
      }
    }
    frontier = next;
    remaining -= 1;
  }

  const symbols = [...visited].sort();
  const symbolSet = new Set(symbols);
  const edges = symbolCallGraphInducedEdgesGet(view, symbolSet);
  return { symbols, edges };
}

// ============================================================================
// Type hierarchy
// ============================================================================

/**
 * Direction of a type-hierarchy traversal.
 *
 * - `supertypes`: walk forward edges — answer "what does this extend /
 *   implement, transitively?"
 * - `subtypes`: walk reverse edges — answer "what extends / implements
 *   this, transitively?"
 * - `both`: union of the two directions starting from the seed symbol.
 */
export type SymbolTypeHierarchyDirection = 'supertypes' | 'subtypes' | 'both';

export type SymbolTypeHierarchyInput = {
  symbolId: SymbolId;
  direction: SymbolTypeHierarchyDirection;
  /**
   * Maximum BFS depth from `symbolId`. `0` returns just the seed.
   * Omitting or passing `Infinity` walks until the hierarchy is
   * exhausted.
   */
  depth?: number;
};

/**
 * Bounded BFS over the type hierarchy.
 *
 * `edges` always orient `from = subtype/child`, `to = supertype/parent`
 * so consumers can render the result uniformly regardless of traversal
 * direction.
 *
 * Cycle-tolerant — type relations should be a DAG in well-formed
 * codebases but the helper still bounds itself with a visited set so
 * pathological inputs (e.g. a class that incorrectly extends itself
 * through an intermediate alias) do not cause infinite recursion.
 *
 * Output is deterministic: symbols sorted lexicographically, edges
 * sorted by `(from, to)`.
 */
export function symbolTypeHierarchyCompute(
  view: SymbolTypeHierarchyView,
  input: SymbolTypeHierarchyInput,
): SymbolGraphTraversalResult {
  const depth = input.depth === undefined ? Infinity : Math.max(0, input.depth);

  const visited = new Set<SymbolId>();
  visited.add(input.symbolId);
  let frontier: SymbolId[] = [input.symbolId];
  let remaining = depth;

  while (frontier.length > 0 && remaining > 0) {
    const next: SymbolId[] = [];
    for (const symbolId of frontier) {
      for (const neighbor of symbolTypeHierarchyNeighborsGet(view, symbolId, input.direction)) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        next.push(neighbor);
      }
    }
    frontier = next;
    remaining -= 1;
  }

  const symbols = [...visited].sort();
  const symbolSet = new Set(symbols);
  const edges = symbolTypeHierarchyInducedEdgesGet(view, symbolSet);
  return { symbols, edges };
}

// ============================================================================
// Shared traversal helpers
// ============================================================================

function symbolCallGraphNeighborsGet(
  view: SymbolCallGraphView,
  symbolId: SymbolId,
  direction: SymbolCallGraphDirection,
): SymbolId[] {
  switch (direction) {
    case 'callers':
      return view.callersGet(symbolId);
    case 'callees':
      return view.calleesGet(symbolId);
    case 'both': {
      const callers = view.callersGet(symbolId);
      const callees = view.calleesGet(symbolId);
      if (callers.length === 0) return callees;
      if (callees.length === 0) return callers;
      const union = new Set<SymbolId>(callers);
      for (const callee of callees) union.add(callee);
      return [...union];
    }
  }
}

function symbolTypeHierarchyNeighborsGet(
  view: SymbolTypeHierarchyView,
  symbolId: SymbolId,
  direction: SymbolTypeHierarchyDirection,
): SymbolId[] {
  switch (direction) {
    case 'supertypes':
      return view.superTypesGet(symbolId);
    case 'subtypes':
      return view.subTypesGet(symbolId);
    case 'both': {
      const supers = view.superTypesGet(symbolId);
      const subs = view.subTypesGet(symbolId);
      if (supers.length === 0) return subs;
      if (subs.length === 0) return supers;
      const union = new Set<SymbolId>(supers);
      for (const sub of subs) union.add(sub);
      return [...union];
    }
  }
}

function symbolCallGraphInducedEdgesGet(
  view: SymbolCallGraphView,
  symbols: Set<SymbolId>,
): Array<{ from: SymbolId; to: SymbolId }> {
  const edges: Array<{ from: SymbolId; to: SymbolId }> = [];
  const seen = new Set<string>();
  for (const symbolId of symbols) {
    for (const callee of view.calleesGet(symbolId)) {
      if (!symbols.has(callee)) continue;
      const key = `${symbolId}\u0000${callee}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: symbolId, to: callee });
    }
  }
  edges.sort(symbolGraphEdgeCompare);
  return edges;
}

function symbolTypeHierarchyInducedEdgesGet(
  view: SymbolTypeHierarchyView,
  symbols: Set<SymbolId>,
): Array<{ from: SymbolId; to: SymbolId }> {
  const edges: Array<{ from: SymbolId; to: SymbolId }> = [];
  const seen = new Set<string>();
  for (const symbolId of symbols) {
    for (const parent of view.superTypesGet(symbolId)) {
      if (!symbols.has(parent)) continue;
      const key = `${symbolId}\u0000${parent}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: symbolId, to: parent });
    }
  }
  edges.sort(symbolGraphEdgeCompare);
  return edges;
}

function symbolGraphEdgeCompare(
  left: { from: SymbolId; to: SymbolId },
  right: { from: SymbolId; to: SymbolId },
): number {
  if (left.from !== right.from) return left.from < right.from ? -1 : 1;
  if (left.to !== right.to) return left.to < right.to ? -1 : 1;
  return 0;
}
