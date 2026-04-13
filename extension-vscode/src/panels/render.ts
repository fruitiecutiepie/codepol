import type {
  HoverCardViewModel,
  RenamePreviewPanelViewModel,
  SemanticDefinitionPanelViewModel,
  SemanticReferencesPanelViewModel,
} from '../viewModels';

export type CodepolPanelViewModel =
  | {
      kind: 'semanticDefinition';
      title: string;
      uri: string;
      data: SemanticDefinitionPanelViewModel;
    }
  | {
      kind: 'architectureLinks';
      title: string;
      uri: string;
      data: SemanticReferencesPanelViewModel;
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

function semanticDefinitionBodyHtml(model: SemanticDefinitionPanelViewModel): string {
  return `${hoverCardHtml(model.hoverCard, model.uri)}
    <section class="card">
      <h3>Definition</h3>
      ${locationsHtml(model.locations)}
    </section>`;
}

function semanticReferencesBodyHtml(model: SemanticReferencesPanelViewModel): string {
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
      <h3>Architecture Links</h3>
      <p class="summary">Showing ${model.totalItems} of ${model.totalAvailableItems} semantic links.</p>
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
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const locationButton = target.closest('[data-open-uri]');
    if (locationButton instanceof HTMLElement) {
      vscode.postMessage({
        type: 'openLocation',
        uri: locationButton.dataset.openUri,
        line: Number(locationButton.dataset.openLine ?? 0),
        character: Number(locationButton.dataset.openCharacter ?? 0),
      });
      return;
    }
    const actionButton = target.closest('[data-action]');
    if (actionButton instanceof HTMLElement) {
      vscode.postMessage({
        type: 'hoverAction',
        action: actionButton.dataset.action,
        uri: actionButton.dataset.uri,
      });
      return;
    }
    const applyButton = target.closest('[data-plan-id]');
    if (applyButton instanceof HTMLElement) {
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
      : input.model.kind === 'architectureLinks'
        ? semanticReferencesBodyHtml(input.model.data)
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
      </style>
    </head>
    <body>
      ${body}
      <script nonce="${input.nonce}">${BASE_SCRIPT}</script>
    </body>
  </html>`;
}
