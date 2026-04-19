/**
 * View-model for the dedicated call-graph panel.
 *
 * Sibling to the file-graph view-model in `viewModels.ts` — they
 * share input shapes (`WorkspaceDependencyGraphResult`) but the
 * file-graph layout is wrong for a call graph and the file-graph
 * filters (`crossPackageOnly` / edge-kind chips) are nonsense for
 * one. This module owns:
 *
 * - The directional layout: caller-tree above the seed, callee-tree
 *   below. Reads naturally as "this function is called by X and
 *   calls Y".
 * - The chip set the call-graph toolbar exposes: direction, depth,
 *   plus inert slots for `callGraphConfidence` and `callGraphKind`
 *   that Phase 9.2's type-aware bridges will populate.
 * - Per-node retention of `declarationUri` + `declarationRange` so
 *   click navigation can jump to the symbol declaration. The
 *   file-graph view-model drops these fields (it deals in file URIs
 *   that VS Code can open directly); for symbol nodes they are
 *   load-bearing.
 *
 * Layout is intentionally simple — three logical rows (caller / seed
 * / callee) for `direction: 'both'`, two for the unidirectional
 * cases. BFS depth >1 stacks more rows on the same axis. The shape
 * is good enough for the MVP and stays stable as direction toggles
 * inside the panel.
 */

import type {
  WorkspaceDependencyGraphEdge,
  WorkspaceDependencyGraphNode,
  WorkspaceDependencyGraphResult,
  WorkspaceRange,
} from '@codepol/core';

const SYMBOL_URI_SCHEME_PREFIX = 'codepol-symbol://';

export type CallGraphPanelDirection = 'callers' | 'callees' | 'both';

export type CallGraphPanelDepth = 1 | 2 | 'unbounded';

export type CallGraphConfidence = 'structural' | 'type-aware';

export type CallGraphKind = 'direct' | 'dynamic-dispatch' | 'higher-order';

export type CallGraphNodeViewModel = {
  /** Synthetic URI used as the canvas node key. */
  uri: string;
  /** Stable symbol id when the node is symbol-scoped. */
  symbolId?: string;
  /** Display name; empty string for anonymous symbols. */
  symbolName: string;
  /** Language-agnostic kind (e.g. `function`, `method`). */
  symbolKind?: string;
  /** Declaration URI used by the click handler to jump to source. */
  declarationUri?: string;
  /** Declaration range used by the click handler. */
  declarationRange?: WorkspaceRange;
  /** Logical layout band: above the seed, the seed itself, or below. */
  layer: 'caller' | 'seed' | 'callee';
  /** Pixel-space center coordinates produced by {@link callGraphPanelViewModelCreate}. */
  x: number;
  y: number;
  /** Node circle radius in pixels. */
  r: number;
  /** True for the seed node — rendered with emphasis. */
  isFocus: boolean;
};

export type CallGraphEdgeViewModel = {
  fromUri: string;
  toUri: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /**
   * Phase 9.2 confidence axis. Always absent in the MVP because no
   * `TypeAwareCallGraphSource` is wired yet. Plumbed through so the
   * day-of cost when a host wires a binding is one chip render.
   */
  callGraphConfidence?: CallGraphConfidence;
  /**
   * Phase 9.2 kind axis. Same status as `callGraphConfidence`.
   */
  callGraphKind?: CallGraphKind;
};

export type CallGraphCanvasViewModel = {
  width: number;
  height: number;
  nodes: CallGraphNodeViewModel[];
  edges: CallGraphEdgeViewModel[];
  emptyMessage: string;
};

export type CallGraphChipViewModel = {
  id: string;
  label: string;
  active: boolean;
  description?: string;
};

export type CallGraphControlsViewModel = {
  directionChips: CallGraphChipViewModel[];
  depthChips: CallGraphChipViewModel[];
  /** Phase 9.2 placeholder; today every chip is `active: false` and inert. */
  confidenceChips: CallGraphChipViewModel[];
  /** Phase 9.2 placeholder; today every chip is `active: false` and inert. */
  kindChips: CallGraphChipViewModel[];
};

export type CallGraphPanelViewModel = {
  /** Stable id of the seed symbol the panel is centered on. */
  focusSymbolId: string;
  /** Display name shown in the panel header; falls back to '<anonymous>'. */
  focusSymbolName: string;
  /** Declaration URI of the seed (when the seed exists in the index). */
  focusDeclarationUri?: string;
  /** Declaration range of the seed (when the seed exists in the index). */
  focusDeclarationRange?: WorkspaceRange;
  graph: CallGraphCanvasViewModel;
  controls: CallGraphControlsViewModel;
  direction: CallGraphPanelDirection;
  depth: CallGraphPanelDepth;
};

const NODE_RADIUS = 14;
const ROW_HEIGHT = 80;
const COLUMN_WIDTH = 180;
const PADDING = 40;

/**
 * Build the panel view-model from a workspace call-graph result.
 *
 * Edge orientation in `WorkspaceDependencyGraphResult` is
 * `from = caller`, `to = callee` regardless of which BFS direction
 * the workspace ran. The layout walks edges directly:
 *
 * - any node with an outgoing edge to the seed is a caller
 * - any node the seed has an outgoing edge to is a callee
 *
 * Nodes with neither relationship to the seed (introduced by depth >1
 * BFS) are bucketed by counting BFS hops from the seed in the
 * direction that connects them. The simple iterative-BFS below stops
 * at the first time a node is seen — symmetry with the workspace's
 * own `symbolCallGraphCompute` traversal.
 */
export function callGraphPanelViewModelCreate(input: {
  graph: WorkspaceDependencyGraphResult;
  focusSymbolId: string;
  focusSymbolName?: string;
  direction: CallGraphPanelDirection;
  depth: CallGraphPanelDepth;
}): CallGraphPanelViewModel {
  const focusUri = callGraphSymbolUriCreate(input.focusSymbolId);
  const nodesByUri = new Map<string, WorkspaceDependencyGraphNode>();
  for (const node of input.graph.nodes) {
    nodesByUri.set(node.uri, node);
  }

  const edgesByCaller = new Map<string, WorkspaceDependencyGraphEdge[]>();
  const edgesByCallee = new Map<string, WorkspaceDependencyGraphEdge[]>();
  for (const edge of input.graph.edges) {
    let outgoing = edgesByCaller.get(edge.fromUri);
    if (!outgoing) {
      outgoing = [];
      edgesByCaller.set(edge.fromUri, outgoing);
    }
    outgoing.push(edge);
    let incoming = edgesByCallee.get(edge.toUri);
    if (!incoming) {
      incoming = [];
      edgesByCallee.set(edge.toUri, incoming);
    }
    incoming.push(edge);
  }

  const callerLayers = callGraphBfsLayers({
    seedUri: focusUri,
    edgesAdjacency: edgesByCallee,
    edgePeerKey: 'fromUri',
  });
  const calleeLayers = callGraphBfsLayers({
    seedUri: focusUri,
    edgesAdjacency: edgesByCaller,
    edgePeerKey: 'toUri',
  });

  const layoutNodes: CallGraphNodeViewModel[] = [];
  const focusNode = nodesByUri.get(focusUri);
  const focusName =
    input.focusSymbolName ?? focusNode?.symbolName ?? '<anonymous>';

  // Seed always lives on row 0 (y center).
  const focusVm: CallGraphNodeViewModel = {
    uri: focusUri,
    symbolId: input.focusSymbolId,
    symbolName: focusName,
    ...(focusNode?.symbolKind !== undefined ? { symbolKind: focusNode.symbolKind } : {}),
    ...(focusNode?.declarationUri !== undefined
      ? { declarationUri: focusNode.declarationUri }
      : {}),
    ...(focusNode?.declarationRange !== undefined
      ? { declarationRange: focusNode.declarationRange }
      : {}),
    layer: 'seed',
    x: 0,
    y: 0,
    r: NODE_RADIUS,
    isFocus: true,
  };
  layoutNodes.push(focusVm);

  if (input.direction !== 'callees') {
    callGraphLayoutLayers({
      layers: callerLayers,
      direction: 'caller',
      nodesByUri,
      out: layoutNodes,
    });
  }
  if (input.direction !== 'callers') {
    callGraphLayoutLayers({
      layers: calleeLayers,
      direction: 'callee',
      nodesByUri,
      out: layoutNodes,
    });
  }

  // Translate the y-centered layout into a positive bounding box so
  // the SVG renderer can use raw pixel coords.
  const minY = layoutNodes.reduce(
    (acc, n) => Math.min(acc, n.y),
    Number.POSITIVE_INFINITY,
  );
  const maxY = layoutNodes.reduce(
    (acc, n) => Math.max(acc, n.y),
    Number.NEGATIVE_INFINITY,
  );
  const minX = layoutNodes.reduce(
    (acc, n) => Math.min(acc, n.x),
    Number.POSITIVE_INFINITY,
  );
  const maxX = layoutNodes.reduce(
    (acc, n) => Math.max(acc, n.x),
    Number.NEGATIVE_INFINITY,
  );
  const width = Math.max(maxX - minX + 2 * PADDING, 320);
  const height = Math.max(maxY - minY + 2 * PADDING, 200);
  const offsetX = PADDING - minX;
  const offsetY = PADDING - minY;
  for (const node of layoutNodes) {
    node.x += offsetX;
    node.y += offsetY;
  }

  // Edges: keep only edges whose direction is in scope and whose both
  // endpoints landed in the layout. Endpoints outside the requested
  // direction (e.g. the seed's callees when direction is 'callers')
  // will be missing — drop those edges silently.
  const nodeIndexByUri = new Map(layoutNodes.map((n) => [n.uri, n]));
  const layoutEdges: CallGraphEdgeViewModel[] = [];
  for (const edge of input.graph.edges) {
    const fromNode = nodeIndexByUri.get(edge.fromUri);
    const toNode = nodeIndexByUri.get(edge.toUri);
    if (!fromNode || !toNode) continue;
    const layoutEdge: CallGraphEdgeViewModel = {
      fromUri: edge.fromUri,
      toUri: edge.toUri,
      x1: fromNode.x,
      y1: fromNode.y,
      x2: toNode.x,
      y2: toNode.y,
    };
    if (edge.callGraphConfidence !== undefined) {
      layoutEdge.callGraphConfidence = edge.callGraphConfidence as CallGraphConfidence;
    }
    if (edge.callGraphKind !== undefined) {
      layoutEdge.callGraphKind = edge.callGraphKind as CallGraphKind;
    }
    layoutEdges.push(layoutEdge);
  }

  const emptyMessage =
    layoutNodes.length <= 1
      ? input.direction === 'callers'
        ? `${focusName} has no callers in the structural call graph.`
        : input.direction === 'callees'
          ? `${focusName} has no callees in the structural call graph.`
          : `${focusName} is structurally isolated in the call graph.`
      : '';

  const result: CallGraphPanelViewModel = {
    focusSymbolId: input.focusSymbolId,
    focusSymbolName: focusName,
    graph: {
      width,
      height,
      nodes: layoutNodes,
      edges: layoutEdges,
      emptyMessage,
    },
    controls: callGraphControlsViewModelCreate({
      direction: input.direction,
      depth: input.depth,
    }),
    direction: input.direction,
    depth: input.depth,
  };
  if (focusNode?.declarationUri !== undefined) {
    result.focusDeclarationUri = focusNode.declarationUri;
  }
  if (focusNode?.declarationRange !== undefined) {
    result.focusDeclarationRange = focusNode.declarationRange;
  }
  return result;
}

/**
 * Resolve a click on a node's `data-open-uri` attribute to the
 * `(uri, line, character)` tuple the panel should ask VS Code to
 * open. For `codepol-symbol://` URIs the panel uses the node's
 * `declarationUri` + `declarationRange`. For any other scheme the
 * URI is opaque and passes through unchanged.
 *
 * Returns `null` when the node is unknown or carries no declaration
 * — the panel manager treats `null` as "no-op click" rather than
 * trying to open an invalid URI.
 */
export function callGraphNodeOpenLocationResolve(input: {
  model: CallGraphPanelViewModel;
  uri: string;
}): { uri: string; line: number; character: number } | null {
  const node = input.model.graph.nodes.find((n) => n.uri === input.uri);
  if (!node) return null;
  if (input.uri.startsWith(SYMBOL_URI_SCHEME_PREFIX)) {
    if (!node.declarationUri || !node.declarationRange) return null;
    return {
      uri: node.declarationUri,
      line: node.declarationRange.start.line,
      character: node.declarationRange.start.character,
    };
  }
  // Non-symbol URI — pass through with the declaration anchor when we
  // happen to have it, otherwise fall back to file start.
  return {
    uri: input.uri,
    line: node.declarationRange?.start.line ?? 0,
    character: node.declarationRange?.start.character ?? 0,
  };
}

function callGraphSymbolUriCreate(symbolId: string): string {
  return `${SYMBOL_URI_SCHEME_PREFIX}${encodeURIComponent(symbolId)}`;
}

/**
 * BFS over the supplied adjacency map starting from `seedUri`.
 * Returns layers indexed by hop distance (`layers[0]` is the seed's
 * direct neighbors, `layers[1]` is two hops, …). The seed itself is
 * NOT included.
 */
function callGraphBfsLayers(input: {
  seedUri: string;
  edgesAdjacency: Map<string, WorkspaceDependencyGraphEdge[]>;
  edgePeerKey: 'fromUri' | 'toUri';
}): string[][] {
  const visited = new Set<string>();
  visited.add(input.seedUri);
  const layers: string[][] = [];
  let frontier: string[] = [input.seedUri];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const uri of frontier) {
      const adjacent = input.edgesAdjacency.get(uri) ?? [];
      for (const edge of adjacent) {
        const peer = edge[input.edgePeerKey];
        if (visited.has(peer)) continue;
        visited.add(peer);
        next.push(peer);
      }
    }
    if (next.length === 0) break;
    layers.push(next);
    frontier = next;
  }
  return layers;
}

function callGraphLayoutLayers(input: {
  layers: string[][];
  direction: 'caller' | 'callee';
  nodesByUri: Map<string, WorkspaceDependencyGraphNode>;
  out: CallGraphNodeViewModel[];
}): void {
  const ySign = input.direction === 'caller' ? -1 : 1;
  for (let layerIndex = 0; layerIndex < input.layers.length; layerIndex += 1) {
    const layer = input.layers[layerIndex]!;
    const sortedLayer = [...layer].sort();
    const layerWidth = (sortedLayer.length - 1) * COLUMN_WIDTH;
    const startX = -layerWidth / 2;
    for (let i = 0; i < sortedLayer.length; i += 1) {
      const uri = sortedLayer[i]!;
      const node = input.nodesByUri.get(uri);
      const symbolName = node?.symbolName ?? '';
      const layoutNode: CallGraphNodeViewModel = {
        uri,
        symbolName,
        layer: input.direction,
        x: startX + i * COLUMN_WIDTH,
        y: ySign * (layerIndex + 1) * ROW_HEIGHT,
        r: NODE_RADIUS,
        isFocus: false,
      };
      if (node?.symbolId !== undefined) {
        layoutNode.symbolId = node.symbolId;
      }
      if (node?.symbolKind !== undefined) {
        layoutNode.symbolKind = node.symbolKind;
      }
      if (node?.declarationUri !== undefined) {
        layoutNode.declarationUri = node.declarationUri;
      }
      if (node?.declarationRange !== undefined) {
        layoutNode.declarationRange = node.declarationRange;
      }
      input.out.push(layoutNode);
    }
  }
}

function callGraphControlsViewModelCreate(input: {
  direction: CallGraphPanelDirection;
  depth: CallGraphPanelDepth;
}): CallGraphControlsViewModel {
  const directions: CallGraphPanelDirection[] = ['callers', 'callees', 'both'];
  const depths: CallGraphPanelDepth[] = [1, 2, 'unbounded'];
  return {
    directionChips: directions.map((d) => ({
      id: `direction:${d}`,
      label: d === 'callers' ? 'Callers' : d === 'callees' ? 'Callees' : 'Both',
      active: d === input.direction,
    })),
    depthChips: depths.map((d) => ({
      id: `depth:${String(d)}`,
      label: d === 'unbounded' ? 'Unbounded' : `Depth ${d}`,
      active: d === input.depth,
    })),
    confidenceChips: [
      {
        id: 'confidence:structural',
        label: 'Structural',
        active: false,
        description: 'Available when no type-aware source is registered.',
      },
      {
        id: 'confidence:type-aware',
        label: 'Type-aware',
        active: false,
        description: 'Populated by a TypeAwareCallGraphSource binding.',
      },
    ],
    kindChips: [
      { id: 'kind:direct', label: 'Direct', active: false },
      { id: 'kind:dynamic-dispatch', label: 'Dynamic dispatch', active: false },
      { id: 'kind:higher-order', label: 'Higher-order', active: false },
    ],
  };
}
