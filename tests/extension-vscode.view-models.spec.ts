import { describe, expect, it } from 'vitest';
import {
  renamePreviewPanelViewModelCreate,
  semanticDefinitionPanelViewModelCreate,
  semanticHoverCardViewModelCreate,
  semanticReferencesPanelViewModelCreate,
} from '../extension-vscode/src/viewModels';

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

  it('maps semantic references and rename preview payloads into grouped UI models', () => {
    expect(
      semanticReferencesPanelViewModelCreate({
        uri: 'file:///workspace/packages/lib/src/index.ts',
        references: {
          target: {
            uri: 'file:///workspace/packages/lib/src/index.ts',
            semanticClass: 'architecture_node',
          },
          presentation: 'grouped_list',
          totalItems: 2,
          totalAvailableItems: 2,
          truncated: false,
          groups: [
            {
              group: 'declarations',
              totalCount: 1,
              truncated: false,
              items: [
                {
                  location: {
                    uri: 'file:///workspace/packages/lib/src/index.ts',
                    range: {
                      start: { line: 0, character: 0 },
                      end: { line: 0, character: 0 },
                    },
                  },
                  label: 'packages/lib/src/index.ts',
                  detail: 'module declaration',
                  relationKind: 'declarations',
                  semanticClass: 'architecture_node',
                },
              ],
            },
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
          ],
          source: 'codepol',
          semanticClass: 'architecture_node',
        },
        hover: null,
      }),
    ).toEqual({
      uri: 'file:///workspace/packages/lib/src/index.ts',
      hoverCard: null,
      totalItems: 2,
      totalAvailableItems: 2,
      truncated: false,
      groups: [
        {
          group: 'declarations',
          totalCount: 1,
          truncated: false,
          items: [
            {
              uri: 'file:///workspace/packages/lib/src/index.ts',
              line: 0,
              character: 0,
              label: 'packages/lib/src/index.ts',
              detail: 'module declaration',
            },
          ],
        },
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
      ],
    });

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
      namingRules: [
        'Pattern: npm package name (lowercase, optional @scope/name)',
        'Min length: 1',
      ],
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
