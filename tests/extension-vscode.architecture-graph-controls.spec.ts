import { describe, expect, it } from 'vitest';
import type { WorkspaceDependencyGraphResult } from '@codepol/core';
import { architectureCodeLensViewModelCreate } from '../extension-vscode/src/codeLensViewModels';
import {
  dependencyGraphControlMessageIs,
  dependencyGraphControlStateUpdate,
  dependencyGraphPanelControlStateInitialDependencyGraph,
} from '../extension-vscode/src/panels/controls';
import {
  architectureLinksPanelViewModelCreate,
  dependencyGraphPanelViewModelCreate,
} from '../extension-vscode/src/viewModels';

const baseGraph: WorkspaceDependencyGraphResult = {
  nodes: [
    {
      uri: 'file:///workspace/apps/web/src/app.ts',
      workspaceRelativePath: 'apps/web/src/app.ts',
    },
    {
      uri: 'file:///workspace/apps/web/src/app.test.ts',
      workspaceRelativePath: 'apps/web/src/app.test.ts',
    },
    {
      uri: 'file:///workspace/packages/lib/src/index.ts',
      workspaceRelativePath: 'packages/lib/src/index.ts',
    },
    {
      uri: 'file:///workspace/packages/lib/src/math.ts',
      workspaceRelativePath: 'packages/lib/src/math.ts',
    },
  ],
  edges: [
    {
      fromUri: 'file:///workspace/apps/web/src/app.ts',
      toUri: 'file:///workspace/packages/lib/src/index.ts',
      kind: 'static',
      crossesPackageBoundary: true,
      crossesLayerBoundary: true,
    },
    {
      fromUri: 'file:///workspace/apps/web/src/app.test.ts',
      toUri: 'file:///workspace/apps/web/src/app.ts',
      kind: 'static',
      crossesPackageBoundary: false,
      crossesLayerBoundary: false,
    },
    {
      fromUri: 'file:///workspace/packages/lib/src/index.ts',
      toUri: 'file:///workspace/packages/lib/src/math.ts',
      kind: 'type_only',
      crossesPackageBoundary: false,
      crossesLayerBoundary: false,
    },
  ],
  entryPoints: [
    'file:///workspace/apps/web/src/app.ts',
    'file:///workspace/apps/web/src/app.test.ts',
  ],
  cycles: [],
};

describe('dependency graph control state', () => {
  it('toggles boolean filters and edge-kind chips, and resets to undefined when emptied', () => {
    const initial = dependencyGraphPanelControlStateInitialDependencyGraph;

    const afterCrossPackage = dependencyGraphControlStateUpdate(initial, {
      type: 'graphFilterToggle',
      filter: 'crossPackageOnly',
    });
    expect(afterCrossPackage?.filters.crossPackageOnly).toBe(true);

    const afterEdgeKindAdd = dependencyGraphControlStateUpdate(
      afterCrossPackage!,
      {
        type: 'graphEdgeKindToggle',
        edgeKindChipId: 'edgeKind:type_only',
      },
    );
    expect(afterEdgeKindAdd?.filters.edgeKinds).toEqual(['type_only']);

    const afterEdgeKindRemove = dependencyGraphControlStateUpdate(
      afterEdgeKindAdd!,
      {
        type: 'graphEdgeKindToggle',
        edgeKindChipId: 'edgeKind:type_only',
      },
    );
    expect(afterEdgeKindRemove?.filters.edgeKinds).toBeUndefined();

    const afterLayout = dependencyGraphControlStateUpdate(
      afterEdgeKindRemove!,
      {
        type: 'graphLayoutSet',
        layout: 'force',
      },
    );
    expect(afterLayout?.layoutMode).toBe('force');

    const afterBlast = dependencyGraphControlStateUpdate(afterLayout!, {
      type: 'graphBlastRadiusSet',
      uri: 'file:///workspace/packages/lib/src/index.ts',
    });
    expect(afterBlast?.blastRadiusUri).toBe(
      'file:///workspace/packages/lib/src/index.ts',
    );

    const afterBlastClear = dependencyGraphControlStateUpdate(afterBlast!, {
      type: 'graphBlastRadiusSet',
      uri: null,
    });
    expect(afterBlastClear?.blastRadiusUri).toBeUndefined();
  });

  it('classifies graph control messages and rejects unknown payload values', () => {
    expect(
      dependencyGraphControlMessageIs({ type: 'graphFilterToggle' }),
    ).toBe(true);
    expect(
      dependencyGraphControlMessageIs({ type: 'openLocation' }),
    ).toBe(false);

    expect(
      dependencyGraphControlStateUpdate(
        dependencyGraphPanelControlStateInitialDependencyGraph,
        {
          type: 'graphFilterToggle',
          filter: 'unknownFilter',
        } as never,
      ),
    ).toBeNull();

    expect(
      dependencyGraphControlStateUpdate(
        dependencyGraphPanelControlStateInitialDependencyGraph,
        {
          type: 'graphEdgeKindToggle',
          edgeKindChipId: 'edgeKind:bogus',
        } as never,
      ),
    ).toBeNull();

    expect(
      dependencyGraphControlStateUpdate(
        dependencyGraphPanelControlStateInitialDependencyGraph,
        {
          type: 'graphLayoutSet',
          layout: 'magic',
        } as never,
      ),
    ).toBeNull();
  });
});

describe('dependencyGraphPanelViewModelCreate filters and layout', () => {
  it('drops test files when hideTests is active and removes their edges', () => {
    const model = dependencyGraphPanelViewModelCreate({
      graph: baseGraph,
      summary: null,
      filters: { hideTests: true },
      layoutMode: 'layered',
    });

    const nodeUris = model.graph.nodes.map((node) => node.uri);
    expect(nodeUris).not.toContain(
      'file:///workspace/apps/web/src/app.test.ts',
    );
    expect(nodeUris).toContain('file:///workspace/apps/web/src/app.ts');

    const edges = model.graph.edges.map(
      (edge) => `${edge.fromUri}->${edge.toUri}`,
    );
    expect(edges).not.toContain(
      'file:///workspace/apps/web/src/app.test.ts->file:///workspace/apps/web/src/app.ts',
    );

    expect(model.controls.filterChips.find((chip) => chip.id === 'hideTests')?.active).toBe(
      true,
    );
  });

  it('only keeps edges matching active edge kinds', () => {
    const model = dependencyGraphPanelViewModelCreate({
      graph: baseGraph,
      summary: null,
      filters: { edgeKinds: ['type_only'] },
    });

    const edgeKinds = model.graph.edges.map((edge) => edge.fromUri);
    expect(edgeKinds).toEqual([
      'file:///workspace/packages/lib/src/index.ts',
    ]);
  });

  it('marks unreachable nodes as dimmed when blast radius is set', () => {
    const model = dependencyGraphPanelViewModelCreate({
      graph: baseGraph,
      summary: null,
      blastRadiusUri: 'file:///workspace/packages/lib/src/index.ts',
    });

    const dimmedUris = model.graph.nodes
      .filter((node) => node.isDimmed === true)
      .map((node) => node.uri);
    expect(dimmedUris).toEqual([]);

    const isolatedModel = dependencyGraphPanelViewModelCreate({
      graph: {
        ...baseGraph,
        edges: [],
      },
      summary: null,
      blastRadiusUri: 'file:///workspace/packages/lib/src/index.ts',
    });
    const isolatedDimmed = isolatedModel.graph.nodes
      .filter((node) => node.isDimmed === true)
      .map((node) => node.uri)
      .sort();
    expect(isolatedDimmed).toEqual(
      [
        'file:///workspace/apps/web/src/app.test.ts',
        'file:///workspace/apps/web/src/app.ts',
        'file:///workspace/packages/lib/src/math.ts',
      ].sort(),
    );
    expect(isolatedModel.controls.blastRadiusReachableCount).toBe(1);
  });

  it('switches layout mode to force layout (alphabetical grid) on demand', () => {
    const model = dependencyGraphPanelViewModelCreate({
      graph: baseGraph,
      summary: null,
      layoutMode: 'force',
    });

    expect(model.layoutMode).toBe('force');
    expect(model.graph.nodes.map((node) => node.detail)).toEqual([
      'apps/web/src/app.test.ts',
      'apps/web/src/app.ts',
      'packages/lib/src/index.ts',
      'packages/lib/src/math.ts',
    ]);
    expect(
      model.controls.layoutOptions.find((option) => option.id === 'force')?.active,
    ).toBe(true);
  });
});

describe('architectureLinksPanelViewModelCreate filters and blast-radius', () => {
  it('threads filters through to the focused canvas and exposes them on controls', () => {
    const model = architectureLinksPanelViewModelCreate({
      uri: 'file:///workspace/packages/lib/src/index.ts',
      references: null,
      hover: null,
      graph: baseGraph,
      summary: null,
      filters: { crossPackageOnly: true },
      layoutMode: 'radial',
    });

    expect(model.layoutMode).toBe('radial');
    expect(
      model.controls.filterChips.find((chip) => chip.id === 'crossPackageOnly')?.active,
    ).toBe(true);
    const edges = model.graph.edges.map(
      (edge) => `${edge.fromUri}->${edge.toUri}`,
    );
    expect(edges).toContain(
      'file:///workspace/apps/web/src/app.ts->file:///workspace/packages/lib/src/index.ts',
    );
    expect(edges).not.toContain(
      'file:///workspace/packages/lib/src/index.ts->file:///workspace/packages/lib/src/math.ts',
    );
  });

  it('dims every node outside cycleHighlightUris when the Phase 6 cycle action populates the option', () => {
    // Cycle members: app.ts (anchor) <-> index.ts. The third node in
    // baseGraph (math.ts) is NOT a member, so it must be dimmed even
    // though it is downstream of the focused subgraph.
    const cycleAnchor = 'file:///workspace/apps/web/src/app.ts';
    const cycleMember = 'file:///workspace/packages/lib/src/index.ts';
    const model = architectureLinksPanelViewModelCreate({
      uri: cycleAnchor,
      references: null,
      hover: null,
      // Use the layered layout so every node from the source graph
      // appears on the canvas — radial focus would otherwise prune
      // nodes that are not adjacent to the anchor and the dim
      // assertion would silently pass.
      layoutMode: 'layered',
      graph: baseGraph,
      summary: null,
      cycleHighlightUris: [cycleAnchor, cycleMember],
    });

    expect(model.cycleHighlightUris).toEqual([cycleAnchor, cycleMember]);

    const visibleNodes = model.graph.nodes
      .filter((node) => node.isDimmed !== true)
      .map((node) => node.uri)
      .sort();
    expect(visibleNodes).toEqual([cycleAnchor, cycleMember].sort());

    const dimmedNodes = model.graph.nodes
      .filter((node) => node.isDimmed === true)
      .map((node) => node.uri);
    // Every non-member that the layered canvas decided to render must
    // be dimmed (we don't pin the exact list to keep the test resilient
    // to future canvas layout changes).
    expect(dimmedNodes.length).toBeGreaterThan(0);
    for (const uri of dimmedNodes) {
      expect(uri).not.toBe(cycleAnchor);
      expect(uri).not.toBe(cycleMember);
    }
  });

  it('intersects cycleHighlightUris with blastRadiusUri so a node must be in both sets to stay un-dimmed', () => {
    const cycleAnchor = 'file:///workspace/apps/web/src/app.ts';
    const cycleMember = 'file:///workspace/packages/lib/src/index.ts';
    // Blast seed is the test file. Blast radius is the undirected
    // reachable set, so it covers the anchor and the cycle member but
    // NOT math.ts (which only exists downstream of index.ts via a
    // type-only edge already filtered into the canvas).
    const blastSeed = 'file:///workspace/apps/web/src/app.test.ts';
    const mathUri = 'file:///workspace/packages/lib/src/math.ts';

    const model = architectureLinksPanelViewModelCreate({
      uri: cycleAnchor,
      references: null,
      hover: null,
      layoutMode: 'layered',
      graph: baseGraph,
      summary: null,
      blastRadiusUri: blastSeed,
      // math.ts is reachable from blast seed via the undirected
      // adjacency (test -> app -> index -> math), so the intersection
      // with the cycle set will keep only the two cycle members.
      cycleHighlightUris: [cycleAnchor, cycleMember],
    });

    const dimmed = new Set(
      model.graph.nodes
        .filter((node) => node.isDimmed === true)
        .map((node) => node.uri),
    );
    // Cycle anchor + member: in both sets -> visible.
    expect(dimmed.has(cycleAnchor)).toBe(false);
    expect(dimmed.has(cycleMember)).toBe(false);
    // Blast seed and math.ts: reachable from blast but not in the
    // cycle highlight set -> intersected away -> dimmed.
    expect(dimmed.has(blastSeed)).toBe(true);
    expect(dimmed.has(mathUri)).toBe(true);
  });

  it('omits cycleHighlightUris from the view model when the option is empty or unset', () => {
    const noOption = architectureLinksPanelViewModelCreate({
      uri: 'file:///workspace/packages/lib/src/index.ts',
      references: null,
      hover: null,
      graph: baseGraph,
      summary: null,
    });
    expect(noOption.cycleHighlightUris).toBeUndefined();

    const emptyArray = architectureLinksPanelViewModelCreate({
      uri: 'file:///workspace/packages/lib/src/index.ts',
      references: null,
      hover: null,
      graph: baseGraph,
      summary: null,
      cycleHighlightUris: [],
    });
    expect(emptyArray.cycleHighlightUris).toBeUndefined();
    // No highlight set -> nothing should be dimmed.
    expect(
      emptyArray.graph.nodes.every((node) => node.isDimmed !== true),
    ).toBe(true);
  });
});

describe('architectureCodeLensViewModelCreate', () => {
  it('counts importers and importees from the impact-radius subgraph', () => {
    const viewModel = architectureCodeLensViewModelCreate({
      graph: baseGraph,
      focusUri: 'file:///workspace/packages/lib/src/index.ts',
    });
    expect(viewModel).toEqual({
      title: 'Codepol: 1 importer • 1 importee',
      tooltip: 'Peek Codepol architecture for packages/lib/src/index.ts',
      commandKind: 'peekArchitecture',
      commandArgument: { uri: 'file:///workspace/packages/lib/src/index.ts' },
      importerCount: 1,
      importeeCount: 1,
    });
  });

  it('returns null when the focus file is not in the graph', () => {
    expect(
      architectureCodeLensViewModelCreate({
        graph: baseGraph,
        focusUri: 'file:///workspace/missing.ts',
      }),
    ).toBeNull();
  });

  it('uses pluralised counts for zero and many importers', () => {
    const zero = architectureCodeLensViewModelCreate({
      graph: {
        ...baseGraph,
        edges: [],
      },
      focusUri: 'file:///workspace/packages/lib/src/index.ts',
    });
    expect(zero?.title).toBe('Codepol: 0 importers • 0 importees');
  });

  it('appends Phase 8 instability and complexity to the title when the focus file is in the summary', () => {
    const focusUri = 'file:///workspace/packages/lib/src/index.ts';
    const viewModel = architectureCodeLensViewModelCreate({
      graph: baseGraph,
      focusUri,
      summary: {
        summary: 'Indexed 4 files, 8 symbols, 1 entry points, 0 cycles.',
        indexedFileCount: 4,
        symbolCount: 8,
        scopeCount: 4,
        relationCount: 6,
        entryPointCount: 2,
        cycleCount: 0,
        hotspots: [],
        instability: [
          {
            uri: focusUri,
            workspaceRelativePath: 'packages/lib/src/index.ts',
            value: 0.5,
            importerCount: 1,
            importeeCount: 1,
          },
        ],
        complexityHotspots: [
          {
            uri: focusUri,
            workspaceRelativePath: 'packages/lib/src/index.ts',
            aggregateCyclomaticComplexity: 14,
            importerCount: 1,
            score: 14,
          },
        ],
      },
    });
    expect(viewModel).toEqual({
      title:
        'Codepol: 1 importer • 1 importee • I=0.50 • complexity 14',
      tooltip: 'Peek Codepol architecture for packages/lib/src/index.ts',
      commandKind: 'peekArchitecture',
      commandArgument: { uri: focusUri },
      importerCount: 1,
      importeeCount: 1,
      instabilityValue: 0.5,
      aggregateCyclomaticComplexity: 14,
    });
  });

  it('falls back to the legacy title when the summary is null or omits the focus file', () => {
    const focusUri = 'file:///workspace/packages/lib/src/index.ts';
    const fromNullSummary = architectureCodeLensViewModelCreate({
      graph: baseGraph,
      focusUri,
      summary: null,
    });
    expect(fromNullSummary?.title).toBe('Codepol: 1 importer • 1 importee');
    expect(fromNullSummary?.instabilityValue).toBeUndefined();
    expect(fromNullSummary?.aggregateCyclomaticComplexity).toBeUndefined();

    const fromOtherFileSummary = architectureCodeLensViewModelCreate({
      graph: baseGraph,
      focusUri,
      summary: {
        summary: 'Indexed 4 files',
        indexedFileCount: 4,
        symbolCount: 8,
        scopeCount: 4,
        relationCount: 6,
        entryPointCount: 2,
        cycleCount: 0,
        hotspots: [],
        instability: [
          {
            uri: 'file:///workspace/somewhere/else.ts',
            workspaceRelativePath: 'somewhere/else.ts',
            value: 0.9,
            importerCount: 0,
            importeeCount: 9,
          },
        ],
      },
    });
    expect(fromOtherFileSummary?.title).toBe(
      'Codepol: 1 importer • 1 importee',
    );
    expect(fromOtherFileSummary?.instabilityValue).toBeUndefined();
    expect(fromOtherFileSummary?.aggregateCyclomaticComplexity).toBeUndefined();
  });
});
