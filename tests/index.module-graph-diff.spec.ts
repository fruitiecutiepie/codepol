/**
 * Phase 6 unit tests for {@link moduleDependencyDiffCompute} (in
 * `packages/core/src/index/moduleGraphDiff.ts`).
 *
 * The helper is a pure function that diffs two snapshot payloads. The
 * snapshots are built directly here so the tests have no dependency on
 * tree-sitter, the workspace service, or the filesystem.
 */

import { describe, expect, it } from 'vitest';
import type { GraphSnapshot } from '@codepol/core';
import { moduleDependencyDiffCompute } from '@codepol/core';

function snapshotCreate(input: {
  nodes: Array<{ uri: string; workspaceRelativePath: string }>;
  edges?: Array<{ fromUri: string; toUri: string }>;
  cycles?: string[][];
  entryPoints?: string[];
  workspaceRootId?: string;
  analysisGeneration?: number;
}): GraphSnapshot {
  return {
    schemaVersion: 1,
    workspaceRootId: input.workspaceRootId ?? 'root-0',
    createdAtUnixMs: 0,
    ...(input.analysisGeneration !== undefined
      ? { analysisGeneration: input.analysisGeneration }
      : {}),
    nodes: input.nodes,
    edges: input.edges ?? [],
    entryPoints: input.entryPoints ?? [],
    cycles: input.cycles ?? [],
  };
}

describe('moduleDependencyDiffCompute', () => {
  it('returns empty diff lists when both snapshots are identical', () => {
    const snapshot = snapshotCreate({
      nodes: [
        { uri: 'file:///a.ts', workspaceRelativePath: 'a.ts' },
        { uri: 'file:///b.ts', workspaceRelativePath: 'b.ts' },
      ],
      edges: [{ fromUri: 'file:///a.ts', toUri: 'file:///b.ts' }],
    });
    expect(
      moduleDependencyDiffCompute({ baseline: snapshot, current: snapshot }),
    ).toEqual({
      addedNodes: [],
      removedNodes: [],
      addedEdges: [],
      removedEdges: [],
      newCycles: [],
      removedCycles: [],
    });
  });

  it('detects added and removed nodes', () => {
    const baseline = snapshotCreate({
      nodes: [
        { uri: 'file:///a.ts', workspaceRelativePath: 'a.ts' },
        { uri: 'file:///b.ts', workspaceRelativePath: 'b.ts' },
      ],
    });
    const current = snapshotCreate({
      nodes: [
        { uri: 'file:///a.ts', workspaceRelativePath: 'a.ts' },
        { uri: 'file:///c.ts', workspaceRelativePath: 'c.ts' },
        { uri: 'file:///d.ts', workspaceRelativePath: 'd.ts' },
      ],
    });
    const diff = moduleDependencyDiffCompute({ baseline, current });
    expect(diff.addedNodes).toEqual([
      { uri: 'file:///c.ts', workspaceRelativePath: 'c.ts' },
      { uri: 'file:///d.ts', workspaceRelativePath: 'd.ts' },
    ]);
    expect(diff.removedNodes).toEqual([
      { uri: 'file:///b.ts', workspaceRelativePath: 'b.ts' },
    ]);
  });

  it('detects added and removed edges deterministically', () => {
    const baseline = snapshotCreate({
      nodes: [
        { uri: 'file:///a.ts', workspaceRelativePath: 'a.ts' },
        { uri: 'file:///b.ts', workspaceRelativePath: 'b.ts' },
        { uri: 'file:///c.ts', workspaceRelativePath: 'c.ts' },
      ],
      edges: [
        { fromUri: 'file:///a.ts', toUri: 'file:///b.ts' },
        { fromUri: 'file:///a.ts', toUri: 'file:///c.ts' },
      ],
    });
    const current = snapshotCreate({
      nodes: baseline.nodes,
      edges: [
        { fromUri: 'file:///a.ts', toUri: 'file:///b.ts' },
        { fromUri: 'file:///b.ts', toUri: 'file:///c.ts' },
      ],
    });
    const diff = moduleDependencyDiffCompute({ baseline, current });
    expect(diff.addedEdges).toEqual([
      { fromUri: 'file:///b.ts', toUri: 'file:///c.ts' },
    ]);
    expect(diff.removedEdges).toEqual([
      { fromUri: 'file:///a.ts', toUri: 'file:///c.ts' },
    ]);
  });

  it('treats cycles as canonical sets so member rotation does not matter', () => {
    const baseline = snapshotCreate({
      nodes: [
        { uri: 'file:///a.ts', workspaceRelativePath: 'a.ts' },
        { uri: 'file:///b.ts', workspaceRelativePath: 'b.ts' },
        { uri: 'file:///c.ts', workspaceRelativePath: 'c.ts' },
      ],
      cycles: [['file:///a.ts', 'file:///b.ts', 'file:///c.ts']],
    });
    const current = snapshotCreate({
      nodes: baseline.nodes,
      // Same cycle members, different rotation.
      cycles: [['file:///c.ts', 'file:///a.ts', 'file:///b.ts']],
    });
    const diff = moduleDependencyDiffCompute({ baseline, current });
    expect(diff.newCycles).toEqual([]);
    expect(diff.removedCycles).toEqual([]);
  });

  it('reports brand-new cycles in newCycles and gone cycles in removedCycles', () => {
    const baseline = snapshotCreate({
      nodes: [
        { uri: 'file:///a.ts', workspaceRelativePath: 'a.ts' },
        { uri: 'file:///b.ts', workspaceRelativePath: 'b.ts' },
        { uri: 'file:///c.ts', workspaceRelativePath: 'c.ts' },
      ],
      cycles: [['file:///a.ts', 'file:///b.ts']],
    });
    const current = snapshotCreate({
      nodes: baseline.nodes,
      cycles: [['file:///b.ts', 'file:///c.ts']],
    });
    const diff = moduleDependencyDiffCompute({ baseline, current });
    expect(diff.newCycles).toEqual([['file:///b.ts', 'file:///c.ts']]);
    expect(diff.removedCycles).toEqual([['file:///a.ts', 'file:///b.ts']]);
  });

  it('preserves the workspaceRelativePath from the surviving snapshot', () => {
    // Removed node only exists in baseline; the diff should still know
    // its path so a CLI/text renderer can show it.
    const baseline = snapshotCreate({
      nodes: [
        { uri: 'file:///old.ts', workspaceRelativePath: 'pkg/old.ts' },
      ],
    });
    const current = snapshotCreate({ nodes: [] });
    const diff = moduleDependencyDiffCompute({ baseline, current });
    expect(diff.removedNodes).toEqual([
      { uri: 'file:///old.ts', workspaceRelativePath: 'pkg/old.ts' },
    ]);
  });

  it('sorts every diff array deterministically across runs', () => {
    // Mix everything and assert the output is sorted.
    const baseline = snapshotCreate({
      nodes: [
        { uri: 'file:///z.ts', workspaceRelativePath: 'z.ts' },
        { uri: 'file:///y.ts', workspaceRelativePath: 'y.ts' },
      ],
      edges: [
        { fromUri: 'file:///z.ts', toUri: 'file:///y.ts' },
      ],
      cycles: [['file:///y.ts', 'file:///z.ts']],
    });
    const current = snapshotCreate({
      nodes: [
        { uri: 'file:///b.ts', workspaceRelativePath: 'b.ts' },
        { uri: 'file:///a.ts', workspaceRelativePath: 'a.ts' },
      ],
      edges: [
        { fromUri: 'file:///b.ts', toUri: 'file:///a.ts' },
        { fromUri: 'file:///a.ts', toUri: 'file:///b.ts' },
      ],
      cycles: [
        ['file:///a.ts', 'file:///b.ts'],
        ['file:///b.ts', 'file:///a.ts'],
      ],
    });
    const diff = moduleDependencyDiffCompute({ baseline, current });
    expect(diff.addedNodes.map((node) => node.uri)).toEqual([
      'file:///a.ts',
      'file:///b.ts',
    ]);
    expect(diff.removedNodes.map((node) => node.uri)).toEqual([
      'file:///y.ts',
      'file:///z.ts',
    ]);
    expect(diff.addedEdges).toEqual([
      { fromUri: 'file:///a.ts', toUri: 'file:///b.ts' },
      { fromUri: 'file:///b.ts', toUri: 'file:///a.ts' },
    ]);
    expect(diff.removedEdges).toEqual([
      { fromUri: 'file:///z.ts', toUri: 'file:///y.ts' },
    ]);
    // Both current cycles are the same canonical {a, b} cycle —
    // duplicates should collapse.
    expect(diff.newCycles).toEqual([['file:///a.ts', 'file:///b.ts']]);
    expect(diff.removedCycles).toEqual([['file:///y.ts', 'file:///z.ts']]);
  });
});
