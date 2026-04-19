import type {
  WorkspaceArchitectureSummaryResult,
  WorkspaceDependencyGraphResult,
} from '@codepol/core';

export type ArchitectureCodeLensCommandKind = 'peekArchitecture';

export type ArchitectureCodeLensViewModel = {
  title: string;
  tooltip: string;
  commandKind: ArchitectureCodeLensCommandKind;
  commandArgument: { uri: string };
  importerCount: number;
  importeeCount: number;
  /**
   * Phase 8 instability value (`Ce / (Ca + Ce)`) when the focus file
   * appears in `summary.instability`. Omitted otherwise so the lens
   * stays visually identical to the legacy importer/importee-only
   * variant when no summary is available.
   */
  instabilityValue?: number;
  /**
   * Phase 8 aggregate cyclomatic complexity when the focus file appears
   * in `summary.complexityHotspots`. Omitted otherwise.
   */
  aggregateCyclomaticComplexity?: number;
};

function pluralLabelCreate(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function architectureCodeLensViewModelCreate(input: {
  graph: WorkspaceDependencyGraphResult;
  focusUri: string;
  /**
   * Optional Phase 8 summary used to enrich the lens title with the
   * focus file's instability and aggregate cyclomatic complexity.
   * `null` (the value the workspace service returns when no summary is
   * yet available) is treated the same as omission.
   */
  summary?: WorkspaceArchitectureSummaryResult | null;
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

  const summary = input.summary ?? undefined;
  const instabilityEntry = summary?.instability?.find(
    (entry) => entry.uri === focusUri,
  );
  const complexityEntry = summary?.complexityHotspots?.find(
    (entry) => entry.uri === focusUri,
  );

  const baseTitle = `Codepol: ${pluralLabelCreate(importerCount, 'importer', 'importers')} • ${pluralLabelCreate(importeeCount, 'importee', 'importees')}`;
  const phase8Suffix = architectureCodeLensPhase8SuffixCreate({
    instabilityValue: instabilityEntry?.value,
    aggregateCyclomaticComplexity: complexityEntry?.aggregateCyclomaticComplexity,
  });
  const title = phase8Suffix === '' ? baseTitle : `${baseTitle} • ${phase8Suffix}`;

  const result: ArchitectureCodeLensViewModel = {
    title,
    tooltip: `Peek Codepol architecture for ${focusNode.workspaceRelativePath}`,
    commandKind: 'peekArchitecture',
    commandArgument: { uri: focusUri },
    importerCount,
    importeeCount,
  };
  if (instabilityEntry) {
    result.instabilityValue = instabilityEntry.value;
  }
  if (complexityEntry) {
    result.aggregateCyclomaticComplexity =
      complexityEntry.aggregateCyclomaticComplexity;
  }
  return result;
}

/**
 * Pure formatter: append `I=0.86` and/or `complexity 14` to the lens
 * title when those fields are populated. Returns the empty string when
 * neither value applies, so the caller can decide whether to add a
 * separator.
 */
function architectureCodeLensPhase8SuffixCreate(input: {
  instabilityValue?: number;
  aggregateCyclomaticComplexity?: number;
}): string {
  const segments: string[] = [];
  if (input.instabilityValue !== undefined) {
    segments.push(`I=${input.instabilityValue.toFixed(2)}`);
  }
  if (input.aggregateCyclomaticComplexity !== undefined) {
    segments.push(`complexity ${input.aggregateCyclomaticComplexity}`);
  }
  return segments.join(' • ');
}
