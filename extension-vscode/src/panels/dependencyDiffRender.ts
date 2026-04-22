/**
 * HTML body renderer for the dedicated dependency-diff panel.
 *
 * Self-contained on purpose — see `dependencyPathRender.ts` for the
 * same rationale. The renderer emits one section per diff category and
 * one row per changed node / edge / cycle. File-backed rows carry
 * `data-open-uri` so the panel manager's existing `openLocation`
 * postMessage handler routes clicks to the editor.
 *
 * The header carries two control buttons:
 *
 * - "Choose baseline..." — emits `dependencyDiffChooseBaselineRequest`
 * - "Use configured baseline" — emits
 *   `dependencyDiffUseConfiguredBaselineRequest`
 */

import type {
  DependencyDiffPanelSection,
  DependencyDiffPanelSectionRow,
  DependencyDiffPanelViewModel,
} from '../dependencyDiffViewModels';

function htmlEscape(value: string): string {
  return value
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;')
    .split("'").join('&#39;');
}

function dependencyDiffRowHtml(row: DependencyDiffPanelSectionRow): string {
  const labelHtml = row.uri
    ? `<button
        type="button"
        class="dd-row-link"
        data-open-uri="${htmlEscape(row.uri)}"
        data-open-line="0"
        data-open-character="0"
        title="${htmlEscape(row.uri)}"
      >${htmlEscape(row.label)}</button>`
    : `<span class="dd-row-label">${htmlEscape(row.label)}</span>`;
  const detailHtml = row.detail
    ? `<span class="dd-row-detail">${htmlEscape(row.detail)}</span>`
    : '';
  return `<li class="dd-row">${labelHtml}${detailHtml}</li>`;
}

function dependencyDiffSectionHtml(section: DependencyDiffPanelSection): string {
  return `<section class="dd-section">
    <header class="dd-section-header">
      <h3>${htmlEscape(section.title)}</h3>
      <span class="dd-section-count">${section.count}</span>
    </header>
    ${
      section.rows.length === 0
        ? '<p class="dd-empty-section">None</p>'
        : `<ul class="dd-row-list">${section.rows.map(dependencyDiffRowHtml).join('')}</ul>`
    }
  </section>`;
}

export function dependencyDiffPanelBodyHtml(
  view: DependencyDiffPanelViewModel,
): string {
  const sections = [
    view.sections.addedNodes,
    view.sections.removedNodes,
    view.sections.addedEdges,
    view.sections.removedEdges,
    view.sections.newCycles,
    view.sections.removedCycles,
  ];

  const generations = [
    `Current generation: ${view.currentAnalysisGeneration}`,
    view.baselineAnalysisGeneration !== undefined
      ? `Baseline generation: ${view.baselineAnalysisGeneration}`
      : undefined,
  ]
    .filter((value): value is string => value !== undefined)
    .join(' · ');

  return `<section class="dd-panel">
    <header class="dd-header">
      <h2>${htmlEscape(view.headline)}</h2>
      <p class="dd-summary">${htmlEscape(view.summary)}</p>
      <p class="dd-meta">${htmlEscape(generations)}</p>
      <div class="dd-controls" role="group" aria-label="Baseline">
        <button
          type="button"
          class="dd-control"
          data-dd-control="choose-baseline"
        >Choose baseline...</button>
        <button
          type="button"
          class="dd-control"
          data-dd-control="configured-baseline"
        >Use configured baseline</button>
      </div>
    </header>
    ${
      view.isEmpty
        ? '<p class="dd-empty">No dependency changes against the selected baseline.</p>'
        : sections.map(dependencyDiffSectionHtml).join('')
    }
  </section>`;
}
