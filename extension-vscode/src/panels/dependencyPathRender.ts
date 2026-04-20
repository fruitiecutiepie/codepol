/**
 * HTML body renderer for the dedicated dependency-path panel.
 *
 * Self-contained on purpose — the file-graph renderer in `render.ts`
 * couples node rendering with file-graph-specific filter chips,
 * hotspots, and "blast radius" affordances that don't apply to
 * dependency-path output. This module only emits the panel body; the
 * surrounding shell (CSP, base styles, click-handler script) lives in
 * `render.ts`.
 *
 * Each path node carries `data-open-uri` so the panel manager's
 * existing `openLocation` postMessage handler routes clicks. Each
 * `maxPaths` chip carries `data-dp-chip-value` and is wired to the
 * `dependencyPathMaxPathsSet` postMessage by `BASE_SCRIPT`.
 */

import type {
  DependencyPathPanelChip,
  DependencyPathPanelPath,
  DependencyPathPanelViewModel,
} from '../dependencyPathViewModels';

function htmlEscape(value: string): string {
  return value
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;')
    .split("'").join('&#39;');
}

function dependencyPathChipHtml(chip: DependencyPathPanelChip): string {
  return `<button
      type="button"
      class="dp-chip${chip.active ? ' dp-chip-active' : ''}"
      data-dp-chip-value="${htmlEscape(chip.id)}"
    >${htmlEscape(chip.label)}</button>`;
}

function dependencyPathPathHtml(path: DependencyPathPanelPath): string {
  if (path.nodes.length === 0) {
    return '';
  }
  const nodeHtml = path.nodes
    .map(
      (node) => `<button
        type="button"
        class="dp-node"
        data-open-uri="${htmlEscape(node.uri)}"
        data-open-line="0"
        data-open-character="0"
        title="${htmlEscape(node.uri)}"
      >${htmlEscape(node.workspaceRelativePath)}</button>`,
    )
    .join('<span class="dp-node-arrow" aria-hidden="true"> → </span>');
  return `<li class="dp-path">${nodeHtml}</li>`;
}

export function dependencyPathPanelBodyHtml(
  view: DependencyPathPanelViewModel,
): string {
  const headlineHtml = `<h2>${htmlEscape(view.fromWorkspaceRelativePath)} → ${htmlEscape(view.toWorkspaceRelativePath)}</h2>`;
  const summaryHtml = `<p class="dp-summary">${htmlEscape(view.headline)} · ${htmlEscape(view.summary)}</p>`;
  const chipsHtml = `<div class="dp-chip-row" role="group" aria-label="Max paths">
    <span class="dp-chip-row-label">Max paths</span>
    ${view.chips.map(dependencyPathChipHtml).join('')}
  </div>`;
  const pathsHtml =
    view.paths.length === 0
      ? `<p class="dp-empty">No paths to render.</p>`
      : `<ol class="dp-path-list">${view.paths.map(dependencyPathPathHtml).join('')}</ol>`;

  return `<section class="dp-panel">
    <header class="dp-header">
      ${headlineHtml}
      ${summaryHtml}
    </header>
    ${chipsHtml}
    ${pathsHtml}
  </section>`;
}
