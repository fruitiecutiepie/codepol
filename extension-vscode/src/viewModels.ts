import * as path from 'node:path';
import type {
  WorkspaceArchitectureSummaryResult,
  WorkspaceDependencyGraphEdge,
  WorkspaceDependencyGraphEdgeKind,
  WorkspaceDependencyGraphResult,
  WorkspaceLintRuleDetailsResult,
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

/**
 * Phase 8 health hotspot displayed alongside the fan-in `hotspots` list.
 * Carries the same `PanelLocationViewModel` shape as a regular hotspot
 * so it can flow through the existing rendering helpers, plus the three
 * raw values needed to reconstruct the ranking.
 */
export type WorkspaceSummaryComplexityHotspotViewModel = PanelLocationViewModel & {
  aggregateCyclomaticComplexity: number;
  importerCount: number;
  score: number;
};

export type WorkspaceSummaryCardViewModel = {
  summary: string;
  metrics: WorkspaceSummaryMetricViewModel[];
  hotspots: WorkspaceSummaryHotspotViewModel[];
  /**
   * Phase 8 complexity hotspots. Omitted when the underlying summary
   * had no complexityHotspots data so the existing equality-based view
   * model tests stay valid for workspaces that emit only the legacy
   * shape.
   */
  complexityHotspots?: WorkspaceSummaryComplexityHotspotViewModel[];
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
  isDimmed?: boolean;
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
  isDimmed?: boolean;
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

export type DependencyGraphLayoutMode = 'force' | 'layered' | 'radial';

export type DependencyGraphFilterState = {
  edgeKinds?: WorkspaceDependencyGraphEdgeKind[];
  crossPackageOnly?: boolean;
  crossLayerOnly?: boolean;
  hideTests?: boolean;
};

export type DependencyGraphFilterChipViewModel = {
  id: string;
  label: string;
  active: boolean;
  description?: string;
};

export type DependencyGraphLayoutOptionViewModel = {
  id: DependencyGraphLayoutMode;
  label: string;
  active: boolean;
};

export type DependencyGraphControlsViewModel = {
  filterChips: DependencyGraphFilterChipViewModel[];
  edgeKindChips: DependencyGraphFilterChipViewModel[];
  layoutOptions: DependencyGraphLayoutOptionViewModel[];
  blastRadiusUri: string | null;
  blastRadiusReachableCount: number;
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
  controls: DependencyGraphControlsViewModel;
  filters: DependencyGraphFilterState;
  layoutMode: DependencyGraphLayoutMode;
  blastRadiusUri?: string;
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
  controls: DependencyGraphControlsViewModel;
  filters: DependencyGraphFilterState;
  layoutMode: DependencyGraphLayoutMode;
  blastRadiusUri?: string;
};

export type LintRuleDetailsPanelGroupViewModel = {
  title: string;
  items: PanelLocationViewModel[];
};

export type LintRuleDetailsPanelViewModel = {
  ruleId: string;
  ownershipLabel: string;
  analysisStateLabel: string;
  totalDiagnosticCount: number;
  recentNativeDiagnosticCount: number;
  recentWrappedDiagnosticCount: number;
  severities: string[];
  targetPatterns: string[];
  languages: string[];
  providerSummaries: Array<{ label: string; detail?: string }>;
  fixSurfaceNotes: string[];
  analyzerIssues: string[];
  groups: LintRuleDetailsPanelGroupViewModel[];
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

  const baseMetrics: WorkspaceSummaryMetricViewModel[] = [
    { label: 'Indexed Files', value: String(summary.indexedFileCount) },
    { label: 'Symbols', value: String(summary.symbolCount) },
    { label: 'Scopes', value: String(summary.scopeCount) },
    { label: 'Relations', value: String(summary.relationCount) },
    { label: 'Entry Points', value: String(summary.entryPointCount) },
    { label: 'Cycles', value: String(summary.cycleCount) },
  ];
  const phase8Metrics: WorkspaceSummaryMetricViewModel[] = [];
  if (summary.longestChain && summary.longestChain.length > 0) {
    phase8Metrics.push({
      label: 'Longest Chain',
      value: countLabelCreate(summary.longestChain.length, 'hop', 'hops'),
    });
  }
  if (summary.sccSizeDistribution) {
    const sizes = Object.keys(summary.sccSizeDistribution)
      .map((key) => Number(key))
      .filter((size) => Number.isFinite(size))
      .sort((left, right) => right - left);
    if (sizes.length > 0) {
      const largestSize = sizes[0];
      const largestCount = summary.sccSizeDistribution[largestSize] ?? 0;
      phase8Metrics.push({
        label: 'Largest Cycle',
        value: `${largestSize} files${largestCount > 1 ? ` (${largestCount} cycles)` : ''}`,
      });
    }
  }
  if (summary.instability && summary.instability.length > 0) {
    const mostUnstable = summary.instability[0];
    phase8Metrics.push({
      label: 'Most Unstable',
      value: `${mostUnstable.workspaceRelativePath} (${mostUnstable.value.toFixed(2)})`,
    });
  }

  const hotspots: WorkspaceSummaryHotspotViewModel[] = summary.hotspots.map((hotspot) => ({
    ...locationViewModelCreate({
      uri: hotspot.uri,
      line: 0,
      character: 0,
      label: hotspot.workspaceRelativePath,
      detail: `${countLabelCreate(hotspot.importerCount, 'importer', 'importers')} • ${countLabelCreate(hotspot.importeeCount, 'importee', 'importees')}`,
    }),
    importerCount: hotspot.importerCount,
    importeeCount: hotspot.importeeCount,
  }));

  const card: WorkspaceSummaryCardViewModel = {
    summary: summary.summary,
    metrics: [...baseMetrics, ...phase8Metrics],
    hotspots,
  };

  if (summary.complexityHotspots && summary.complexityHotspots.length > 0) {
    card.complexityHotspots = summary.complexityHotspots.map((hotspot) => ({
      ...locationViewModelCreate({
        uri: hotspot.uri,
        line: 0,
        character: 0,
        label: hotspot.workspaceRelativePath,
        detail: `complexity ${hotspot.aggregateCyclomaticComplexity} × ${countLabelCreate(hotspot.importerCount, 'importer', 'importers')}`,
      }),
      aggregateCyclomaticComplexity: hotspot.aggregateCyclomaticComplexity,
      importerCount: hotspot.importerCount,
      score: hotspot.score,
    }));
  }

  return card;
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

const TEST_PATH_PATTERNS: RegExp[] = [
  /\.(test|spec)\.[a-zA-Z0-9]+$/,
  /(^|\/)__tests__(\/|$)/,
  /(^|\/)tests?(\/|$)/,
];

function nodePathIsTest(workspaceRelativePath: string): boolean {
  return TEST_PATH_PATTERNS.some((pattern) => pattern.test(workspaceRelativePath));
}

function edgeMatchesFilters(
  edge: WorkspaceDependencyGraphEdge,
  filters: DependencyGraphFilterState,
): boolean {
  if (filters.edgeKinds && filters.edgeKinds.length > 0) {
    if (!edge.kind || !filters.edgeKinds.includes(edge.kind)) {
      return false;
    }
  }
  if (filters.crossPackageOnly === true && edge.crossesPackageBoundary !== true) {
    return false;
  }
  if (filters.crossLayerOnly === true && edge.crossesLayerBoundary !== true) {
    return false;
  }
  return true;
}

function dependencyGraphFiltersApply(
  graph: WorkspaceDependencyGraphResult,
  filters: DependencyGraphFilterState,
): WorkspaceDependencyGraphResult {
  const removedNodeUris = new Set<string>();
  if (filters.hideTests === true) {
    for (const node of graph.nodes) {
      if (nodePathIsTest(node.workspaceRelativePath)) {
        removedNodeUris.add(node.uri);
      }
    }
  }
  const nodes = graph.nodes.filter((node) => !removedNodeUris.has(node.uri));
  const edges = graph.edges.filter(
    (edge) =>
      !removedNodeUris.has(edge.fromUri) &&
      !removedNodeUris.has(edge.toUri) &&
      edgeMatchesFilters(edge, filters),
  );
  const cycles = graph.cycles
    .map((cycle) => cycle.filter((uri) => !removedNodeUris.has(uri)))
    .filter((cycle) => cycle.length > 1);
  const entryPoints = graph.entryPoints.filter((uri) => !removedNodeUris.has(uri));

  return {
    nodes,
    edges,
    entryPoints,
    cycles,
  };
}

function blastRadiusReachableFromUriCompute(
  graph: WorkspaceDependencyGraphResult,
  blastRadiusUri: string,
): Set<string> {
  const reachable = new Set<string>();
  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const list = adjacency.get(edge.fromUri) ?? [];
    list.push(edge.toUri);
    adjacency.set(edge.fromUri, list);
    const reverse = adjacency.get(edge.toUri) ?? [];
    reverse.push(edge.fromUri);
    adjacency.set(edge.toUri, reverse);
  }

  const queue = [blastRadiusUri];
  reachable.add(blastRadiusUri);
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    for (const next of (adjacency.get(current) ?? []).slice().sort()) {
      if (reachable.has(next)) {
        continue;
      }
      reachable.add(next);
      queue.push(next);
    }
  }
  return reachable;
}

const FILTER_CHIP_DEFINITIONS: Array<{
  id: 'crossPackageOnly' | 'crossLayerOnly' | 'hideTests';
  label: string;
  description: string;
}> = [
  {
    id: 'crossPackageOnly',
    label: 'Cross-package only',
    description: 'Show only edges that cross monorepo package boundaries.',
  },
  {
    id: 'crossLayerOnly',
    label: 'Cross-layer only',
    description: 'Show only edges that cross architectural layer boundaries.',
  },
  {
    id: 'hideTests',
    label: 'Hide tests',
    description: 'Hide files that look like test or spec sources.',
  },
];

const EDGE_KIND_CHIP_DEFINITIONS: Array<{
  id: WorkspaceDependencyGraphEdgeKind;
  label: string;
}> = [
  { id: 'static', label: 'Static' },
  { id: 'dynamic', label: 'Dynamic' },
  { id: 'side_effect', label: 'Side-effect' },
  { id: 'cjs', label: 'CJS' },
  { id: 'type_only', label: 'Type-only' },
];

const LAYOUT_OPTION_DEFINITIONS: Array<{
  id: DependencyGraphLayoutMode;
  label: string;
}> = [
  { id: 'layered', label: 'Layered' },
  { id: 'radial', label: 'Radial' },
  { id: 'force', label: 'Force (alpha)' },
];

function dependencyGraphControlsViewModelCreate(input: {
  filters: DependencyGraphFilterState;
  layoutMode: DependencyGraphLayoutMode;
  blastRadiusUri: string | undefined;
  blastRadiusReachableCount: number;
}): DependencyGraphControlsViewModel {
  const activeEdgeKinds = new Set<WorkspaceDependencyGraphEdgeKind>(
    input.filters.edgeKinds ?? [],
  );

  return {
    filterChips: FILTER_CHIP_DEFINITIONS.map((definition) => ({
      id: definition.id,
      label: definition.label,
      description: definition.description,
      active: input.filters[definition.id] === true,
    })),
    edgeKindChips: EDGE_KIND_CHIP_DEFINITIONS.map((definition) => ({
      id: `edgeKind:${definition.id}`,
      label: definition.label,
      active: activeEdgeKinds.has(definition.id),
    })),
    layoutOptions: LAYOUT_OPTION_DEFINITIONS.map((definition) => ({
      id: definition.id,
      label: definition.label,
      active: input.layoutMode === definition.id,
    })),
    blastRadiusUri: input.blastRadiusUri ?? null,
    blastRadiusReachableCount: input.blastRadiusReachableCount,
  };
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

function dependencyGraphForceCanvasViewModelCreate(input: {
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

  const ordered = [...nodesByUri.values()].slice().sort(graphNodeSort);
  const membership = dependencyGraphSetsCreate(input.graph);
  const columnsCount = Math.max(1, Math.ceil(Math.sqrt(ordered.length)));
  const nodes: DependencyGraphNodeViewModel[] = ordered.map((node, index) => {
    const meta = graphNodeMetaCreate(node);
    const columnIndex = index % columnsCount;
    const rowIndex = Math.floor(index / columnsCount);
    return {
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
    };
  });

  return dependencyGraphCanvasFromPositionsCreate({
    graph: input.graph,
    mode: 'workspace',
    focusUri: input.focusUri,
    nodes,
    emptyMessage: 'No dependency graph data is available for this workspace.',
  });
}

function dependencyGraphCanvasBlastRadiusApply(
  canvas: DependencyGraphCanvasViewModel,
  reachableUris: Set<string>,
): DependencyGraphCanvasViewModel {
  return {
    ...canvas,
    nodes: canvas.nodes.map((node) => ({
      ...node,
      isDimmed: !reachableUris.has(node.uri),
    })),
    edges: canvas.edges.map((edge) => ({
      ...edge,
      isDimmed: !reachableUris.has(edge.fromUri) || !reachableUris.has(edge.toUri),
    })),
  };
}

function dependencyGraphCanvasForLayoutCreate(input: {
  graph: WorkspaceDependencyGraphResult;
  focusUri?: string;
  layoutMode: DependencyGraphLayoutMode;
  preferFocusForRadial: boolean;
}): DependencyGraphCanvasViewModel {
  if (input.layoutMode === 'force') {
    return dependencyGraphForceCanvasViewModelCreate({
      graph: input.graph,
      focusUri: input.focusUri,
    });
  }
  if (input.layoutMode === 'radial' && input.focusUri) {
    return dependencyGraphFocusCanvasViewModelCreate({
      graph: input.graph,
      focusUri: input.focusUri,
    });
  }
  if (input.layoutMode === 'radial' && input.preferFocusForRadial) {
    return dependencyGraphWorkspaceCanvasViewModelCreate({
      graph: input.graph,
      focusUri: input.focusUri,
    });
  }
  return dependencyGraphWorkspaceCanvasViewModelCreate({
    graph: input.graph,
    focusUri: input.focusUri,
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
  filters?: DependencyGraphFilterState;
  layoutMode?: DependencyGraphLayoutMode;
  blastRadiusUri?: string;
}): DependencyGraphPanelViewModel {
  const filters = input.filters ?? {};
  const layoutMode = input.layoutMode ?? 'layered';
  const filteredGraph = dependencyGraphFiltersApply(input.graph, filters);
  let canvas = dependencyGraphCanvasForLayoutCreate({
    graph: filteredGraph,
    focusUri: input.focusUri,
    layoutMode,
    preferFocusForRadial: false,
  });
  let blastRadiusReachableCount = 0;
  if (input.blastRadiusUri) {
    const reachable = blastRadiusReachableFromUriCompute(
      filteredGraph,
      input.blastRadiusUri,
    );
    blastRadiusReachableCount = reachable.size;
    canvas = dependencyGraphCanvasBlastRadiusApply(canvas, reachable);
  }

  return {
    focusUri: input.focusUri,
    summaryCard: workspaceSummaryCardViewModelCreate(input.summary),
    graph: canvas,
    controls: dependencyGraphControlsViewModelCreate({
      filters,
      layoutMode,
      blastRadiusUri: input.blastRadiusUri,
      blastRadiusReachableCount,
    }),
    filters,
    layoutMode,
    blastRadiusUri: input.blastRadiusUri,
  };
}

export function architectureLinksPanelViewModelCreate(input: {
  uri: string;
  references: WorkspaceSemanticReferencesResult | null;
  hover: WorkspaceSemanticHoverResult | null;
  graph: WorkspaceDependencyGraphResult | null;
  summary: WorkspaceArchitectureSummaryResult | null;
  filters?: DependencyGraphFilterState;
  layoutMode?: DependencyGraphLayoutMode;
  blastRadiusUri?: string;
}): ArchitectureLinksPanelViewModel {
  const filters = input.filters ?? {};
  const layoutMode = input.layoutMode ?? 'radial';
  const filteredGraph =
    input.graph !== null
      ? dependencyGraphFiltersApply(input.graph, filters)
      : null;
  let canvas: DependencyGraphCanvasViewModel;
  let blastRadiusReachableCount = 0;
  if (filteredGraph !== null) {
    canvas = dependencyGraphCanvasForLayoutCreate({
      graph: filteredGraph,
      focusUri: input.uri,
      layoutMode,
      preferFocusForRadial: true,
    });
    if (input.blastRadiusUri) {
      const reachable = blastRadiusReachableFromUriCompute(
        filteredGraph,
        input.blastRadiusUri,
      );
      blastRadiusReachableCount = reachable.size;
      canvas = dependencyGraphCanvasBlastRadiusApply(canvas, reachable);
    }
  } else {
    canvas = {
      mode: 'focus',
      focusUri: input.uri,
      width: 0,
      height: 0,
      nodes: [],
      edges: [],
      emptyMessage: 'No dependency graph context is available for this target.',
    };
  }

  return {
    uri: input.uri,
    hoverCard: semanticHoverCardViewModelCreate(input.hover),
    workspaceSummaryCard: workspaceSummaryCardViewModelCreate(input.summary),
    graph: canvas,
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
    controls: dependencyGraphControlsViewModelCreate({
      filters,
      layoutMode,
      blastRadiusUri: input.blastRadiusUri,
      blastRadiusReachableCount,
    }),
    filters,
    layoutMode,
    blastRadiusUri: input.blastRadiusUri,
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

function lintRuleOwnershipLabelResolve(
  ownership: WorkspaceLintRuleDetailsResult['rule']['ownership'],
): string {
  switch (ownership) {
    case 'native_preferred':
      return 'Native Preferred';
    case 'keep_wrapped':
      return 'Keep Wrapped';
    default:
      return 'Pending Analysis';
  }
}

function lintRuleAnalysisStateLabelResolve(
  state: WorkspaceLintRuleDetailsResult['rule']['analysisState'],
): string {
  switch (state) {
    case 'ready':
      return 'Ready';
    case 'error':
      return 'Error';
    default:
      return 'Pending';
  }
}

export function lintRuleDetailsPanelViewModelCreate(input: {
  details: WorkspaceLintRuleDetailsResult;
}): LintRuleDetailsPanelViewModel {
  return {
    ruleId: input.details.rule.ruleId,
    ownershipLabel: lintRuleOwnershipLabelResolve(input.details.rule.ownership),
    analysisStateLabel: lintRuleAnalysisStateLabelResolve(
      input.details.rule.analysisState,
    ),
    totalDiagnosticCount: input.details.totalDiagnosticCount,
    recentNativeDiagnosticCount: input.details.rule.recentNativeDiagnosticCount,
    recentWrappedDiagnosticCount: input.details.rule.recentWrappedDiagnosticCount,
    severities: input.details.rule.severities,
    targetPatterns: input.details.rule.targetPatterns,
    languages: input.details.rule.languages,
    providerSummaries: input.details.rule.providers.map((provider) => ({
      label: `${provider.platform} (${provider.languages.join(', ') || 'all'})`,
      detail: provider.configSummary,
    })),
    fixSurfaceNotes: input.details.rule.fixSurfaceNotes,
    analyzerIssues: input.details.rule.analyzerIssues,
    groups: input.details.groups.map((group) => ({
      title: group.workspaceRelativePath,
      items: group.diagnostics.map((diagnostic) =>
        locationViewModelCreate({
          uri: group.uri,
          line: diagnostic.range.start.line,
          character: diagnostic.range.start.character,
          label: diagnostic.message,
          detail: `${diagnostic.severity} • ${diagnostic.range.start.line + 1}:${diagnostic.range.start.character + 1}`,
        }),
      ),
    })),
  };
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
