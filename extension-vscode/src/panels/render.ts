import type {
  ArchitectureLinksPanelViewModel,
  ArchitectureSummaryPanelViewModel,
  DependencyGraphCanvasViewModel,
  DependencyGraphPanelViewModel,
  HoverCardViewModel,
  RenamePreviewPanelViewModel,
  SemanticDefinitionPanelViewModel,
  WorkspaceSummaryCardViewModel,
} from '../viewModels';

export type CodepolPanelViewModel =
  | {
      kind: 'semanticDefinition';
      title: string;
      uri: string;
      data: SemanticDefinitionPanelViewModel;
    }
  | {
      kind: 'architectureSummary';
      title: string;
      data: ArchitectureSummaryPanelViewModel;
    }
  | {
      kind: 'dependencyGraph';
      title: string;
      data: DependencyGraphPanelViewModel;
    }
  | {
      kind: 'architectureLinks';
      title: string;
      uri: string;
      data: ArchitectureLinksPanelViewModel;
    }
  | {
      kind: 'renamePreview';
      title: string;
      data: RenamePreviewPanelViewModel;
    };

function htmlEscape(value: string): string {
  return value
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;')
    .split("'").join('&#39;');
}

function hoverActionsHtml(card: HoverCardViewModel, uri: string): string {
  if (card.actions.length === 0) {
    return '';
  }

  return `<div class="actions">${card.actions
    .map(
      (action) =>
        `<button data-action="${htmlEscape(action.action)}" data-uri="${htmlEscape(uri)}">${htmlEscape(action.label)}</button>`,
    )
    .join('')}</div>`;
}

function hoverCardHtml(card: HoverCardViewModel | null, uri: string): string {
  if (!card) {
    return '';
  }

  return `<section class="card">
    <header>
      <h2>${htmlEscape(card.title)}</h2>
      ${card.subtitle ? `<p class="subtitle">${htmlEscape(card.subtitle)}</p>` : ''}
      ${card.summary ? `<p class="summary">${htmlEscape(card.summary)}</p>` : ''}
      ${card.statusText ? `<p class="status">${htmlEscape(card.statusText)}</p>` : ''}
    </header>
    <dl>
      ${card.fields
        .map(
          (field) =>
            `<div class="field"><dt>${htmlEscape(field.label)}</dt><dd>${htmlEscape(field.value)}</dd></div>`,
        )
        .join('')}
    </dl>
    ${hoverActionsHtml(card, uri)}
  </section>`;
}

function locationsHtml(
  items: Array<{
    uri: string;
    line: number;
    character: number;
    label: string;
    detail?: string;
  }>,
): string {
  if (items.length === 0) {
    return '<p class="empty">No Codepol locations are available for this target.</p>';
  }

  return `<ul class="list">${items
    .map(
      (item) => `<li>
        <button class="location" data-open-uri="${htmlEscape(item.uri)}" data-open-line="${item.line}" data-open-character="${item.character}">
          <span class="label">${htmlEscape(item.label)}</span>
          ${item.detail ? `<span class="detail">${htmlEscape(item.detail)}</span>` : ''}
        </button>
      </li>`,
    )
    .join('')}</ul>`;
}

function workspaceSummaryCardHtml(
  summaryCard: WorkspaceSummaryCardViewModel | null,
  title = 'Workspace Summary',
): string {
  if (!summaryCard) {
    return '';
  }

  const hotspotsHtml =
    summaryCard.hotspots.length === 0
      ? '<p class="empty">No hotspots are available yet.</p>'
      : `<ul class="list">${summaryCard.hotspots
          .map(
            (hotspot) => `<li>
              <button class="location" data-open-uri="${htmlEscape(hotspot.uri)}" data-open-line="${hotspot.line}" data-open-character="${hotspot.character}">
                <span class="label">${htmlEscape(hotspot.label)}</span>
                <span class="detail">${htmlEscape(hotspot.detail ?? '')}</span>
              </button>
            </li>`,
          )
          .join('')}</ul>`;

  return `<section class="card">
    <header>
      <h2>${htmlEscape(title)}</h2>
      <p class="summary">${htmlEscape(summaryCard.summary)}</p>
    </header>
    <dl>
      ${summaryCard.metrics
        .map(
          (metric) =>
            `<div class="field"><dt>${htmlEscape(metric.label)}</dt><dd>${htmlEscape(metric.value)}</dd></div>`,
        )
        .join('')}
    </dl>
    <div class="section">
      <h3>Hotspots</h3>
      ${hotspotsHtml}
    </div>
  </section>`;
}

function graphOverviewHtml(summaryCard: WorkspaceSummaryCardViewModel | null): string {
  if (!summaryCard) {
    return '';
  }

  return `<div class="graph-overview">
    <p class="summary">${htmlEscape(summaryCard.summary)}</p>
    <div class="metric-row">${summaryCard.metrics
      .slice(0, 3)
      .map(
        (metric) =>
          `<span class="metric-pill">${htmlEscape(metric.label)}: ${htmlEscape(metric.value)}</span>`,
      )
      .join('')}</div>
  </div>`;
}

function graphSvgHtml(graph: DependencyGraphCanvasViewModel): string {
  if (graph.nodes.length === 0) {
    return `<p class="empty">${htmlEscape(graph.emptyMessage)}</p>`;
  }

  return `<svg class="graph" viewBox="0 0 ${graph.width} ${graph.height}" aria-label="Codepol dependency graph">
    <defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" class="graph-marker"></path>
      </marker>
    </defs>
    ${graph.edges
      .map(
        (edge) => `<line
          class="graph-edge${edge.isFocus ? ' focus' : ''}"
          x1="${edge.x1}"
          y1="${edge.y1}"
          x2="${edge.x2}"
          y2="${edge.y2}"
          marker-end="url(#arrow)"
        ></line>`,
      )
      .join('')}
    ${graph.nodes
      .map(
        (node) => `<g
          class="graph-node${node.isFocus ? ' focus' : ''}${node.isEntryPoint ? ' entry' : ''}${node.isCycleMember ? ' cycle' : ''}"
          data-open-uri="${htmlEscape(node.uri)}"
          data-open-line="0"
          data-open-character="0"
        >
          <rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="14" ry="14"></rect>
          <text x="${node.x + 16}" y="${node.y + 28}">
            <tspan x="${node.x + 16}" dy="0">${htmlEscape(node.label)}</tspan>
            <tspan x="${node.x + 16}" dy="22" class="graph-detail">${htmlEscape(node.detail)}</tspan>
          </text>
        </g>`,
      )
      .join('')}
  </svg>`;
}

function semanticDefinitionBodyHtml(model: SemanticDefinitionPanelViewModel): string {
  return `${hoverCardHtml(model.hoverCard, model.uri)}
    <section class="card">
      <h3>Definition</h3>
      ${locationsHtml(model.locations)}
    </section>`;
}

function architectureSummaryBodyHtml(model: ArchitectureSummaryPanelViewModel): string {
  return workspaceSummaryCardHtml(model.summaryCard);
}

function dependencyGraphBodyHtml(model: DependencyGraphPanelViewModel): string {
  return `${workspaceSummaryCardHtml(model.summaryCard)}
    <section class="card">
      <header>
        <h2>Dependency Graph</h2>
        <p class="summary">Showing ${model.graph.nodes.length} nodes and ${model.graph.edges.length} edges.${model.focusUri ? ` Highlighting ${htmlEscape(model.focusUri)}.` : ''}</p>
      </header>
      ${graphSvgHtml(model.graph)}
    </section>`;
}

function architectureLinksBodyHtml(model: ArchitectureLinksPanelViewModel): string {
  const groupsHtml =
    model.groups.length === 0
      ? '<p class="empty">No Codepol architecture links are available for this target.</p>'
      : model.groups
          .map(
            (group) => `<section class="card">
              <h3>${htmlEscape(group.group)} <span class="count">${group.totalCount}</span></h3>
              ${group.truncated ? '<p class="status">Results truncated.</p>' : ''}
              ${locationsHtml(group.items)}
            </section>`,
          )
          .join('');

  return `${hoverCardHtml(model.hoverCard, model.uri)}
    <section class="card">
      <header>
        <h2>Focused Graph</h2>
        <p class="summary">Showing ${model.totalItems} of ${model.totalAvailableItems} semantic links.</p>
        ${model.truncated ? '<p class="status">Semantic link results are truncated.</p>' : ''}
      </header>
      ${graphOverviewHtml(model.workspaceSummaryCard)}
      ${graphSvgHtml(model.graph)}
    </section>
    ${groupsHtml}`;
}

function renamePreviewGroupsHtml(model: RenamePreviewPanelViewModel): string {
  if (model.groups.length === 0) {
    return '<p class="empty">No rename edits are available yet.</p>';
  }

  return model.groups
    .map(
      (group) => `<section class="card">
        <h3>${htmlEscape(group.title)}</h3>
        <ul class="list">
          ${group.edits
            .map(
              (edit) => `<li>
                <button class="location" data-open-uri="${htmlEscape(edit.uri)}" data-open-line="${edit.line}" data-open-character="${edit.character}">
                  <span class="label">${htmlEscape(edit.kind)}</span>
                  <span class="detail">${htmlEscape(edit.oldText)} → ${htmlEscape(edit.newText)}</span>
                </button>
              </li>`,
            )
            .join('')}
        </ul>
      </section>`,
    )
    .join('');
}

function listSectionHtml(title: string, items: string[]): string {
  if (items.length === 0) {
    return '';
  }

  return `<section class="card">
    <h3>${htmlEscape(title)}</h3>
    <ul class="plain-list">${items
      .map((item) => `<li>${htmlEscape(item)}</li>`)
      .join('')}</ul>
  </section>`;
}

function renamePreviewBodyHtml(model: RenamePreviewPanelViewModel): string {
  const applyButton =
    model.canApply && model.planId
      ? `<div class="actions"><button data-plan-id="${htmlEscape(model.planId)}">Apply Rename</button></div>`
      : '';
  const metaRows = [
    model.currentName ? `<div class="field"><dt>Current name</dt><dd>${htmlEscape(model.currentName)}</dd></div>` : '',
    model.oldName ? `<div class="field"><dt>Preview</dt><dd>${htmlEscape(model.oldName)} → ${htmlEscape(model.newName ?? '')}</dd></div>` : '',
    model.namespaceId ? `<div class="field"><dt>Namespace</dt><dd>${htmlEscape(model.namespaceId)}</dd></div>` : '',
    model.impactedSiteCount !== undefined
      ? `<div class="field"><dt>Impacted sites</dt><dd>${model.impactedSiteCount}</dd></div>`
      : '',
  ]
    .filter((row) => row.length > 0)
    .join('');

  return `<section class="card">
    <header>
      <h2>${htmlEscape(model.targetLabel)}</h2>
      ${model.prepareMessage ? `<p class="status">${htmlEscape(model.prepareMessage)}</p>` : ''}
      ${model.previewMessage ? `<p class="status">${htmlEscape(model.previewMessage)}</p>` : ''}
      ${model.applyMessage ? `<p class="status success">${htmlEscape(model.applyMessage)}</p>` : ''}
    </header>
    <dl>${metaRows}</dl>
    ${applyButton}
  </section>
  ${listSectionHtml('Naming Rules', model.namingRules)}
  ${listSectionHtml('Warnings', model.warnings)}
  ${listSectionHtml('Blocking Issues', model.blockingIssues)}
  ${renamePreviewGroupsHtml(model)}`;
}

const BASE_SCRIPT = `
  const vscode = acquireVsCodeApi();
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const locationButton = target.closest('[data-open-uri]');
    if (locationButton instanceof HTMLElement || locationButton instanceof SVGElement) {
      vscode.postMessage({
        type: 'openLocation',
        uri: locationButton.dataset.openUri,
        line: Number(locationButton.dataset.openLine ?? 0),
        character: Number(locationButton.dataset.openCharacter ?? 0),
      });
      return;
    }
    const actionButton = target.closest('[data-action]');
    if (actionButton instanceof HTMLElement || actionButton instanceof SVGElement) {
      vscode.postMessage({
        type: 'hoverAction',
        action: actionButton.dataset.action,
        uri: actionButton.dataset.uri,
      });
      return;
    }
    const applyButton = target.closest('[data-plan-id]');
    if (applyButton instanceof HTMLElement || applyButton instanceof SVGElement) {
      vscode.postMessage({
        type: 'applyPlan',
        planId: applyButton.dataset.planId,
      });
    }
  });
`;

export function codepolPanelHtmlRender(input: {
  nonce: string;
  model: CodepolPanelViewModel;
}): string {
  const body =
    input.model.kind === 'semanticDefinition'
      ? semanticDefinitionBodyHtml(input.model.data)
      : input.model.kind === 'architectureSummary'
        ? architectureSummaryBodyHtml(input.model.data)
        : input.model.kind === 'dependencyGraph'
          ? dependencyGraphBodyHtml(input.model.data)
          : input.model.kind === 'architectureLinks'
            ? architectureLinksBodyHtml(input.model.data)
            : renamePreviewBodyHtml(input.model.data);

  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta
        http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${input.nonce}';"
      />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>${htmlEscape(input.model.title)}</title>
      <style>
        body {
          font-family: var(--vscode-font-family);
          color: var(--vscode-foreground);
          background: var(--vscode-editor-background);
          padding: 16px;
        }
        .card {
          border: 1px solid var(--vscode-panel-border);
          border-radius: 10px;
          padding: 14px;
          margin-bottom: 14px;
          background: color-mix(in srgb, var(--vscode-editor-background) 90%, var(--vscode-editorInfo-foreground) 10%);
        }
        .section {
          margin-top: 14px;
        }
        .subtitle, .detail, .summary, .status {
          color: var(--vscode-descriptionForeground);
        }
        .success {
          color: var(--vscode-testing-iconPassed);
        }
        h2, h3 {
          margin-top: 0;
        }
        dl {
          margin: 0;
        }
        .field {
          display: grid;
          grid-template-columns: 140px 1fr;
          gap: 8px;
          margin-top: 8px;
        }
        .actions {
          display: flex;
          gap: 8px;
          margin-top: 12px;
          flex-wrap: wrap;
        }
        button {
          border: 1px solid var(--vscode-button-border, transparent);
          border-radius: 8px;
          padding: 8px 10px;
          background: var(--vscode-button-secondaryBackground);
          color: var(--vscode-button-secondaryForeground);
          cursor: pointer;
        }
        button:hover {
          background: var(--vscode-button-secondaryHoverBackground);
        }
        .location {
          width: 100%;
          text-align: left;
          background: var(--vscode-input-background);
        }
        .list, .plain-list {
          list-style: none;
          padding: 0;
          margin: 0;
          display: grid;
          gap: 8px;
        }
        .label {
          display: block;
          font-weight: 600;
        }
        .count {
          color: var(--vscode-descriptionForeground);
          font-weight: normal;
          margin-left: 8px;
        }
        .empty {
          color: var(--vscode-descriptionForeground);
        }
        .graph-overview {
          margin-bottom: 12px;
        }
        .metric-row {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          margin-top: 8px;
        }
        .metric-pill {
          border: 1px solid var(--vscode-panel-border);
          border-radius: 999px;
          padding: 4px 10px;
          color: var(--vscode-descriptionForeground);
          background: color-mix(in srgb, var(--vscode-editor-background) 82%, var(--vscode-textLink-foreground) 18%);
        }
        .graph {
          width: 100%;
          height: auto;
          border: 1px solid var(--vscode-panel-border);
          border-radius: 12px;
          background: color-mix(in srgb, var(--vscode-editor-background) 84%, var(--vscode-textBlockQuote-background) 16%);
        }
        .graph-edge {
          stroke: var(--vscode-panel-border);
          stroke-width: 2;
        }
        .graph-edge.focus {
          stroke: var(--vscode-textLink-foreground);
          stroke-width: 2.5;
        }
        .graph-marker {
          fill: var(--vscode-panel-border);
        }
        .graph-node {
          cursor: pointer;
        }
        .graph-node rect {
          fill: var(--vscode-input-background);
          stroke: var(--vscode-panel-border);
          stroke-width: 1.5;
        }
        .graph-node.focus rect {
          stroke: var(--vscode-textLink-foreground);
          stroke-width: 2.5;
        }
        .graph-node.entry rect {
          fill: color-mix(in srgb, var(--vscode-input-background) 78%, var(--vscode-testing-iconPassed) 22%);
        }
        .graph-node.cycle rect {
          stroke-dasharray: 6 4;
        }
        .graph-node text {
          fill: var(--vscode-foreground);
          font: 600 13px var(--vscode-font-family);
          pointer-events: none;
        }
        .graph-detail {
          fill: var(--vscode-descriptionForeground);
          font: 400 11px var(--vscode-font-family);
        }
      </style>
    </head>
    <body>
      ${body}
      <script nonce="${input.nonce}">${BASE_SCRIPT}</script>
    </body>
  </html>`;
}
