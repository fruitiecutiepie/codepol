import * as path from 'node:path';
import type {
  WorkspaceArchitectureSummaryResult,
  WorkspaceDependencyGraphResult,
  WorkspacePrepareRenameResult,
  WorkspaceRenamePreviewResult,
  WorkspaceSemanticDefinitionResult,
  WorkspaceSemanticHoverAction,
  WorkspaceSemanticHoverResult,
  WorkspaceSemanticReferencesResult,
} from '@codepol/core';
import type { RenameTargetCandidate } from './discovery';

export type PanelLocationViewModel = {
  uri: string;
  label: string;
  detail?: string;
  line: number;
  character: number;
};

export type HoverActionViewModel = {
  action: WorkspaceSemanticHoverAction;
  label: string;
};

export type HoverCardViewModel = {
  title: string;
  subtitle?: string;
  summary?: string;
  statusText?: string;
  fields: Array<{ label: string; value: string }>;
  actions: HoverActionViewModel[];
};

export type SemanticDefinitionPanelViewModel = {
  uri: string;
  hoverCard: HoverCardViewModel | null;
  locations: PanelLocationViewModel[];
};

export type WorkspaceSummaryMetricViewModel = {
  label: string;
  value: string;
};

export type WorkspaceSummaryHotspotViewModel = PanelLocationViewModel & {
  importerCount: number;
  importeeCount: number;
};

export type WorkspaceSummaryCardViewModel = {
  summary: string;
  metrics: WorkspaceSummaryMetricViewModel[];
  hotspots: WorkspaceSummaryHotspotViewModel[];
};

export type DependencyGraphNodeViewModel = {
  uri: string;
  label: string;
  detail: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isFocus: boolean;
  isEntryPoint: boolean;
  isCycleMember: boolean;
};

export type DependencyGraphEdgeViewModel = {
  id: string;
  fromUri: string;
  toUri: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  isFocus: boolean;
};

export type DependencyGraphCanvasViewModel = {
  mode: 'workspace' | 'focus';
  focusUri?: string;
  width: number;
  height: number;
  nodes: DependencyGraphNodeViewModel[];
  edges: DependencyGraphEdgeViewModel[];
  emptyMessage: string;
};

export type ArchitectureSummaryPanelViewModel = {
  summaryCard: WorkspaceSummaryCardViewModel | null;
};

export type SemanticReferencesPanelGroupViewModel = {
  group: string;
  totalCount: number;
  truncated: boolean;
  items: PanelLocationViewModel[];
};

export type DependencyGraphPanelViewModel = {
  focusUri?: string;
  summaryCard: WorkspaceSummaryCardViewModel | null;
  graph: DependencyGraphCanvasViewModel;
};

export type ArchitectureLinksPanelViewModel = {
  uri: string;
  hoverCard: HoverCardViewModel | null;
  workspaceSummaryCard: WorkspaceSummaryCardViewModel | null;
  graph: DependencyGraphCanvasViewModel;
  totalItems: number;
  totalAvailableItems: number;
  truncated: boolean;
  groups: SemanticReferencesPanelGroupViewModel[];
};

export type RenamePreviewPanelGroupViewModel = {
  title: string;
  edits: Array<{
    uri: string;
    line: number;
    character: number;
    oldText: string;
    newText: string;
    kind: string;
  }>;
};

export type RenamePreviewPanelViewModel = {
  targetLabel: string;
  prepareMessage?: string;
  currentName?: string;
  namespaceId?: string;
  impactedSiteCount?: number;
  namingRules: string[];
  previewMessage?: string;
  oldName?: string;
  newName?: string;
  groups: RenamePreviewPanelGroupViewModel[];
  warnings: string[];
  blockingIssues: string[];
  canApply: boolean;
  planId?: string;
  applyMessage?: string;
};

function hoverActionLabelResolve(action: WorkspaceSemanticHoverAction): string {
  switch (action) {
    case 'go_to_definition':
      return 'Go To Definition';
    case 'find_references':
      return 'Show Architecture Links';
    case 'show_graph':
      return 'Show Graph';
  }
}

export function semanticHoverCardViewModelCreate(
  hover: WorkspaceSemanticHoverResult | null,
): HoverCardViewModel | null {
  if (!hover) {
    return null;
  }

  return {
    title: hover.title,
    subtitle: hover.subtitle,
    summary: hover.summary,
    statusText: hover.statusText,
    fields: hover.fields.map((field) => ({
      label: field.label,
      value: field.value,
    })),
    actions: (hover.actions ?? []).map((action) => ({
      action,
      label: hoverActionLabelResolve(action),
    })),
  };
}

function locationViewModelCreate(input: {
  uri: string;
  line: number;
  character: number;
  label: string;
  detail?: string;
}): PanelLocationViewModel {
  return {
    uri: input.uri,
    line: input.line,
    character: input.character,
    label: input.label,
    detail: input.detail,
  };
}

function countLabelCreate(value: number, singular: string, plural: string): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

export function workspaceSummaryCardViewModelCreate(
  summary: WorkspaceArchitectureSummaryResult | null,
): WorkspaceSummaryCardViewModel | null {
  if (!summary) {
    return null;
  }

  return {
    summary: summary.summary,
    metrics: [
      { label: 'Indexed Files', value: String(summary.indexedFileCount) },
      { label: 'Symbols', value: String(summary.symbolCount) },
      { label: 'Scopes', value: String(summary.scopeCount) },
      { label: 'Relations', value: String(summary.relationCount) },
      { label: 'Entry Points', value: String(summary.entryPointCount) },
      { label: 'Cycles', value: String(summary.cycleCount) },
    ],
    hotspots: summary.hotspots.map((hotspot) =>
      locationViewModelCreate({
        uri: hotspot.uri,
        line: 0,
        character: 0,
        label: hotspot.workspaceRelativePath,
        detail: `${countLabelCreate(hotspot.importerCount, 'importer', 'importers')} • ${countLabelCreate(hotspot.importeeCount, 'importee', 'importees')}`,
      }),
    ).map((hotspot, index) => ({
      ...hotspot,
      importerCount: summary.hotspots[index]?.importerCount ?? 0,
      importeeCount: summary.hotspots[index]?.importeeCount ?? 0,
    })),
  };
}

type GraphLayoutNodeInput = {
  uri: string;
  workspaceRelativePath: string;
};

const GRAPH_NODE_WIDTH = 220;
const GRAPH_NODE_HEIGHT = 72;
const GRAPH_COLUMN_GAP = 80;
const GRAPH_ROW_GAP = 28;
const GRAPH_PADDING_X = 32;
const GRAPH_PADDING_Y = 32;

function graphNodeSort(left: GraphLayoutNodeInput, right: GraphLayoutNodeInput): number {
  return left.workspaceRelativePath.localeCompare(right.workspaceRelativePath);
}

function graphNodeMetaCreate(node: GraphLayoutNodeInput): {
  label: string;
  detail: string;
} {
  return {
    label: path.basename(node.workspaceRelativePath),
    detail: node.workspaceRelativePath,
  };
}

function dependencyGraphSetsCreate(graph: WorkspaceDependencyGraphResult): {
  entryPoints: Set<string>;
  cycleMembers: Set<string>;
} {
  return {
    entryPoints: new Set(graph.entryPoints),
    cycleMembers: new Set(graph.cycles.flat()),
  };
}

function dependencyGraphNodesByUriCreate(
  graph: WorkspaceDependencyGraphResult,
): Map<string, GraphLayoutNodeInput> {
  return new Map(
    graph.nodes
      .slice()
      .sort(graphNodeSort)
      .map((node) => [
        node.uri,
        {
          uri: node.uri,
          workspaceRelativePath: node.workspaceRelativePath,
        },
      ]),
  );
}

function dependencyGraphEdgeSort(
  left: { fromUri: string; toUri: string },
  right: { fromUri: string; toUri: string },
): number {
  const fromDifference = left.fromUri.localeCompare(right.fromUri);
  if (fromDifference !== 0) {
    return fromDifference;
  }
  return left.toUri.localeCompare(right.toUri);
}

function dependencyGraphLayersResolve(
  graph: WorkspaceDependencyGraphResult,
  nodesByUri: Map<string, GraphLayoutNodeInput>,
): Map<string, number> {
  const incomingCount = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  for (const uri of nodesByUri.keys()) {
    incomingCount.set(uri, 0);
    outgoing.set(uri, []);
  }

  for (const edge of graph.edges.slice().sort(dependencyGraphEdgeSort)) {
    if (!nodesByUri.has(edge.fromUri) || !nodesByUri.has(edge.toUri)) {
      continue;
    }
    incomingCount.set(edge.toUri, (incomingCount.get(edge.toUri) ?? 0) + 1);
    outgoing.set(edge.fromUri, [...(outgoing.get(edge.fromUri) ?? []), edge.toUri]);
  }

  const rootUris = (
    graph.entryPoints.length > 0
      ? graph.entryPoints
      : [...incomingCount.entries()]
          .filter(([, count]) => count === 0)
          .map(([uri]) => uri)
  )
    .filter((uri) => nodesByUri.has(uri))
    .sort();

  const seedUris =
    rootUris.length > 0 ? rootUris : [...nodesByUri.keys()].slice(0, 1);
  const layers = new Map<string, number>();
  const queue = seedUris.map((uri) => ({ uri, layer: 0 }));

  for (const uri of seedUris) {
    layers.set(uri, 0);
  }

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    for (const nextUri of (outgoing.get(current.uri) ?? []).slice().sort()) {
      if (layers.has(nextUri)) {
        continue;
      }
      layers.set(nextUri, current.layer + 1);
      queue.push({ uri: nextUri, layer: current.layer + 1 });
    }
  }

  const fallbackLayer =
    [...layers.values()].reduce((max, value) => Math.max(max, value), 0) + 1;
  for (const uri of [...nodesByUri.keys()].sort()) {
    if (!layers.has(uri)) {
      layers.set(uri, fallbackLayer);
    }
  }
  return layers;
}

function dependencyGraphCanvasFromPositionsCreate(input: {
  graph: WorkspaceDependencyGraphResult;
  mode: 'workspace' | 'focus';
  focusUri?: string;
  nodes: DependencyGraphNodeViewModel[];
  emptyMessage: string;
}): DependencyGraphCanvasViewModel {
  const positions = new Map(
    input.nodes.map((node) => [
      node.uri,
      {
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
      },
    ]),
  );
  const sortedEdges = input.graph.edges.slice().sort(dependencyGraphEdgeSort);
  const edges = sortedEdges
    .filter((edge) => positions.has(edge.fromUri) && positions.has(edge.toUri))
    .map((edge, index) => {
      const from = positions.get(edge.fromUri)!;
      const to = positions.get(edge.toUri)!;
      return {
        id: `edge-${index}-${edge.fromUri}-${edge.toUri}`,
        fromUri: edge.fromUri,
        toUri: edge.toUri,
        x1: from.x + from.width,
        y1: from.y + from.height / 2,
        x2: to.x,
        y2: to.y + to.height / 2,
        isFocus:
          input.focusUri !== undefined &&
          (edge.fromUri === input.focusUri || edge.toUri === input.focusUri),
      };
    });

  const width =
    input.nodes.reduce((max, node) => Math.max(max, node.x + node.width), 0) +
    GRAPH_PADDING_X;
  const height =
    input.nodes.reduce((max, node) => Math.max(max, node.y + node.height), 0) +
    GRAPH_PADDING_Y;

  return {
    mode: input.mode,
    focusUri: input.focusUri,
    width,
    height,
    nodes: input.nodes,
    edges,
    emptyMessage: input.emptyMessage,
  };
}

function dependencyGraphWorkspaceCanvasViewModelCreate(input: {
  graph: WorkspaceDependencyGraphResult;
  focusUri?: string;
}): DependencyGraphCanvasViewModel {
  const nodesByUri = dependencyGraphNodesByUriCreate(input.graph);
  if (nodesByUri.size === 0) {
    return {
      mode: 'workspace',
      focusUri: input.focusUri,
      width: 0,
      height: 0,
      nodes: [],
      edges: [],
      emptyMessage: 'No dependency graph data is available for this workspace.',
    };
  }

  const layers = dependencyGraphLayersResolve(input.graph, nodesByUri);
  const membership = dependencyGraphSetsCreate(input.graph);
  const layerEntries = [...nodesByUri.values()].reduce((map, node) => {
    const layer = layers.get(node.uri) ?? 0;
    const nodes = map.get(layer) ?? [];
    nodes.push(node);
    map.set(layer, nodes);
    return map;
  }, new Map<number, GraphLayoutNodeInput[]>());

  const layerIndices = [...layerEntries.keys()].sort((left, right) => left - right);
  const nodes: DependencyGraphNodeViewModel[] = [];

  layerIndices.forEach((layer, columnIndex) => {
    const layerNodes = (layerEntries.get(layer) ?? []).slice().sort(graphNodeSort);
    layerNodes.forEach((node, rowIndex) => {
      const meta = graphNodeMetaCreate(node);
      nodes.push({
        uri: node.uri,
        label: meta.label,
        detail: meta.detail,
        x: GRAPH_PADDING_X + columnIndex * (GRAPH_NODE_WIDTH + GRAPH_COLUMN_GAP),
        y: GRAPH_PADDING_Y + rowIndex * (GRAPH_NODE_HEIGHT + GRAPH_ROW_GAP),
        width: GRAPH_NODE_WIDTH,
        height: GRAPH_NODE_HEIGHT,
        isFocus: input.focusUri === node.uri,
        isEntryPoint: membership.entryPoints.has(node.uri),
        isCycleMember: membership.cycleMembers.has(node.uri),
      });
    });
  });

  return dependencyGraphCanvasFromPositionsCreate({
    graph: input.graph,
    mode: 'workspace',
    focusUri: input.focusUri,
    nodes,
    emptyMessage: 'No dependency graph data is available for this workspace.',
  });
}

function dependencyGraphFocusCanvasViewModelCreate(input: {
  graph: WorkspaceDependencyGraphResult;
  focusUri: string;
}): DependencyGraphCanvasViewModel {
  const nodesByUri = dependencyGraphNodesByUriCreate(input.graph);
  const focusNode = nodesByUri.get(input.focusUri);
  if (!focusNode) {
    return dependencyGraphWorkspaceCanvasViewModelCreate({
      graph: input.graph,
      focusUri: input.focusUri,
    });
  }

  const membership = dependencyGraphSetsCreate(input.graph);
  const sortedEdges = input.graph.edges.slice().sort(dependencyGraphEdgeSort);
  const incoming = [...new Set(
    sortedEdges
      .filter((edge) => edge.toUri === input.focusUri)
      .map((edge) => edge.fromUri),
  )]
    .map((uri) => nodesByUri.get(uri))
    .filter((node): node is GraphLayoutNodeInput => node !== undefined)
    .sort(graphNodeSort);
  const outgoing = [...new Set(
    sortedEdges
      .filter((edge) => edge.fromUri === input.focusUri)
      .map((edge) => edge.toUri),
  )]
    .map((uri) => nodesByUri.get(uri))
    .filter((node): node is GraphLayoutNodeInput => node !== undefined)
    .sort(graphNodeSort);
  const maxRows = Math.max(1, incoming.length, outgoing.length);
  const rowStep = GRAPH_NODE_HEIGHT + GRAPH_ROW_GAP;
  const focusY = GRAPH_PADDING_Y + ((maxRows - 1) * rowStep) / 2;

  const placeColumn = (
    columnNodes: GraphLayoutNodeInput[],
    columnIndex: number,
  ): DependencyGraphNodeViewModel[] =>
    columnNodes.map((node, rowIndex) => {
      const meta = graphNodeMetaCreate(node);
      return {
        uri: node.uri,
        label: meta.label,
        detail: meta.detail,
        x: GRAPH_PADDING_X + columnIndex * (GRAPH_NODE_WIDTH + GRAPH_COLUMN_GAP),
        y: GRAPH_PADDING_Y + rowIndex * rowStep,
        width: GRAPH_NODE_WIDTH,
        height: GRAPH_NODE_HEIGHT,
        isFocus: node.uri === input.focusUri,
        isEntryPoint: membership.entryPoints.has(node.uri),
        isCycleMember: membership.cycleMembers.has(node.uri),
      };
    });

  const meta = graphNodeMetaCreate(focusNode);
  const focusViewModel: DependencyGraphNodeViewModel = {
    uri: focusNode.uri,
    label: meta.label,
    detail: meta.detail,
    x: GRAPH_PADDING_X + (GRAPH_NODE_WIDTH + GRAPH_COLUMN_GAP),
    y: focusY,
    width: GRAPH_NODE_WIDTH,
    height: GRAPH_NODE_HEIGHT,
    isFocus: true,
    isEntryPoint: membership.entryPoints.has(focusNode.uri),
    isCycleMember: membership.cycleMembers.has(focusNode.uri),
  };
  const nodes = [
    ...placeColumn(incoming, 0),
    focusViewModel,
    ...placeColumn(outgoing, 2),
  ];
  const visibleUris = new Set(nodes.map((node) => node.uri));
  const graph = {
    ...input.graph,
    edges: sortedEdges.filter(
      (edge) =>
        visibleUris.has(edge.fromUri) &&
        visibleUris.has(edge.toUri) &&
        (edge.fromUri === input.focusUri || edge.toUri === input.focusUri),
    ),
  };

  return dependencyGraphCanvasFromPositionsCreate({
    graph,
    mode: 'focus',
    focusUri: input.focusUri,
    nodes,
    emptyMessage: 'No dependency graph context is available for this target.',
  });
}

export function architectureSummaryPanelViewModelCreate(input: {
  summary: WorkspaceArchitectureSummaryResult | null;
}): ArchitectureSummaryPanelViewModel {
  return {
    summaryCard: workspaceSummaryCardViewModelCreate(input.summary),
  };
}

export function semanticDefinitionPanelViewModelCreate(input: {
  uri: string;
  definition: WorkspaceSemanticDefinitionResult | null;
  hover: WorkspaceSemanticHoverResult | null;
}): SemanticDefinitionPanelViewModel {
  const locations: PanelLocationViewModel[] = [];
  if (input.definition) {
    locations.push(
      locationViewModelCreate({
        uri: input.definition.location.uri,
        line: input.definition.location.range.start.line,
        character: input.definition.location.range.start.character,
        label: 'Canonical location',
        detail: input.definition.location.uri,
      }),
    );
  }

  return {
    uri: input.uri,
    hoverCard: semanticHoverCardViewModelCreate(input.hover),
    locations,
  };
}

export function dependencyGraphPanelViewModelCreate(input: {
  graph: WorkspaceDependencyGraphResult;
  summary: WorkspaceArchitectureSummaryResult | null;
  focusUri?: string;
}): DependencyGraphPanelViewModel {
  return {
    focusUri: input.focusUri,
    summaryCard: workspaceSummaryCardViewModelCreate(input.summary),
    graph: dependencyGraphWorkspaceCanvasViewModelCreate({
      graph: input.graph,
      focusUri: input.focusUri,
    }),
  };
}

export function architectureLinksPanelViewModelCreate(input: {
  uri: string;
  references: WorkspaceSemanticReferencesResult | null;
  hover: WorkspaceSemanticHoverResult | null;
  graph: WorkspaceDependencyGraphResult | null;
  summary: WorkspaceArchitectureSummaryResult | null;
}): ArchitectureLinksPanelViewModel {
  return {
    uri: input.uri,
    hoverCard: semanticHoverCardViewModelCreate(input.hover),
    workspaceSummaryCard: workspaceSummaryCardViewModelCreate(input.summary),
    graph:
      input.graph !== null
        ? dependencyGraphFocusCanvasViewModelCreate({
            graph: input.graph,
            focusUri: input.uri,
          })
        : {
            mode: 'focus',
            focusUri: input.uri,
            width: 0,
            height: 0,
            nodes: [],
            edges: [],
            emptyMessage: 'No dependency graph context is available for this target.',
          },
    totalItems: input.references?.totalItems ?? 0,
    totalAvailableItems: input.references?.totalAvailableItems ?? 0,
    truncated: input.references?.truncated ?? false,
    groups:
      input.references?.groups.map((group) => ({
        group: group.group,
        totalCount: group.totalCount,
        truncated: group.truncated,
        items: group.items.map((item) =>
          locationViewModelCreate({
            uri: item.location.uri,
            line: item.location.range.start.line,
            character: item.location.range.start.character,
            label: item.label,
            detail: item.detail,
          }),
        ),
      })) ?? [],
  };
}

function namingRuleLinesCreate(
  prepare: Extract<WorkspacePrepareRenameResult, { ok: true }>,
): string[] {
  const rules: string[] = [];
  if (prepare.namingRules.patternDescription) {
    rules.push(`Pattern: ${prepare.namingRules.patternDescription}`);
  }
  if (prepare.namingRules.casePolicy) {
    rules.push(`Case policy: ${prepare.namingRules.casePolicy}`);
  }
  if (prepare.namingRules.minLength !== undefined) {
    rules.push(`Min length: ${prepare.namingRules.minLength}`);
  }
  if (prepare.namingRules.maxLength !== undefined) {
    rules.push(`Max length: ${prepare.namingRules.maxLength}`);
  }
  return rules;
}

function renameGroupTitleResolve(group: string): string {
  switch (group) {
    case 'declarations':
      return 'Declarations';
    case 'references':
      return 'References';
    case 'config':
      return 'Config';
    case 'metadata':
      return 'Metadata';
    case 'labels':
      return 'Labels';
    default:
      return group;
  }
}

export function renamePreviewPanelViewModelCreate(input: {
  candidate?: RenameTargetCandidate;
  prepare: WorkspacePrepareRenameResult;
  preview?: WorkspaceRenamePreviewResult;
  applyMessage?: string;
}): RenamePreviewPanelViewModel {
  const targetLabel =
    input.candidate?.label ??
    (input.prepare.ok ? input.prepare.displayName : 'Codepol rename');
  const namingRules = input.prepare.ok ? namingRuleLinesCreate(input.prepare) : [];

  if (!input.preview) {
    return {
      targetLabel,
      prepareMessage: input.prepare.ok ? undefined : input.prepare.message,
      currentName: input.prepare.ok ? input.prepare.currentName : undefined,
      namespaceId: input.prepare.ok ? input.prepare.namespaceId : undefined,
      impactedSiteCount: input.prepare.ok ? input.prepare.impactedSiteCount : undefined,
      namingRules,
      groups: [],
      warnings: [],
      blockingIssues: [],
      canApply: false,
      applyMessage: input.applyMessage,
    };
  }

  if (!input.preview.ok) {
    return {
      targetLabel,
      prepareMessage: input.prepare.ok ? undefined : input.prepare.message,
      currentName: input.prepare.ok ? input.prepare.currentName : undefined,
      namespaceId: input.prepare.ok ? input.prepare.namespaceId : undefined,
      impactedSiteCount: input.prepare.ok ? input.prepare.impactedSiteCount : undefined,
      namingRules,
      previewMessage: input.preview.message,
      groups: [],
      warnings: [],
      blockingIssues: [],
      canApply: false,
      applyMessage: input.applyMessage,
    };
  }

  return {
    targetLabel,
    prepareMessage: input.prepare.ok ? undefined : input.prepare.message,
    currentName: input.prepare.ok ? input.prepare.currentName : undefined,
    namespaceId: input.preview.namespaceId,
    impactedSiteCount: input.prepare.ok ? input.prepare.impactedSiteCount : undefined,
    namingRules,
    previewMessage: input.preview.canApply ? undefined : 'Preview is blocked.',
    oldName: input.preview.oldName,
    newName: input.preview.newName,
    groups: input.preview.groups.map((group) => ({
      title: renameGroupTitleResolve(group.group),
      edits: group.edits.map((edit) => ({
        uri: edit.uri,
        line: edit.range.start.line,
        character: edit.range.start.character,
        oldText: edit.oldText,
        newText: edit.newText,
        kind: edit.kind,
      })),
    })),
    warnings: input.preview.warnings.map((warning) => warning.message),
    blockingIssues: input.preview.blockingIssues.map((issue) => issue.message),
    canApply: input.preview.canApply && Boolean(input.preview.plan),
    planId: input.preview.plan?.id,
    applyMessage: input.applyMessage,
  };
}
