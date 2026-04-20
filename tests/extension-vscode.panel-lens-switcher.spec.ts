/**
 * Phase 7 unit tests for the shared panel helpers in
 * `extension-vscode/src/panels/panelShared.ts` and the lens-switcher
 * routing through `CodepolPanelManager`.
 *
 * The shared helpers are pure HTML producers — easiest tested in
 * isolation against literal substring assertions that pin the
 * panel-prefix-free DOM grammar.
 *
 * The lens-switcher routing test exercises the manager-side
 * `panelLensSet` message → `panelLensOpen` action handoff so the
 * file ↔ symbol lens-button click reaches the host without going
 * through a real webview. Mirrors the `vi.mock('vscode', ...)`
 * pattern from `tests/extension-vscode.call-graph-panel-manager.spec.ts`
 * so the manager runs against a fake `WebviewPanel` we control.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PANEL_SHARED_CSS,
  panelChipRowHtml,
  panelConfidenceBannerHtml,
  panelLegendHtml,
  panelLensSwitcherHtml,
  panelModePillHtml,
  panelTallyHeaderHtml,
} from '../extension-vscode/src/panels/panelShared';

type ReceiveListener = (message: unknown) => void;

type FakeWebviewPanel = {
  webview: {
    html: string;
    onDidReceiveMessage(listener: ReceiveListener): { dispose(): void };
  };
  title: string;
  reveal(): void;
  dispose(): void;
  onDidDispose(listener: () => void): { dispose(): void };
  receive(message: unknown): void;
};

function fakeWebviewPanelCreate(): FakeWebviewPanel {
  let listener: ReceiveListener | null = null;
  const disposeListeners: Array<() => void> = [];
  return {
    webview: {
      html: '',
      onDidReceiveMessage(register) {
        listener = register;
        return { dispose() { listener = null; } };
      },
    },
    title: '',
    reveal() {},
    dispose() {
      for (const fn of disposeListeners.splice(0)) fn();
    },
    onDidDispose(register) {
      disposeListeners.push(register);
      return { dispose() {} };
    },
    receive(message) {
      listener?.(message);
    },
  };
}

const lastCreatedPanel: { value: FakeWebviewPanel | null } = { value: null };

vi.mock('vscode', () => {
  return {
    EventEmitter: class {
      private listeners: Array<(value: unknown) => void> = [];
      event = (listener: (value: unknown) => void) => {
        this.listeners.push(listener);
        return { dispose: () => {} };
      };
      fire(value?: unknown): void {
        for (const fn of this.listeners) fn(value);
      }
      dispose(): void {
        this.listeners = [];
      }
    },
    ViewColumn: { Beside: 2 },
    window: {
      createWebviewPanel(): unknown {
        const panel = fakeWebviewPanelCreate();
        lastCreatedPanel.value = panel;
        return panel;
      },
    },
  };
});

afterEach(() => {
  lastCreatedPanel.value = null;
  vi.clearAllMocks();
});

// ============================================================================
// panelChipRowHtml
// ============================================================================

describe('panelChipRowHtml', () => {
  it('emits a labelled row with the unified panel-chip class names and forwarded data attributes', () => {
    const html = panelChipRowHtml({
      label: 'Direction',
      chips: [
        {
          label: 'Callers',
          active: true,
          dataAttributes: {
            'data-cg-chip-group': 'direction',
            'data-cg-chip-value': 'callers',
          },
        },
        {
          label: 'Callees',
          active: false,
          dataAttributes: {
            'data-cg-chip-group': 'direction',
            'data-cg-chip-value': 'callees',
          },
        },
      ],
    });
    expect(html).toContain('class="panel-chip-row"');
    expect(html).toContain('aria-label="Direction"');
    expect(html).toContain('panel-chip-row-label">Direction');
    // First chip: active, second: inactive.
    expect(html).toContain('panel-chip-active');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
    // Caller-provided data attributes round-trip.
    expect(html).toContain('data-cg-chip-group="direction"');
    expect(html).toContain('data-cg-chip-value="callers"');
    expect(html).toContain('data-cg-chip-value="callees"');
  });

  it('marks locked chips with aria-disabled and the panel-chip-locked class hook', () => {
    const html = panelChipRowHtml({
      label: 'Direction',
      chips: [
        {
          label: 'Callers',
          active: true,
          locked: true,
          dataAttributes: { 'data-cg-chip-group': 'direction' },
        },
      ],
    });
    expect(html).toContain('panel-chip-locked');
    expect(html).toContain('aria-disabled="true"');
  });

  it('returns the empty string when no chips are provided', () => {
    expect(panelChipRowHtml({ label: 'Direction', chips: [] })).toBe('');
  });

  it('appends a row-extra-class hook so callers can preserve legacy CSS', () => {
    const html = panelChipRowHtml({
      label: 'Direction',
      chips: [
        {
          label: 'Callers',
          dataAttributes: { 'data-cg-chip-group': 'direction' },
        },
      ],
      rowExtraClass: 'cg-chip-row',
      chipExtraClass: 'cg-chip',
    });
    expect(html).toContain('class="panel-chip-row cg-chip-row"');
    expect(html).toContain('panel-chip cg-chip');
  });

  it('renders the optional note text to the right of the chips', () => {
    const html = panelChipRowHtml({
      label: 'Confidence',
      chips: [
        { label: 'Structural', dataAttributes: { 'data-cg-chip-group': 'confidence' } },
      ],
      note: 'Populated when a TypeAwareCallGraphSource is wired.',
    });
    expect(html).toContain('panel-chip-row-note');
    expect(html).toContain('Populated when a TypeAwareCallGraphSource is wired.');
  });
});

// ============================================================================
// panelTallyHeaderHtml
// ============================================================================

describe('panelTallyHeaderHtml', () => {
  it('joins entries with a middle dot separator', () => {
    const html = panelTallyHeaderHtml({
      tallies: [
        { label: 'declared', count: 5 },
        { label: 'shape-matched', count: 2 },
        { label: 'from language server', count: 1 },
      ],
    });
    expect(html).toContain('5 declared');
    expect(html).toContain('2 shape-matched');
    expect(html).toContain('1 from language server');
    expect(html).toContain('\u00b7');
  });

  it('omits zero-count entries', () => {
    const html = panelTallyHeaderHtml({
      tallies: [
        { label: 'declared', count: 5 },
        { label: 'shape-matched', count: 0 },
        { label: 'from language server', count: 0 },
      ],
    });
    expect(html).toContain('5 declared');
    expect(html).not.toContain('shape-matched');
    expect(html).not.toContain('from language server');
  });

  it('returns the empty string when every entry collapses', () => {
    const html = panelTallyHeaderHtml({
      tallies: [
        { label: 'structural', count: 0 },
        { label: 'type-aware', count: 0 },
      ],
    });
    expect(html).toBe('');
  });

  it('appends an optional extra class to the wrapping paragraph', () => {
    const html = panelTallyHeaderHtml({
      tallies: [{ label: 'structural', count: 1 }],
      extraClass: 'cg-summary',
    });
    expect(html).toContain('panel-tally cg-summary');
  });
});

// ============================================================================
// panelLegendHtml
// ============================================================================

describe('panelLegendHtml', () => {
  it('renders one row per legend entry with the supplied swatch class on the SVG line', () => {
    const html = panelLegendHtml({
      entries: [
        {
          label: 'Structural',
          detail: 'direct call edges',
          swatchClass: 'cg-edge-structural',
        },
        {
          label: 'Type-aware',
          detail: 'confirmed by language server',
          swatchClass: 'cg-edge-type-aware',
        },
      ],
    });
    expect(html).toContain('class="panel-legend"');
    expect(html).toContain('Structural');
    expect(html).toContain('Type-aware');
    expect(html).toContain('cg-edge-structural');
    expect(html).toContain('cg-edge-type-aware');
    expect(html).toContain('panel-legend-swatch');
    expect(html).toContain('panel-legend-label');
    expect(html).toContain('panel-legend-detail');
  });

  it('returns the empty string when no entries are provided', () => {
    expect(panelLegendHtml({ entries: [] })).toBe('');
  });
});

// ============================================================================
// panelLensSwitcherHtml
// ============================================================================

describe('panelLensSwitcherHtml', () => {
  it('emits one button per available lens with the focus payload JSON-encoded on a data attribute', () => {
    const html = panelLensSwitcherHtml({
      currentLens: 'callers',
      availableLenses: ['callers', 'type-hierarchy'],
      focus: { kind: 'symbol', symbolId: 'sym-1', symbolName: 'doStuff' },
    });
    expect(html).toContain('panel-lens-switcher');
    expect(html).toContain('panel-lens-button');
    // Both lens buttons render.
    expect(html).toContain('data-panel-lens="callers"');
    expect(html).toContain('data-panel-lens="type-hierarchy"');
    // Current lens carries the panel-lens-button-current hook.
    expect(html).toContain('panel-lens-button-current');
    // Focus payload survives the JSON round-trip.
    expect(html).toContain('data-panel-lens-focus');
    expect(html).toContain('symbolId');
    expect(html).toContain('sym-1');
  });

  it('returns the empty string when only one lens is available (no switcher value)', () => {
    expect(
      panelLensSwitcherHtml({
        currentLens: 'callers',
        availableLenses: ['callers'],
        focus: { kind: 'symbol', symbolId: 'sym-1' },
      }),
    ).toBe('');
  });

  it('encodes a file-typed focus shape so the host can decode it without parsing the lens label', () => {
    const html = panelLensSwitcherHtml({
      currentLens: 'links',
      availableLenses: ['module', 'links'],
      focus: { kind: 'file', uri: 'file:///workspace/src/a.ts' },
    });
    expect(html).toContain('&quot;kind&quot;:&quot;file&quot;');
    expect(html).toContain('file:///workspace/src/a.ts');
  });
});

// ============================================================================
// panelModePillHtml
// ============================================================================

describe('panelModePillHtml', () => {
  it('renders the locked-mode pill with a configuration suffix and clear button', () => {
    const html = panelModePillHtml({
      label: 'Signature impact',
      configurationSummary: 'callers, unbounded',
      modeId: 'signature-impact',
    });
    expect(html).toContain('panel-mode-pill');
    expect(html).toContain('data-panel-mode="signature-impact"');
    expect(html).toContain('Signature impact \u2014 callers, unbounded');
    expect(html).toContain('panel-mode-pill-clear');
    expect(html).toContain('data-panel-mode-clear="signature-impact"');
  });

  it('omits the configuration suffix when none is supplied', () => {
    const html = panelModePillHtml({ label: 'Snapshot', modeId: 'snapshot' });
    expect(html).toContain('panel-mode-pill-label">Snapshot');
    expect(html).not.toContain('\u2014');
  });
});

// ============================================================================
// panelConfidenceBannerHtml
// ============================================================================

describe('panelConfidenceBannerHtml', () => {
  it('renders a structural-confidence banner with the message escaped', () => {
    const html = panelConfidenceBannerHtml({
      message: 'Structural confidence \u2014 dynamic dispatch is not tracked.',
    });
    expect(html).toContain('panel-confidence-banner');
    expect(html).toContain('Structural confidence');
    expect(html).toContain('not tracked');
  });

  it('returns the empty string when the message is empty', () => {
    expect(panelConfidenceBannerHtml({ message: '' })).toBe('');
  });

  it('embeds the optional inline action button when both label and id are provided', () => {
    const html = panelConfidenceBannerHtml({
      message: 'Structural confidence',
      actionLabel: 'Learn more',
      actionId: 'open-confidence-docs',
    });
    expect(html).toContain('panel-confidence-banner-action');
    expect(html).toContain('data-action="open-confidence-docs"');
    expect(html).toContain('Learn more');
  });
});

// ============================================================================
// PANEL_SHARED_CSS
// ============================================================================

describe('PANEL_SHARED_CSS', () => {
  it('exports the panel grammar selectors so the shell can embed them once', () => {
    expect(PANEL_SHARED_CSS).toContain('.panel-chip-row');
    expect(PANEL_SHARED_CSS).toContain('.panel-chip');
    expect(PANEL_SHARED_CSS).toContain('.panel-tally');
    expect(PANEL_SHARED_CSS).toContain('.panel-legend');
    expect(PANEL_SHARED_CSS).toContain('.panel-lens-switcher');
    expect(PANEL_SHARED_CSS).toContain('.panel-mode-pill');
    expect(PANEL_SHARED_CSS).toContain('.panel-confidence-banner');
  });
});

// ============================================================================
// CodepolPanelManager.panelLensOpen routing
// ============================================================================

const SEED_ID = 'seed-symbol-id';
const SEED_URI = `codepol-symbol://${encodeURIComponent(SEED_ID)}`;

function callGraphFixtureGraphCreate(): import('@codepol/core').WorkspaceDependencyGraphResult {
  return {
    nodes: [
      {
        uri: SEED_URI,
        workspaceRelativePath: 'src/seed.ts::seed',
        symbolId: SEED_ID,
        symbolName: 'seed',
        symbolKind: 'function',
        declarationUri: 'file:///workspace/src/seed.ts',
        declarationRange: {
          start: { line: 0, character: 9 },
          end: { line: 0, character: 13 },
        },
      },
    ],
    edges: [],
    entryPoints: [],
    cycles: [],
  };
}

describe('CodepolPanelManager.panelLensOpen routing', () => {
  it('translates a symbol-focus panelLensSet message into a host action call', async () => {
    const { CodepolPanelManager } = await import(
      '../extension-vscode/src/panels/manager'
    );
    const { callGraphPanelViewModelCreate } = await import(
      '../extension-vscode/src/callGraphViewModels'
    );

    const panelLensOpen = vi.fn(async () => {});
    const manager = new CodepolPanelManager({
      openLocation: vi.fn(async () => {}),
      applyEditPlan: vi.fn(async () => {}),
      executeCommand: vi.fn(async () => {}),
      panelLensOpen,
    });

    const initialModel = callGraphPanelViewModelCreate({
      graph: callGraphFixtureGraphCreate(),
      focusSymbolId: SEED_ID,
      focusSymbolName: 'seed',
      direction: 'callers',
      depth: 1,
    });
    manager.showCallGraph(initialModel, async () => initialModel);

    const panel = lastCreatedPanel.value;
    expect(panel).not.toBeNull();
    panel!.receive({
      type: 'panelLensSet',
      lens: 'type-hierarchy',
      focus: { kind: 'symbol', symbolId: SEED_ID, symbolName: 'seed' },
    });
    // Allow the async messageHandle promise to settle.
    await Promise.resolve();
    await Promise.resolve();
    expect(panelLensOpen).toHaveBeenCalledWith({
      lens: 'type-hierarchy',
      focus: { kind: 'symbol', symbolId: SEED_ID, symbolName: 'seed' },
    });
  });

  it('drops malformed panelLensSet messages (unknown lens, missing focus, wrong shape)', async () => {
    const { CodepolPanelManager } = await import(
      '../extension-vscode/src/panels/manager'
    );
    const { callGraphPanelViewModelCreate } = await import(
      '../extension-vscode/src/callGraphViewModels'
    );

    const panelLensOpen = vi.fn(async () => {});
    const manager = new CodepolPanelManager({
      openLocation: vi.fn(async () => {}),
      applyEditPlan: vi.fn(async () => {}),
      executeCommand: vi.fn(async () => {}),
      panelLensOpen,
    });
    const initialModel = callGraphPanelViewModelCreate({
      graph: callGraphFixtureGraphCreate(),
      focusSymbolId: SEED_ID,
      focusSymbolName: 'seed',
      direction: 'callers',
      depth: 1,
    });
    manager.showCallGraph(initialModel, async () => initialModel);

    const panel = lastCreatedPanel.value!;
    panel.receive({
      type: 'panelLensSet',
      lens: 'not-a-lens',
      focus: { kind: 'symbol', symbolId: SEED_ID },
    });
    panel.receive({ type: 'panelLensSet', lens: 'type-hierarchy' });
    panel.receive({
      type: 'panelLensSet',
      lens: 'type-hierarchy',
      focus: { kind: 'wat', symbolId: SEED_ID },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(panelLensOpen).not.toHaveBeenCalled();
  });

  it('routes panelModeClear for a signature-impact pill back to the host with the panel focus', async () => {
    const { CodepolPanelManager } = await import(
      '../extension-vscode/src/panels/manager'
    );
    const { callGraphPanelViewModelCreate } = await import(
      '../extension-vscode/src/callGraphViewModels'
    );

    const panelModeClear = vi.fn(async () => {});
    const manager = new CodepolPanelManager({
      openLocation: vi.fn(async () => {}),
      applyEditPlan: vi.fn(async () => {}),
      executeCommand: vi.fn(async () => {}),
      panelModeClear,
    });
    const initialModel = callGraphPanelViewModelCreate({
      graph: callGraphFixtureGraphCreate(),
      focusSymbolId: SEED_ID,
      focusSymbolName: 'seed',
      direction: 'callers',
      depth: 'unbounded',
      mode: 'signature-impact',
    });
    manager.showCallGraph(initialModel, async () => initialModel);

    const panel = lastCreatedPanel.value!;
    panel.receive({ type: 'panelModeClear', modeId: 'signature-impact' });
    await Promise.resolve();
    await Promise.resolve();
    expect(panelModeClear).toHaveBeenCalledWith({
      modeId: 'signature-impact',
      focus: { kind: 'symbol', symbolId: SEED_ID, symbolName: 'seed' },
    });
  });
});
