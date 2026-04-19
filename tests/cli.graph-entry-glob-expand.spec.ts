/**
 * Pure-function tests for `--entry` glob expansion shared by
 * `codepol graph dead`.
 *
 * Glob expansion only consults the workspace dependency graph (never
 * the filesystem) so that the entry set always agrees with the indexed
 * file set; these tests lock in that contract along with the typo
 * warning channel surfaced via `unmatched`.
 */
import { describe, expect, it } from 'vitest';
import type { WorkspaceDependencyGraphNode } from '@codepol/core';
import {
  graphEntryGlobIs,
  graphEntryUrisExpand,
} from '../apps/cli/src/graph/graphEntryGlobExpand';

function nodesFixtureCreate(): WorkspaceDependencyGraphNode[] {
  return [
    { uri: 'file:///root/bin/cli.ts', workspaceRelativePath: 'bin/cli.ts' },
    {
      uri: 'file:///root/bin/server.ts',
      workspaceRelativePath: 'bin/server.ts',
    },
    { uri: 'file:///root/src/lib.ts', workspaceRelativePath: 'src/lib.ts' },
    { uri: 'file:///root/src/util.ts', workspaceRelativePath: 'src/util.ts' },
    {
      uri: 'file:///root/src/orphan.ts',
      workspaceRelativePath: 'src/orphan.ts',
    },
  ];
}

describe('graphEntryGlobIs', () => {
  it('flags glob meta characters', () => {
    expect(graphEntryGlobIs('bin/**')).toBe(true);
    expect(graphEntryGlobIs('src/{a,b}.ts')).toBe(true);
    expect(graphEntryGlobIs('src/[ab].ts')).toBe(true);
    expect(graphEntryGlobIs('src/a?.ts')).toBe(true);
  });

  it('treats plain paths as literals', () => {
    expect(graphEntryGlobIs('src/index.ts')).toBe(false);
    expect(graphEntryGlobIs('/abs/path/file.ts')).toBe(false);
  });
});

describe('graphEntryUrisExpand', () => {
  const cwd = '/root';

  it('keeps literal paths as URIs without consulting the graph', () => {
    const result = graphEntryUrisExpand({
      cwd,
      entries: ['src/index.ts'],
      nodes: [],
    });
    expect(result.uris).toEqual(['file:///root/src/index.ts']);
    expect(result.unmatched).toEqual([]);
  });

  it('expands a directory glob to every matching node URI', () => {
    const nodes = nodesFixtureCreate();
    const result = graphEntryUrisExpand({
      cwd,
      entries: ['bin/**'],
      nodes,
    });
    expect(result.uris).toEqual([
      'file:///root/bin/cli.ts',
      'file:///root/bin/server.ts',
    ]);
    expect(result.unmatched).toEqual([]);
  });

  it('deduplicates across literals and globs and sorts the URI list', () => {
    const nodes = nodesFixtureCreate();
    const result = graphEntryUrisExpand({
      cwd,
      entries: ['bin/**', 'bin/cli.ts', 'src/lib.ts'],
      nodes,
    });
    expect(result.uris).toEqual([
      'file:///root/bin/cli.ts',
      'file:///root/bin/server.ts',
      'file:///root/src/lib.ts',
    ]);
  });

  it('reports globs that match nothing without dropping the rest', () => {
    const nodes = nodesFixtureCreate();
    const result = graphEntryUrisExpand({
      cwd,
      entries: ['typo-dir/**', 'src/lib.ts', 'bin/**'],
      nodes,
    });
    expect(result.unmatched).toEqual(['typo-dir/**']);
    expect(result.uris).toEqual([
      'file:///root/bin/cli.ts',
      'file:///root/bin/server.ts',
      'file:///root/src/lib.ts',
    ]);
  });

  it('expands brace alternation patterns (minimatch contract)', () => {
    const nodes = nodesFixtureCreate();
    const result = graphEntryUrisExpand({
      cwd,
      entries: ['src/{lib,util}.ts'],
      nodes,
    });
    expect(result.uris).toEqual([
      'file:///root/src/lib.ts',
      'file:///root/src/util.ts',
    ]);
    expect(result.unmatched).toEqual([]);
  });

  it('expands character-class patterns (minimatch contract)', () => {
    const result = graphEntryUrisExpand({
      cwd,
      entries: ['bin/[cs]*.ts'],
      nodes: nodesFixtureCreate(),
    });
    expect(result.uris).toEqual([
      'file:///root/bin/cli.ts',
      'file:///root/bin/server.ts',
    ]);
  });

  it('keeps absolute-path literals as-is without consulting the graph', () => {
    const result = graphEntryUrisExpand({
      cwd,
      entries: ['/abs/path/standalone.ts'],
      nodes: nodesFixtureCreate(),
    });
    expect(result.uris).toEqual(['file:///abs/path/standalone.ts']);
    expect(result.unmatched).toEqual([]);
  });
});
