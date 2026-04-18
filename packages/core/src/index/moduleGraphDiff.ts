/**
 * @packageDocumentation
 * Snapshot-based dependency-graph diffs.
 *
 * Phase 6 of the architecture-graph work needs to answer "what changed
 * in the module graph between two points in time?". The two snapshots
 * may come from:
 *
 * - an on-disk sidecar written by `codepol graph snapshot`
 * - an in-process ring buffer kept by the long-running daemon
 * - a fresh `codepol graph export` from another git ref
 *
 * The store mechanics live one layer up (in the workspace service); this
 * file owns only the pure computation: take two minimal snapshots,
 * return a deterministic diff.
 *
 * Snapshots are intentionally minimal — just the structural primitives a
 * diff needs. Enriched node/edge metadata (kinds, package names, layer
 * tags, complexity) is derivable from the live index when a panel needs
 * to render the diff, so we do not waste bytes persisting it.
 */

// ============================================================================
// Snapshot shape
// ============================================================================

/**
 * Minimal node identity persisted in a graph snapshot. Only the URI is
 * required; `workspaceRelativePath` is kept because it is the only field
 * a `codepol graph diff` text renderer needs to display the change to a
 * human without rebuilding the workspace.
 */
export type GraphSnapshotNode = {
  uri: string;
  workspaceRelativePath: string;
};

/**
 * Minimal edge identity persisted in a graph snapshot.
 */
export type GraphSnapshotEdge = {
  fromUri: string;
  toUri: string;
};

/**
 * On-disk / on-wire representation of a workspace dependency graph at a
 * single point in time. Captures the structural primitives needed for
 * diffing — anything richer (per-edge kind, per-node metrics) belongs
 * with the live index.
 *
 * Field ordering and array sort order matter for stable hashing and for
 * a deterministic `git diff` view of two sidecar files; snapshot writers
 * MUST sort:
 *
 * - `nodes` by `uri` ascending
 * - `edges` by `(fromUri, toUri)` ascending
 * - `entryPoints` by `uri` ascending
 * - `cycles[*]` by `uri` ascending; the outer array sorted by first member
 */
export type GraphSnapshot = {
  /** Snapshot format version. Bump when adding fields the reader must understand. */
  schemaVersion: 1;
  /**
   * Stable identifier for the workspace root the snapshot was taken at.
   * Diffs that are not from the same workspace root are rejected so a
   * stale `master` snapshot from a different repo can't pollute a PR
   * comparison.
   */
  workspaceRootId: string;
  /**
   * Optional human-readable label for the snapshot (e.g. `base`, `pr-42`).
   * Stored alongside the snapshot in the sidecar but not used for diffing.
   */
  label?: string;
  /** Wall-clock timestamp at write time (informational only). */
  createdAtUnixMs: number;
  /**
   * Monotonic generation counter from the live index when the snapshot
   * was captured. Optional because external producers (e.g.
   * `codepol graph export` from another ref) cannot infer it. Diff
   * algorithms must not depend on this field.
   */
  analysisGeneration?: number;
  nodes: GraphSnapshotNode[];
  edges: GraphSnapshotEdge[];
  entryPoints: string[];
  cycles: string[][];
};

// ============================================================================
// Diff result
// ============================================================================

/**
 * Output of {@link moduleDependencyDiffCompute}.
 *
 * Sorting:
 *
 * - `addedNodes` / `removedNodes` sorted by `uri`
 * - `addedEdges` / `removedEdges` sorted by `(fromUri, toUri)`
 * - `newCycles` / `removedCycles` sorted by first member (each cycle is
 *   sorted internally)
 *
 * Cycle equality uses the canonical-form representation (members sorted
 * lexicographically) so a cycle reported as `[a, b, c]` in one snapshot
 * matches `[c, a, b]` in the other.
 */
export type ModuleDependencyDiffResult = {
  addedNodes: GraphSnapshotNode[];
  removedNodes: GraphSnapshotNode[];
  addedEdges: GraphSnapshotEdge[];
  removedEdges: GraphSnapshotEdge[];
  newCycles: string[][];
  removedCycles: string[][];
};

export type ModuleDependencyDiffInput = {
  baseline: GraphSnapshot;
  current: GraphSnapshot;
};

// ============================================================================
// Compute
// ============================================================================

/**
 * Compute the structural diff between two graph snapshots.
 *
 * The function is pure and deterministic: identical inputs produce
 * identical outputs across runs. Snapshots from different
 * {@link GraphSnapshot.workspaceRootId} workspaces are still diffed
 * (the caller is responsible for the policy decision to reject
 * cross-root diffs); this keeps the helper itself usable in tests where
 * the IDs do not matter.
 *
 * Implementation notes:
 *
 * - Node identity is `uri`. The `workspaceRelativePath` is preserved
 *   from whichever snapshot still contains the node so the renderer can
 *   show a path even when the file was deleted.
 * - Edge identity is the `(fromUri, toUri)` pair. Edge kind / binding
 *   count are intentionally not part of the diff key — those belong to
 *   richer per-edge diffs that are out of scope here.
 * - Cycle identity is the canonical-form set of members. A cycle is
 *   "new" when its canonical form is not present in the baseline.
 */
export function moduleDependencyDiffCompute(
  input: ModuleDependencyDiffInput,
): ModuleDependencyDiffResult {
  const baselineNodeByUri = nodesIndexByUri(input.baseline.nodes);
  const currentNodeByUri = nodesIndexByUri(input.current.nodes);

  const addedNodes: GraphSnapshotNode[] = [];
  for (const [uri, node] of currentNodeByUri) {
    if (!baselineNodeByUri.has(uri)) addedNodes.push(node);
  }
  const removedNodes: GraphSnapshotNode[] = [];
  for (const [uri, node] of baselineNodeByUri) {
    if (!currentNodeByUri.has(uri)) removedNodes.push(node);
  }

  const baselineEdges = edgesIndexByPair(input.baseline.edges);
  const currentEdges = edgesIndexByPair(input.current.edges);

  const addedEdges: GraphSnapshotEdge[] = [];
  for (const [key, edge] of currentEdges) {
    if (!baselineEdges.has(key)) addedEdges.push(edge);
  }
  const removedEdges: GraphSnapshotEdge[] = [];
  for (const [key, edge] of baselineEdges) {
    if (!currentEdges.has(key)) removedEdges.push(edge);
  }

  const baselineCycles = cyclesIndexByCanonicalKey(input.baseline.cycles);
  const currentCycles = cyclesIndexByCanonicalKey(input.current.cycles);

  const newCycles: string[][] = [];
  for (const [key, members] of currentCycles) {
    if (!baselineCycles.has(key)) newCycles.push(members);
  }
  const removedCycles: string[][] = [];
  for (const [key, members] of baselineCycles) {
    if (!currentCycles.has(key)) removedCycles.push(members);
  }

  return {
    addedNodes: addedNodes.sort((a, b) => stringCompare(a.uri, b.uri)),
    removedNodes: removedNodes.sort((a, b) => stringCompare(a.uri, b.uri)),
    addedEdges: addedEdges.sort(edgeOrderCompare),
    removedEdges: removedEdges.sort(edgeOrderCompare),
    newCycles: newCycles.sort(cyclesOrderCompare),
    removedCycles: removedCycles.sort(cyclesOrderCompare),
  };
}

// ============================================================================
// Helpers
// ============================================================================

function nodesIndexByUri(nodes: readonly GraphSnapshotNode[]): Map<string, GraphSnapshotNode> {
  const map = new Map<string, GraphSnapshotNode>();
  for (const node of nodes) {
    if (!map.has(node.uri)) map.set(node.uri, node);
  }
  return map;
}

function edgeKey(edge: GraphSnapshotEdge): string {
  return `${edge.fromUri}\u0000${edge.toUri}`;
}

function edgesIndexByPair(
  edges: readonly GraphSnapshotEdge[],
): Map<string, GraphSnapshotEdge> {
  const map = new Map<string, GraphSnapshotEdge>();
  for (const edge of edges) {
    const key = edgeKey(edge);
    if (!map.has(key)) map.set(key, edge);
  }
  return map;
}

function cycleCanonicalForm(members: readonly string[]): string[] {
  return [...members].sort();
}

function cyclesIndexByCanonicalKey(
  cycles: readonly string[][],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const cycle of cycles) {
    const canonical = cycleCanonicalForm(cycle);
    const key = canonical.join('\u0000');
    if (!map.has(key)) map.set(key, canonical);
  }
  return map;
}

function stringCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function edgeOrderCompare(a: GraphSnapshotEdge, b: GraphSnapshotEdge): number {
  const fromCmp = stringCompare(a.fromUri, b.fromUri);
  if (fromCmp !== 0) return fromCmp;
  return stringCompare(a.toUri, b.toUri);
}

function cyclesOrderCompare(a: readonly string[], b: readonly string[]): number {
  const headCmp = stringCompare(a[0] ?? '', b[0] ?? '');
  if (headCmp !== 0) return headCmp;
  if (a.length !== b.length) return a.length - b.length;
  for (let index = 0; index < a.length; index += 1) {
    const cmp = stringCompare(a[index] ?? '', b[index] ?? '');
    if (cmp !== 0) return cmp;
  }
  return 0;
}
