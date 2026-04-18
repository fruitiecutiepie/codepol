import type { WorkspaceDependencyGraphResult } from '@codepol/core';

export type ArchitectureCodeLensCommandKind = 'peekArchitecture';

export type ArchitectureCodeLensViewModel = {
  title: string;
  tooltip: string;
  commandKind: ArchitectureCodeLensCommandKind;
  commandArgument: { uri: string };
  importerCount: number;
  importeeCount: number;
};

function pluralLabelCreate(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function architectureCodeLensViewModelCreate(input: {
  graph: WorkspaceDependencyGraphResult;
  focusUri: string;
}): ArchitectureCodeLensViewModel | null {
  const focusUri = input.focusUri;
  const focusNode = input.graph.nodes.find((node) => node.uri === focusUri);
  if (!focusNode) {
    return null;
  }

  const importerCount = input.graph.edges.reduce(
    (count, edge) => (edge.toUri === focusUri ? count + 1 : count),
    0,
  );
  const importeeCount = input.graph.edges.reduce(
    (count, edge) => (edge.fromUri === focusUri ? count + 1 : count),
    0,
  );

  const title = `Codepol: ${pluralLabelCreate(importerCount, 'importer', 'importers')} • ${pluralLabelCreate(importeeCount, 'importee', 'importees')}`;

  return {
    title,
    tooltip: `Peek Codepol architecture for ${focusNode.workspaceRelativePath}`,
    commandKind: 'peekArchitecture',
    commandArgument: { uri: focusUri },
    importerCount,
    importeeCount,
  };
}
