import { describe, expect, it } from 'vitest';
import {
  architectureLinksPanelViewModelCreate,
  architectureSummaryPanelViewModelCreate,
  dependencyGraphPanelViewModelCreate,
  renamePreviewPanelViewModelCreate,
  semanticDefinitionPanelViewModelCreate,
  semanticHoverCardViewModelCreate,
} from '../extension-vscode/src/viewModels';

const dependencyGraphResult = {
  nodes: [
    {
      uri: 'file:///workspace/apps/web/src/app.ts',
      workspaceRelativePath: 'apps/web/src/app.ts',
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
    },
    {
      fromUri: 'file:///workspace/packages/lib/src/index.ts',
      toUri: 'file:///workspace/packages/lib/src/math.ts',
    },
  ],
  entryPoints: ['file:///workspace/apps/web/src/app.ts'],
  cycles: [['file:///workspace/packages/lib/src/index.ts', 'file:///workspace/packages/lib/src/math.ts']],
};

const architectureSummaryResult = {
  summary: 'Indexed 3 files, 6 symbols, 1 entry points, 1 cycles.',
  indexedFileCount: 3,
  symbolCount: 6,
  scopeCount: 3,
  relationCount: 2,
  entryPointCount: 1,
  cycleCount: 1,
  hotspots: [
    {
      uri: 'file:///workspace/packages/lib/src/index.ts',
      workspaceRelativePath: 'packages/lib/src/index.ts',
      importerCount: 1,
      importeeCount: 1,
    },
    {
      uri: 'file:///workspace/apps/web/src/app.ts',
      workspaceRelativePath: 'apps/web/src/app.ts',
      importerCount: 0,
      importeeCount: 1,
    },
  ],
};

describe('extension-vscode view model mapping', () => {
  it('maps semantic hover and definition payloads into structured cards and locations', () => {
    const hoverCard = semanticHoverCardViewModelCreate({
      target: {
        uri: 'file:///workspace/packages/lib/src/index.ts',
        semanticClass: 'architecture_node',
      },
      title: 'index.ts',
      subtitle: 'packages/lib/src/index.ts',
      summary: 'Indexed architecture node for the workspace module graph.',
      statusText: 'Ready',
      fields: [
        { label: 'Directory', value: 'packages/lib/src' },
        { label: 'Inbound edges', value: '1' },
      ],
      actions: ['go_to_definition', 'find_references', 'show_graph'],
      source: 'codepol',
      semanticClass: 'architecture_node',
    });

    expect(hoverCard).toEqual({
      title: 'index.ts',
      subtitle: 'packages/lib/src/index.ts',
      summary: 'Indexed architecture node for the workspace module graph.',
      statusText: 'Ready',
      fields: [
        { label: 'Directory', value: 'packages/lib/src' },
        { label: 'Inbound edges', value: '1' },
      ],
      actions: [
        { action: 'go_to_definition', label: 'Go To Definition' },
        { action: 'find_references', label: 'Show Architecture Links' },
        { action: 'show_graph', label: 'Show Graph' },
      ],
    });

    expect(
      semanticDefinitionPanelViewModelCreate({
        uri: 'file:///workspace/packages/lib/src/index.ts',
        definition: {
          kind: 'single_location',
          target: {
            uri: 'file:///workspace/packages/lib/src/index.ts',
            semanticClass: 'architecture_node',
          },
          location: {
            uri: 'file:///workspace/packages/lib/src/index.ts',
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
          },
          source: 'codepol',
          semanticClass: 'architecture_node',
        },
        hover: {
          target: {
            uri: 'file:///workspace/packages/lib/src/index.ts',
            semanticClass: 'architecture_node',
          },
          title: 'index.ts',
          subtitle: 'packages/lib/src/index.ts',
          summary: 'Indexed architecture node for the workspace module graph.',
          fields: [],
          actions: ['go_to_definition'],
          source: 'codepol',
          semanticClass: 'architecture_node',
        },
      }),
    ).toEqual({
      uri: 'file:///workspace/packages/lib/src/index.ts',
      hoverCard: {
        title: 'index.ts',
        subtitle: 'packages/lib/src/index.ts',
        summary: 'Indexed architecture node for the workspace module graph.',
        statusText: undefined,
        fields: [],
        actions: [{ action: 'go_to_definition', label: 'Go To Definition' }],
      },
      locations: [
        {
          uri: 'file:///workspace/packages/lib/src/index.ts',
          line: 0,
          character: 0,
          label: 'Canonical location',
          detail: 'file:///workspace/packages/lib/src/index.ts',
        },
      ],
    });
  });

  it('maps architecture summary data into a shared summary card with hotspots', () => {
    expect(
      architectureSummaryPanelViewModelCreate({
        summary: architectureSummaryResult,
      }),
    ).toEqual({
      summaryCard: {
        summary: 'Indexed 3 files, 6 symbols, 1 entry points, 1 cycles.',
        metrics: [
          { label: 'Indexed Files', value: '3' },
          { label: 'Symbols', value: '6' },
          { label: 'Scopes', value: '3' },
          { label: 'Relations', value: '2' },
          { label: 'Entry Points', value: '1' },
          { label: 'Cycles', value: '1' },
        ],
        hotspots: [
          {
            uri: 'file:///workspace/packages/lib/src/index.ts',
            line: 0,
            character: 0,
            label: 'packages/lib/src/index.ts',
            detail: '1 importer • 1 importee',
            importerCount: 1,
            importeeCount: 1,
          },
          {
            uri: 'file:///workspace/apps/web/src/app.ts',
            line: 0,
            character: 0,
            label: 'apps/web/src/app.ts',
            detail: '0 importers • 1 importee',
            importerCount: 0,
            importeeCount: 1,
          },
        ],
      },
    });
  });

  it('maps Phase 8 metrics into instability, longest chain, SCC distribution, and complexity hotspot view-model fields', () => {
    const card = architectureSummaryPanelViewModelCreate({
      summary: {
        summary: 'Indexed 4 files, 8 symbols, 1 entry points, 1 cycles.',
        indexedFileCount: 4,
        symbolCount: 8,
        scopeCount: 4,
        relationCount: 6,
        entryPointCount: 1,
        cycleCount: 1,
        hotspots: [],
        instability: [
          {
            uri: 'file:///workspace/src/entry.ts',
            workspaceRelativePath: 'src/entry.ts',
            value: 1,
            importerCount: 0,
            importeeCount: 2,
          },
          {
            uri: 'file:///workspace/src/lib/a.ts',
            workspaceRelativePath: 'src/lib/a.ts',
            value: 0.5,
            importerCount: 1,
            importeeCount: 1,
          },
        ],
        longestChain: {
          length: 3,
          uriPath: [
            'file:///workspace/src/entry.ts',
            'file:///workspace/src/lib/a.ts',
            'file:///workspace/src/lib/b.ts',
            'file:///workspace/src/lib/utils.ts',
          ],
          workspaceRelativePathPath: [
            'src/entry.ts',
            'src/lib/a.ts',
            'src/lib/b.ts',
            'src/lib/utils.ts',
          ],
        },
        sccSizeDistribution: { 2: 2, 4: 1 },
        complexityHotspots: [
          {
            uri: 'file:///workspace/src/utils.ts',
            workspaceRelativePath: 'src/utils.ts',
            aggregateCyclomaticComplexity: 14,
            importerCount: 2,
            score: 28,
          },
        ],
      },
    }).summaryCard!;

    // Three Phase 8 metric pills append in this order: Longest Chain,
    // Largest Cycle, Most Unstable.
    const phase8MetricLabels = card.metrics.slice(-3).map((metric) => metric.label);
    expect(phase8MetricLabels).toEqual(['Longest Chain', 'Largest Cycle', 'Most Unstable']);

    // Instability rows: top entries pre-formatted with valueLabel and a
    // panel-friendly detail string. Order matches the source array
    // (already sorted by value desc).
    expect(card.instabilityRows).toEqual([
      {
        uri: 'file:///workspace/src/entry.ts',
        line: 0,
        character: 0,
        label: 'src/entry.ts',
        detail: 'I=1.00 • Ce=2 Ca=0',
        value: 1,
        valueLabel: '1.00',
        importerCount: 0,
        importeeCount: 2,
      },
      {
        uri: 'file:///workspace/src/lib/a.ts',
        line: 0,
        character: 0,
        label: 'src/lib/a.ts',
        detail: 'I=0.50 • Ce=1 Ca=1',
        value: 0.5,
        valueLabel: '0.50',
        importerCount: 1,
        importeeCount: 1,
      },
    ]);

    // Longest chain path: each row carries the import position label.
    expect(card.longestChainPath).toEqual([
      {
        uri: 'file:///workspace/src/entry.ts',
        line: 0,
        character: 0,
        label: 'src/entry.ts',
        detail: 'hop 1 of 4',
      },
      {
        uri: 'file:///workspace/src/lib/a.ts',
        line: 0,
        character: 0,
        label: 'src/lib/a.ts',
        detail: 'hop 2 of 4',
      },
      {
        uri: 'file:///workspace/src/lib/b.ts',
        line: 0,
        character: 0,
        label: 'src/lib/b.ts',
        detail: 'hop 3 of 4',
      },
      {
        uri: 'file:///workspace/src/lib/utils.ts',
        line: 0,
        character: 0,
        label: 'src/lib/utils.ts',
        detail: 'hop 4 of 4',
      },
    ]);

    // SCC distribution: largest size first.
    expect(card.sccDistributionRows).toEqual([
      { size: 4, count: 1, label: '4-file SCC × 1 cycle' },
      { size: 2, count: 2, label: '2-file SCC × 2 cycles' },
    ]);

    // Complexity hotspot row detail now carries the explicit score so
    // the panel does not have to recompute the ranking math.
    expect(card.complexityHotspots).toEqual([
      {
        uri: 'file:///workspace/src/utils.ts',
        line: 0,
        character: 0,
        label: 'src/utils.ts',
        detail: 'complexity 14 × 2 importers = score 28',
        aggregateCyclomaticComplexity: 14,
        importerCount: 2,
        score: 28,
      },
    ]);
  });

  it('omits Phase 8 view-model fields when the underlying summary lacks them', () => {
    const card = architectureSummaryPanelViewModelCreate({
      summary: architectureSummaryResult,
    }).summaryCard!;
    expect(card.instabilityRows).toBeUndefined();
    expect(card.longestChainPath).toBeUndefined();
    expect(card.sccDistributionRows).toBeUndefined();
    expect(card.complexityHotspots).toBeUndefined();
  });

  it('maps workspace and focused dependency graphs with deterministic highlighting', () => {
    const workspaceGraph = dependencyGraphPanelViewModelCreate({
      graph: dependencyGraphResult,
      summary: architectureSummaryResult,
      focusUri: 'file:///workspace/packages/lib/src/index.ts',
    });

    expect(workspaceGraph.focusUri).toBe('file:///workspace/packages/lib/src/index.ts');
    expect(workspaceGraph.summaryCard?.summary).toBe(architectureSummaryResult.summary);
    expect(workspaceGraph.graph.mode).toBe('workspace');
    expect(workspaceGraph.graph.nodes.map((node) => node.detail)).toEqual([
      'apps/web/src/app.ts',
      'packages/lib/src/index.ts',
      'packages/lib/src/math.ts',
    ]);
    expect(
      workspaceGraph.graph.nodes.find((node) => node.uri === 'file:///workspace/packages/lib/src/index.ts'),
    ).toMatchObject({
      isFocus: true,
      isCycleMember: true,
    });

    const focusedGraph = architectureLinksPanelViewModelCreate({
      uri: 'file:///workspace/packages/lib/src/index.ts',
      references: {
        target: {
          uri: 'file:///workspace/packages/lib/src/index.ts',
          semanticClass: 'architecture_node',
        },
        presentation: 'grouped_list',
        totalItems: 3,
        totalAvailableItems: 3,
        truncated: false,
        groups: [
          {
            group: 'incoming',
            totalCount: 1,
            truncated: false,
            items: [
              {
                location: {
                  uri: 'file:///workspace/apps/web/src/app.ts',
                  range: {
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: 10 },
                  },
                },
                label: 'apps/web/src/app.ts',
                detail: 'import sharedValue from @acme/lib',
                relationKind: 'incoming',
                semanticClass: 'architecture_node',
              },
            ],
          },
          {
            group: 'outgoing',
            totalCount: 1,
            truncated: false,
            items: [
              {
                location: {
                  uri: 'file:///workspace/packages/lib/src/math.ts',
                  range: {
                    start: { line: 1, character: 0 },
                    end: { line: 1, character: 12 },
                  },
                },
                label: 'packages/lib/src/math.ts',
                detail: 'export * from ./math',
                relationKind: 'outgoing',
                semanticClass: 'architecture_node',
              },
            ],
          },
        ],
        source: 'codepol',
        semanticClass: 'architecture_node',
      },
      hover: null,
      graph: dependencyGraphResult,
      summary: architectureSummaryResult,
    });

    expect(focusedGraph.graph.mode).toBe('focus');
    expect(focusedGraph.graph.focusUri).toBe('file:///workspace/packages/lib/src/index.ts');
    expect(focusedGraph.graph.nodes.map((node) => node.detail)).toEqual([
      'apps/web/src/app.ts',
      'packages/lib/src/index.ts',
      'packages/lib/src/math.ts',
    ]);
    expect(focusedGraph.graph.edges).toHaveLength(2);
    expect(
      focusedGraph.graph.nodes.find((node) => node.uri === 'file:///workspace/packages/lib/src/index.ts'),
    ).toMatchObject({
      isFocus: true,
    });
    expect(focusedGraph.groups).toEqual([
      {
        group: 'incoming',
        totalCount: 1,
        truncated: false,
        items: [
          {
            uri: 'file:///workspace/apps/web/src/app.ts',
            line: 0,
            character: 0,
            label: 'apps/web/src/app.ts',
            detail: 'import sharedValue from @acme/lib',
          },
        ],
      },
      {
        group: 'outgoing',
        totalCount: 1,
        truncated: false,
        items: [
          {
            uri: 'file:///workspace/packages/lib/src/math.ts',
            line: 1,
            character: 0,
            label: 'packages/lib/src/math.ts',
            detail: 'export * from ./math',
          },
        ],
      },
    ]);
  });

  it('enriches dependency-graph view models with metrics, package, edge kind, and tooltip strings', () => {
    const enrichedGraph = {
      nodes: [
        {
          uri: 'file:///workspace/apps/web/src/app.ts',
          workspaceRelativePath: 'apps/web/src/app.ts',
          packageName: '@acme/web',
          metrics: {
            importerCount: 0,
            importeeCount: 1,
            symbolCount: 4,
            loc: 32,
            aggregateCyclomaticComplexity: 5,
            isEntryPoint: true,
            isInCycle: false,
          },
        },
        {
          uri: 'file:///workspace/packages/lib/src/index.ts',
          workspaceRelativePath: 'packages/lib/src/index.ts',
          packageName: '@acme/lib',
          metrics: {
            importerCount: 3,
            importeeCount: 1,
            symbolCount: 12,
            loc: 84,
            aggregateCyclomaticComplexity: 7,
            isEntryPoint: false,
            isInCycle: false,
          },
        },
      ],
      edges: [
        {
          fromUri: 'file:///workspace/apps/web/src/app.ts',
          toUri: 'file:///workspace/packages/lib/src/index.ts',
          kind: 'dynamic' as const,
          bindingCount: 2,
          crossesPackageBoundary: true,
        },
      ],
      entryPoints: ['file:///workspace/apps/web/src/app.ts'],
      cycles: [],
    };

    const panel = dependencyGraphPanelViewModelCreate({
      graph: enrichedGraph,
      summary: null,
    });

    const libNode = panel.graph.nodes.find(
      (node) => node.uri === 'file:///workspace/packages/lib/src/index.ts',
    );
    expect(libNode).toBeDefined();
    expect(libNode).toMatchObject({
      importerCount: 3,
      importeeCount: 1,
      symbolCount: 12,
      loc: 84,
      aggregateCyclomaticComplexity: 7,
      packageName: '@acme/lib',
      detail: 'packages/lib/src/index.ts · 3 importers · 1 importee',
      countsLine: '3 importers · 1 importee · 12 symbols · 84 LOC · cyc 7',
      tooltip: '3 importers · 1 importee · 12 symbols · 84 LOC · cyc 7 · @acme/lib',
    });

    const appNode = panel.graph.nodes.find(
      (node) => node.uri === 'file:///workspace/apps/web/src/app.ts',
    );
    expect(appNode).toMatchObject({
      packageName: '@acme/web',
      detail: 'apps/web/src/app.ts · 0 importers · 1 importee',
    });

    expect(panel.graph.edges).toHaveLength(1);
    expect(panel.graph.edges[0]).toMatchObject({
      kind: 'dynamic',
      bindingCount: 2,
      crossesPackageBoundary: true,
      tooltip: 'dynamic · 2 bindings · cross-package',
    });
    expect(panel.graph.edges[0].crossesLayerBoundary).toBeUndefined();
  });

  it('leaves dependency-graph enrichment fields undefined when metrics absent', () => {
    const panel = dependencyGraphPanelViewModelCreate({
      graph: dependencyGraphResult,
      summary: null,
    });
    for (const node of panel.graph.nodes) {
      expect(node.importerCount).toBeUndefined();
      expect(node.importeeCount).toBeUndefined();
      expect(node.symbolCount).toBeUndefined();
      expect(node.loc).toBeUndefined();
      expect(node.aggregateCyclomaticComplexity).toBeUndefined();
      expect(node.packageName).toBeUndefined();
      expect(node.layer).toBeUndefined();
      expect(node.tooltip).toBeUndefined();
      expect(node.countsLine).toBeUndefined();
      // Detail line stays equal to the workspaceRelativePath when no metrics
      // are present so older fixtures keep their assertions valid.
      expect(node.detail).toBe(node.detail.split(' · ')[0]);
    }
    for (const edge of panel.graph.edges) {
      expect(edge.kind).toBeUndefined();
      expect(edge.bindingCount).toBeUndefined();
      expect(edge.crossesPackageBoundary).toBeUndefined();
      expect(edge.crossesLayerBoundary).toBeUndefined();
      expect(edge.tooltip).toBeUndefined();
    }
  });

  it('maps rename preview payloads into grouped UI models', () => {
    expect(
      renamePreviewPanelViewModelCreate({
        candidate: {
          kind: 'workspace_package',
          label: '@acme/lib',
          description: 'packages/lib',
          detail: 'Workspace package',
          target: {
            semanticClass: 'domain_entity',
            targetId: 'package:@acme/lib',
          },
        },
        prepare: {
          ok: true,
          target: {
            semanticClass: 'domain_entity',
            targetId: 'package:@acme/lib',
          },
          displayName: '@acme/lib',
          currentName: '@acme/lib',
          normalizedCurrentName: '@acme/lib',
          namespaceId: 'workspace.packages:file:///workspace',
          impactedSiteCount: 2,
          requiresPreview: true,
          namingRules: {
            minLength: 1,
            patternDescription: 'npm package name (lowercase, optional @scope/name)',
          },
        },
        preview: {
          ok: true,
          target: {
            semanticClass: 'domain_entity',
            targetId: 'package:@acme/lib',
          },
          oldName: '@acme/lib',
          newName: '@acme/lib-next',
          normalizedNewName: '@acme/lib-next',
          namespaceId: 'workspace.packages:file:///workspace',
          totalEdits: 2,
          groups: [
            {
              group: 'declarations',
              edits: [
                {
                  uri: 'file:///workspace/packages/lib/package.json',
                  range: {
                    start: { line: 1, character: 11 },
                    end: { line: 1, character: 20 },
                  },
                  oldText: '@acme/lib',
                  newText: '@acme/lib-next',
                  kind: 'declaration',
                  semanticClass: 'domain_entity',
                  targetId: 'package:@acme/lib',
                },
              ],
            },
          ],
          warnings: [{ code: 'large_edit_set', message: 'Rename touches multiple files.' }],
          blockingIssues: [{ code: 'collision', message: 'Package name already exists.' }],
          canApply: false,
        },
      }),
    ).toEqual({
      targetLabel: '@acme/lib',
      prepareMessage: undefined,
      currentName: '@acme/lib',
      namespaceId: 'workspace.packages:file:///workspace',
      impactedSiteCount: 2,
      namingRules: ['Pattern: npm package name (lowercase, optional @scope/name)', 'Min length: 1'],
      previewMessage: 'Preview is blocked.',
      oldName: '@acme/lib',
      newName: '@acme/lib-next',
      groups: [
        {
          title: 'Declarations',
          edits: [
            {
              uri: 'file:///workspace/packages/lib/package.json',
              line: 1,
              character: 11,
              oldText: '@acme/lib',
              newText: '@acme/lib-next',
              kind: 'declaration',
            },
          ],
        },
      ],
      warnings: ['Rename touches multiple files.'],
      blockingIssues: ['Package name already exists.'],
      canApply: false,
      planId: undefined,
      applyMessage: undefined,
    });
  });
});
