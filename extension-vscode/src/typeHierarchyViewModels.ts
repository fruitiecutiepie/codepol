/**
 * View-model for the dedicated type-hierarchy panel.
 *
 * Sibling to {@link callGraphViewModels} — both consume
 * `WorkspaceDependencyGraphResult` and produce a directional, layered
 * SVG layout, but the chip set, edge styling axis, and click target
 * are different. This module owns:
 *
 * - The directional layout: supertype-tree above the seed, subtype-tree
 *   below. Reads naturally as "this interface is extended by X and
 *   extends Y".
 * - Per-edge confidence retention. Phase 9.4 / 9.5 — every edge
 *   carries an optional `typeRelationConfidence` of `'declared'` /
 *   `'structural-shape'` / `'type-aware'` and the renderer uses the
 *   tier to pick between solid / dashed / emphasized strokes.
 * - A summary card that tallies edges by tier so users can read the
 *   answer without parsing the SVG.
 *
 * Edge orientation follows `WorkspaceDependencyGraphResult` — for
 * type hierarchy, `from = subtype`, `to = supertype`.
 */

import type {
  WorkspaceDependencyGraphEdge,
  WorkspaceDependencyGraphNode,
  WorkspaceDependencyGraphResult,
  WorkspaceRange,
  WorkspaceTypeHierarchyEdgeConfidence,
} from '@codepol/core';
import type { PanelLensSwitcherViewModel } from './panels/panelShared';

const SYMBOL_URI_SCHEME_PREFIX = 'codepol-symbol://';

export type TypeHierarchyPanelDirection = 'supertypes' | 'subtypes' | 'both';

export type TypeHierarchyPanelDepth = 1 | 2 | 'unbounded';

export type TypeHierarchyNodeViewModel = {
  /** Synthetic URI used as the canvas node key. */
  uri: string;
  /** Stable symbol id when the node is symbol-scoped. */
  symbolId?: string;
  /** Display name; empty string for anonymous symbols. */
  symbolName: string;
  /** Language-agnostic kind (e.g. `class`, `interface`). */
  symbolKind?: string;
  /** Declaration URI used by the click handler to jump to source. */
  declarationUri?: string;
  /** Declaration range used by the click handler. */
  declarationRange?: WorkspaceRange;
  /** Logical layout band: above the seed, the seed itself, or below. */
  layer: 'supertype' | 'seed' | 'subtype';
  /** Pixel-space center coordinates produced by {@link typeHierarchyPanelViewModelCreate}. */
  x: number;
  y: number;
  /** Node circle radius in pixels. */
  r: number;
  /** True for the seed node — rendered with emphasis. */
  isFocus: boolean;
};

export type TypeHierarchyEdgeViewModel = {
  fromUri: string;
  toUri: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /**
   * Confidence tier inherited from `WorkspaceDependencyGraphEdge`.
   * Absent ⇒ render as `'declared'` (solid). Set when the workspace
   * produced a structural-shape edge (dashed) or a type-aware edge
   * (emphasized).
   */
  typeRelationConfidence?: WorkspaceTypeHierarchyEdgeConfidence;
};

export type TypeHierarchyCanvasViewModel = {
  width: number;
  height: number;
  nodes: TypeHierarchyNodeViewModel[];
  edges: TypeHierarchyEdgeViewModel[];
  emptyMessage: string;
};

export type TypeHierarchyConfidenceCounts = {
  declared: number;
  structuralShape: number;
  typeAware: number;
};

export type TypeHierarchyChipViewModel = {
  id: string;
  label: string;
  active: boolean;
  description?: string;
};

export type TypeHierarchyControlsViewModel = {
  directionChips: TypeHierarchyChipViewModel[];
  depthChips: TypeHierarchyChipViewModel[];
};

export type TypeHierarchyPanelViewModel = {
  /** Stable id of the seed symbol the panel is centered on. */
  focusSymbolId: string;
  /** Display name shown in the panel header; falls back to '<anonymous>'. */
  focusSymbolName: string;
  /** Declaration URI of the seed (when the seed exists in the index). */
  focusDeclarationUri?: string;
  /** Declaration range of the seed (when the seed exists in the index). */
  focusDeclarationRange?: WorkspaceRange;
  graph: TypeHierarchyCanvasViewModel;
  controls: TypeHierarchyControlsViewModel;
  direction: TypeHierarchyPanelDirection;
  depth: TypeHierarchyPanelDepth;
  /** Per-tier edge counts shown in the panel header. */
  edgeCounts: TypeHierarchyConfidenceCounts;
  /**
   * Optional lens-switcher payload (Phase 7). When present, the
   * panel header renders a {@link panelLensSwitcherHtml} affordance
   * the user can click to reopen the same focus through a sibling
   * lens. Absent when the focus has only one valid lens.
   */
  lensSwitcher?: PanelLensSwitcherViewModel;
};

const NODE_RADIUS = 14;
const ROW_HEIGHT = 80;
const COLUMN_WIDTH = 180;
const PADDING = 40;

/**
 * Build the panel view-model from a workspace type-hierarchy result.
 *
 * Edge orientation in `WorkspaceDependencyGraphResult` for type
 * hierarchy is `from = subtype`, `to = supertype` regardless of the
 * BFS direction the workspace ran. The layout walks edges directly:
 *
 * - any node with an outgoing edge to the seed is a subtype
 * - any node the seed has an outgoing edge to is a supertype
 *
 * Nodes with neither relationship to the seed (introduced by depth >1
 * BFS) are bucketed by counting BFS hops from the seed in the
 * direction that connects them. Same shape as
 * `callGraphPanelViewModelCreate` in `callGraphViewModels.ts`.
 */
export function typeHierarchyPanelViewModelCreate(input: {
  graph: WorkspaceDependencyGraphResult;
  focusSymbolId: string;
  focusSymbolName?: string;
  direction: TypeHierarchyPanelDirection;
  depth: TypeHierarchyPanelDepth;
  /**
   * Optional lens-switcher payload (Phase 7). The controller builds
   * this once per show-call and passes it through; the view-model
   * just surfaces it to the renderer.
   */
  lensSwitcher?: PanelLensSwitcherViewModel;
}): TypeHierarchyPanelViewModel {
  const focusUri = typeHierarchySymbolUriCreate(input.focusSymbolId);
  const nodesByUri = new Map<string, WorkspaceDependencyGraphNode>();
  for (const node of input.graph.nodes) {
    nodesByUri.set(node.uri, node);
  }

  const edgesBySubtype = new Map<string, WorkspaceDependencyGraphEdge[]>();
  const edgesBySupertype = new Map<string, WorkspaceDependencyGraphEdge[]>();
  for (const edge of input.graph.edges) {
    let outgoing = edgesBySubtype.get(edge.fromUri);
    if (!outgoing) {
      outgoing = [];
      edgesBySubtype.set(edge.fromUri, outgoing);
    }
    outgoing.push(edge);
    let incoming = edgesBySupertype.get(edge.toUri);
    if (!incoming) {
      incoming = [];
      edgesBySupertype.set(edge.toUri, incoming);
    }
    incoming.push(edge);
  }

  // Subtype layers: walk reverse edges (incoming to seed). Edge is
  // `from = subtype, to = supertype`, so neighbors of the seed via
  // incoming edges are the seed's subtypes.
  const subtypeLayers = typeHierarchyBfsLayers({
    seedUri: focusUri,
    edgesAdjacency: edgesBySupertype,
    edgePeerKey: 'fromUri',
  });
  // Supertype layers: walk forward edges (outgoing from seed).
  const supertypeLayers = typeHierarchyBfsLayers({
    seedUri: focusUri,
    edgesAdjacency: edgesBySubtype,
    edgePeerKey: 'toUri',
  });

  const layoutNodes: TypeHierarchyNodeViewModel[] = [];
  const focusNode = nodesByUri.get(focusUri);
  const focusName =
    input.focusSymbolName ?? focusNode?.symbolName ?? '<anonymous>';

  // Seed always lives on row 0 (y center).
  const focusVm: TypeHierarchyNodeViewModel = {
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

  if (input.direction !== 'subtypes') {
    typeHierarchyLayoutLayers({
      layers: supertypeLayers,
      direction: 'supertype',
      nodesByUri,
      out: layoutNodes,
    });
  }
  if (input.direction !== 'supertypes') {
    typeHierarchyLayoutLayers({
      layers: subtypeLayers,
      direction: 'subtype',
      nodesByUri,
      out: layoutNodes,
    });
  }

  // Translate the y-centered layout into a positive bounding box.
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

  // Drop edges whose endpoints fell out of the layout (e.g. caller
  // dropped because direction is 'subtypes').
  const nodeIndexByUri = new Map(layoutNodes.map((n) => [n.uri, n]));
  const layoutEdges: TypeHierarchyEdgeViewModel[] = [];
  const counts: TypeHierarchyConfidenceCounts = {
    declared: 0,
    structuralShape: 0,
    typeAware: 0,
  };
  for (const edge of input.graph.edges) {
    const fromNode = nodeIndexByUri.get(edge.fromUri);
    const toNode = nodeIndexByUri.get(edge.toUri);
    if (!fromNode || !toNode) continue;
    const layoutEdge: TypeHierarchyEdgeViewModel = {
      fromUri: edge.fromUri,
      toUri: edge.toUri,
      x1: fromNode.x,
      y1: fromNode.y,
      x2: toNode.x,
      y2: toNode.y,
    };
    if (edge.typeRelationConfidence !== undefined) {
      layoutEdge.typeRelationConfidence = edge.typeRelationConfidence;
    }
    layoutEdges.push(layoutEdge);
    typeHierarchyConfidenceTally(counts, edge.typeRelationConfidence);
  }

  const emptyMessage =
    layoutNodes.length <= 1
      ? input.direction === 'supertypes'
        ? `${focusName} has no supertypes in the type hierarchy.`
        : input.direction === 'subtypes'
          ? `${focusName} has no subtypes in the type hierarchy.`
          : `${focusName} is not connected to any other type in the hierarchy.`
      : '';

  const result: TypeHierarchyPanelViewModel = {
    focusSymbolId: input.focusSymbolId,
    focusSymbolName: focusName,
    graph: {
      width,
      height,
      nodes: layoutNodes,
      edges: layoutEdges,
      emptyMessage,
    },
    controls: typeHierarchyControlsViewModelCreate({
      direction: input.direction,
      depth: input.depth,
    }),
    direction: input.direction,
    depth: input.depth,
    edgeCounts: counts,
  };
  if (focusNode?.declarationUri !== undefined) {
    result.focusDeclarationUri = focusNode.declarationUri;
  }
  if (focusNode?.declarationRange !== undefined) {
    result.focusDeclarationRange = focusNode.declarationRange;
  }
  if (input.lensSwitcher !== undefined) {
    result.lensSwitcher = input.lensSwitcher;
  }
  return result;
}

/**
 * Resolve a click on a node's `data-open-uri` attribute to the
 * `(uri, line, character)` tuple the panel should ask VS Code to
 * open. Mirrors {@link callGraphNodeOpenLocationResolve}.
 */
export function typeHierarchyNodeOpenLocationResolve(input: {
  model: TypeHierarchyPanelViewModel;
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
  return {
    uri: input.uri,
    line: node.declarationRange?.start.line ?? 0,
    character: node.declarationRange?.start.character ?? 0,
  };
}

function typeHierarchySymbolUriCreate(symbolId: string): string {
  return `${SYMBOL_URI_SCHEME_PREFIX}${encodeURIComponent(symbolId)}`;
}

function typeHierarchyConfidenceTally(
  counts: TypeHierarchyConfidenceCounts,
  confidence: WorkspaceTypeHierarchyEdgeConfidence | undefined,
): void {
  if (confidence === 'structural-shape') {
    counts.structuralShape += 1;
    return;
  }
  if (confidence === 'type-aware') {
    counts.typeAware += 1;
    return;
  }
  // Absent ⇒ declared, per the contract on
  // `WorkspaceDependencyGraphEdge.typeRelationConfidence`.
  counts.declared += 1;
}

/**
 * BFS over the supplied adjacency map starting from `seedUri`.
 * Returns layers indexed by hop distance (`layers[0]` is the seed's
 * direct neighbors, `layers[1]` is two hops, …). The seed itself is
 * NOT included.
 */
function typeHierarchyBfsLayers(input: {
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

function typeHierarchyLayoutLayers(input: {
  layers: string[][];
  direction: 'supertype' | 'subtype';
  nodesByUri: Map<string, WorkspaceDependencyGraphNode>;
  out: TypeHierarchyNodeViewModel[];
}): void {
  // Supertypes sit above the seed (negative y); subtypes below.
  const ySign = input.direction === 'supertype' ? -1 : 1;
  for (let layerIndex = 0; layerIndex < input.layers.length; layerIndex += 1) {
    const layer = input.layers[layerIndex]!;
    const sortedLayer = [...layer].sort();
    const layerWidth = (sortedLayer.length - 1) * COLUMN_WIDTH;
    const startX = -layerWidth / 2;
    for (let i = 0; i < sortedLayer.length; i += 1) {
      const uri = sortedLayer[i]!;
      const node = input.nodesByUri.get(uri);
      const symbolName = node?.symbolName ?? '';
      const layoutNode: TypeHierarchyNodeViewModel = {
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

function typeHierarchyControlsViewModelCreate(input: {
  direction: TypeHierarchyPanelDirection;
  depth: TypeHierarchyPanelDepth;
}): TypeHierarchyControlsViewModel {
  const directions: TypeHierarchyPanelDirection[] = [
    'supertypes',
    'subtypes',
    'both',
  ];
  const depths: TypeHierarchyPanelDepth[] = [1, 2, 'unbounded'];
  return {
    directionChips: directions.map((d) => ({
      id: `direction:${d}`,
      label:
        d === 'supertypes' ? 'Supertypes' : d === 'subtypes' ? 'Subtypes' : 'Both',
      active: d === input.direction,
    })),
    depthChips: depths.map((d) => ({
      id: `depth:${String(d)}`,
      label: d === 'unbounded' ? 'Unbounded' : `Depth ${d}`,
      active: d === input.depth,
    })),
  };
}
