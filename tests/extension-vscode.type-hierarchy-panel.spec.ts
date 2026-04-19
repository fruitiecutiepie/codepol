/**
 * Unit tests for the type-hierarchy panel view-model, click
 * translator, and renderer.
 *
 * Phase 9.5 / Gap 3 — sibling to
 * `tests/extension-vscode.call-graph-panel.spec.ts`. Pinning the
 * layout / chip / navigation / confidence-tier behavior here covers
 * the panel's contract end-to-end without spinning up a real
 * `vscode.WebviewPanel`.
 */
import { describe, expect, it } from 'vitest';
import {
  typeHierarchyNodeOpenLocationResolve,
  typeHierarchyPanelViewModelCreate,
} from '../extension-vscode/src/typeHierarchyViewModels';
import { codepolPanelHtmlRender } from '../extension-vscode/src/panels/render';
import { typeHierarchyLegendHtml } from '../extension-vscode/src/panels/typeHierarchyRender';
import type { WorkspaceDependencyGraphResult } from '@codepol/core';

const SEED_ID = 'iface-symbol-id';
const SUBTYPE_DECLARED_ID = 'class-declared-id';
const SUBTYPE_SHAPE_ID = 'class-shape-id';
const SUBTYPE_TYPE_AWARE_ID = 'class-type-aware-id';
const SUPERTYPE_ID = 'iface-parent-id';

const SEED_URI = `codepol-symbol://${encodeURIComponent(SEED_ID)}`;
const SUBTYPE_DECLARED_URI = `codepol-symbol://${encodeURIComponent(SUBTYPE_DECLARED_ID)}`;
const SUBTYPE_SHAPE_URI = `codepol-symbol://${encodeURIComponent(SUBTYPE_SHAPE_ID)}`;
const SUBTYPE_TYPE_AWARE_URI = `codepol-symbol://${encodeURIComponent(SUBTYPE_TYPE_AWARE_ID)}`;
const SUPERTYPE_URI = `codepol-symbol://${encodeURIComponent(SUPERTYPE_ID)}`;

function typeHierarchyFixtureCreate(): WorkspaceDependencyGraphResult {
  return {
    nodes: [
      {
        uri: SEED_URI,
        workspaceRelativePath: 'src/iface.ts::IShape',
        symbolId: SEED_ID,
        symbolName: 'IShape',
        symbolKind: 'interface',
        declarationUri: 'file:///workspace/src/iface.ts',
        declarationRange: {
          start: { line: 0, character: 17 },
          end: { line: 0, character: 23 },
        },
      },
      {
        uri: SUBTYPE_DECLARED_URI,
        workspaceRelativePath: 'src/declared.ts::Square',
        symbolId: SUBTYPE_DECLARED_ID,
        symbolName: 'Square',
        symbolKind: 'class',
        declarationUri: 'file:///workspace/src/declared.ts',
        declarationRange: {
          start: { line: 1, character: 14 },
          end: { line: 1, character: 20 },
        },
      },
      {
        uri: SUBTYPE_SHAPE_URI,
        workspaceRelativePath: 'src/duck.ts::Duck',
        symbolId: SUBTYPE_SHAPE_ID,
        symbolName: 'Duck',
        symbolKind: 'class',
        declarationUri: 'file:///workspace/src/duck.ts',
        declarationRange: {
          start: { line: 2, character: 14 },
          end: { line: 2, character: 18 },
        },
      },
      {
        uri: SUBTYPE_TYPE_AWARE_URI,
        workspaceRelativePath: 'src/aware.ts::Hexagon',
        symbolId: SUBTYPE_TYPE_AWARE_ID,
        symbolName: 'Hexagon',
        symbolKind: 'class',
        declarationUri: 'file:///workspace/src/aware.ts',
        declarationRange: {
          start: { line: 3, character: 14 },
          end: { line: 3, character: 21 },
        },
      },
      {
        uri: SUPERTYPE_URI,
        workspaceRelativePath: 'src/parent.ts::IShapeBase',
        symbolId: SUPERTYPE_ID,
        symbolName: 'IShapeBase',
        symbolKind: 'interface',
      },
    ],
    edges: [
      // Subtypes (from = subtype, to = supertype = SEED).
      { fromUri: SUBTYPE_DECLARED_URI, toUri: SEED_URI }, // declared
      {
        fromUri: SUBTYPE_SHAPE_URI,
        toUri: SEED_URI,
        typeRelationConfidence: 'structural-shape',
      },
      {
        fromUri: SUBTYPE_TYPE_AWARE_URI,
        toUri: SEED_URI,
        typeRelationConfidence: 'type-aware',
      },
      // Seed extends a parent interface.
      { fromUri: SEED_URI, toUri: SUPERTYPE_URI },
    ],
    entryPoints: [],
    cycles: [],
  };
}

describe('typeHierarchyPanelViewModelCreate', () => {
  it('places the seed at the centre with supertypes above and subtypes below for direction "both"', () => {
    const model = typeHierarchyPanelViewModelCreate({
      graph: typeHierarchyFixtureCreate(),
      focusSymbolId: SEED_ID,
      direction: 'both',
      depth: 1,
    });
    const layers = new Map(
      model.graph.nodes.map((n) => [n.symbolId ?? n.uri, n.layer]),
    );
    expect(layers.get(SEED_ID)).toBe('seed');
    expect(layers.get(SUPERTYPE_ID)).toBe('supertype');
    expect(layers.get(SUBTYPE_DECLARED_ID)).toBe('subtype');
    expect(layers.get(SUBTYPE_SHAPE_ID)).toBe('subtype');
    expect(layers.get(SUBTYPE_TYPE_AWARE_ID)).toBe('subtype');

    const seedNode = model.graph.nodes.find((n) => n.symbolId === SEED_ID)!;
    const supertypeNode = model.graph.nodes.find((n) => n.symbolId === SUPERTYPE_ID)!;
    const subtypeNode = model.graph.nodes.find((n) => n.symbolId === SUBTYPE_DECLARED_ID)!;
    expect(supertypeNode.y).toBeLessThan(seedNode.y);
    expect(subtypeNode.y).toBeGreaterThan(seedNode.y);
  });

  it('drops endpoints out of the requested direction so subtypes-only walks omit supertypes', () => {
    const model = typeHierarchyPanelViewModelCreate({
      graph: typeHierarchyFixtureCreate(),
      focusSymbolId: SEED_ID,
      direction: 'subtypes',
      depth: 1,
    });
    const ids = model.graph.nodes.map((n) => n.symbolId);
    expect(ids).toContain(SEED_ID);
    expect(ids).toContain(SUBTYPE_DECLARED_ID);
    expect(ids).not.toContain(SUPERTYPE_ID);
    const edgeUris = model.graph.edges.map((e) => `${e.fromUri}->${e.toUri}`);
    expect(edgeUris).toContain(`${SUBTYPE_DECLARED_URI}->${SEED_URI}`);
    expect(edgeUris).not.toContain(`${SEED_URI}->${SUPERTYPE_URI}`);
  });

  it('propagates typeRelationConfidence from workspace edges to view-model edges', () => {
    const model = typeHierarchyPanelViewModelCreate({
      graph: typeHierarchyFixtureCreate(),
      focusSymbolId: SEED_ID,
      direction: 'subtypes',
      depth: 1,
    });
    const declaredEdge = model.graph.edges.find(
      (e) => e.fromUri === SUBTYPE_DECLARED_URI && e.toUri === SEED_URI,
    );
    const shapeEdge = model.graph.edges.find(
      (e) => e.fromUri === SUBTYPE_SHAPE_URI && e.toUri === SEED_URI,
    );
    const typeAwareEdge = model.graph.edges.find(
      (e) => e.fromUri === SUBTYPE_TYPE_AWARE_URI && e.toUri === SEED_URI,
    );
    expect(declaredEdge?.typeRelationConfidence).toBeUndefined();
    expect(shapeEdge?.typeRelationConfidence).toBe('structural-shape');
    expect(typeAwareEdge?.typeRelationConfidence).toBe('type-aware');
  });

  it('tallies edge counts by tier for the panel header', () => {
    const model = typeHierarchyPanelViewModelCreate({
      graph: typeHierarchyFixtureCreate(),
      focusSymbolId: SEED_ID,
      direction: 'both',
      depth: 1,
    });
    // Seed has 1 declared subtype, 1 shape-matched subtype, 1
    // type-aware subtype, plus 1 supertype edge (declared).
    expect(model.edgeCounts.declared).toBe(2);
    expect(model.edgeCounts.structuralShape).toBe(1);
    expect(model.edgeCounts.typeAware).toBe(1);
  });

  it('flags the active direction and depth chips', () => {
    const model = typeHierarchyPanelViewModelCreate({
      graph: typeHierarchyFixtureCreate(),
      focusSymbolId: SEED_ID,
      direction: 'subtypes',
      depth: 2,
    });
    const activeDirection = model.controls.directionChips
      .filter((c) => c.active)
      .map((c) => c.id);
    const activeDepth = model.controls.depthChips
      .filter((c) => c.active)
      .map((c) => c.id);
    expect(activeDirection).toEqual(['direction:subtypes']);
    expect(activeDepth).toEqual(['depth:2']);
  });

  it('renders a meaningful empty message when the seed is structurally isolated', () => {
    const model = typeHierarchyPanelViewModelCreate({
      graph: { nodes: [], edges: [], entryPoints: [], cycles: [] },
      focusSymbolId: SEED_ID,
      focusSymbolName: 'lonely',
      direction: 'both',
      depth: 1,
    });
    expect(model.graph.emptyMessage).toContain('lonely');
  });
});

describe('typeHierarchyNodeOpenLocationResolve', () => {
  it('translates a symbol-URI click to the symbol declaration', () => {
    const model = typeHierarchyPanelViewModelCreate({
      graph: typeHierarchyFixtureCreate(),
      focusSymbolId: SEED_ID,
      direction: 'both',
      depth: 1,
    });
    const opened = typeHierarchyNodeOpenLocationResolve({
      model,
      uri: SUBTYPE_DECLARED_URI,
    });
    expect(opened).toEqual({
      uri: 'file:///workspace/src/declared.ts',
      line: 1,
      character: 14,
    });
  });

  it('returns null for an unknown URI rather than fabricating a location', () => {
    const model = typeHierarchyPanelViewModelCreate({
      graph: typeHierarchyFixtureCreate(),
      focusSymbolId: SEED_ID,
      direction: 'both',
      depth: 1,
    });
    const opened = typeHierarchyNodeOpenLocationResolve({
      model,
      uri: 'codepol-symbol://nope',
    });
    expect(opened).toBeNull();
  });
});

describe('codepolPanelHtmlRender (typeHierarchy kind)', () => {
  it('embeds the panel body, chip controls, legend, and SVG with the three confidence styles', () => {
    const model = typeHierarchyPanelViewModelCreate({
      graph: typeHierarchyFixtureCreate(),
      focusSymbolId: SEED_ID,
      focusSymbolName: 'IShape',
      direction: 'both',
      depth: 1,
    });
    const html = codepolPanelHtmlRender({
      nonce: 'test-nonce',
      model: {
        kind: 'typeHierarchy',
        title: 'Codepol: Type Hierarchy (IShape)',
        data: model,
      },
    });
    expect(html).toContain('Type Hierarchy: IShape');
    // Chip dispatch is wired to the type-hierarchy-specific data
    // attribute pair (mirrored in render.ts BASE_SCRIPT).
    expect(html).toContain('data-th-chip-group="direction"');
    expect(html).toContain('data-th-chip-value="both"');
    // Legend block must appear, with one row per tier.
    expect(html).toContain('th-edge-declared');
    expect(html).toContain('th-edge-structural-shape');
    expect(html).toContain('th-edge-type-aware');
    // Counts line surfaces declared count plus shape-matched and
    // type-aware suffix because both are present.
    expect(html).toContain('declared');
    expect(html).toContain('shape-matched');
    expect(html).toContain('from language server');
    // Seed node is reachable via data-open-uri.
    expect(html).toContain(`data-open-uri="${SEED_URI}"`);
  });
});

describe('typeHierarchyLegendHtml', () => {
  it('emits exactly three rows with the human-readable copy', () => {
    const html = typeHierarchyLegendHtml();
    expect(html).toContain('Declared');
    expect(html).toContain('Shape-matched');
    expect(html).toContain('Type-aware');
    expect(html).toContain('extends / implements clause');
    expect(html).toContain('name + arity match');
    expect(html).toContain('confirmed by the language server');
  });
});
