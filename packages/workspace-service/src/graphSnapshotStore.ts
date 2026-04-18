/**
 * @packageDocumentation
 * Persistent storage for {@link GraphSnapshot} payloads.
 *
 * This is the Phase 6 / Q1 sidecar implementation: graph snapshots are
 * written as JSON files under `.codepol/graph-snapshots/` next to the
 * workspace's existing cache. CI flows (`codepol graph snapshot --label
 * base` on the base branch, `codepol graph diff base` on a PR head)
 * round-trip through this store; in-process consumers can also use it
 * to compare the current graph against a previously labeled snapshot.
 *
 * Design choices:
 *
 * - **Sidecar format, not the index.** Snapshots only contain the
 *   structural primitives needed for diffing. Enriched metadata
 *   (per-edge kinds, package names, etc.) lives on the live index and
 *   is rebuilt on demand when a panel renders the diff.
 * - **Label addressing.** CI cares about names like `base` / `pr-42`,
 *   not generation numbers. Generation is still recorded inside the
 *   payload for diagnostics but is not part of the lookup key.
 * - **Atomic writes.** Each snapshot is written to a temp file in the
 *   same directory and `rename`d over the final path. Readers always
 *   see a complete JSON payload or no file at all.
 *
 * The writer/reader/lister surface is small enough that the daemon's
 * future in-memory ring buffer (Q1 option D) can implement the same
 * interface and be swapped in for editor-only diffs.
 */

import { createHash } from 'node:crypto';
import { promises as fs, type Stats } from 'node:fs';
import path from 'node:path';
import {
  type GraphSnapshot,
  type WorkspaceDependencyGraphResult,
} from '@codepol/core';

// ============================================================================
// Public types
// ============================================================================

/**
 * Storage primitive for graph snapshots, parametric over backend so we
 * can ship the on-disk sidecar today and add the in-memory ring buffer
 * later without changing the workspace-service callsite.
 *
 * Reads return `undefined` for missing labels rather than throwing so
 * callers can distinguish "no baseline yet" from "baseline corrupt".
 */
export type GraphSnapshotStore = {
  /**
   * Persist a snapshot under the given label. Existing snapshots with
   * the same label are overwritten atomically.
   */
  graphSnapshotWrite(input: {
    label: string;
    snapshot: GraphSnapshot;
  }): Promise<void>;
  /**
   * Read the snapshot stored under `label`, or `undefined` when no
   * snapshot has ever been written under that label.
   *
   * Throws when a snapshot file exists but cannot be parsed — this is
   * a hard error because it almost always indicates filesystem
   * corruption or a manual edit by the user.
   */
  graphSnapshotRead(input: { label: string }): Promise<GraphSnapshot | undefined>;
  /**
   * List all known labels in lexicographic order. Useful for the CLI
   * diff subcommand's "no such baseline" error message.
   */
  graphSnapshotLabelsList(): Promise<string[]>;
  /**
   * Delete the snapshot stored under `label`. Returns `true` when a
   * snapshot was actually removed and `false` when no snapshot existed.
   */
  graphSnapshotDelete(input: { label: string }): Promise<boolean>;
};

/**
 * Stable identifier for a workspace root. Diffs across workspaces with
 * different IDs are flagged by the workspace-service so a stale `base`
 * snapshot from another repo can't accidentally satisfy a PR diff.
 */
export function graphSnapshotWorkspaceRootIdCompute(rootPath: string): string {
  return createHash('sha256').update(path.resolve(rootPath)).digest('hex').slice(0, 16);
}

/**
 * Build a {@link GraphSnapshot} payload from the live workspace
 * dependency graph result. The conversion strips edge / node metadata
 * (kinds, metrics, layer tags) the diff does not consume; everything
 * left is normalized into the snapshot's deterministic ordering.
 */
export function graphSnapshotFromDependencyGraphResult(input: {
  graph: WorkspaceDependencyGraphResult;
  workspaceRootId: string;
  label?: string;
  analysisGeneration?: number;
  createdAtUnixMs?: number;
}): GraphSnapshot {
  const nodes: GraphSnapshot['nodes'] = input.graph.nodes
    .map((node) => ({
      uri: node.uri,
      workspaceRelativePath: node.workspaceRelativePath,
    }))
    .sort((a, b) => stringCompare(a.uri, b.uri));

  const edges: GraphSnapshot['edges'] = input.graph.edges
    .map((edge) => ({ fromUri: edge.fromUri, toUri: edge.toUri }))
    .sort(edgeOrderCompare);

  const entryPoints = [...input.graph.entryPoints].sort();

  const cycles = input.graph.cycles
    .map((cycle) => [...cycle].sort())
    .sort((a, b) => stringCompare(a[0] ?? '', b[0] ?? ''));

  return {
    schemaVersion: 1,
    workspaceRootId: input.workspaceRootId,
    ...(input.label !== undefined ? { label: input.label } : {}),
    createdAtUnixMs: input.createdAtUnixMs ?? Date.now(),
    ...(input.analysisGeneration !== undefined
      ? { analysisGeneration: input.analysisGeneration }
      : {}),
    nodes,
    edges,
    entryPoints,
    cycles,
  };
}

// ============================================================================
// Filesystem implementation
// ============================================================================

const GRAPH_SNAPSHOT_DIR = path.join('.codepol', 'graph-snapshots');
const GRAPH_SNAPSHOT_EXTENSION = '.json';

/**
 * Construct a {@link GraphSnapshotStore} backed by JSON sidecar files
 * under `<rootPath>/.codepol/graph-snapshots/`.
 *
 * Labels must be filesystem-safe identifiers. The label is sanitized
 * before becoming a filename so callers can pass branch names like
 * `feature/awesome` without traversing out of the snapshot directory.
 */
export function fileSystemGraphSnapshotStoreCreate(input: {
  rootPath: string;
}): GraphSnapshotStore {
  const directory = path.join(input.rootPath, GRAPH_SNAPSHOT_DIR);

  return {
    async graphSnapshotWrite({ label, snapshot }) {
      const safeLabel = graphSnapshotLabelSanitize(label);
      await fs.mkdir(directory, { recursive: true });
      const finalPath = path.join(directory, `${safeLabel}${GRAPH_SNAPSHOT_EXTENSION}`);
      const tempPath = `${finalPath}.${process.pid}.tmp`;
      const payload = JSON.stringify(snapshot, null, 2);
      await fs.writeFile(tempPath, payload, 'utf8');
      await fs.rename(tempPath, finalPath);
    },

    async graphSnapshotRead({ label }) {
      const safeLabel = graphSnapshotLabelSanitize(label);
      const finalPath = path.join(directory, `${safeLabel}${GRAPH_SNAPSHOT_EXTENSION}`);
      let raw: string;
      try {
        raw = await fs.readFile(finalPath, 'utf8');
      } catch (error) {
        if (errorIsNotFound(error)) return undefined;
        throw error;
      }
      try {
        return graphSnapshotPayloadValidate(JSON.parse(raw));
      } catch (error) {
        throw new Error(
          `Failed to parse graph snapshot at ${finalPath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },

    async graphSnapshotLabelsList() {
      let entries: string[];
      try {
        entries = await fs.readdir(directory);
      } catch (error) {
        if (errorIsNotFound(error)) return [];
        throw error;
      }
      const labels: string[] = [];
      for (const entry of entries) {
        if (!entry.endsWith(GRAPH_SNAPSHOT_EXTENSION)) continue;
        let stat: Stats;
        try {
          stat = await fs.stat(path.join(directory, entry));
        } catch (error) {
          if (errorIsNotFound(error)) continue;
          throw error;
        }
        if (!stat.isFile()) continue;
        labels.push(entry.slice(0, -GRAPH_SNAPSHOT_EXTENSION.length));
      }
      return labels.sort();
    },

    async graphSnapshotDelete({ label }) {
      const safeLabel = graphSnapshotLabelSanitize(label);
      const finalPath = path.join(directory, `${safeLabel}${GRAPH_SNAPSHOT_EXTENSION}`);
      try {
        await fs.unlink(finalPath);
        return true;
      } catch (error) {
        if (errorIsNotFound(error)) return false;
        throw error;
      }
    },
  };
}

// ============================================================================
// Helpers
// ============================================================================

function errorIsNotFound(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      (error as NodeJS.ErrnoException).code === 'ENOENT',
  );
}

const GRAPH_SNAPSHOT_LABEL_REPLACEMENTS = /[^a-zA-Z0-9._-]+/g;

/**
 * Map an arbitrary user-supplied label to a filesystem-safe filename
 * stem. Labels that collapse to an empty string are rejected so a
 * malicious value like `"/.."` cannot escape the snapshot directory.
 */
export function graphSnapshotLabelSanitize(label: string): string {
  const trimmed = label.trim();
  if (trimmed.length === 0) {
    throw new Error('Graph snapshot label must not be empty');
  }
  const sanitized = trimmed.replace(GRAPH_SNAPSHOT_LABEL_REPLACEMENTS, '_');
  if (sanitized.length === 0 || sanitized === '.' || sanitized === '..') {
    throw new Error(`Graph snapshot label is not filesystem-safe: ${label}`);
  }
  return sanitized;
}

function graphSnapshotPayloadValidate(payload: unknown): GraphSnapshot {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Snapshot payload is not an object');
  }
  const candidate = payload as Partial<GraphSnapshot>;
  if (candidate.schemaVersion !== 1) {
    throw new Error(
      `Unsupported snapshot schema version: ${String(candidate.schemaVersion)}`,
    );
  }
  if (typeof candidate.workspaceRootId !== 'string') {
    throw new Error('Snapshot is missing workspaceRootId');
  }
  if (!Array.isArray(candidate.nodes)) throw new Error('Snapshot is missing nodes[]');
  if (!Array.isArray(candidate.edges)) throw new Error('Snapshot is missing edges[]');
  if (!Array.isArray(candidate.entryPoints)) {
    throw new Error('Snapshot is missing entryPoints[]');
  }
  if (!Array.isArray(candidate.cycles)) throw new Error('Snapshot is missing cycles[]');
  return candidate as GraphSnapshot;
}

function stringCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function edgeOrderCompare(
  a: { fromUri: string; toUri: string },
  b: { fromUri: string; toUri: string },
): number {
  const fromCmp = stringCompare(a.fromUri, b.fromUri);
  if (fromCmp !== 0) return fromCmp;
  return stringCompare(a.toUri, b.toUri);
}
