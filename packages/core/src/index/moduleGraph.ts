/**
 * @packageDocumentation
 * Module-level dependency graph built from import relations.
 *
 * Provides:
 * - Forward and reverse adjacency queries (importers / importees)
 * - Topological sort (dependency order)
 * - Circular dependency detection (Tarjan's SCC)
 * - Entry point detection (files with no importers)
 *
 * Operates on resolved module paths from IndexStore import bindings.
 * External packages (unresolved paths) are excluded from the graph.
 */

import type { IndexStore } from './indexStore';

// ============================================================================
// Public API
// ============================================================================

/**
 * Classification of a single edge in the module dependency graph.
 *
 * - `static`: produced by a syntactic static import (ES `import`, Python
 *   `import`/`from`).
 * - `dynamic`: produced by a dynamic import (`import(...)` or
 *   `await import(...)`), regardless of whether the result is bound.
 * - `cjs`: produced by a CommonJS `require(...)` call.
 * - `side_effect`: produced by a module-specifier-only import (no binding
 *   on the source side), e.g. `import "./polyfill"`.
 * - `type_only`: reserved — not populated in Phase 1; will be set when
 *   type-only import metadata is captured by adapters.
 */
export type ModuleEdgeKind =
  | 'static'
  | 'dynamic'
  | 'side_effect'
  | 'cjs'
  | 'type_only';

/**
 * Per-edge metadata computed from the underlying index relations.
 */
export type ModuleEdgeInfo = {
  /** Dominant kind of this edge. Picked deterministically when sources disagree. */
  kind: ModuleEdgeKind;
  /**
   * Number of distinct `ImportBindingRelation` entries that contributed to
   * this edge. Zero for pure side-effect edges (no bindings on the
   * importer side).
   */
  bindingCount: number;
};

/**
 * Read-only lookup for per-edge metadata on top of a ModuleGraph.
 * Instances are built by {@link moduleGraphEdgeInfoBuild} and are
 * independent from the ModuleGraph instance itself so that consumers can
 * opt-in without paying the cost when they only need topology.
 */
export type ModuleGraphEdgeInfo = {
  /**
   * Returns metadata for the edge `from → to` if such an edge exists,
   * otherwise `undefined`. Callers are expected to first confirm the edge
   * exists via {@link ModuleGraph.moduleGraphImporteesGet}; looking up a
   * non-existent edge returns `undefined` rather than a default object.
   */
  moduleEdgeInfoGet(from: string, to: string): ModuleEdgeInfo | undefined;
};

/**
 * Module-level dependency graph.
 * All file paths are absolute, matching the paths in IndexStore.
 */
export type ModuleGraph = {
  /**
   * Get files that import the given file (reverse edges).
   * Returns empty array if the file has no importers or is unknown.
   */
  moduleGraphImportersGet(file: string): string[];

  /**
   * Get files that the given file imports (forward edges).
   * Returns empty array if the file imports nothing or is unknown.
   */
  moduleGraphImporteesGet(file: string): string[];

  /**
   * Get all indexed files in dependency order (topological sort).
   * Files with no dependencies come first; dependents come after their dependencies.
   * Files involved in cycles are included but their relative order within the cycle
   * is arbitrary (the cycle is broken at an arbitrary point).
   */
  moduleGraphDependencyOrderGet(): string[];

  /**
   * Get all circular dependency cycles.
   * Each cycle is an array of file paths forming the loop.
   * A file that imports itself is a cycle of length 1.
   * Returns empty array if no cycles exist.
   */
  moduleGraphCyclesGet(): string[][];

  /**
   * Get all entry point files (files with no importers within the indexed set).
   * These are root files that nothing else depends on.
   * Sorted alphabetically for determinism.
   */
  moduleGraphEntryPointsGet(): string[];
};

// ============================================================================
// Graph Construction
// ============================================================================

/**
 * Build a ModuleGraph from an IndexStore.
 *
 * Reads import bindings from all indexed files and builds adjacency lists
 * from resolved module paths. External packages (bindings without
 * resolvedModulePath) are excluded.
 */
export function moduleGraphBuild(store: IndexStore): ModuleGraph {
  const files = store.filesGet();
  const fileSet = new Set(files);

  // Forward adjacency: file -> set of files it imports
  const forward = new Map<string, Set<string>>();
  // Reverse adjacency: file -> set of files that import it
  const reverse = new Map<string, Set<string>>();

  // Initialize all files in both maps
  for (const file of files) {
    forward.set(file, new Set());
    reverse.set(file, new Set());
  }

  // Build edges from import bindings
  for (const file of files) {
    const bindings = store.importBindingsInFileGet(file);
    for (const binding of bindings) {
      const target = binding.resolvedModulePath;
      if (!target || !fileSet.has(target)) continue; // Skip external / unresolved
      if (target === file) continue; // Self-import: still record for cycle detection below

      forward.get(file)!.add(target);
      reverse.get(target)!.add(file);
    }

    // Also check ImportsRelation for side-effect and dynamic imports
    // that were resolved during crossFileResolve (Step 7).
    const imports = store.importsInFileGet(file);
    for (const imp of imports) {
      const target = imp.resolvedModulePath;
      if (!target || !fileSet.has(target)) continue;
      if (target === file) continue;

      forward.get(file)!.add(target);
      reverse.get(target)!.add(file);
    }
  }

  // Cache computed results
  let cachedOrder: string[] | undefined;
  let cachedCycles: string[][] | undefined;
  let cachedEntryPoints: string[] | undefined;

  return {
    moduleGraphImportersGet(file: string): string[] {
      return Array.from(reverse.get(file) ?? []);
    },

    moduleGraphImporteesGet(file: string): string[] {
      return Array.from(forward.get(file) ?? []);
    },

    moduleGraphDependencyOrderGet(): string[] {
      if (cachedOrder) return cachedOrder;
      cachedOrder = topologicalSort(files, forward);
      return cachedOrder;
    },

    moduleGraphCyclesGet(): string[][] {
      if (cachedCycles) return cachedCycles;
      cachedCycles = cyclesDetect(files, forward);
      return cachedCycles;
    },

    moduleGraphEntryPointsGet(): string[] {
      if (cachedEntryPoints) return cachedEntryPoints;
      cachedEntryPoints = files
        .filter(file => (reverse.get(file)?.size ?? 0) === 0)
        .sort();
      return cachedEntryPoints;
    },
  };
}

// ============================================================================
// Module Graph Edge Info
// ============================================================================

/**
 * Build a {@link ModuleGraphEdgeInfo} over the given IndexStore.
 *
 * For each `from → to` edge present in the module graph the helper
 * aggregates information from two relation sources:
 *
 * 1. `ImportBindingRelation` entries in `from` whose `resolvedModulePath`
 *    equals `to`. These carry the authoritative import syntactic style
 *    (`static`, `dynamic`, `cjs`) and contribute to `bindingCount`.
 * 2. `ImportsRelation` entries in `from` whose `resolvedModulePath`
 *    equals `to` when there are no bindings. These represent pure
 *    side-effect imports (`import "./polyfill"`) and side-effect-only
 *    dynamic imports (`await import("./x")` without assignment).
 *
 * Kind precedence when multiple bindings contribute to the same edge:
 *
 * ```
 *   dynamic > cjs > static
 * ```
 *
 * The precedence intentionally surfaces the most "runtime-flavored" style
 * so architecture rules can treat any mixed-style coupling as dynamic.
 *
 * Edges not present in the underlying graph return `undefined` — see
 * {@link ModuleGraphEdgeInfo.moduleEdgeInfoGet}.
 */
export function moduleGraphEdgeInfoBuild(store: IndexStore): ModuleGraphEdgeInfo {
  const files = store.filesGet();
  const fileSet = new Set(files);

  type EdgeAccumulator = {
    kind: ModuleEdgeKind;
    bindingCount: number;
  };

  // edgeKey = `${from}\0${to}`
  const edges = new Map<string, EdgeAccumulator>();

  const edgeKey = (from: string, to: string): string => `${from}\0${to}`;

  for (const file of files) {
    const bindings = store.importBindingsInFileGet(file);
    for (const binding of bindings) {
      const target = binding.resolvedModulePath;
      if (!target || !fileSet.has(target) || target === file) continue;

      const key = edgeKey(file, target);
      const style = binding.importStyle ?? 'static';
      const bindingKind: ModuleEdgeKind =
        style === 'dynamic' ? 'dynamic' : style === 'cjs' ? 'cjs' : 'static';

      const existing = edges.get(key);
      if (!existing) {
        edges.set(key, { kind: bindingKind, bindingCount: 1 });
      } else {
        existing.bindingCount += 1;
        existing.kind = edgeKindMerge(existing.kind, bindingKind);
      }
    }

    const imports = store.importsInFileGet(file);
    for (const imp of imports) {
      const target = imp.resolvedModulePath;
      if (!target || !fileSet.has(target) || target === file) continue;

      const key = edgeKey(file, target);
      if (edges.has(key)) {
        // Edge is already described by at least one ImportBindingRelation;
        // the ImportsRelation here is a duplicate source-specifier capture
        // and should not downgrade the classification.
        continue;
      }
      edges.set(key, { kind: 'side_effect', bindingCount: 0 });
    }
  }

  return {
    moduleEdgeInfoGet(from: string, to: string): ModuleEdgeInfo | undefined {
      const entry = edges.get(edgeKey(from, to));
      if (!entry) return undefined;
      return { kind: entry.kind, bindingCount: entry.bindingCount };
    },
  };
}

/**
 * Pick the dominant edge kind when multiple bindings contribute to the
 * same file→file edge. Precedence is `dynamic > cjs > static` so that any
 * runtime-style import visible on the edge wins.
 */
function edgeKindMerge(existing: ModuleEdgeKind, next: ModuleEdgeKind): ModuleEdgeKind {
  const rank = (kind: ModuleEdgeKind): number => {
    switch (kind) {
      case 'dynamic':
        return 3;
      case 'cjs':
        return 2;
      case 'static':
        return 1;
      case 'side_effect':
        return 0;
      case 'type_only':
        return 0;
    }
  };
  return rank(next) > rank(existing) ? next : existing;
}

// ============================================================================
// Topological Sort (Kahn's algorithm)
// ============================================================================

/**
 * Topological sort using Kahn's algorithm on the reversed dependency graph.
 *
 * `forward` maps file -> files it imports (its dependencies).
 * We want dependencies-first ordering, so we process the graph in reverse:
 * a file's "out-degree" in the forward graph is how many deps it has.
 * A file with zero forward edges (imports nothing) is a leaf dependency
 * and should appear first.
 *
 * Handles cycles by appending cycle members after their non-cyclic dependencies.
 * Returns all files; files in cycles appear in an arbitrary but deterministic order.
 */
function topologicalSort(
  files: string[],
  forward: Map<string, Set<string>>
): string[] {
  // For dependencies-first ordering, we count how many imports each file has.
  // Files that import nothing (out-degree 0 in forward = in-degree 0 in reversed)
  // are processed first.
  const depCount = new Map<string, number>();
  for (const file of files) {
    depCount.set(file, forward.get(file)?.size ?? 0);
  }

  // Start with files that have no dependencies, sorted for determinism
  const queue: string[] = [];
  for (const file of files) {
    if ((depCount.get(file) ?? 0) === 0) {
      queue.push(file);
    }
  }
  queue.sort();

  // Build reverse adjacency for traversal: file -> files that depend on it
  const reverse = new Map<string, Set<string>>();
  for (const file of files) {
    reverse.set(file, new Set());
  }
  for (const [file, targets] of forward) {
    for (const target of targets) {
      reverse.get(target)?.add(file);
    }
  }

  const result: string[] = [];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const file = queue.shift()!;
    if (visited.has(file)) continue;
    visited.add(file);
    result.push(file);

    // For each file that depends on this one, decrement its dep count
    const dependents = reverse.get(file);
    if (!dependents) continue;

    const freed: string[] = [];
    for (const dependent of dependents) {
      const newCount = (depCount.get(dependent) ?? 1) - 1;
      depCount.set(dependent, newCount);
      if (newCount === 0 && !visited.has(dependent)) {
        freed.push(dependent);
      }
    }
    freed.sort();
    queue.push(...freed);
  }

  // Files in cycles haven't been visited yet. Add them sorted.
  if (visited.size < files.length) {
    const remaining = files.filter(f => !visited.has(f));
    remaining.sort();
    result.push(...remaining);
  }

  return result;
}

// ============================================================================
// Cycle Detection (Tarjan's SCC)
// ============================================================================

/**
 * Detect all strongly connected components with more than one node (cycles).
 * Uses Tarjan's algorithm for O(V + E) performance.
 * Returns cycles sorted by their first element for determinism.
 */
function cyclesDetect(
  files: string[],
  forward: Map<string, Set<string>>
): string[][] {
  let index = 0;
  const nodeIndex = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  function strongConnect(file: string): void {
    nodeIndex.set(file, index);
    lowLink.set(file, index);
    index++;
    stack.push(file);
    onStack.add(file);

    const targets = forward.get(file);
    if (targets) {
      for (const target of targets) {
        if (!nodeIndex.has(target)) {
          // Not yet visited
          strongConnect(target);
          lowLink.set(file, Math.min(lowLink.get(file)!, lowLink.get(target)!));
        } else if (onStack.has(target)) {
          // On stack: part of current SCC
          lowLink.set(file, Math.min(lowLink.get(file)!, nodeIndex.get(target)!));
        }
      }
    }

    // If file is a root node, pop the SCC
    if (lowLink.get(file) === nodeIndex.get(file)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== file);

      // Only report SCCs with more than one node (actual cycles)
      if (scc.length > 1) {
        scc.sort(); // Deterministic order within the cycle
        sccs.push(scc);
      }
    }
  }

  // Process files in sorted order for determinism
  const sortedFiles = [...files].sort();
  for (const file of sortedFiles) {
    if (!nodeIndex.has(file)) {
      strongConnect(file);
    }
  }

  // Sort cycles by their first element for deterministic output
  sccs.sort((a, b) => a[0].localeCompare(b[0]));
  return sccs;
}
