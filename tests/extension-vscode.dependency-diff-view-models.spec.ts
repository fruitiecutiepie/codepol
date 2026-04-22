import { describe, expect, it } from 'vitest';
import type { WorkspaceDependencyDiffResult } from '@codepol/core';
import { dependencyDiffPanelViewModelCreate } from '../extension-vscode/src/dependencyDiffViewModels';

function resultCreate(
  overrides: Partial<WorkspaceDependencyDiffResult> = {},
): WorkspaceDependencyDiffResult {
  return {
    workspaceId: 'workspace-1',
    baselineLabel: 'base',
    currentAnalysisGeneration: 7,
    baselineAnalysisGeneration: 3,
    addedNodes: [],
    removedNodes: [],
    addedEdges: [],
    removedEdges: [],
    newCycles: [],
    removedCycles: [],
    ...overrides,
  };
}

function nodeRelGet(uri: string): string {
  return uri.replace('file:///workspace/', '');
}

describe('dependencyDiffPanelViewModelCreate', () => {
  it('marks an empty diff as empty and renders a no-changes summary', () => {
    const view = dependencyDiffPanelViewModelCreate({
      result: resultCreate(),
      nodeWorkspaceRelativePathGet: nodeRelGet,
    });

    expect(view.isEmpty).toBe(true);
    expect(view.headline).toBe('Diff against baseline "base"');
    expect(view.summary).toBe(
      'No dependency changes against the selected baseline.',
    );
    expect(view.sections.addedNodes.rows).toEqual([]);
    expect(view.sections.newCycles.rows).toEqual([]);
  });

  it('renders section counts for a non-empty diff', () => {
    const view = dependencyDiffPanelViewModelCreate({
      result: resultCreate({
        addedNodes: [
          {
            uri: 'file:///workspace/src/new.ts',
            workspaceRelativePath: 'src/new.ts',
          },
        ],
        removedEdges: [
          {
            fromUri: 'file:///workspace/src/a.ts',
            toUri: 'file:///workspace/src/b.ts',
          },
        ],
        newCycles: [[
          'file:///workspace/src/a.ts',
          'file:///workspace/src/b.ts',
        ]],
      }),
      nodeWorkspaceRelativePathGet: nodeRelGet,
    });

    expect(view.isEmpty).toBe(false);
    expect(view.summary).toBe(
      '1 added node · 1 removed edge · 1 new cycle',
    );
    expect(view.sections.addedNodes.count).toBe(1);
    expect(view.sections.removedEdges.count).toBe(1);
    expect(view.sections.newCycles.count).toBe(1);
  });

  it('falls back to nodeWorkspaceRelativePathGet when a node has no workspaceRelativePath', () => {
    const view = dependencyDiffPanelViewModelCreate({
      result: resultCreate({
        addedNodes: [
          {
            uri: 'file:///workspace/src/fallback.ts',
            workspaceRelativePath: '',
          },
        ],
      }),
      nodeWorkspaceRelativePathGet: nodeRelGet,
    });

    expect(view.sections.addedNodes.rows).toEqual([
      {
        uri: 'file:///workspace/src/fallback.ts',
        label: 'src/fallback.ts',
      },
    ]);
  });

  it('sorts cycle member labels lexicographically inside the row detail', () => {
    const view = dependencyDiffPanelViewModelCreate({
      result: resultCreate({
        newCycles: [[
          'file:///workspace/src/c.ts',
          'file:///workspace/src/a.ts',
          'file:///workspace/src/b.ts',
        ]],
      }),
      nodeWorkspaceRelativePathGet: nodeRelGet,
    });

    expect(view.sections.newCycles.rows).toEqual([
      {
        uri: 'file:///workspace/src/a.ts',
        label: 'src/a.ts',
        detail: 'src/a.ts → src/b.ts → src/c.ts',
      },
    ]);
  });

  it('omits baselineAnalysisGeneration when the result does not carry one', () => {
    const view = dependencyDiffPanelViewModelCreate({
      result: resultCreate({
        baselineAnalysisGeneration: undefined,
      }),
      nodeWorkspaceRelativePathGet: nodeRelGet,
    });

    expect('baselineAnalysisGeneration' in view).toBe(false);
  });
});
