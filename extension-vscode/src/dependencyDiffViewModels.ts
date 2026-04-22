/**
 * @packageDocumentation
 * Pure view model for the dedicated dependency-diff panel.
 *
 * Inputs are the workspace-service `WorkspaceDependencyDiffResult` plus
 * a workspace-relative path lookup the controller already has from the
 * current dependency graph. The factory is `vscode`-free so it can be
 * unit-tested without a host.
 *
 * The panel is intentionally read-oriented: it renders six sections
 * (added / removed nodes, edges, cycles) and relies on the controller
 * for interactivity around baseline selection. Cycle rows anchor on the
 * alphabetically-first member and surface the remaining members inside
 * a concise `detail` string.
 */

import type {
  WorkspaceDependencyDiffEdge,
  WorkspaceDependencyDiffNode,
  WorkspaceDependencyDiffResult,
} from '@codepol/core';

export type DependencyDiffPanelSectionRow = {
  uri?: string;
  label: string;
  detail?: string;
};

export type DependencyDiffPanelSection = {
  title: string;
  count: number;
  rows: DependencyDiffPanelSectionRow[];
};

export type DependencyDiffPanelViewModel = {
  baselineLabel: string;
  headline: string;
  summary: string;
  currentAnalysisGeneration: number;
  baselineAnalysisGeneration?: number;
  sections: {
    addedNodes: DependencyDiffPanelSection;
    removedNodes: DependencyDiffPanelSection;
    addedEdges: DependencyDiffPanelSection;
    removedEdges: DependencyDiffPanelSection;
    newCycles: DependencyDiffPanelSection;
    removedCycles: DependencyDiffPanelSection;
  };
  isEmpty: boolean;
};

export function dependencyDiffPanelViewModelCreate(input: {
  result: WorkspaceDependencyDiffResult;
  nodeWorkspaceRelativePathGet: (uri: string) => string;
}): DependencyDiffPanelViewModel {
  const sections = {
    addedNodes: sectionFromNodesCreate(
      'Added Nodes',
      input.result.addedNodes,
      input.nodeWorkspaceRelativePathGet,
    ),
    removedNodes: sectionFromNodesCreate(
      'Removed Nodes',
      input.result.removedNodes,
      input.nodeWorkspaceRelativePathGet,
    ),
    addedEdges: sectionFromEdgesCreate(
      'Added Edges',
      input.result.addedEdges,
      input.nodeWorkspaceRelativePathGet,
    ),
    removedEdges: sectionFromEdgesCreate(
      'Removed Edges',
      input.result.removedEdges,
      input.nodeWorkspaceRelativePathGet,
    ),
    newCycles: sectionFromCyclesCreate(
      'New Cycles',
      input.result.newCycles,
      input.nodeWorkspaceRelativePathGet,
    ),
    removedCycles: sectionFromCyclesCreate(
      'Removed Cycles',
      input.result.removedCycles,
      input.nodeWorkspaceRelativePathGet,
    ),
  };

  const isEmpty =
    sections.addedNodes.count === 0 &&
    sections.removedNodes.count === 0 &&
    sections.addedEdges.count === 0 &&
    sections.removedEdges.count === 0 &&
    sections.newCycles.count === 0 &&
    sections.removedCycles.count === 0;

  const summary = summaryCreate(sections, isEmpty);

  const result: DependencyDiffPanelViewModel = {
    baselineLabel: input.result.baselineLabel ?? 'inline baseline',
    headline: `Diff against baseline "${input.result.baselineLabel ?? 'inline baseline'}"`,
    summary,
    currentAnalysisGeneration: input.result.currentAnalysisGeneration,
    sections,
    isEmpty,
  };
  if (input.result.baselineAnalysisGeneration !== undefined) {
    result.baselineAnalysisGeneration = input.result.baselineAnalysisGeneration;
  }
  return result;
}

function sectionFromNodesCreate(
  title: string,
  nodes: WorkspaceDependencyDiffNode[],
  nodeWorkspaceRelativePathGet: (uri: string) => string,
): DependencyDiffPanelSection {
  return {
    title,
    count: nodes.length,
    rows: nodes.map((node) => ({
      uri: node.uri,
      label:
        node.workspaceRelativePath.length > 0
          ? node.workspaceRelativePath
          : nodeWorkspaceRelativePathGet(node.uri),
    })),
  };
}

function sectionFromEdgesCreate(
  title: string,
  edges: WorkspaceDependencyDiffEdge[],
  nodeWorkspaceRelativePathGet: (uri: string) => string,
): DependencyDiffPanelSection {
  return {
    title,
    count: edges.length,
    rows: edges.map((edge) => {
      const fromLabel = nodeWorkspaceRelativePathGet(edge.fromUri);
      const toLabel = nodeWorkspaceRelativePathGet(edge.toUri);
      return {
        uri: edge.fromUri,
        label: `${fromLabel} → ${toLabel}`,
        detail: `${edge.fromUri} → ${edge.toUri}`,
      };
    }),
  };
}

function sectionFromCyclesCreate(
  title: string,
  cycles: string[][],
  nodeWorkspaceRelativePathGet: (uri: string) => string,
): DependencyDiffPanelSection {
  return {
    title,
    count: cycles.length,
    rows: cycles.map((cycle) => {
      const sorted = [...cycle].sort();
      const anchor = sorted[0];
      return {
        uri: anchor,
        label:
          anchor === undefined ? '(empty cycle)' : nodeWorkspaceRelativePathGet(anchor),
        detail: sorted.map((uri) => nodeWorkspaceRelativePathGet(uri)).join(' → '),
      };
    }),
  };
}

function summaryCreate(
  sections: DependencyDiffPanelViewModel['sections'],
  isEmpty: boolean,
): string {
  if (isEmpty) {
    return 'No dependency changes against the selected baseline.';
  }
  const segments: string[] = [];
  if (sections.addedNodes.count > 0) {
    segments.push(countLabelCreate(sections.addedNodes.count, 'added node'));
  }
  if (sections.removedNodes.count > 0) {
    segments.push(countLabelCreate(sections.removedNodes.count, 'removed node'));
  }
  if (sections.addedEdges.count > 0) {
    segments.push(countLabelCreate(sections.addedEdges.count, 'added edge'));
  }
  if (sections.removedEdges.count > 0) {
    segments.push(countLabelCreate(sections.removedEdges.count, 'removed edge'));
  }
  if (sections.newCycles.count > 0) {
    segments.push(countLabelCreate(sections.newCycles.count, 'new cycle'));
  }
  if (sections.removedCycles.count > 0) {
    segments.push(countLabelCreate(sections.removedCycles.count, 'removed cycle'));
  }
  return segments.join(' · ');
}

function countLabelCreate(count: number, singularPhrase: string): string {
  const pluralPhrase = singularPhrase.endsWith('y')
    ? `${singularPhrase.slice(0, -1)}ies`
    : `${singularPhrase}s`;
  return `${count} ${count === 1 ? singularPhrase : pluralPhrase}`;
}
