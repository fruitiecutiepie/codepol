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
});
