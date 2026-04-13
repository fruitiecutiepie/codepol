import { describe, expect, it } from 'vitest';
import {
  CODEPOL_EXTENSION_COMMAND_SHOW_ARCHITECTURE_LINKS,
  CODEPOL_EXTENSION_COMMAND_SHOW_DEPENDENCY_GRAPH,
} from '../extension-vscode/src/constants';
import { codepolHoverActionCommandResolve } from '../extension-vscode/src/panels/messages';
import { codepolPanelHtmlRender } from '../extension-vscode/src/panels/render';

describe('extension-vscode panel rendering', () => {
  it('renders dependency graph nodes and hotspots as clickable panel content', () => {
    const html = codepolPanelHtmlRender({
      nonce: 'nonce-1',
      model: {
        kind: 'dependencyGraph',
        title: 'Codepol: Dependency Graph',
        data: {
          focusUri: 'file:///workspace/packages/lib/src/index.ts',
          summaryCard: {
            summary: 'Indexed 2 files, 4 symbols, 1 entry points, 0 cycles.',
            metrics: [
              { label: 'Indexed Files', value: '2' },
              { label: 'Symbols', value: '4' },
            ],
            hotspots: [
              {
                uri: 'file:///workspace/packages/lib/src/index.ts',
                line: 0,
                character: 0,
                label: 'packages/lib/src/index.ts',
                detail: '1 importer • 0 importees',
                importerCount: 1,
                importeeCount: 0,
              },
            ],
          },
          graph: {
            mode: 'workspace',
            focusUri: 'file:///workspace/packages/lib/src/index.ts',
            width: 480,
            height: 240,
            emptyMessage: 'No dependency graph data is available for this workspace.',
            edges: [
              {
                id: 'edge-1',
                fromUri: 'file:///workspace/apps/web/src/app.ts',
                toUri: 'file:///workspace/packages/lib/src/index.ts',
                x1: 120,
                y1: 60,
                x2: 260,
                y2: 60,
                isFocus: true,
              },
            ],
            nodes: [
              {
                uri: 'file:///workspace/apps/web/src/app.ts',
                label: 'app.ts',
                detail: 'apps/web/src/app.ts',
                x: 32,
                y: 24,
                width: 180,
                height: 72,
                isFocus: false,
                isEntryPoint: true,
                isCycleMember: false,
              },
              {
                uri: 'file:///workspace/packages/lib/src/index.ts',
                label: 'index.ts',
                detail: 'packages/lib/src/index.ts',
                x: 260,
                y: 24,
                width: 180,
                height: 72,
                isFocus: true,
                isEntryPoint: false,
                isCycleMember: false,
              },
            ],
          },
        },
      },
    });

    expect(html).toContain('<title>Codepol: Dependency Graph</title>');
    expect(html).toContain('data-open-uri="file:///workspace/packages/lib/src/index.ts"');
    expect(html).toContain('aria-label="Codepol dependency graph"');
    expect(html).toContain('Hotspots');
    expect(html).toContain('graph-node focus');
  });

  it('renders architecture links as a focused graph with grouped evidence', () => {
    const html = codepolPanelHtmlRender({
      nonce: 'nonce-2',
      model: {
        kind: 'architectureLinks',
        title: 'Codepol: Architecture Links',
        uri: 'file:///workspace/packages/lib/src/index.ts',
        data: {
          uri: 'file:///workspace/packages/lib/src/index.ts',
          hoverCard: null,
          workspaceSummaryCard: {
            summary: 'Indexed 2 files, 4 symbols, 1 entry points, 0 cycles.',
            metrics: [
              { label: 'Indexed Files', value: '2' },
              { label: 'Symbols', value: '4' },
              { label: 'Relations', value: '1' },
            ],
            hotspots: [],
          },
          graph: {
            mode: 'focus',
            focusUri: 'file:///workspace/packages/lib/src/index.ts',
            width: 480,
            height: 240,
            emptyMessage: 'No dependency graph context is available for this target.',
            edges: [],
            nodes: [
              {
                uri: 'file:///workspace/packages/lib/src/index.ts',
                label: 'index.ts',
                detail: 'packages/lib/src/index.ts',
                x: 260,
                y: 24,
                width: 180,
                height: 72,
                isFocus: true,
                isEntryPoint: false,
                isCycleMember: false,
              },
            ],
          },
          totalItems: 1,
          totalAvailableItems: 1,
          truncated: false,
          groups: [
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
        },
      },
    });

    expect(html).toContain('<title>Codepol: Architecture Links</title>');
    expect(html).toContain('Focused Graph');
    expect(html).toContain('incoming');
    expect(html).toContain('import sharedValue from @acme/lib');
  });

  it('routes hover actions to the correct Codepol commands', () => {
    expect(codepolHoverActionCommandResolve('find_references')).toBe(
      CODEPOL_EXTENSION_COMMAND_SHOW_ARCHITECTURE_LINKS,
    );
    expect(codepolHoverActionCommandResolve('show_graph')).toBe(
      CODEPOL_EXTENSION_COMMAND_SHOW_DEPENDENCY_GRAPH,
    );
  });
});
