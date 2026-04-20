import { describe, expect, it } from 'vitest';
import type { WorkspaceDependencyPathResult } from '@codepol/core';
import {
  dependencyPathPanelViewModelCreate,
  type DependencyPathPanelMaxPaths,
} from '../extension-vscode/src/dependencyPathViewModels';

const FROM_URI = 'file:///workspace/src/app.ts';
const TO_URI = 'file:///workspace/src/leaf.ts';
const FROM_REL = 'src/app.ts';
const TO_REL = 'src/leaf.ts';

function nodeRelGet(uri: string): string {
  return uri.replace('file:///workspace/', '');
}

function viewModelBuild(input: {
  result: WorkspaceDependencyPathResult;
  maxPaths?: DependencyPathPanelMaxPaths;
  fromUri?: string;
  toUri?: string;
  fromRel?: string;
  toRel?: string;
}) {
  return dependencyPathPanelViewModelCreate({
    result: input.result,
    fromUri: input.fromUri ?? FROM_URI,
    toUri: input.toUri ?? TO_URI,
    fromWorkspaceRelativePath: input.fromRel ?? FROM_REL,
    toWorkspaceRelativePath: input.toRel ?? TO_REL,
    nodeWorkspaceRelativePathGet: nodeRelGet,
    maxPaths: input.maxPaths ?? 5,
  });
}

describe('dependencyPathPanelViewModelCreate', () => {
  it('returns "No path" when the workspace service reports no path', () => {
    const view = viewModelBuild({
      result: { paths: [], shortestLength: 0, truncated: false },
    });

    expect(view.headline).toBe('No path');
    expect(view.paths).toEqual([]);
    expect(view.summary).toBe('No paths found');
    expect(view.truncated).toBe(false);
  });

  it('renders a single shortest path of 3 hops', () => {
    const view = viewModelBuild({
      result: {
        paths: [
          [FROM_URI, 'file:///workspace/src/b.ts', 'file:///workspace/src/c.ts', TO_URI],
        ],
        shortestLength: 3,
        truncated: false,
      },
    });

    expect(view.headline).toBe('Shortest path: 3 hops');
    expect(view.paths).toHaveLength(1);
    expect(view.paths[0]?.hops).toBe(3);
    expect(view.paths[0]?.nodes).toHaveLength(4);
    expect(view.paths[0]?.nodes.map((n) => n.workspaceRelativePath)).toEqual([
      'src/app.ts',
      'src/b.ts',
      'src/c.ts',
      'src/leaf.ts',
    ]);
    expect(view.summary).toBe('1 path shown');
    expect(view.shortestLength).toBe(3);
  });

  it('flags truncation in the summary when result.truncated is true at maxPaths', () => {
    const view = viewModelBuild({
      result: {
        paths: Array.from({ length: 5 }, (_, index) => [
          FROM_URI,
          `file:///workspace/src/middle-${index}.ts`,
          TO_URI,
        ]),
        shortestLength: 2,
        truncated: true,
      },
      maxPaths: 5,
    });

    expect(view.truncated).toBe(true);
    expect(view.paths).toHaveLength(5);
    expect(view.summary).toMatch(/more available$/);
    expect(view.summary).toBe('5 of 5+ paths shown · more available');
  });

  it('returns a single zero-hop entry when from === to', () => {
    const view = viewModelBuild({
      result: {
        paths: [[FROM_URI]],
        shortestLength: 0,
        truncated: false,
      },
      toUri: FROM_URI,
      toRel: FROM_REL,
    });

    expect(view.headline).toBe('Same file — no traversal');
    expect(view.paths).toHaveLength(1);
    expect(view.paths[0]?.hops).toBe(0);
    expect(view.paths[0]?.nodes).toEqual([
      { uri: FROM_URI, workspaceRelativePath: FROM_REL },
    ]);
  });

  it('marks only the chip whose value matches maxPaths as active', () => {
    const view = viewModelBuild({
      result: { paths: [], shortestLength: 0, truncated: false },
      maxPaths: 10,
    });

    expect(view.chips.map((chip) => chip.id)).toEqual(['5', '10', '20']);
    expect(view.chips.find((chip) => chip.id === '10')?.active).toBe(true);
    expect(view.chips.filter((chip) => chip.active)).toHaveLength(1);
  });
});
