/**
 * Shared HTML helpers for the architecture-graph panels (call graph,
 * type hierarchy, dependency graph, architecture links, dependency
 * path, dead modules).
 *
 * The four architecture-graph panels intentionally live in separate
 * `PanelKind`s — their underlying queries differ enough that reusing a
 * single view-model would be hostile to readers — but every reader
 * benefits from learning *one* visual grammar across the family. The
 * helpers below own that grammar:
 *
 * - {@link panelChipRowHtml} — uniform `<div class="panel-chip-row">`
 *   wrapping `<button class="panel-chip">` so chip layouts read the
 *   same regardless of whether the chip drives a file-graph filter,
 *   a call-graph direction toggle, or a type-hierarchy depth chip.
 * - {@link panelTallyHeaderHtml} — second-summary line that tallies
 *   counts. Generalizes the `N declared · M shape-matched · K from
 *   language server` line from the type-hierarchy panel so the
 *   call-graph panel (and any future panel) can adopt the same shape.
 * - {@link panelLegendHtml} — legend block with SVG swatches for edge
 *   tier styles. Generalized from `typeHierarchyLegendHtml` so the
 *   call-graph panel can ship its own legend without duplicating the
 *   SVG plumbing.
 * - {@link panelLensSwitcherHtml} — header affordance that lets the
 *   user reopen the same focus through a sibling lens (module ↔
 *   architecture links for file focus; call graph ↔ type hierarchy
 *   for symbol focus). Cross-type switching (file ↔ symbol) is
 *   deliberately out of scope for the MVP — the user has to peek the
 *   right place to switch lens classes.
 *
 * All helpers are pure: no DOM access, no `vscode` imports, fully
 * unit-testable. Callers are responsible for `htmlEscape`-ing any
 * untrusted content before passing it in. Each helper returns the
 * empty string when its inputs are empty so the calling renderer can
 * embed unconditionally without tracking optionality.
 */

function htmlEscape(value: string): string {
  return value
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;')
    .split("'").join('&#39;');
}

// ============================================================================
// Chip row
// ============================================================================

/**
 * One chip in a chip row. Carries an opaque `dataAttributes` map so
 * each panel can encode its own click-dispatch protocol without the
 * shared helper having to know about `data-cg-chip-*`,
 * `data-th-chip-*`, `data-control-*`, etc.
 *
 * The shared helper writes:
 *
 *   <button class="panel-chip{ panel-chip-active}{ panel-chip-locked}"
 *     type="button"
 *     {...dataAttributes}
 *     {?title=description}
 *     {?aria-pressed=active}
 *     {?aria-disabled=locked}>
 *     {label}
 *   </button>
 */
export type PanelChipDescriptor = {
  /** Display label. Pass the human-readable name; helper escapes it. */
  label: string;
  /** Whether the chip is in the "selected" / "active" visual state. */
  active?: boolean;
  /** Optional tooltip / aria-label. */
  description?: string;
  /**
   * Locked variant. Adds `aria-disabled` and a `panel-chip-locked`
   * class hook so the panel's `BASE_SCRIPT` dispatcher can skip
   * locked chips before posting a message. Used by
   * `mode: 'signature-impact'` to indicate that direction / depth
   * chips are pinned.
   */
  locked?: boolean;
  /**
   * Caller-provided data attributes that route the click. Examples:
   *   { 'data-cg-chip-group': 'direction', 'data-cg-chip-value': 'callers' }
   *   { 'data-control-filter': 'crossPackageOnly' }
   *
   * Keys must already start with `data-`. Values are HTML-escaped by
   * the helper.
   */
  dataAttributes?: Record<string, string>;
};

/**
 * Render a labelled chip row. The chip row markup is unified across
 * panel kinds; every panel that uses chips should funnel through this
 * helper so users see the same visual rhythm regardless of which
 * panel kind they happen to have open.
 *
 * `groupAriaLabel` is the row's `aria-label`; pass the same text the
 * label uses (e.g. `'Direction'`, `'Confidence'`).
 */
export function panelChipRowHtml(input: {
  label: string;
  /** ARIA label; defaults to `label`. */
  groupAriaLabel?: string;
  chips: PanelChipDescriptor[];
  /**
   * Class added to the row wrapper (in addition to `panel-chip-row`).
   * Useful for panels that already shipped a row-level CSS hook (e.g.
   * `cg-chip-row` / `dp-chip-row`) and need to keep the existing
   * styling intact while migrating to the unified inner markup.
   */
  rowExtraClass?: string;
  /**
   * Class added to each chip button (in addition to `panel-chip`).
   * Same migration motivation as `rowExtraClass`.
   */
  chipExtraClass?: string;
  /**
   * Optional descriptive note rendered to the right of the chips.
   * Used to surface "populated when …" hints next to placeholder
   * chip rows.
   */
  note?: string;
}): string {
  if (input.chips.length === 0) return '';
  const aria = htmlEscape(input.groupAriaLabel ?? input.label);
  const rowClass = ['panel-chip-row', input.rowExtraClass].filter(Boolean).join(' ');
  const chipsHtml = input.chips
    .map((chip) => panelChipButtonHtml(chip, input.chipExtraClass))
    .join('');
  const noteHtml = input.note
    ? `<span class="panel-chip-row-note">${htmlEscape(input.note)}</span>`
    : '';
  return `<div class="${htmlEscape(rowClass)}" role="group" aria-label="${aria}">
    <span class="panel-chip-row-label">${htmlEscape(input.label)}</span>
    ${chipsHtml}
    ${noteHtml}
  </div>`;
}

function panelChipButtonHtml(
  chip: PanelChipDescriptor,
  extraClass: string | undefined,
): string {
  const classes = ['panel-chip'];
  if (chip.active) classes.push('panel-chip-active');
  if (chip.locked) classes.push('panel-chip-locked');
  if (extraClass) classes.push(extraClass);
  // Re-flag with the legacy `cg-chip` / `cg-chip-active` classes when
  // the caller passes `extraClass: 'cg-chip'`, so existing CSS for
  // those panels keeps applying. The caller controls this — no
  // implicit naming convention here.
  if (extraClass === 'cg-chip' && chip.active) classes.push('cg-chip-active');
  const dataAttrs = Object.entries(chip.dataAttributes ?? {})
    .map(([k, v]) => `${k}="${htmlEscape(v)}"`)
    .join(' ');
  const titleAttr = chip.description
    ? ` title="${htmlEscape(chip.description)}"`
    : '';
  const ariaPressed = chip.active ? ' aria-pressed="true"' : ' aria-pressed="false"';
  const ariaDisabled = chip.locked ? ' aria-disabled="true"' : '';
  return `<button type="button" class="${htmlEscape(classes.join(' '))}" ${dataAttrs}${titleAttr}${ariaPressed}${ariaDisabled}>${htmlEscape(chip.label)}</button>`;
}

// ============================================================================
// Tally header
// ============================================================================

export type PanelTallyEntry = {
  /** Display label, e.g. `'declared'`, `'structural'`. */
  label: string;
  /** Count to display. Entries with `count === 0` are omitted. */
  count: number;
  /**
   * Optional pluralization hint. When present, used as-is when count
   * is not 1. Defaults to `${label}` for singular and plural alike
   * — most call sites pass plural-form labels (`'callers'`,
   * `'callees'`) so the default is good enough.
   */
  pluralLabel?: string;
};

/**
 * Render a tally line: `5 declared · 2 structural · 1 type-aware`.
 * Entries with `count === 0` are dropped before the join. Returns the
 * empty string when *every* entry collapses, so callers can embed the
 * helper unconditionally.
 *
 * The wrapping `<p class="panel-tally">` carries no panel-specific
 * class so it can be styled uniformly across panels. Callers that
 * need an extra hook should pass `extraClass`.
 */
export function panelTallyHeaderHtml(input: {
  tallies: PanelTallyEntry[];
  extraClass?: string;
}): string {
  const visible = input.tallies.filter((entry) => entry.count > 0);
  if (visible.length === 0) return '';
  const className = ['panel-tally', input.extraClass]
    .filter((v): v is string => Boolean(v))
    .join(' ');
  const text = visible
    .map((entry) => {
      const labelText = entry.count === 1
        ? entry.label
        : (entry.pluralLabel ?? entry.label);
      return `${entry.count} ${labelText}`;
    })
    .join(' \u00b7 ');
  return `<p class="${htmlEscape(className)}">${htmlEscape(text)}</p>`;
}

// ============================================================================
// Legend
// ============================================================================

export type PanelLegendEntry = {
  /** Bold label rendered next to the swatch. */
  label: string;
  /** Optional descriptive subtitle. */
  detail?: string;
  /**
   * CSS class applied to the SVG line inside the swatch. Use the
   * panel's existing edge-style class names (e.g.
   * `'th-edge-declared'`, `'cg-edge-type-aware'`) so the swatch
   * looks identical to actual edges on the canvas.
   */
  swatchClass: string;
};

/**
 * Render a legend block. The outer `<ul class="panel-legend">` is
 * uniform; each entry shows a tiny inline-SVG swatch followed by the
 * label and optional detail.
 *
 * Returns the empty string when `entries` is empty.
 */
export function panelLegendHtml(input: { entries: PanelLegendEntry[] }): string {
  if (input.entries.length === 0) return '';
  const items = input.entries
    .map((entry) => {
      const detailHtml = entry.detail
        ? `<span class="panel-legend-detail">${htmlEscape(entry.detail)}</span>`
        : '';
      return `<li>
        <svg class="panel-legend-swatch" viewBox="0 0 24 8" aria-hidden="true">
          <line class="cg-edge ${htmlEscape(entry.swatchClass)}" x1="0" y1="4" x2="24" y2="4" />
        </svg>
        <span class="panel-legend-label">${htmlEscape(entry.label)}</span>
        ${detailHtml}
      </li>`;
    })
    .join('');
  return `<ul class="panel-legend" role="list">${items}</ul>`;
}

// ============================================================================
// Lens switcher
// ============================================================================

/**
 * Possible lens values the lens switcher can post.
 *
 * - `module` — workspace dependency graph (file-focus)
 * - `links` — architecture links (file-focus)
 * - `callers` — call graph (symbol-focus)
 * - `type-hierarchy` — type hierarchy (symbol-focus)
 *
 * Cross-type switching (file ↔ symbol) is deliberately out of scope
 * for the MVP — the lens switcher only surfaces lenses compatible
 * with the current focus type. A symbol-focus user who wants the
 * file graph still has to use the command palette / sidebar.
 */
export type PanelLensValue = 'module' | 'links' | 'callers' | 'type-hierarchy';

/**
 * Focus payload echoed back to the manager when the user switches
 * lens. The manager uses this to call the right `show*` controller
 * method without having to track the previously-shown panel state.
 */
export type PanelLensFocus =
  | { kind: 'file'; uri: string }
  | { kind: 'symbol'; symbolId: string; symbolName?: string };

export type PanelLensSwitcherViewModel = {
  /** Current lens (rendered as the active button). */
  currentLens: PanelLensValue;
  /**
   * Lenses to render as buttons. Always includes `currentLens`. When
   * the focus is file-typed the helper expects file-typed lenses
   * (`module`, `links`); when symbol-typed it expects
   * (`callers`, `type-hierarchy`). The helper does NOT validate the
   * combination — caller is responsible for picking compatible
   * lenses for the focus.
   */
  availableLenses: PanelLensValue[];
  /** Focus echoed in the click message. */
  focus: PanelLensFocus;
};

const PANEL_LENS_LABELS: Record<PanelLensValue, string> = {
  module: 'Module Graph',
  links: 'Architecture Links',
  callers: 'Call Graph',
  'type-hierarchy': 'Type Hierarchy',
};

/**
 * Render the per-panel "Switch lens" affordance.
 *
 * The helper emits one `<button data-panel-lens="…">` per available
 * lens. The button payload — the JSON-serialized {@link PanelLensFocus}
 * — rides on a `data-panel-lens-focus` attribute so the BASE_SCRIPT
 * dispatcher can echo it back without parsing the lens label.
 *
 * Returns the empty string when `availableLenses.length <= 1` (no
 * other lens to switch to — the affordance would be confusing).
 */
export function panelLensSwitcherHtml(model: PanelLensSwitcherViewModel): string {
  if (model.availableLenses.length <= 1) return '';
  const focusJson = JSON.stringify(model.focus);
  const buttons = model.availableLenses
    .map((lens) => {
      const isCurrent = lens === model.currentLens;
      const classes = ['panel-lens-button'];
      if (isCurrent) classes.push('panel-lens-button-current');
      const label = PANEL_LENS_LABELS[lens];
      return `<button
        type="button"
        class="${htmlEscape(classes.join(' '))}"
        data-panel-lens="${htmlEscape(lens)}"
        data-panel-lens-focus="${htmlEscape(focusJson)}"
        aria-pressed="${isCurrent ? 'true' : 'false'}"
        ${isCurrent ? 'aria-current="true"' : ''}
      >${htmlEscape(label)}</button>`;
    })
    .join('');
  return `<nav class="panel-lens-switcher" aria-label="Switch lens">
    <span class="panel-lens-label">View as</span>
    ${buttons}
  </nav>`;
}

// ============================================================================
// Mode pill
// ============================================================================

/**
 * Locked-mode pill rendered at the top of a panel when the panel is
 * pinned to a specific mode (e.g. `signature-impact`). The "exit"
 * button (`×`) carries `data-panel-mode-clear` so the BASE_SCRIPT
 * dispatcher can post a panel-specific clear-mode message.
 *
 * The mode pill exists so users can tell at a glance that the
 * panel's chip controls are locked, and what the framing of the
 * locked configuration is. When unset, the panel renders normally.
 */
export type PanelModePillViewModel = {
  /**
   * Short label rendered inside the pill, e.g. `'Signature impact'`.
   */
  label: string;
  /**
   * Optional configuration suffix appended after an em-dash, e.g.
   * `'callers, unbounded'`. The pill renders as
   * `${label} — ${configurationSummary}`.
   */
  configurationSummary?: string;
  /**
   * Mode identifier echoed on the data attribute so panel-specific
   * styling and message dispatch can branch on it.
   */
  modeId: string;
  /**
   * Tooltip explaining what locking the mode means / how to unlock.
   * Defaults to `'Click × to return to interactive mode.'`.
   */
  description?: string;
};

export function panelModePillHtml(model: PanelModePillViewModel): string {
  const innerLabel = model.configurationSummary
    ? `${model.label} \u2014 ${model.configurationSummary}`
    : model.label;
  const description = model.description
    ?? 'Click \u00d7 to return to interactive mode.';
  return `<div class="panel-mode-pill" data-panel-mode="${htmlEscape(model.modeId)}" role="status" title="${htmlEscape(description)}">
    <span class="panel-mode-pill-label">${htmlEscape(innerLabel)}</span>
    <button
      type="button"
      class="panel-mode-pill-clear"
      data-panel-mode-clear="${htmlEscape(model.modeId)}"
      aria-label="Exit mode"
    >\u00d7</button>
  </div>`;
}

// ============================================================================
// Confidence banner
// ============================================================================

/**
 * Inline confidence banner rendered above a graph canvas when the
 * data displayed has a fidelity caveat the user must understand.
 * Used by `mode: 'signature-impact'` on the call-graph panel to
 * make the structural-only nature of the graph unmistakable.
 *
 * Returns the empty string when `message` is empty so the helper can
 * be embedded unconditionally.
 */
export function panelConfidenceBannerHtml(input: {
  message: string;
  /**
   * Optional inline action the banner exposes (e.g. a docs link).
   * `actionLabel` shows up as a bare button anchored on the right of
   * the banner; `actionId` rides on `data-action` so the BASE_SCRIPT
   * dispatcher can post a `hoverAction` message.
   */
  actionLabel?: string;
  actionId?: string;
}): string {
  if (input.message.length === 0) return '';
  const actionHtml =
    input.actionLabel && input.actionId
      ? `<button
        type="button"
        class="panel-confidence-banner-action"
        data-action="${htmlEscape(input.actionId)}"
      >${htmlEscape(input.actionLabel)}</button>`
      : '';
  return `<div class="panel-confidence-banner" role="note">
    <span class="panel-confidence-banner-message">${htmlEscape(input.message)}</span>
    ${actionHtml}
  </div>`;
}

// ============================================================================
// CSS
// ============================================================================

/**
 * Shared CSS for the panel helpers above. Embedded by the panel
 * shell (`render.ts`) once so every panel that uses the helpers
 * picks up the styling without duplicating it. Class names are
 * panel-prefix-free (`panel-chip`, `panel-tally`, `panel-legend`,
 * `panel-lens-switcher`, `panel-mode-pill`,
 * `panel-confidence-banner`) so the styling reads as panel-shell
 * defaults rather than a single panel's CSS.
 */
export const PANEL_SHARED_CSS = `
  .panel-chip-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .panel-chip-row-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--vscode-descriptionForeground);
    margin-right: 4px;
  }
  .panel-chip-row-note {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    margin-left: auto;
  }
  .panel-chip {
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid var(--vscode-panel-border);
    background: transparent;
    color: var(--vscode-foreground);
    font-size: 11px;
    cursor: pointer;
  }
  .panel-chip-active {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border-color: transparent;
  }
  .panel-chip-locked {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .panel-tally {
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
    margin: 4px 0 0 0;
  }
  .panel-legend {
    list-style: none;
    margin: 0 0 12px 0;
    padding: 8px 12px;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .panel-legend li {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }
  .panel-legend-swatch {
    width: 24px;
    height: 8px;
    flex-shrink: 0;
  }
  .panel-legend-label {
    font-weight: 600;
    color: var(--vscode-foreground);
    min-width: 110px;
  }
  .panel-legend-detail {
    color: var(--vscode-descriptionForeground);
    font-size: 11px;
  }
  .panel-lens-switcher {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    margin: 4px 0 8px 0;
  }
  .panel-lens-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--vscode-descriptionForeground);
    margin-right: 4px;
  }
  .panel-lens-button {
    padding: 2px 10px;
    border-radius: 999px;
    border: 1px solid var(--vscode-panel-border);
    background: transparent;
    color: var(--vscode-foreground);
    font-size: 11px;
    cursor: pointer;
  }
  .panel-lens-button-current {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border-color: transparent;
    cursor: default;
  }
  .panel-mode-pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 4px 10px;
    margin: 0 0 12px 0;
    border-radius: 999px;
    background: color-mix(in srgb, var(--vscode-button-background) 30%, transparent);
    border: 1px solid var(--vscode-button-background);
    color: var(--vscode-foreground);
    font-size: 12px;
    max-width: 100%;
  }
  .panel-mode-pill-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .panel-mode-pill-clear {
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 0 2px;
  }
  .panel-confidence-banner {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    margin: 0 0 12px 0;
    border-radius: 6px;
    background: color-mix(in srgb, var(--vscode-editorInfo-foreground) 12%, transparent);
    border-left: 3px solid var(--vscode-editorInfo-foreground);
    color: var(--vscode-foreground);
    font-size: 12px;
  }
  .panel-confidence-banner-message {
    flex: 1;
    overflow-wrap: anywhere;
  }
  .panel-confidence-banner-action {
    border: 1px solid var(--vscode-panel-border);
    background: transparent;
    color: var(--vscode-foreground);
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 4px;
    cursor: pointer;
    white-space: nowrap;
  }
`;
