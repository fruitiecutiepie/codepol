/**
 * HTML renderer for the dedicated type-hierarchy panel.
 *
 * Sibling to {@link callGraphRender} — both render directional
 * symbol graphs as inline SVG inside the panel shell. This module
 * adds three confidence-tier edge styles plus a legend so users can
 * read what they're looking at without a tooltip:
 *
 * - solid stroke:   declared (`extends` / `implements` in source)
 * - dashed stroke:  structural-shape (Phase 9.4 cross-file shape match)
 * - emphasized:     type-aware (Phase 9.5 language-server binding)
 *
 * Layout, click handling, and chip wiring follow `callGraphRender`
 * one-for-one — `data-cg-chip-*` attributes are reused so the panel
 * shell's inline `<script>` does not need a new branch. Per-node SVG
 * carries `data-open-uri` so the panel manager's existing
 * `openLocation` message can fire on click.
 */

import type {
  TypeHierarchyCanvasViewModel,
  TypeHierarchyChipViewModel,
  TypeHierarchyControlsViewModel,
  TypeHierarchyConfidenceCounts,
  TypeHierarchyPanelViewModel,
} from '../typeHierarchyViewModels';

function htmlEscape(value: string): string {
  return value
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;')
    .split("'").join('&#39;');
}

function typeHierarchyChipHtml(
  chip: TypeHierarchyChipViewModel,
  group: 'direction' | 'depth',
): string {
  const description = chip.description
    ? ` title="${htmlEscape(chip.description)}"`
    : '';
  const value = chip.id.startsWith(`${group}:`) ? chip.id.slice(group.length + 1) : chip.id;
  // Reuse the call-graph chip class names for visual styling but
  // tag with `data-th-chip-*` so the panel shell dispatches the
  // type-hierarchy-specific message type. The two panels share
  // chip CSS but never collide on chip values (call graph uses
  // 'callers'/'callees', type hierarchy uses 'supertypes'/'subtypes').
  return `<button
      type="button"
      class="cg-chip${chip.active ? ' cg-chip-active' : ''}"
      data-th-chip-group="${htmlEscape(group)}"
      data-th-chip-value="${htmlEscape(value)}"
      ${description}
    >${htmlEscape(chip.label)}</button>`;
}

function typeHierarchyControlsHtml(controls: TypeHierarchyControlsViewModel): string {
  return `<div class="cg-controls">
    <div class="cg-chip-row" role="group" aria-label="Direction">
      <span class="cg-chip-row-label">Direction</span>
      ${controls.directionChips.map((c) => typeHierarchyChipHtml(c, 'direction')).join('')}
    </div>
    <div class="cg-chip-row" role="group" aria-label="Depth">
      <span class="cg-chip-row-label">Depth</span>
      ${controls.depthChips.map((c) => typeHierarchyChipHtml(c, 'depth')).join('')}
    </div>
  </div>`;
}

/**
 * Three-row legend explaining the confidence tiers. Renders a tiny
 * SVG swatch for each tier so the visual matches the actual edge
 * style users see on the canvas.
 */
export function typeHierarchyLegendHtml(): string {
  const swatch = (className: string): string =>
    `<svg class="th-legend-swatch" viewBox="0 0 24 8" aria-hidden="true">
      <line class="cg-edge ${className}" x1="0" y1="4" x2="24" y2="4" />
    </svg>`;
  return `<ul class="th-legend" role="list">
    <li>
      ${swatch('th-edge-declared')}
      <span class="th-legend-label">Declared</span>
      <span class="th-legend-detail">extends / implements clause in source code</span>
    </li>
    <li>
      ${swatch('th-edge-structural-shape')}
      <span class="th-legend-label">Shape-matched</span>
      <span class="th-legend-detail">name + arity match — may include false positives</span>
    </li>
    <li>
      ${swatch('th-edge-type-aware')}
      <span class="th-legend-label">Type-aware</span>
      <span class="th-legend-detail">confirmed by the language server</span>
    </li>
  </ul>`;
}

function typeHierarchyConfidenceClassResolve(
  confidence: string | undefined,
): string {
  if (confidence === 'structural-shape') return 'th-edge-structural-shape';
  if (confidence === 'type-aware') return 'th-edge-type-aware';
  return 'th-edge-declared';
}

function typeHierarchySvgHtml(canvas: TypeHierarchyCanvasViewModel): string {
  if (canvas.nodes.length === 0) {
    return `<p class="th-empty">${htmlEscape(canvas.emptyMessage || 'No type-hierarchy data.')}</p>`;
  }

  const edges = canvas.edges
    .map((edge) => {
      const confidenceClass = typeHierarchyConfidenceClassResolve(
        edge.typeRelationConfidence,
      );
      return `<line
        class="cg-edge ${confidenceClass}"
        x1="${edge.x1}" y1="${edge.y1}"
        x2="${edge.x2}" y2="${edge.y2}"
        data-from-uri="${htmlEscape(edge.fromUri)}"
        data-to-uri="${htmlEscape(edge.toUri)}"
      />`;
    })
    .join('');

  const nodes = canvas.nodes
    .map((node) => {
      const labelText = node.symbolName.length > 0 ? node.symbolName : '<anonymous>';
      const detailText = node.symbolKind ? ` ${node.symbolKind}` : '';
      const ariaLabel = `${labelText}${detailText}`;
      return `<g class="cg-node cg-node-${node.layer}${node.isFocus ? ' cg-node-focus' : ''}"
          data-open-uri="${htmlEscape(node.uri)}"
          tabindex="0"
          role="button"
          aria-label="${htmlEscape(ariaLabel)}"
        >
        <circle cx="${node.x}" cy="${node.y}" r="${node.r}" />
        <text x="${node.x}" y="${node.y + node.r + 14}" text-anchor="middle">
          ${htmlEscape(labelText)}
        </text>
      </g>`;
    })
    .join('');

  return `<svg
      class="cg-canvas"
      viewBox="0 0 ${canvas.width} ${canvas.height}"
      width="100%"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Type hierarchy canvas"
    >
      <g class="cg-edges">${edges}</g>
      <g class="cg-nodes">${nodes}</g>
    </svg>`;
}

function typeHierarchyCountsHtml(counts: TypeHierarchyConfidenceCounts): string {
  const parts: string[] = [];
  parts.push(`${counts.declared} declared`);
  if (counts.structuralShape > 0) {
    parts.push(`${counts.structuralShape} shape-matched`);
  }
  if (counts.typeAware > 0) {
    parts.push(`${counts.typeAware} from language server`);
  }
  return parts.join(' \u00b7 ');
}

const TYPE_HIERARCHY_PANEL_CSS = `
  .th-card { padding: 12px; border: 1px solid var(--vscode-panel-border); border-radius: 10px; background: var(--vscode-editor-background); }
  .th-header { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
  .th-header h2 { margin: 0; font-size: 14px; }
  .th-summary { color: var(--vscode-descriptionForeground); font-size: 12px; }
  .cg-controls { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
  .cg-chip-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .cg-chip-row-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--vscode-descriptionForeground); margin-right: 4px; }
  .cg-chip { padding: 2px 8px; border-radius: 999px; border: 1px solid var(--vscode-panel-border); background: transparent; color: var(--vscode-foreground); font-size: 11px; cursor: pointer; }
  .cg-chip-active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: transparent; }
  .th-legend { list-style: none; margin: 0 0 12px 0; padding: 8px 12px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; display: flex; flex-direction: column; gap: 4px; }
  .th-legend li { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .th-legend-swatch { width: 24px; height: 8px; flex-shrink: 0; }
  .th-legend-label { font-weight: 600; color: var(--vscode-foreground); min-width: 110px; }
  .th-legend-detail { color: var(--vscode-descriptionForeground); font-size: 11px; }
  .cg-canvas { width: 100%; height: auto; max-height: 70vh; }
  .cg-edge { stroke: var(--vscode-editorIndentGuide-background); stroke-width: 1.5; fill: none; }
  .cg-edge.th-edge-declared { stroke: var(--vscode-foreground); stroke-width: 1.5; }
  .cg-edge.th-edge-structural-shape { stroke: var(--vscode-foreground); stroke-width: 1.5; stroke-dasharray: 4 3; opacity: 0.85; }
  .cg-edge.th-edge-type-aware { stroke: var(--vscode-textLink-activeForeground); stroke-width: 2.5; }
  .cg-node circle { fill: var(--vscode-editor-background); stroke: var(--vscode-foreground); stroke-width: 1.25; }
  .cg-node-focus circle { fill: var(--vscode-button-background); stroke: var(--vscode-button-background); }
  .cg-node-supertype circle { stroke: var(--vscode-symbolIcon-interfaceForeground, #75beff); }
  .cg-node-subtype circle { stroke: var(--vscode-symbolIcon-classForeground, #ee9d28); }
  .cg-node text { fill: var(--vscode-foreground); font-size: 11px; }
  .cg-node { cursor: pointer; }
  .cg-node:focus { outline: 2px solid var(--vscode-focusBorder); }
  .th-empty { color: var(--vscode-descriptionForeground); font-size: 12px; }
`;

/**
 * Build the panel `<body>` HTML. Click handling is delegated to the
 * shell's single `BASE_SCRIPT` (in `render.ts`); chips reuse the
 * `data-cg-chip-*` attribute pair so the existing dispatcher routes
 * messages to the manager's chip handler.
 */
export function typeHierarchyPanelBodyHtml(input: {
  model: TypeHierarchyPanelViewModel;
}): string {
  const { model } = input;
  const summaryParts = [
    `${model.graph.nodes.length} nodes`,
    `${model.graph.edges.length} edges`,
    `direction: ${model.direction}`,
    `depth: ${typeof model.depth === 'string' ? model.depth : `up to ${model.depth}`}`,
  ];
  const headingName = model.focusSymbolName.length > 0
    ? model.focusSymbolName
    : '<anonymous>';
  const countsLine = typeHierarchyCountsHtml(model.edgeCounts);
  return `<style>${TYPE_HIERARCHY_PANEL_CSS}</style>
    <section class="th-card">
      <header class="th-header">
        <h2>Type Hierarchy: ${htmlEscape(headingName)}</h2>
        <p class="th-summary">${htmlEscape(summaryParts.join(' \u00b7 '))}</p>
        <p class="th-summary">${htmlEscape(countsLine)}</p>
      </header>
      ${typeHierarchyControlsHtml(model.controls)}
      ${typeHierarchyLegendHtml()}
      ${typeHierarchySvgHtml(model.graph)}
    </section>`;
}
