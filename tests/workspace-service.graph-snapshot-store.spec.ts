/**
 * Phase 6 unit tests for the file-system graph snapshot store.
 *
 * Covers:
 *
 * - write/read round-trip preserves payload fields
 * - missing labels return `undefined` (not throw)
 * - listing returns labels in sorted order, ignoring stray files
 * - delete removes the file and reports whether anything was removed
 * - label sanitization rejects empty / unsafe input and replaces unsafe
 *   characters with underscores
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  fileSystemGraphSnapshotStoreCreate,
  graphSnapshotFromDependencyGraphResult,
  graphSnapshotLabelSanitize,
  graphSnapshotWorkspaceRootIdCompute,
} from '@codepol/workspace-service';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempRootCreate(prefix: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

describe('fileSystemGraphSnapshotStoreCreate', () => {
  it('round-trips a snapshot through write then read', async () => {
    const root = tempRootCreate('codepol-snapshot-roundtrip-');
    const store = fileSystemGraphSnapshotStoreCreate({ rootPath: root });
    const snapshot = graphSnapshotFromDependencyGraphResult({
      graph: {
        nodes: [
          {
            uri: 'file:///foo.ts',
            workspaceRelativePath: 'foo.ts',
          },
        ],
        edges: [],
        entryPoints: ['file:///foo.ts'],
        cycles: [],
      },
      workspaceRootId: graphSnapshotWorkspaceRootIdCompute(root),
      label: 'base',
      analysisGeneration: 7,
    });
    await store.graphSnapshotWrite({ label: 'base', snapshot });

    const read = await store.graphSnapshotRead({ label: 'base' });
    expect(read).toEqual(snapshot);
  });

  it('returns undefined when no snapshot has ever been written under a label', async () => {
    const root = tempRootCreate('codepol-snapshot-missing-');
    const store = fileSystemGraphSnapshotStoreCreate({ rootPath: root });
    expect(await store.graphSnapshotRead({ label: 'never-written' })).toBeUndefined();
  });

  it('lists labels in sorted order, ignoring non-snapshot files', async () => {
    const root = tempRootCreate('codepol-snapshot-list-');
    const store = fileSystemGraphSnapshotStoreCreate({ rootPath: root });
    const snapshot = graphSnapshotFromDependencyGraphResult({
      graph: { nodes: [], edges: [], entryPoints: [], cycles: [] },
      workspaceRootId: 'root',
    });
    await store.graphSnapshotWrite({ label: 'zeta', snapshot });
    await store.graphSnapshotWrite({ label: 'alpha', snapshot });
    await store.graphSnapshotWrite({ label: 'mid', snapshot });

    // Drop a stray file the store should ignore.
    const snapshotDir = path.join(root, '.codepol', 'graph-snapshots');
    fs.writeFileSync(path.join(snapshotDir, 'README.md'), 'not a snapshot', 'utf8');

    expect(await store.graphSnapshotLabelsList()).toEqual(['alpha', 'mid', 'zeta']);
  });

  it('delete reports true when something was removed and false otherwise', async () => {
    const root = tempRootCreate('codepol-snapshot-delete-');
    const store = fileSystemGraphSnapshotStoreCreate({ rootPath: root });
    const snapshot = graphSnapshotFromDependencyGraphResult({
      graph: { nodes: [], edges: [], entryPoints: [], cycles: [] },
      workspaceRootId: 'root',
    });
    await store.graphSnapshotWrite({ label: 'pr-42', snapshot });
    expect(await store.graphSnapshotDelete({ label: 'pr-42' })).toBe(true);
    expect(await store.graphSnapshotDelete({ label: 'pr-42' })).toBe(false);
  });

  it('rejects empty labels', () => {
    expect(() => graphSnapshotLabelSanitize('')).toThrow(/must not be empty/i);
    expect(() => graphSnapshotLabelSanitize('   ')).toThrow(/must not be empty/i);
  });

  it('rejects unsafe traversal-only labels', () => {
    expect(() => graphSnapshotLabelSanitize('..')).toThrow(/not filesystem-safe/);
  });

  it('replaces filesystem-unsafe characters with underscores', () => {
    expect(graphSnapshotLabelSanitize('feature/awesome-thing')).toBe(
      'feature_awesome-thing',
    );
    expect(graphSnapshotLabelSanitize('release v1.2.3')).toBe('release_v1.2.3');
  });
});

describe('graphSnapshotFromDependencyGraphResult', () => {
  it('produces deterministically sorted nodes / edges / cycles', () => {
    const snapshot = graphSnapshotFromDependencyGraphResult({
      graph: {
        nodes: [
          { uri: 'file:///z.ts', workspaceRelativePath: 'z.ts' },
          { uri: 'file:///a.ts', workspaceRelativePath: 'a.ts' },
        ],
        edges: [
          { fromUri: 'file:///z.ts', toUri: 'file:///a.ts' },
          { fromUri: 'file:///a.ts', toUri: 'file:///z.ts' },
        ],
        entryPoints: ['file:///z.ts', 'file:///a.ts'],
        cycles: [['file:///z.ts', 'file:///a.ts']],
      },
      workspaceRootId: 'root',
    });
    expect(snapshot.nodes.map((n) => n.uri)).toEqual([
      'file:///a.ts',
      'file:///z.ts',
    ]);
    expect(snapshot.edges).toEqual([
      { fromUri: 'file:///a.ts', toUri: 'file:///z.ts' },
      { fromUri: 'file:///z.ts', toUri: 'file:///a.ts' },
    ]);
    expect(snapshot.entryPoints).toEqual(['file:///a.ts', 'file:///z.ts']);
    expect(snapshot.cycles).toEqual([['file:///a.ts', 'file:///z.ts']]);
  });
});
