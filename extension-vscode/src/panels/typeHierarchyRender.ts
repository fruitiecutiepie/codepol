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
 * Phase 7 polish: chip rows, the per-tier counts header, the legend,
 * and the lens-switcher header affordance funnel through the shared
 * helpers in {@link panelShared} so the visual grammar matches the
 * call-graph panel exactly.
 *
 * Layout, click handling, and chip wiring follow `callGraphRender`
 * one-for-one — `data-th-chip-*` attributes route messages
 * specifically to the type-hierarchy handler in `manager.ts`.
 * Per-node SVG carries `data-open-uri` so the panel manager's
 * existing `openLocation` message can fire on click.
 */

import type {
  TypeHierarchyCanvasViewModel,
  TypeHierarchyChipViewModel,
  TypeHierarchyControlsViewModel,
  TypeHierarchyConfidenceCounts,
  TypeHierarchyPanelViewModel,
} from '../typeHierarchyViewModels';
import {
  panelChipRowHtml,
  panelLegendHtml,
  panelLensSwitcherHtml,
} from './panelShared';

function htmlEscape(value: string): string {
  return value
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;')
    .split("'").join('&#39;');
}

function typeHierarchyChipDescriptorCreate(
  chip: TypeHierarchyChipViewModel,
  group: 'direction' | 'depth',
): import('./panelShared').PanelChipDescriptor {
  const value = chip.id.startsWith(`${group}:`)
    ? chip.id.slice(group.length + 1)
    : chip.id;
  return {
    label: chip.label,
    active: chip.active,
    ...(chip.description !== undefined ? { description: chip.description } : {}),
    dataAttributes: {
      'data-th-chip-group': group,
      'data-th-chip-value': value,
    },
  };
}

function typeHierarchyControlsHtml(controls: TypeHierarchyControlsViewModel): string {
  return `<div class="cg-controls">
    ${panelChipRowHtml({
      label: 'Direction',
      chips: controls.directionChips.map((c) =>
        typeHierarchyChipDescriptorCreate(c, 'direction'),
      ),
      rowExtraClass: 'cg-chip-row',
      chipExtraClass: 'cg-chip',
    })}
    ${panelChipRowHtml({
      label: 'Depth',
      chips: controls.depthChips.map((c) =>
        typeHierarchyChipDescriptorCreate(c, 'depth'),
      ),
      rowExtraClass: 'cg-chip-row',
      chipExtraClass: 'cg-chip',
    })}
  </div>`;
}

/**
 * Three-row legend explaining the confidence tiers. Renders a tiny
 * SVG swatch for each tier so the visual matches the actual edge
 * style users see on the canvas. Exported so the test suite can
 * assert the human-readable copy in isolation from the panel body.
 */
export function typeHierarchyLegendHtml(): string {
  return panelLegendHtml({
    entries: [
      {
        label: 'Declared',
        detail: 'extends / implements clause in source code',
        swatchClass: 'th-edge-declared',
      },
      {
        label: 'Shape-matched',
        detail: 'name + arity match — may include false positives',
        swatchClass: 'th-edge-structural-shape',
      },
      {
        label: 'Type-aware',
        detail: 'confirmed by the language server',
        swatchClass: 'th-edge-type-aware',
      },
    ],
  });
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

/**
 * Tier counts line. The `declared` count always renders (even at
 * zero) — the panel shipped this row from day one and dropping it on
 * zero would surprise readers used to the existing layout. The other
 * tiers collapse when zero so the line stays terse on declared-only
 * graphs.
 */
function typeHierarchyTallyHtml(counts: TypeHierarchyConfidenceCounts): string {
  const parts: string[] = [`${counts.declared} declared`];
  if (counts.structuralShape > 0) {
    parts.push(`${counts.structuralShape} shape-matched`);
  }
  if (counts.typeAware > 0) {
    parts.push(`${counts.typeAware} from language server`);
  }
  return `<p class="panel-tally th-summary">${htmlEscape(parts.join(' \u00b7 '))}</p>`;
}

const TYPE_HIERARCHY_PANEL_CSS = `
  .th-card { padding: 12px; border: 1px solid var(--vscode-panel-border); border-radius: 10px; background: var(--vscode-editor-background); }
  .th-header { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
  .th-header h2 { margin: 0; font-size: 14px; }
  .th-summary { color: var(--vscode-descriptionForeground); font-size: 12px; }
  .cg-controls { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
  .cg-chip-row { /* parity hook; layout supplied by .panel-chip-row */ }
  .cg-chip { /* parity hook; styling supplied by .panel-chip */ }
  .cg-chip-active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: transparent; }
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
 * Render the panel's header copy: optional lens switcher → title →
 * primary summary line → tier-tally.
 */
function typeHierarchyHeaderHtml(model: TypeHierarchyPanelViewModel): string {
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
  return `<header class="th-header">
    ${lensSwitcher}
    <h2>Type Hierarchy: ${htmlEscape(headingName)}</h2>
    <p class="th-summary">${htmlEscape(summaryParts.join(' \u00b7 '))}</p>
    ${typeHierarchyTallyHtml(model.edgeCounts)}
  </header>`;
}

/**
 * Build the panel `<body>` HTML. Click handling is delegated to the
 * shell's single `BASE_SCRIPT` (in `render.ts`); chips reuse the
 * `data-th-chip-*` attribute pair so the existing dispatcher routes
 * messages to the manager's chip handler.
 */
export function typeHierarchyPanelBodyHtml(input: {
  model: TypeHierarchyPanelViewModel;
}): string {
  const { model } = input;
  return `<style>${TYPE_HIERARCHY_PANEL_CSS}</style>
    <section class="th-card">
      ${typeHierarchyHeaderHtml(model)}
      ${typeHierarchyControlsHtml(model.controls)}
      ${typeHierarchyLegendHtml()}
      ${typeHierarchySvgHtml(model.graph)}
    </section>`;
}
