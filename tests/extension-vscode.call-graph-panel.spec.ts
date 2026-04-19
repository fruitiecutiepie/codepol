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
    // Confidence + kind chips are scaffolded but always inert today.
    expect(model.controls.confidenceChips.every((c) => !c.active)).toBe(true);
    expect(model.controls.kindChips.every((c) => !c.active)).toBe(true);
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
});
