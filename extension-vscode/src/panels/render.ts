import type {
  ArchitectureLinksPanelViewModel,
  ArchitectureSummaryPanelViewModel,
  DependencyGraphCanvasViewModel,
  DependencyGraphControlsViewModel,
  DependencyGraphPanelViewModel,
  HoverCardViewModel,
  LintRuleDetailsPanelViewModel,
  PanelLocationViewModel,
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
      kind: 'lintRuleDetails';
      title: string;
      data: LintRuleDetailsPanelViewModel;
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

function classNames(...values: Array<string | false | undefined>): string {
  return values.filter((value): value is string => Boolean(value)).join(' ');
}

function hoverActionCompactLabelResolve(
  action: HoverCardViewModel['actions'][number]['action'],
): string {
  if (action === 'go_to_definition') {
    return 'Definition';
  }
  if (action === 'find_references') {
    return 'Refs';
  }
  return 'Graph';
}

function locationTitleResolve(item: { label: string; detail?: string }): string {
  return item.detail ? `${item.label}: ${item.detail}` : item.label;
}

function hoverActionsHtml(card: HoverCardViewModel, uri: string): string {
  if (card.actions.length === 0) {
    return '';
  }

  return `<div class="actions">${card.actions
    .map(
      (action) => {
        const fullLabel = htmlEscape(action.label);
        const compactLabel = htmlEscape(
          hoverActionCompactLabelResolve(action.action),
        );
        return `<button data-action="${htmlEscape(action.action)}" data-uri="${htmlEscape(uri)}" title="${fullLabel}" aria-label="${fullLabel}">
          <span class="button-label-full">${fullLabel}</span>
          <span class="button-label-micro">${compactLabel}</span>
        </button>`;
      },
    )
    .join('')}</div>`;
}

function hoverCardHtml(
  card: HoverCardViewModel | null,
  uri: string,
  input?: { microHideDetails?: boolean },
): string {
  if (!card) {
    return '';
  }

  return `<section class="card hover-card" data-micro-hide-details="${input?.microHideDetails ? 'true' : 'false'}">
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
            `<div class="field"><dt>${htmlEscape(field.label)}</dt><dd title="${htmlEscape(field.value)}">${htmlEscape(field.value)}</dd></div>`,
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
  input?: {
    listClass?: string;
  },
): string {
  if (items.length === 0) {
    return '<p class="empty">No Codepol locations are available for this target.</p>';
  }

  return `<ul class="${htmlEscape(classNames('list', input?.listClass))}">${items
    .map(
      (item) => {
        const title = htmlEscape(locationTitleResolve(item));
        return `<li>
        <button class="location" data-open-uri="${htmlEscape(item.uri)}" data-open-line="${item.line}" data-open-character="${item.character}" title="${title}" aria-label="${title}">
          <span class="label">${htmlEscape(item.label)}</span>
          ${item.detail ? `<span class="detail">${htmlEscape(item.detail)}</span>` : ''}
        </button>
      </li>`;
      },
    )
    .join('')}</ul>`;
}

function graphNodeLocationViewModelCreate(input: {
  uri: string;
  label: string;
  detail: string;
}): PanelLocationViewModel {
  return {
    uri: input.uri,
    line: 0,
    character: 0,
    label: input.label,
    detail: input.detail,
  };
}

function graphFocusLocationResolve(
  graph: DependencyGraphCanvasViewModel,
  focusUri?: string,
): PanelLocationViewModel | null {
  if (!focusUri) {
    return null;
  }

  const node = graph.nodes.find((candidate) => candidate.uri === focusUri);
  if (!node) {
    return null;
  }

  return graphNodeLocationViewModelCreate({
    uri: node.uri,
    label: node.label,
    detail: node.detail,
  });
}

function graphPreviewItemsResolve(
  graph: DependencyGraphCanvasViewModel,
  focusUri?: string,
  limit = 3,
): PanelLocationViewModel[] {
  const ordered = [
    ...(focusUri
      ? graph.nodes.filter((node) => node.uri === focusUri)
      : []),
    ...graph.nodes.filter((node) => node.uri !== focusUri),
  ];
  const seen = new Set<string>();

  return ordered
    .filter((node) => {
      if (seen.has(node.uri)) {
        return false;
      }
      seen.add(node.uri);
      return true;
    })
    .slice(0, limit)
    .map((node) =>
      graphNodeLocationViewModelCreate({
        uri: node.uri,
        label: node.label,
        detail: node.detail,
      }),
    );
}

function microStatListHtml(
  items: Array<{
    label: string;
    value: string;
  }>,
): string {
  if (items.length === 0) {
    return '';
  }

  return `<div class="micro-stat-list">${items
    .map(
      (item) => `<div class="micro-stat">
        <span class="micro-stat-label">${htmlEscape(item.label)}</span>
        <span class="micro-stat-value" title="${htmlEscape(item.value)}">${htmlEscape(item.value)}</span>
      </div>`,
    )
    .join('')}</div>`;
}

function microLocationSectionHtml(input: {
  title: string;
  items: PanelLocationViewModel[];
  listClass?: string;
}): string {
  if (input.items.length === 0) {
    return '';
  }

  return `<div class="section micro-section">
    <h3>${htmlEscape(input.title)}</h3>
    ${locationsHtml(input.items, {
      listClass: classNames('micro-list', input.listClass),
    })}
  </div>`;
}

function graphMicroFallbackHtml(input: {
  stats: Array<{ label: string; value: string }>;
  note: string;
  sections: Array<{
    title: string;
    items: PanelLocationViewModel[];
    listClass?: string;
  }>;
}): string {
  return `<div class="graph-micro mode-micro-only">
    ${microStatListHtml(input.stats)}
    ${input.sections
      .map((section) => microLocationSectionHtml(section))
      .join('')}
    <p class="status micro-note">${htmlEscape(input.note)}</p>
  </div>`;
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
      : locationsHtml(summaryCard.hotspots, {
          listClass: 'summary-hotspots micro-limit-3',
        });

  return `<section class="card summary-card">
    <header>
      <h2>${htmlEscape(title)}</h2>
      <p class="summary">${htmlEscape(summaryCard.summary)}</p>
    </header>
    <dl>
      ${summaryCard.metrics
        .map(
          (metric) =>
            `<div class="field"><dt>${htmlEscape(metric.label)}</dt><dd title="${htmlEscape(metric.value)}">${htmlEscape(metric.value)}</dd></div>`,
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
          `<span class="metric-pill" title="${htmlEscape(`${metric.label}: ${metric.value}`)}">${htmlEscape(metric.label)}: ${htmlEscape(metric.value)}</span>`,
      )
      .join('')}</div>
  </div>`;
}

function graphControlsHtml(controls: DependencyGraphControlsViewModel): string {
  const filterChipsHtml = controls.filterChips
    .map((chip) => {
      const title = chip.description ? htmlEscape(chip.description) : htmlEscape(chip.label);
      return `<button
        class="control-chip${chip.active ? ' active' : ''}"
        type="button"
        data-control-filter="${htmlEscape(chip.id)}"
        title="${title}"
        aria-pressed="${chip.active ? 'true' : 'false'}"
      >${htmlEscape(chip.label)}</button>`;
    })
    .join('');
  const edgeKindChipsHtml = controls.edgeKindChips
    .map(
      (chip) => `<button
        class="control-chip${chip.active ? ' active' : ''}"
        type="button"
        data-control-edge-kind="${htmlEscape(chip.id)}"
        aria-pressed="${chip.active ? 'true' : 'false'}"
      >${htmlEscape(chip.label)}</button>`,
    )
    .join('');
  const layoutOptionsHtml = controls.layoutOptions
    .map(
      (option) => `<button
        class="control-chip${option.active ? ' active' : ''}"
        type="button"
        data-control-layout="${htmlEscape(option.id)}"
        aria-pressed="${option.active ? 'true' : 'false'}"
      >${htmlEscape(option.label)}</button>`,
    )
    .join('');
  const blastRadiusHtml = controls.blastRadiusUri
    ? `<div class="control-row blast-radius-row">
        <span class="control-label">Blast radius</span>
        <span class="control-status" title="${htmlEscape(controls.blastRadiusUri)}">
          ${controls.blastRadiusReachableCount} reachable
        </span>
        <button
          class="control-chip"
          type="button"
          data-control-blast-radius=""
          title="Clear blast-radius selection"
        >Clear</button>
      </div>`
    : '';

  return `<div class="graph-controls mode-micro-hide">
    <div class="control-row">
      <span class="control-label">Filters</span>
      <div class="control-chip-group">${filterChipsHtml}</div>
    </div>
    <div class="control-row">
      <span class="control-label">Edge kinds</span>
      <div class="control-chip-group">${edgeKindChipsHtml}</div>
    </div>
    <div class="control-row">
      <span class="control-label">Layout</span>
      <div class="control-chip-group">${layoutOptionsHtml}</div>
    </div>
    ${blastRadiusHtml}
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
          class="graph-edge${edge.isFocus ? ' focus' : ''}${edge.isDimmed ? ' dimmed' : ''}"
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
          class="graph-node${node.isFocus ? ' focus' : ''}${node.isEntryPoint ? ' entry' : ''}${node.isCycleMember ? ' cycle' : ''}${node.isDimmed ? ' dimmed' : ''}"
          data-open-uri="${htmlEscape(node.uri)}"
          data-open-line="0"
          data-open-character="0"
          data-blast-radius-uri="${htmlEscape(node.uri)}"
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
  return `${hoverCardHtml(model.hoverCard, model.uri, {
      microHideDetails: true,
    })}
    <section class="card definition-card">
      <h3>Definition</h3>
      ${locationsHtml(model.locations, {
        listClass: 'definition-list',
      })}
    </section>`;
}

function architectureSummaryBodyHtml(model: ArchitectureSummaryPanelViewModel): string {
  return workspaceSummaryCardHtml(model.summaryCard);
}

function dependencyGraphBodyHtml(model: DependencyGraphPanelViewModel): string {
  const focusItem = graphFocusLocationResolve(
    model.graph,
    model.focusUri ?? model.graph.focusUri,
  );
  const relatedItems = graphPreviewItemsResolve(
    model.graph,
    model.focusUri ?? model.graph.focusUri,
    3,
  ).filter((item) => item.uri !== focusItem?.uri);
  const hotspotItems = model.summaryCard?.hotspots.slice(0, 3) ?? [];
  const microSections = [
    ...(focusItem
      ? [
          {
            title: 'Focus',
            items: [focusItem],
            listClass: 'micro-limit-1',
          },
        ]
      : []),
    ...(hotspotItems.length > 0
      ? [
          {
            title: 'Hotspots',
            items: hotspotItems,
            listClass: 'micro-limit-3',
          },
        ]
      : relatedItems.length > 0
        ? [
            {
              title: focusItem ? 'Related' : 'Nodes',
              items: relatedItems.slice(0, focusItem ? 2 : 3),
              listClass: 'micro-limit-3',
            },
          ]
        : []),
  ];

  return `${workspaceSummaryCardHtml(model.summaryCard)}
    <section class="card graph-card dependency-graph-card">
      <header>
        <h2>Dependency Graph</h2>
        <p class="summary">Showing ${model.graph.nodes.length} nodes and ${model.graph.edges.length} edges.${model.focusUri ? ` Highlighting ${htmlEscape(model.focusUri)}.` : ''}</p>
      </header>
      ${graphControlsHtml(model.controls)}
      <div class="mode-micro-hide">
        ${graphSvgHtml(model.graph)}
      </div>
      ${graphMicroFallbackHtml({
        stats: [
          { label: 'Nodes', value: String(model.graph.nodes.length) },
          { label: 'Edges', value: String(model.graph.edges.length) },
        ],
        note: 'Open wider for graph view.',
        sections: microSections,
      })}
    </section>`;
}

function architectureLinksBodyHtml(model: ArchitectureLinksPanelViewModel): string {
  const groupsHtml =
    model.groups.length === 0
      ? '<p class="empty">No Codepol architecture links are available for this target.</p>'
      : model.groups
          .map(
            (group) => `<section class="card links-group-card">
              <h3>${htmlEscape(group.group)} <span class="count">${group.totalCount}</span></h3>
              ${group.truncated ? '<p class="status">Results truncated.</p>' : ''}
              ${locationsHtml(group.items, {
                listClass: 'link-group-list',
              })}
            </section>`,
          )
          .join('');
  const focusItem = graphFocusLocationResolve(model.graph, model.uri);
  const fallbackHotspots =
    model.groups.length === 0
      ? (model.workspaceSummaryCard?.hotspots.slice(0, 3) ?? [])
      : [];
  const microSections = [
    ...(focusItem
      ? [
          {
            title: 'Focus',
            items: [focusItem],
            listClass: 'micro-limit-1',
          },
        ]
      : []),
    ...(fallbackHotspots.length > 0
      ? [
          {
            title: 'Hotspots',
            items: fallbackHotspots,
            listClass: 'micro-limit-3',
          },
        ]
      : []),
  ];

  return `${hoverCardHtml(model.hoverCard, model.uri, {
      microHideDetails: true,
    })}
    <section class="card graph-card architecture-links-graph-card">
      <header>
        <h2>Focused Graph</h2>
        <p class="summary">Showing ${model.totalItems} of ${model.totalAvailableItems} semantic links.</p>
        ${model.truncated ? '<p class="status">Semantic link results are truncated.</p>' : ''}
      </header>
      ${graphControlsHtml(model.controls)}
      <div class="mode-micro-hide">
        ${graphOverviewHtml(model.workspaceSummaryCard)}
        ${graphSvgHtml(model.graph)}
      </div>
      ${graphMicroFallbackHtml({
        stats: [
          { label: 'Shown', value: String(model.totalItems) },
          { label: 'Avail', value: String(model.totalAvailableItems) },
          { label: 'Groups', value: String(model.groups.length) },
        ],
        note: 'Open wider for graph view.',
        sections: microSections,
      })}
    </section>
    ${groupsHtml}`;
}

function providerSummariesHtml(model: LintRuleDetailsPanelViewModel): string {
  if (model.providerSummaries.length === 0) {
    return '<p class="empty">No lint providers are configured for this rule.</p>';
  }

  return `<ul class="plain-list">${model.providerSummaries
    .map(
      (provider) => `<li>
        <strong>${htmlEscape(provider.label)}</strong>
        ${provider.detail ? `<div class="detail">${htmlEscape(provider.detail)}</div>` : ''}
      </li>`,
    )
    .join('')}</ul>`;
}

function lintRuleDetailsBodyHtml(model: LintRuleDetailsPanelViewModel): string {
  const groupHtml =
    model.groups.length === 0
      ? '<p class="empty">This rule has no current workspace diagnostics.</p>'
      : model.groups
          .map(
            (group) => `<section class="card lint-rule-group-card">
              <h3>${htmlEscape(group.title)}</h3>
              ${locationsHtml(group.items, {
                listClass: 'lint-rule-diagnostic-list',
              })}
            </section>`,
          )
          .join('');

  return `<section class="card lint-rule-meta-card">
    <header>
      <h2>${htmlEscape(model.ruleId)}</h2>
      <p class="summary">${htmlEscape(model.ownershipLabel)} • ${htmlEscape(model.analysisStateLabel)}</p>
    </header>
    <dl>
      <div class="field"><dt>Total diagnostics</dt><dd>${model.totalDiagnosticCount}</dd></div>
      <div class="field"><dt>Native diagnostics</dt><dd>${model.recentNativeDiagnosticCount}</dd></div>
      <div class="field"><dt>Wrapped diagnostics</dt><dd>${model.recentWrappedDiagnosticCount}</dd></div>
    </dl>
  </section>
  ${listSectionHtml('Severities', model.severities, {
    className: 'lint-rule-severity-card',
  })}
  ${listSectionHtml('Target Patterns', model.targetPatterns, {
    className: 'lint-rule-targets-card',
  })}
  ${listSectionHtml('Languages', model.languages, {
    className: 'lint-rule-languages-card',
  })}
  <section class="card lint-rule-providers-card">
    <h3>Providers</h3>
    ${providerSummariesHtml(model)}
  </section>
  ${listSectionHtml('Fix Surface', model.fixSurfaceNotes, {
    className: 'lint-rule-fix-surface-card',
  })}
  ${listSectionHtml('Analyzer Issues', model.analyzerIssues, {
    className: 'lint-rule-issues-card',
  })}
  ${groupHtml}`;
}

function renamePreviewGroupsHtml(model: RenamePreviewPanelViewModel): string {
  if (model.groups.length === 0) {
    return '<p class="empty">No rename edits are available yet.</p>';
  }

  return model.groups
    .map(
      (group) => `<section class="card rename-group-card">
        <h3>${htmlEscape(group.title)}</h3>
        ${locationsHtml(
          group.edits.map((edit) => ({
            uri: edit.uri,
            line: edit.line,
            character: edit.character,
            label: edit.kind,
            detail: `${edit.oldText} → ${edit.newText}`,
          })),
          {
            listClass: 'rename-edit-list',
          },
        )}
      </section>`,
    )
    .join('');
}

function listSectionHtml(
  title: string,
  items: string[],
  input?: { className?: string },
): string {
  if (items.length === 0) {
    return '';
  }

  return `<section class="${htmlEscape(classNames('card', input?.className))}">
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
    model.currentName ? `<div class="field"><dt>Current name</dt><dd title="${htmlEscape(model.currentName)}">${htmlEscape(model.currentName)}</dd></div>` : '',
    model.oldName ? `<div class="field"><dt>Preview</dt><dd title="${htmlEscape(`${model.oldName} → ${model.newName ?? ''}`)}">${htmlEscape(model.oldName)} → ${htmlEscape(model.newName ?? '')}</dd></div>` : '',
    model.namespaceId ? `<div class="field"><dt>Namespace</dt><dd title="${htmlEscape(model.namespaceId)}">${htmlEscape(model.namespaceId)}</dd></div>` : '',
    model.impactedSiteCount !== undefined
      ? `<div class="field"><dt>Impacted sites</dt><dd title="${model.impactedSiteCount}">${model.impactedSiteCount}</dd></div>`
      : '',
  ]
    .filter((row) => row.length > 0)
    .join('');

  return `<section class="card rename-meta-card">
    <header>
      <h2>${htmlEscape(model.targetLabel)}</h2>
      ${model.prepareMessage ? `<p class="status">${htmlEscape(model.prepareMessage)}</p>` : ''}
      ${model.previewMessage ? `<p class="status">${htmlEscape(model.previewMessage)}</p>` : ''}
      ${model.applyMessage ? `<p class="status success">${htmlEscape(model.applyMessage)}</p>` : ''}
    </header>
    <dl>${metaRows}</dl>
    ${applyButton}
  </section>
  ${listSectionHtml('Naming Rules', model.namingRules, {
    className: 'naming-rules-card',
  })}
  ${listSectionHtml('Warnings', model.warnings, {
    className: 'warnings-card',
  })}
  ${listSectionHtml('Blocking Issues', model.blockingIssues, {
    className: 'blocking-card',
  })}
  ${renamePreviewGroupsHtml(model)}`;
}

const BASE_SCRIPT = `
  const vscode = acquireVsCodeApi();
  const widthModeResolve = (width) => {
    if (width <= 220) {
      return 'micro';
    }
    if (width <= 320) {
      return 'compact';
    }
    return 'full';
  };
  const modeApply = () => {
    const width = Math.max(
      document.documentElement.clientWidth,
      window.innerWidth || 0,
    );
    document.body.dataset.mode = widthModeResolve(width);
  };
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const filterButton = target.closest('[data-control-filter]');
    if (filterButton instanceof HTMLElement) {
      event.preventDefault();
      vscode.postMessage({
        type: 'graphFilterToggle',
        filter: filterButton.dataset.controlFilter,
      });
      return;
    }
    const edgeKindButton = target.closest('[data-control-edge-kind]');
    if (edgeKindButton instanceof HTMLElement) {
      event.preventDefault();
      vscode.postMessage({
        type: 'graphEdgeKindToggle',
        edgeKindChipId: edgeKindButton.dataset.controlEdgeKind,
      });
      return;
    }
    const layoutButton = target.closest('[data-control-layout]');
    if (layoutButton instanceof HTMLElement) {
      event.preventDefault();
      vscode.postMessage({
        type: 'graphLayoutSet',
        layout: layoutButton.dataset.controlLayout,
      });
      return;
    }
    const blastRadiusClearButton = target.closest('[data-control-blast-radius]');
    if (blastRadiusClearButton instanceof HTMLElement) {
      event.preventDefault();
      vscode.postMessage({
        type: 'graphBlastRadiusSet',
        uri: null,
      });
      return;
    }
    if (event.altKey) {
      const blastRadiusNode = target.closest('[data-blast-radius-uri]');
      if (blastRadiusNode instanceof SVGElement || blastRadiusNode instanceof HTMLElement) {
        event.preventDefault();
        vscode.postMessage({
          type: 'graphBlastRadiusSet',
          uri: blastRadiusNode.dataset.blastRadiusUri,
        });
        return;
      }
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
  modeApply();
  if (typeof ResizeObserver === 'function') {
    const modeObserver = new ResizeObserver(() => {
      modeApply();
    });
    modeObserver.observe(document.documentElement);
  } else {
    window.addEventListener('resize', modeApply);
  }
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
            : input.model.kind === 'lintRuleDetails'
              ? lintRuleDetailsBodyHtml(input.model.data)
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
        :root {
          color-scheme: light dark;
        }
        html, body {
          margin: 0;
          min-width: 0;
          max-width: 100%;
        }
        *, *::before, *::after {
          box-sizing: border-box;
        }
        body {
          font-family: var(--vscode-font-family);
          color: var(--vscode-foreground);
          background: var(--vscode-editor-background);
          padding: 16px;
          min-width: 0;
          max-width: 100%;
        }
        body[data-mode="compact"] {
          padding: 12px;
        }
        body[data-mode="micro"] {
          padding: 8px;
        }
        .mode-micro-only {
          display: none;
        }
        body[data-mode="micro"] .mode-micro-only {
          display: block;
        }
        body[data-mode="micro"] .mode-micro-hide {
          display: none !important;
        }
        .card {
          border: 1px solid var(--vscode-panel-border);
          border-radius: 10px;
          padding: 14px;
          margin-bottom: 12px;
          background: color-mix(in srgb, var(--vscode-editor-background) 90%, var(--vscode-editorInfo-foreground) 10%);
          min-width: 0;
          max-width: 100%;
        }
        body[data-mode="compact"] .card {
          padding: 12px;
          border-radius: 9px;
          margin-bottom: 10px;
        }
        body[data-mode="micro"] .card {
          padding: 8px;
          border-radius: 8px;
          margin-bottom: 8px;
        }
        .section {
          margin-top: 12px;
        }
        body[data-mode="micro"] .section {
          margin-top: 8px;
        }
        header p,
        .section p {
          margin: 6px 0 0;
        }
        .subtitle, .detail, .summary, .status {
          color: var(--vscode-descriptionForeground);
          overflow-wrap: anywhere;
        }
        .success {
          color: var(--vscode-testing-iconPassed);
        }
        h2, h3 {
          margin: 0;
          line-height: 1.3;
        }
        h2 {
          font-size: 14px;
        }
        h3 {
          font-size: 11px;
          color: var(--vscode-descriptionForeground);
        }
        body[data-mode="micro"] h2 {
          font-size: 13px;
        }
        dl {
          margin: 0;
          min-width: 0;
          max-width: 100%;
        }
        dt {
          color: var(--vscode-descriptionForeground);
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        dd {
          margin: 0;
          min-width: 0;
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .field {
          display: grid;
          grid-template-columns: minmax(0, 140px) minmax(0, 1fr);
          gap: 8px;
          margin-top: 8px;
          min-width: 0;
          max-width: 100%;
        }
        .field > * {
          min-width: 0;
        }
        body[data-mode="compact"] .field,
        body[data-mode="micro"] .field {
          grid-template-columns: minmax(0, 1fr);
          gap: 4px;
        }
        .actions {
          display: flex;
          gap: 8px;
          margin-top: 12px;
          flex-wrap: wrap;
          min-width: 0;
          max-width: 100%;
        }
        body[data-mode="micro"] .actions {
          flex-direction: column;
          gap: 6px;
          margin-top: 8px;
        }
        button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          border: 1px solid var(--vscode-button-border, transparent);
          border-radius: 8px;
          padding: 8px 10px;
          background: var(--vscode-button-secondaryBackground);
          color: var(--vscode-button-secondaryForeground);
          cursor: pointer;
          min-width: 0;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        body[data-mode="micro"] button {
          width: 100%;
        }
        button:hover {
          background: var(--vscode-button-secondaryHoverBackground);
        }
        .button-label-micro {
          display: none;
        }
        body[data-mode="micro"] .button-label-full {
          display: none;
        }
        body[data-mode="micro"] .button-label-micro {
          display: inline;
        }
        .location {
          display: block;
          width: 100%;
          min-width: 0;
          max-width: 100%;
          text-align: left;
          background: var(--vscode-input-background);
          overflow: hidden;
        }
        .list, .plain-list {
          list-style: none;
          padding: 0;
          margin: 0;
          display: grid;
          gap: 8px;
          min-width: 0;
          max-width: 100%;
        }
        .label {
          display: block;
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .detail {
          display: block;
          margin-top: 3px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .count {
          color: var(--vscode-descriptionForeground);
          font-weight: normal;
          margin-left: 8px;
        }
        body[data-mode="micro"] .count {
          display: block;
          margin-left: 0;
          margin-top: 2px;
        }
        .empty {
          color: var(--vscode-descriptionForeground);
          margin: 0;
        }
        .plain-list li {
          padding: 8px 10px;
          border-radius: 8px;
          background: var(--vscode-input-background);
          overflow-wrap: anywhere;
        }
        body[data-mode="micro"] .plain-list li {
          padding: 6px 8px;
        }
        .graph-overview {
          margin-bottom: 12px;
          min-width: 0;
          max-width: 100%;
        }
        .metric-row {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          margin-top: 8px;
        }
        .metric-pill {
          display: inline-block;
          max-width: 100%;
          border: 1px solid var(--vscode-panel-border);
          border-radius: 999px;
          padding: 4px 10px;
          color: var(--vscode-descriptionForeground);
          background: color-mix(in srgb, var(--vscode-editor-background) 82%, var(--vscode-textLink-foreground) 18%);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .graph-micro {
          gap: 8px;
        }
        body[data-mode="micro"] .graph-micro {
          display: grid;
        }
        .micro-section {
          margin-top: 0;
        }
        .micro-stat-list {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 6px;
        }
        .micro-stat {
          padding: 6px;
          border: 1px solid var(--vscode-panel-border);
          border-radius: 8px;
          background: color-mix(in srgb, var(--vscode-input-background) 88%, transparent);
          min-width: 0;
        }
        .micro-stat-label {
          display: block;
          color: var(--vscode-descriptionForeground);
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .micro-stat-value {
          display: block;
          margin-top: 3px;
          font-weight: 600;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .micro-note {
          margin: 0;
        }
        .graph {
          display: block;
          width: 100%;
          min-width: 0;
          max-width: 100%;
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
        .graph-edge.dimmed {
          opacity: 0.18;
        }
        .graph-node.dimmed {
          opacity: 0.32;
        }
        .graph-controls {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-bottom: 12px;
        }
        .control-row {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        .control-label {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--vscode-descriptionForeground);
          min-width: 84px;
        }
        .control-status {
          font-size: 12px;
          color: var(--vscode-descriptionForeground);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .control-chip-group {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }
        .control-chip {
          display: inline-flex;
          align-items: center;
          padding: 4px 10px;
          border-radius: 999px;
          border: 1px solid var(--vscode-panel-border);
          background: var(--vscode-input-background);
          color: var(--vscode-foreground);
          font-size: 12px;
          cursor: pointer;
        }
        .control-chip.active {
          background: color-mix(in srgb, var(--vscode-input-background) 60%, var(--vscode-textLink-foreground) 40%);
          border-color: var(--vscode-textLink-foreground);
          color: var(--vscode-textLink-foreground);
        }
        .blast-radius-row {
          background: color-mix(in srgb, var(--vscode-input-background) 80%, var(--vscode-textBlockQuote-background) 20%);
          padding: 6px 10px;
          border-radius: 8px;
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
        body[data-mode="micro"] .hover-card[data-micro-hide-details="true"] dl,
        body[data-mode="micro"] .hover-card[data-micro-hide-details="true"] .subtitle,
        body[data-mode="micro"] .hover-card[data-micro-hide-details="true"] .summary,
        body[data-mode="micro"] .summary-card .summary,
        body[data-mode="micro"] .graph-card > header .summary,
        body[data-mode="micro"] .naming-rules-card {
          display: none;
        }
        body[data-mode="micro"] .summary-card dl .field:nth-child(n + 5),
        body[data-mode="micro"] .micro-limit-3 > li:nth-child(n + 4),
        body[data-mode="micro"] .micro-limit-1 > li:nth-child(n + 2) {
          display: none;
        }
      </style>
    </head>
    <body data-mode="full">
      ${body}
      <script nonce="${input.nonce}">${BASE_SCRIPT}</script>
    </body>
  </html>`;
}
