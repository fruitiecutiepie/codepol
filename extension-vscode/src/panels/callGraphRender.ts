/**
 * HTML renderer for the dedicated call-graph panel.
 *
 * Self-contained on purpose — the file-graph renderer in `render.ts`
 * couples node rendering with file-graph-specific filter chips,
 * hotspots, and "blast radius" affordances that don't apply to
 * symbol-level call graphs. Per the plan ("no refactor of
 * `render.ts`"), this module duplicates the small subset of SVG
 * primitives the call-graph layout needs and stays free of any
 * imports from the file-graph render path.
 *
 * The output HTML is rendered inside `codepolPanelHtmlRender`'s
 * `<body>`; the surrounding `<head>` (CSP, base styles) is supplied
 * by render.ts so the call-graph panel inherits the standard panel
 * shell. Per-node SVG carries `data-open-uri` so the panel manager's
 * existing `openLocation` message can fire on click — the manager
 * runs the URI through `callGraphNodeOpenLocationResolve` before
 * dispatching, so symbol URIs end up at the symbol's declaration.
 */

import type {
  CallGraphCanvasViewModel,
  CallGraphChipViewModel,
  CallGraphControlsViewModel,
  CallGraphPanelViewModel,
} from '../callGraphViewModels';

function htmlEscape(value: string): string {
  return value
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;')
    .split("'").join('&#39;');
}

function callGraphChipHtml(
  chip: CallGraphChipViewModel,
  group: 'direction' | 'depth' | 'confidence' | 'kind',
): string {
  const description = chip.description
    ? ` title="${htmlEscape(chip.description)}"`
    : '';
  // The chip id is `<group>:<value>`; strip the prefix so the click
  // handler in render.ts only has to read `data-cg-chip-value`.
  const value = chip.id.startsWith(`${group}:`) ? chip.id.slice(group.length + 1) : chip.id;
  return `<button
      type="button"
      class="cg-chip${chip.active ? ' cg-chip-active' : ''}"
      data-cg-chip-group="${htmlEscape(group)}"
      data-cg-chip-value="${htmlEscape(value)}"
      ${description}
    >${htmlEscape(chip.label)}</button>`;
}

function callGraphControlsHtml(controls: CallGraphControlsViewModel): string {
  return `<div class="cg-controls">
    <div class="cg-chip-row" role="group" aria-label="Direction">
      <span class="cg-chip-row-label">Direction</span>
      ${controls.directionChips.map((c) => callGraphChipHtml(c, 'direction')).join('')}
    </div>
    <div class="cg-chip-row" role="group" aria-label="Depth">
      <span class="cg-chip-row-label">Depth</span>
      ${controls.depthChips.map((c) => callGraphChipHtml(c, 'depth')).join('')}
    </div>
    <div class="cg-chip-row cg-chip-row-inert" role="group" aria-label="Confidence">
      <span class="cg-chip-row-label">Confidence</span>
      ${controls.confidenceChips.map((c) => callGraphChipHtml(c, 'confidence')).join('')}
      <span class="cg-chip-row-note">populated when a TypeAwareCallGraphSource is wired</span>
    </div>
    <div class="cg-chip-row cg-chip-row-inert" role="group" aria-label="Kind">
      <span class="cg-chip-row-label">Kind</span>
      ${controls.kindChips.map((c) => callGraphChipHtml(c, 'kind')).join('')}
    </div>
  </div>`;
}

function callGraphSvgHtml(canvas: CallGraphCanvasViewModel): string {
  if (canvas.nodes.length === 0) {
    return `<p class="empty">${htmlEscape(canvas.emptyMessage || 'No call-graph data.')}</p>`;
  }

  const edges = canvas.edges
    .map((edge) => {
      const confidenceClass = edge.callGraphConfidence === 'type-aware'
        ? 'cg-edge-type-aware'
        : 'cg-edge-structural';
      const kindClass = edge.callGraphKind
        ? `cg-edge-kind-${edge.callGraphKind}`
        : 'cg-edge-kind-direct';
      return `<line
        class="cg-edge ${confidenceClass} ${kindClass}"
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
      aria-label="Call graph canvas"
    >
      <g class="cg-edges">${edges}</g>
      <g class="cg-nodes">${nodes}</g>
    </svg>`;
}

const CALL_GRAPH_PANEL_CSS = `
  .cg-card { padding: 12px; border: 1px solid var(--vscode-panel-border); border-radius: 10px; background: var(--vscode-editor-background); }
  .cg-header { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
  .cg-header h2 { margin: 0; font-size: 14px; }
  .cg-header .cg-summary { color: var(--vscode-descriptionForeground); font-size: 12px; }
  .cg-controls { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
  .cg-chip-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .cg-chip-row-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--vscode-descriptionForeground); margin-right: 4px; }
  .cg-chip-row-inert .cg-chip { opacity: 0.55; pointer-events: none; }
  .cg-chip-row-note { font-size: 11px; color: var(--vscode-descriptionForeground); margin-left: auto; }
  .cg-chip { padding: 2px 8px; border-radius: 999px; border: 1px solid var(--vscode-panel-border); background: transparent; color: var(--vscode-foreground); font-size: 11px; cursor: pointer; }
  .cg-chip-active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: transparent; }
  .cg-canvas { width: 100%; height: auto; max-height: 70vh; }
  .cg-edge { stroke: var(--vscode-editorIndentGuide-background); stroke-width: 1.5; }
  .cg-edge-type-aware { stroke-width: 2.25; }
  .cg-edge-kind-dynamic-dispatch { stroke-dasharray: 6 4; }
  .cg-edge-kind-higher-order { stroke-dasharray: 2 3; }
  .cg-node circle { fill: var(--vscode-editor-background); stroke: var(--vscode-foreground); stroke-width: 1.25; }
  .cg-node-focus circle { fill: var(--vscode-button-background); stroke: var(--vscode-button-background); }
  .cg-node-caller circle { stroke: var(--vscode-symbolIcon-functionForeground, #b4c4ff); }
  .cg-node-callee circle { stroke: var(--vscode-symbolIcon-methodForeground, #c0c0ff); }
  .cg-node text { fill: var(--vscode-foreground); font-size: 11px; }
  .cg-node { cursor: pointer; }
  .cg-node:focus { outline: 2px solid var(--vscode-focusBorder); }
  .cg-empty { color: var(--vscode-descriptionForeground); font-size: 12px; }
`;

/**
 * Build the panel `<body>` HTML.
 *
 * Click handling is intentionally delegated to the panel shell's
 * single `BASE_SCRIPT` (in `render.ts`) so the panel only ever calls
 * `acquireVsCodeApi()` once. Nodes carry `data-open-uri` (the
 * standard panel attribute) and chips carry `data-cg-chip-group` /
 * `data-cg-chip-value` (the new attribute pair the shell knows about
 * for the call-graph panel).
 */
export function callGraphPanelBodyHtml(input: {
  model: CallGraphPanelViewModel;
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
  return `<style>${CALL_GRAPH_PANEL_CSS}</style>
    <section class="cg-card">
      <header class="cg-header">
        <h2>Call Graph: ${htmlEscape(headingName)}</h2>
        <p class="cg-summary">${htmlEscape(summaryParts.join(' \u00b7 '))}</p>
      </header>
      ${callGraphControlsHtml(model.controls)}
      ${callGraphSvgHtml(model.graph)}
    </section>`;
}
