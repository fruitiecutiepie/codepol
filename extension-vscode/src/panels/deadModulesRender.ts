/**
 * HTML body renderer for the dedicated dead-modules panel.
 *
 * Self-contained on purpose — see `dependencyPathRender.ts` for the
 * same rationale. The renderer emits one collapsible `<details>` per
 * directory group and one row per file. File rows carry `data-open-uri`
 * so the panel manager's existing `openLocation` postMessage handler
 * routes clicks to the editor.
 *
 * The header carries two control buttons:
 *
 * - "Configure entry points..." — emits
 *   `deadModulesEntryPointsConfigureRequest`. The panel manager
 *   forwards the request to the host so it can run a multi-select
 *   quick-pick before re-firing the rebuilder.
 * - "Use natural entry points" — emits `deadModulesEntryPointsSet`
 *   with `entryPointUris: undefined`, which the manager threads
 *   straight into the rebuilder.
 */

import type {
  DeadModulesPanelGroup,
  DeadModulesPanelViewModel,
} from '../deadModulesViewModels';

function htmlEscape(value: string): string {
  return value
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;')
    .split("'").join('&#39;');
}

function deadModulesGroupHtml(group: DeadModulesPanelGroup): string {
  const directoryLabel =
    group.directoryWorkspaceRelativePath.length === 0
      ? '/'
      : group.directoryWorkspaceRelativePath;
  const fileItems = group.files
    .map(
      (file) => `<li class="dm-file-row">
      <button
        type="button"
        class="dm-file"
        data-open-uri="${htmlEscape(file.uri)}"
        data-open-line="0"
        data-open-character="0"
        title="${htmlEscape(file.uri)}"
      >${htmlEscape(file.basename)}</button>
      <span class="dm-file-rel">${htmlEscape(file.workspaceRelativePath)}</span>
    </li>`,
    )
    .join('');
  return `<li class="dm-group">
    <details open>
      <summary>
        <span class="dm-group-label">${htmlEscape(directoryLabel)}</span>
        <span class="dm-group-count">${group.files.length}</span>
      </summary>
      <ul class="dm-file-list">${fileItems}</ul>
    </details>
  </li>`;
}

export function deadModulesPanelBodyHtml(
  view: DeadModulesPanelViewModel,
): string {
  const controlsHtml = `<div class="dm-controls" role="group" aria-label="Entry points">
    <button
      type="button"
      class="dm-control"
      data-dm-control="configure"
    >Configure entry points…</button>
    <button
      type="button"
      class="dm-control"
      data-dm-control="natural"
    >Use natural entry points</button>
  </div>`;
  const groupsHtml =
    view.groups.length === 0
      ? `<p class="dm-empty">No unreachable files in this workspace.</p>`
      : `<ul class="dm-group-list">${view.groups.map(deadModulesGroupHtml).join('')}</ul>`;

  return `<section class="dm-panel">
    <header class="dm-header">
      <h2>${htmlEscape(view.headline)}</h2>
      <p class="dm-summary">${htmlEscape(view.summary)}</p>
    </header>
    ${controlsHtml}
    ${groupsHtml}
  </section>`;
}
