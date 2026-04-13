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
