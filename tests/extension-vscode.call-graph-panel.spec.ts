/**
 * Unit tests for the call-graph panel view-model and click translator.
 *
 * The view-model is the load-bearing piece — the manager defers all
 * shape and click decisions to it, so pinning the layout / chip /
 * navigation behavior here covers the panel's contract end-to-end
 * without spinning up a real `vscode.WebviewPanel`.
 */
import { describe, expect, it } from 'vitest';
import {
  callGraphNodeOpenLocationResolve,
  callGraphPanelViewModelCreate,
} from '../extension-vscode/src/callGraphViewModels';
import { codepolPanelHtmlRender } from '../extension-vscode/src/panels/render';
import type { WorkspaceDependencyGraphResult } from '@codepol/core';

const SEED_ID = 'seed-symbol-id';
const CALLER_ID = 'caller-symbol-id';
const CALLEE_ID = 'callee-symbol-id';

const SEED_URI = `codepol-symbol://${encodeURIComponent(SEED_ID)}`;
const CALLER_URI = `codepol-symbol://${encodeURIComponent(CALLER_ID)}`;
const CALLEE_URI = `codepol-symbol://${encodeURIComponent(CALLEE_ID)}`;

function callGraphFixtureCreate(): WorkspaceDependencyGraphResult {
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
          start: { line: 4, character: 16 },
          end: { line: 4, character: 20 },
        },
      },
      {
        uri: CALLER_URI,
        workspaceRelativePath: 'src/caller.ts::caller',
        symbolId: CALLER_ID,
        symbolName: 'caller',
        symbolKind: 'function',
        declarationUri: 'file:///workspace/src/caller.ts',
        declarationRange: {
          start: { line: 9, character: 8 },
          end: { line: 9, character: 14 },
        },
      },
      {
        uri: CALLEE_URI,
        workspaceRelativePath: 'src/callee.ts::callee',
        symbolId: CALLEE_ID,
        symbolName: 'callee',
        symbolKind: 'function',
        declarationUri: 'file:///workspace/src/callee.ts',
        declarationRange: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 6 },
        },
      },
    ],
    edges: [
      { fromUri: CALLER_URI, toUri: SEED_URI },
      { fromUri: SEED_URI, toUri: CALLEE_URI },
    ],
    entryPoints: [],
    cycles: [],
  };
}

describe('callGraphPanelViewModelCreate', () => {
  it('places the seed at the centre with caller above and callee below for direction "both"', () => {
    const model = callGraphPanelViewModelCreate({
      graph: callGraphFixtureCreate(),
      focusSymbolId: SEED_ID,
      direction: 'both',
      depth: 1,
    });
    const layers = new Map(
      model.graph.nodes.map((n) => [n.symbolId ?? n.uri, n.layer]),
    );
    expect(layers.get(SEED_ID)).toBe('seed');
    expect(layers.get(CALLER_ID)).toBe('caller');
    expect(layers.get(CALLEE_ID)).toBe('callee');

    const seedNode = model.graph.nodes.find((n) => n.symbolId === SEED_ID)!;
    const callerNode = model.graph.nodes.find((n) => n.symbolId === CALLER_ID)!;
    const calleeNode = model.graph.nodes.find((n) => n.symbolId === CALLEE_ID)!;
    // Caller above the seed (smaller y), callee below (larger y).
    expect(callerNode.y).toBeLessThan(seedNode.y);
    expect(calleeNode.y).toBeGreaterThan(seedNode.y);
  });

  it('drops endpoints out of the requested direction so the panel only shows callers when asked', () => {
    const model = callGraphPanelViewModelCreate({
      graph: callGraphFixtureCreate(),
      focusSymbolId: SEED_ID,
      direction: 'callers',
      depth: 1,
    });
    const ids = model.graph.nodes.map((n) => n.symbolId);
    expect(ids).toContain(SEED_ID);
    expect(ids).toContain(CALLER_ID);
    expect(ids).not.toContain(CALLEE_ID);
    // Edge to the dropped callee must also be excluded.
    const edgeUris = model.graph.edges.map((e) => `${e.fromUri}->${e.toUri}`);
    expect(edgeUris).toContain(`${CALLER_URI}->${SEED_URI}`);
    expect(edgeUris).not.toContain(`${SEED_URI}->${CALLEE_URI}`);
  });

  it('flags the active direction and depth chips and leaves Phase 9.2 axes inert', () => {
    const model = callGraphPanelViewModelCreate({
      graph: callGraphFixtureCreate(),
      focusSymbolId: SEED_ID,
      direction: 'callees',
      depth: 2,
    });
    const activeDirection = model.controls.directionChips
      .filter((c) => c.active)
      .map((c) => c.id);
    const activeDepth = model.controls.depthChips
      .filter((c) => c.active)
      .map((c) => c.id);
    expect(activeDirection).toEqual(['direction:callees']);
    expect(activeDepth).toEqual(['depth:2']);
    // Phase 7: confidence + kind chips are now interactive and
    // default to all-active (no filter applied). Toggling a chip
    // narrows the visible set; users can opt into a filter without
    // leaving an empty subgraph by accident.
    expect(model.controls.confidenceChips.every((c) => c.active)).toBe(true);
    expect(model.controls.kindChips.every((c) => c.active)).toBe(true);
  });

  it('produces a rebuild with the new direction when the panel toggles direction', () => {
    const both = callGraphPanelViewModelCreate({
      graph: callGraphFixtureCreate(),
      focusSymbolId: SEED_ID,
      direction: 'both',
      depth: 1,
    });
    const callersOnly = callGraphPanelViewModelCreate({
      graph: callGraphFixtureCreate(),
      focusSymbolId: SEED_ID,
      direction: 'callers',
      depth: 1,
    });
    expect(both.graph.nodes.length).toBeGreaterThan(callersOnly.graph.nodes.length);
    expect(callersOnly.direction).toBe('callers');
  });

  it('renders a meaningful empty message when the seed is structurally isolated', () => {
    const model = callGraphPanelViewModelCreate({
      graph: { nodes: [], edges: [], entryPoints: [], cycles: [] },
      focusSymbolId: SEED_ID,
      focusSymbolName: 'lonely',
      direction: 'both',
      depth: 1,
    });
    expect(model.graph.emptyMessage).toContain('lonely');
  });
});

describe('callGraphNodeOpenLocationResolve', () => {
  it('translates a symbol-URI click to the symbol declaration', () => {
    const model = callGraphPanelViewModelCreate({
      graph: callGraphFixtureCreate(),
      focusSymbolId: SEED_ID,
      direction: 'both',
      depth: 1,
    });
    const opened = callGraphNodeOpenLocationResolve({
      model,
      uri: CALLER_URI,
    });
    expect(opened).toEqual({
      uri: 'file:///workspace/src/caller.ts',
      line: 9,
      character: 8,
    });
  });

  it('returns null for an unknown URI rather than fabricating a location', () => {
    const model = callGraphPanelViewModelCreate({
      graph: callGraphFixtureCreate(),
      focusSymbolId: SEED_ID,
      direction: 'both',
      depth: 1,
    });
    const opened = callGraphNodeOpenLocationResolve({
      model,
      uri: 'codepol-symbol://nope',
    });
    expect(opened).toBeNull();
  });
});

describe('codepolPanelHtmlRender (callGraph kind)', () => {
  it('embeds the panel body, chip controls, and SVG without leaking raw symbol ids into attributes', () => {
    const model = callGraphPanelViewModelCreate({
      graph: callGraphFixtureCreate(),
      focusSymbolId: SEED_ID,
      direction: 'both',
      depth: 1,
    });
    const html = codepolPanelHtmlRender({
      nonce: 'test-nonce',
      model: {
        kind: 'callGraph',
        title: 'Codepol: Call Graph (seed)',
        data: model,
      },
    });
    expect(html).toContain('Call Graph: seed');
    expect(html).toContain('data-cg-chip-group="direction"');
    expect(html).toContain('data-cg-chip-value="both"');
    expect(html).toContain('class="cg-canvas"');
    expect(html).toContain(`data-open-uri="${SEED_URI}"`);
  });

  it('renders the structural-confidence banner and locked mode pill when mode is signature-impact', () => {
    const model = callGraphPanelViewModelCreate({
      graph: callGraphFixtureCreate(),
      focusSymbolId: SEED_ID,
      direction: 'callers',
      depth: 'unbounded',
      mode: 'signature-impact',
    });
    const html = codepolPanelHtmlRender({
      nonce: 'test-nonce',
      model: {
        kind: 'callGraph',
        title: 'Codepol: Call Graph (seed)',
        data: model,
      },
    });
    // Mode pill rendered + dispatch attribute on the clear button.
    expect(html).toContain('panel-mode-pill');
    expect(html).toContain('data-panel-mode="signature-impact"');
    expect(html).toContain('Signature impact');
    expect(html).toContain('callers, unbounded');
    expect(html).toContain('data-panel-mode-clear="signature-impact"');
    // Direction / depth chips locked.
    expect(html).toContain('panel-chip-locked');
    expect(html).toContain('aria-disabled="true"');
    // Structural-confidence banner above the canvas.
    expect(html).toContain('panel-confidence-banner');
    expect(html).toContain('Structural confidence');
  });

  it('omits the mode pill and confidence banner in the default interactive mode', () => {
    const model = callGraphPanelViewModelCreate({
      graph: callGraphFixtureCreate(),
      focusSymbolId: SEED_ID,
      direction: 'both',
      depth: 1,
    });
    const html = codepolPanelHtmlRender({
      nonce: 'test-nonce',
      model: {
        kind: 'callGraph',
        title: 'Codepol: Call Graph (seed)',
        data: model,
      },
    });
    // The CSS embeds class-name selectors so we assert the *DOM
    // element* attribute, not the raw substring (which would also
    // match the stylesheet).
    expect(html).not.toContain('class="panel-mode-pill"');
    expect(html).not.toContain('class="panel-confidence-banner"');
    expect(html).not.toContain('panel-chip panel-chip-active panel-chip-locked');
    expect(html).not.toContain('aria-disabled="true"');
  });

  it('renders the per-tier tally and confidence + kind chip rows so the panel surface stays uniform with type hierarchy', () => {
    const model = callGraphPanelViewModelCreate({
      graph: callGraphFixtureCreate(),
      focusSymbolId: SEED_ID,
      direction: 'both',
      depth: 1,
    });
    const html = codepolPanelHtmlRender({
      nonce: 'test-nonce',
      model: {
        kind: 'callGraph',
        title: 'Codepol: Call Graph (seed)',
        data: model,
      },
    });
    // Tier tally line + "structural" entry (the fixture has two
    // structural edges).
    expect(html).toContain('class="panel-tally cg-summary"');
    expect(html).toContain('2 structural');
    // Confidence + kind chip rows present and dispatch through the
    // call-graph attribute pair (same dispatcher branch as the
    // direction / depth chips).
    expect(html).toContain('data-cg-chip-group="confidence"');
    expect(html).toContain('data-cg-chip-group="kind"');
    // Legend block present so users can read what they're looking at.
    expect(html).toContain('class="panel-legend"');
    expect(html).toContain('cg-edge-structural');
    expect(html).toContain('cg-edge-type-aware');
  });

  it('renders the lens-switcher header when the controller supplied one', () => {
    const model = callGraphPanelViewModelCreate({
      graph: callGraphFixtureCreate(),
      focusSymbolId: SEED_ID,
      direction: 'both',
      depth: 1,
      lensSwitcher: {
        currentLens: 'callers',
        availableLenses: ['callers', 'type-hierarchy'],
        focus: { kind: 'symbol', symbolId: SEED_ID, symbolName: 'seed' },
      },
    });
    const html = codepolPanelHtmlRender({
      nonce: 'test-nonce',
      model: {
        kind: 'callGraph',
        title: 'Codepol: Call Graph (seed)',
        data: model,
      },
    });
    expect(html).toContain('panel-lens-switcher');
    expect(html).toContain('data-panel-lens="callers"');
    expect(html).toContain('data-panel-lens="type-hierarchy"');
    expect(html).toContain('panel-lens-button-current');
  });
});
