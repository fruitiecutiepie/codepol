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
 * Phase 7 polish: chip rows, the second-summary tally, the legend,
 * the lens-switcher header affordance, the locked mode pill, and the
 * structural-confidence banner all funnel through the shared helpers
 * in {@link panelShared} so the visual grammar is uniform across the
 * call-graph, type-hierarchy, dependency-graph, and architecture-links
 * panels.
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
import {
  panelChipRowHtml,
  panelConfidenceBannerHtml,
  panelLegendHtml,
  panelLensSwitcherHtml,
  panelModePillHtml,
  panelTallyHeaderHtml,
} from './panelShared';

function htmlEscape(value: string): string {
  return value
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;')
    .split("'").join('&#39;');
}

/**
 * Convert one viewmodel chip into the shared-helper descriptor shape.
 * The data-attribute pair stays panel-specific (`data-cg-chip-*`) so
 * the existing BASE_SCRIPT dispatcher and the existing test
 * assertions on those attributes continue to work after the helper
 * migration.
 */
function callGraphChipDescriptorCreate(
  chip: CallGraphChipViewModel,
  group: 'direction' | 'depth' | 'confidence' | 'kind',
  options: { locked?: boolean } = {},
): import('./panelShared').PanelChipDescriptor {
  // The chip id is `<group>:<value>`; strip the prefix so the click
  // handler in render.ts only has to read `data-cg-chip-value`.
  const value = chip.id.startsWith(`${group}:`)
    ? chip.id.slice(group.length + 1)
    : chip.id;
  return {
    label: chip.label,
    active: chip.active,
    locked: options.locked === true,
    ...(chip.description !== undefined ? { description: chip.description } : {}),
    dataAttributes: {
      'data-cg-chip-group': group,
      'data-cg-chip-value': value,
    },
  };
}

function callGraphControlsHtml(
  controls: CallGraphControlsViewModel,
  options: { locked?: boolean } = {},
): string {
  const directionRow = panelChipRowHtml({
    label: 'Direction',
    chips: controls.directionChips.map((c) =>
      callGraphChipDescriptorCreate(c, 'direction', { locked: options.locked }),
    ),
    rowExtraClass: 'cg-chip-row',
    chipExtraClass: 'cg-chip',
  });
  const depthRow = panelChipRowHtml({
    label: 'Depth',
    chips: controls.depthChips.map((c) =>
      callGraphChipDescriptorCreate(c, 'depth', { locked: options.locked }),
    ),
    rowExtraClass: 'cg-chip-row',
    chipExtraClass: 'cg-chip',
  });
  const confidenceRow = panelChipRowHtml({
    label: 'Confidence',
    chips: controls.confidenceChips.map((c) =>
      callGraphChipDescriptorCreate(c, 'confidence'),
    ),
    rowExtraClass: 'cg-chip-row',
    chipExtraClass: 'cg-chip',
    note: 'Populated when a TypeAwareCallGraphSource is wired.',
  });
  const kindRow = panelChipRowHtml({
    label: 'Kind',
    chips: controls.kindChips.map((c) =>
      callGraphChipDescriptorCreate(c, 'kind'),
    ),
    rowExtraClass: 'cg-chip-row',
    chipExtraClass: 'cg-chip',
  });
  return `<div class="cg-controls">
    ${directionRow}
    ${depthRow}
    ${confidenceRow}
    ${kindRow}
  </div>`;
}

/**
 * Two-row legend explaining the confidence tiers. Mirrors the
 * type-hierarchy legend so the visual grammar is consistent across
 * symbol-graph panels.
 */
function callGraphLegendHtml(): string {
  return panelLegendHtml({
    entries: [
      {
        label: 'Structural',
        detail: 'direct call edges resolved from the source index',
        swatchClass: 'cg-edge-structural',
      },
      {
        label: 'Type-aware',
        detail: 'confirmed by a registered TypeAwareCallGraphSource',
        swatchClass: 'cg-edge-type-aware',
      },
    ],
  });
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

/**
 * Format a per-tier counts line for the panel header. Zero-count
 * tiers collapse so the line stays terse on small graphs.
 */
function callGraphTallyHtml(model: CallGraphPanelViewModel): string {
  return panelTallyHeaderHtml({
    tallies: [
      { label: 'structural', count: model.edgeCounts.structural },
      { label: 'type-aware', count: model.edgeCounts.typeAware },
    ],
    extraClass: 'cg-summary',
  });
}

/**
 * Render the panel's header copy: lens switcher → optional mode pill
 * → title → primary summary line → tier-tally.
 *
 * The lens switcher and mode pill are optional and collapse to the
 * empty string when absent so the header looks unchanged for callers
 * that don't supply them.
 */
function callGraphHeaderHtml(model: CallGraphPanelViewModel): string {
  const headingName = model.focusSymbolName.length > 0
    ? model.focusSymbolName
    : '<anonymous>';
  const summaryParts = [
    `${model.graph.nodes.length} nodes`,
    `${model.graph.edges.length} edges`,
    `direction: ${model.direction}`,
    `depth: ${typeof model.depth === 'string' ? model.depth : `up to ${model.depth}`}`,
  ];
  const lensSwitcher = model.lensSwitcher
    ? panelLensSwitcherHtml(model.lensSwitcher)
    : '';
  const modePill = model.mode === 'signature-impact'
    ? panelModePillHtml({
        label: 'Signature impact',
        configurationSummary: 'callers, unbounded',
        modeId: 'signature-impact',
        description: 'Locked: showing every caller (transitive). Click \u00d7 to return to interactive mode.',
      })
    : '';
  return `<header class="cg-header">
    ${lensSwitcher}
    ${modePill}
    <h2>Call Graph: ${htmlEscape(headingName)}</h2>
    <p class="cg-summary">${htmlEscape(summaryParts.join(' \u00b7 '))}</p>
    ${callGraphTallyHtml(model)}
  </header>`;
}

const CALL_GRAPH_PANEL_CSS = `
  .cg-card { padding: 12px; border: 1px solid var(--vscode-panel-border); border-radius: 10px; background: var(--vscode-editor-background); }
  .cg-header { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
  .cg-header h2 { margin: 0; font-size: 14px; }
  .cg-header .cg-summary { color: var(--vscode-descriptionForeground); font-size: 12px; }
  .cg-controls { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
  .cg-chip-row { /* parity row hook; layout supplied by .panel-chip-row */ }
  .cg-chip { /* parity chip hook; styling supplied by .panel-chip */ }
  .cg-chip-active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: transparent; }
  .cg-canvas { width: 100%; height: auto; max-height: 70vh; }
  .cg-edge { stroke: var(--vscode-editorIndentGuide-background); stroke-width: 1.5; }
  .cg-edge-structural { stroke: var(--vscode-editorIndentGuide-background); stroke-width: 1.5; }
  .cg-edge-type-aware { stroke: var(--vscode-textLink-activeForeground); stroke-width: 2.25; }
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
 * standard panel attribute), chips carry `data-cg-chip-group` /
 * `data-cg-chip-value` (the existing attribute pair the shell knows
 * about for the call-graph panel), and the lens switcher /
 * mode-clear button rely on the shared `data-panel-lens` /
 * `data-panel-mode-clear` attributes the shell now also dispatches.
 */
export function callGraphPanelBodyHtml(input: {
  model: CallGraphPanelViewModel;
}): string {
  const { model } = input;
  const isLocked = model.mode === 'signature-impact';
  const confidenceBanner = isLocked
    ? panelConfidenceBannerHtml({
        message:
          'Structural confidence — dynamic dispatch and higher-order calls are not tracked.',
      })
    : '';
  return `<style>${CALL_GRAPH_PANEL_CSS}</style>
    <section class="cg-card">
      ${callGraphHeaderHtml(model)}
      ${callGraphControlsHtml(model.controls, { locked: isLocked })}
      ${callGraphLegendHtml()}
      ${confidenceBanner}
      ${callGraphSvgHtml(model.graph)}
    </section>`;
}
