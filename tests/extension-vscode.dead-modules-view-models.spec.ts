import { describe, expect, it } from 'vitest';
import type { WorkspaceDeadModulesResult } from '@codepol/core';
import { deadModulesPanelViewModelCreate } from '../extension-vscode/src/deadModulesViewModels';

function nodeRelGet(uri: string): string {
  return uri.replace('file:///workspace/', '');
}

function viewModelBuild(input: {
  result: WorkspaceDeadModulesResult;
  entryPointUris?: string[];
}) {
  return deadModulesPanelViewModelCreate({
    result: input.result,
    entryPointUris: input.entryPointUris,
    nodeWorkspaceRelativePathGet: nodeRelGet,
  });
}

describe('deadModulesPanelViewModelCreate', () => {
  it('returns "0 unreachable files" with no groups when the result is empty', () => {
    const view = viewModelBuild({
      result: { unreachable: [] },
    });

    expect(view.headline).toBe('0 unreachable files');
    expect(view.groups).toEqual([]);
    expect(view.totalUnreachable).toBe(0);
  });

  it('groups files by directory and sorts both groups and files lexicographically', () => {
    const view = viewModelBuild({
      result: {
        unreachable: [
          'file:///workspace/src/foo/c.ts',
          'file:///workspace/src/bar/x.ts',
          'file:///workspace/src/foo/a.ts',
          'file:///workspace/src/foo/b.ts',
        ],
      },
    });

    expect(view.headline).toBe('4 unreachable files in 2 directories');
    expect(view.groups.map((g) => g.directoryWorkspaceRelativePath)).toEqual([
      'src/bar',
      'src/foo',
    ]);
    const fooGroup = view.groups.find(
      (g) => g.directoryWorkspaceRelativePath === 'src/foo',
    );
    expect(fooGroup?.files.map((f) => f.basename)).toEqual([
      'a.ts',
      'b.ts',
      'c.ts',
    ]);
    const barGroup = view.groups.find(
      (g) => g.directoryWorkspaceRelativePath === 'src/bar',
    );
    expect(barGroup?.files).toHaveLength(1);
    expect(barGroup?.files[0]).toEqual({
      uri: 'file:///workspace/src/bar/x.ts',
      workspaceRelativePath: 'src/bar/x.ts',
      basename: 'x.ts',
    });
  });

  it('reports "Entry points: natural" when the caller supplies no entry points', () => {
    const view = viewModelBuild({
      result: { unreachable: ['file:///workspace/orphan.ts'] },
    });

    expect(view.summary).toBe('Entry points: natural');
    expect(view.entryPointUris).toEqual([]);
    expect(view.entryPointLabels).toEqual([]);
  });

  it('lists caller-supplied entry points (deduped, in input order) in the summary', () => {
    const view = viewModelBuild({
      result: { unreachable: [] },
      entryPointUris: [
        'file:///workspace/src/index.ts',
        'file:///workspace/scripts/main.ts',
        'file:///workspace/src/index.ts',
      ],
    });

    expect(view.entryPointUris).toEqual([
      'file:///workspace/src/index.ts',
      'file:///workspace/scripts/main.ts',
    ]);
    expect(view.entryPointLabels).toEqual([
      'src/index.ts',
      'scripts/main.ts',
    ]);
    expect(view.summary).toBe(
      'Entry points: src/index.ts, scripts/main.ts',
    );
  });

  it('keeps workspace-root files in a synthetic group with directory ""', () => {
    const view = viewModelBuild({
      result: {
        unreachable: [
          'file:///workspace/orphan.ts',
          'file:///workspace/src/util.ts',
        ],
      },
    });

    expect(view.groups.map((g) => g.directoryWorkspaceRelativePath)).toEqual([
      '',
      'src',
    ]);
    const rootGroup = view.groups[0];
    expect(rootGroup?.files).toEqual([
      {
        uri: 'file:///workspace/orphan.ts',
        workspaceRelativePath: 'orphan.ts',
        basename: 'orphan.ts',
      },
    ]);
  });
});
