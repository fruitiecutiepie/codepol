/**
 * Pure renderers for `codepol graph export --format <format>`.
 *
 * Each renderer transforms a {@link WorkspaceDependencyGraphResult} into
 * a string that downstream tools (Graphviz, Mermaid Live Editor, Gephi,
 * docs sites) can consume directly. Renderers are pure functions so they
 * can be unit-tested without spinning up the workspace service.
 *
 * Determinism rules (so diffing two exports of the same graph is stable):
 *
 * - Nodes are emitted sorted by `workspaceRelativePath` (alphabetical),
 *   tie-broken by `uri`. This matches `WorkspaceDependencyGraphResult`'s
 *   own deterministic `nodes` ordering but we re-sort defensively.
 * - Edges are emitted sorted by `(fromKey, toKey)`.
 * - Stable per-graph node ids (`n0`, `n1`, …) are assigned from the
 *   sorted node list so two exports of the same graph produce identical
 *   bytes regardless of the underlying URI strings.
 */
import type { WorkspaceDependencyGraphResult } from '@codepol/core';

export type GraphExportFormat = 'json' | 'text' | 'dot' | 'mermaid' | 'graphml';

const GRAPH_EXPORT_FORMATS: readonly GraphExportFormat[] = [
  'json',
  'text',
  'dot',
  'mermaid',
  'graphml',
];

export function graphExportFormatParse(raw: string | undefined): GraphExportFormat {
  if (raw === undefined) return 'json';
  const lowered = raw.trim().toLowerCase();
  if ((GRAPH_EXPORT_FORMATS as readonly string[]).includes(lowered)) {
    return lowered as GraphExportFormat;
  }
  throw new Error(
    `Unknown graph export format "${raw}". Expected one of: ${GRAPH_EXPORT_FORMATS.join(', ')}`,
  );
}

export function graphExportFormatChoices(): readonly GraphExportFormat[] {
  return GRAPH_EXPORT_FORMATS;
}

type NormalizedNode = {
  uri: string;
  workspaceRelativePath: string;
  id: string;
};

type NormalizedEdge = {
  fromId: string;
  toId: string;
  fromLabel: string;
  toLabel: string;
};

function nodesNormalize(graph: WorkspaceDependencyGraphResult): NormalizedNode[] {
  const sorted = [...graph.nodes].sort((left, right) => {
    if (left.workspaceRelativePath !== right.workspaceRelativePath) {
      return left.workspaceRelativePath < right.workspaceRelativePath ? -1 : 1;
    }
    return left.uri < right.uri ? -1 : left.uri > right.uri ? 1 : 0;
  });
  return sorted.map((node, index) => ({
    uri: node.uri,
    workspaceRelativePath: node.workspaceRelativePath,
    id: `n${index}`,
  }));
}

function edgesNormalize(
  graph: WorkspaceDependencyGraphResult,
  nodes: NormalizedNode[],
): NormalizedEdge[] {
  const idByUri = new Map<string, string>();
  const labelByUri = new Map<string, string>();
  for (const node of nodes) {
    idByUri.set(node.uri, node.id);
    labelByUri.set(node.uri, node.workspaceRelativePath);
  }
  const result: NormalizedEdge[] = [];
  for (const edge of graph.edges) {
    const fromId = idByUri.get(edge.fromUri);
    const toId = idByUri.get(edge.toUri);
    if (fromId === undefined || toId === undefined) {
      // Skip edges whose endpoints didn't make it into the node set;
      // this can only happen with corrupt inputs but we'd rather drop
      // than throw because exports are diagnostic by nature.
      continue;
    }
    result.push({
      fromId,
      toId,
      fromLabel: labelByUri.get(edge.fromUri) ?? edge.fromUri,
      toLabel: labelByUri.get(edge.toUri) ?? edge.toUri,
    });
  }
  result.sort((left, right) => {
    if (left.fromId !== right.fromId) {
      return left.fromId.length === right.fromId.length
        ? left.fromId < right.fromId
          ? -1
          : 1
        : left.fromId.length - right.fromId.length;
    }
    return left.toId.length === right.toId.length
      ? left.toId < right.toId
        ? -1
        : left.toId > right.toId
          ? 1
          : 0
      : left.toId.length - right.toId.length;
  });
  return result;
}

function dotStringEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function graphExportRenderDot(graph: WorkspaceDependencyGraphResult): string {
  const nodes = nodesNormalize(graph);
  const edges = edgesNormalize(graph, nodes);
  const lines: string[] = [];
  lines.push('digraph codepol {');
  lines.push('  rankdir=LR;');
  lines.push('  node [shape=box, fontname="Helvetica"];');
  for (const node of nodes) {
    lines.push(`  ${node.id} [label="${dotStringEscape(node.workspaceRelativePath)}"];`);
  }
  for (const edge of edges) {
    lines.push(`  ${edge.fromId} -> ${edge.toId};`);
  }
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

export function graphExportRenderMermaid(graph: WorkspaceDependencyGraphResult): string {
  const nodes = nodesNormalize(graph);
  const edges = edgesNormalize(graph, nodes);
  const lines: string[] = [];
  lines.push('flowchart LR');
  for (const node of nodes) {
    // Use square-bracket node syntax with a quoted label so paths with
    // dots and slashes survive the Mermaid parser unchanged.
    lines.push(`  ${node.id}["${node.workspaceRelativePath.replace(/"/g, '\\"')}"]`);
  }
  for (const edge of edges) {
    lines.push(`  ${edge.fromId} --> ${edge.toId}`);
  }
  return `${lines.join('\n')}\n`;
}

function xmlAttributeEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function graphExportRenderGraphMl(graph: WorkspaceDependencyGraphResult): string {
  const nodes = nodesNormalize(graph);
  const edges = edgesNormalize(graph, nodes);
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns" ' +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
      'xsi:schemaLocation="http://graphml.graphdrawing.org/xmlns ' +
      'http://graphml.graphdrawing.org/xmlns/1.1/graphml.xsd">',
  );
  lines.push('  <key id="label" for="node" attr.name="label" attr.type="string"/>');
  lines.push('  <key id="uri" for="node" attr.name="uri" attr.type="string"/>');
  lines.push('  <graph id="codepol" edgedefault="directed">');
  for (const node of nodes) {
    lines.push(`    <node id="${node.id}">`);
    lines.push(
      `      <data key="label">${xmlAttributeEscape(node.workspaceRelativePath)}</data>`,
    );
    lines.push(`      <data key="uri">${xmlAttributeEscape(node.uri)}</data>`);
    lines.push('    </node>');
  }
  for (let index = 0; index < edges.length; index += 1) {
    const edge = edges[index];
    if (!edge) continue;
    lines.push(
      `    <edge id="e${index}" source="${edge.fromId}" target="${edge.toId}"/>`,
    );
  }
  lines.push('  </graph>');
  lines.push('</graphml>');
  return `${lines.join('\n')}\n`;
}
