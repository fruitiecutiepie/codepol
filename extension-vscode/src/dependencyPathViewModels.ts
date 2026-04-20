/**
 * @packageDocumentation
 * Pure view model for the dedicated dependency-path panel.
 *
 * Inputs are the workspace-service `WorkspaceDependencyPathResult` plus
 * the workspace-relative path lookup the controller already has from
 * `queryDependencyGraph`. The factory is `vscode`-free so it can be
 * unit-tested without a host.
 *
 * Output shape mirrors the call-graph / type-hierarchy panels: a header
 * line, a chip row for the only knob (`maxPaths`), and a sorted list of
 * simple paths whose nodes carry `uri` so the panel manager's existing
 * `openLocation` postMessage handler can route clicks to the editor.
 */

import type { WorkspaceDependencyPathResult } from '@codepol/core';

/**
 * Allowed `maxPaths` values exposed as chips in the panel. Chosen to
 * cover the most useful slices: "first few", "deeper investigation",
 * and "everything within the workspace-service cap".
 */
export type DependencyPathPanelMaxPaths = 5 | 10 | 20;

export const DEPENDENCY_PATH_PANEL_MAX_PATHS_VALUES: readonly DependencyPathPanelMaxPaths[] = [
  5,
  10,
  20,
];

export type DependencyPathPanelNode = {
  uri: string;
  workspaceRelativePath: string;
};

export type DependencyPathPanelPath = {
  /** Length === hops + 1. First entry is `fromUri`, last entry is `toUri`. */
  nodes: DependencyPathPanelNode[];
  /** Number of edges in the path (`nodes.length - 1`). */
  hops: number;
};

export type DependencyPathPanelChip = {
  id: string;
  label: string;
  active: boolean;
};

export type DependencyPathPanelViewModel = {
  fromUri: string;
  toUri: string;
  fromWorkspaceRelativePath: string;
  toWorkspaceRelativePath: string;
  /** "Shortest path: 3 hops" | "Same file — no traversal" | "No path". */
  headline: string;
  /** "5 of 12 paths shown · more available" | "5 paths shown" | "No paths found". */
  summary: string;
  maxPaths: DependencyPathPanelMaxPaths;
  /** Mirrors `result.truncated`. */
  truncated: boolean;
  /** Mirrors `result.shortestLength`. Useful for tests. */
  shortestLength: number;
  /** Sorted (length asc, then per-node lexicographic). */
  paths: DependencyPathPanelPath[];
  chips: DependencyPathPanelChip[];
};

export type DependencyPathPanelViewModelInput = {
  result: WorkspaceDependencyPathResult;
  fromUri: string;
  toUri: string;
  fromWorkspaceRelativePath: string;
  toWorkspaceRelativePath: string;
  /**
   * Resolved by the controller from `queryDependencyGraph().nodes`. When
   * a path node is not in the graph (defensive case) the helper falls
   * back to the URI itself so rendering never blows up.
   */
  nodeWorkspaceRelativePathGet: (uri: string) => string;
  maxPaths: DependencyPathPanelMaxPaths;
};

export function dependencyPathPanelViewModelCreate(
  input: DependencyPathPanelViewModelInput,
): DependencyPathPanelViewModel {
  const chips: DependencyPathPanelChip[] = DEPENDENCY_PATH_PANEL_MAX_PATHS_VALUES.map(
    (value) => ({
      id: String(value),
      label: String(value),
      active: value === input.maxPaths,
    }),
  );

  const paths: DependencyPathPanelPath[] = input.result.paths.map((uris) => ({
    nodes: uris.map((uri) => ({
      uri,
      workspaceRelativePath: input.nodeWorkspaceRelativePathGet(uri),
    })),
    hops: Math.max(0, uris.length - 1),
  }));

  const headline = headlineResolve(input.fromUri, input.toUri, paths, input.result.shortestLength);
  const summary = summaryResolve({
    paths,
    truncated: input.result.truncated,
    maxPaths: input.maxPaths,
  });

  return {
    fromUri: input.fromUri,
    toUri: input.toUri,
    fromWorkspaceRelativePath: input.fromWorkspaceRelativePath,
    toWorkspaceRelativePath: input.toWorkspaceRelativePath,
    headline,
    summary,
    maxPaths: input.maxPaths,
    truncated: input.result.truncated,
    shortestLength: input.result.shortestLength,
    paths,
    chips,
  };
}

function headlineResolve(
  fromUri: string,
  toUri: string,
  paths: DependencyPathPanelPath[],
  shortestLength: number,
): string {
  if (fromUri === toUri && shortestLength === 0) {
    return 'Same file — no traversal';
  }
  if (paths.length === 0) {
    return 'No path';
  }
  const hops = shortestLength;
  const label = hops === 1 ? 'hop' : 'hops';
  return `Shortest path: ${hops} ${label}`;
}

function summaryResolve(input: {
  paths: DependencyPathPanelPath[];
  truncated: boolean;
  maxPaths: DependencyPathPanelMaxPaths;
}): string {
  const shown = input.paths.length;
  if (shown === 0) {
    return 'No paths found';
  }
  if (input.truncated) {
    return `${shown} of ${input.maxPaths}+ paths shown · more available`;
  }
  const label = shown === 1 ? 'path' : 'paths';
  return `${shown} ${label} shown`;
}
