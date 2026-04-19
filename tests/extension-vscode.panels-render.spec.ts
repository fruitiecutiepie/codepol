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
          controls: {
            filterChips: [],
            edgeKindChips: [],
            layoutOptions: [],
            blastRadiusUri: null,
            blastRadiusReachableCount: 0,
          },
          filters: {},
          layoutMode: 'layered',
        },
      },
    });

    expect(html).toContain('<title>Codepol: Dependency Graph</title>');
    expect(html).toContain('data-open-uri="file:///workspace/packages/lib/src/index.ts"');
    expect(html).toContain('aria-label="Codepol dependency graph"');
    expect(html).toContain('Hotspots');
    expect(html).toContain('graph-node focus');
  });

  it('renders enriched dependency-graph nodes and edges with tooltips, count line, edge kind, and cross-package styling', () => {
    const html = codepolPanelHtmlRender({
      nonce: 'nonce-enriched',
      model: {
        kind: 'dependencyGraph',
        title: 'Codepol: Dependency Graph',
        data: {
          summaryCard: null,
          graph: {
            mode: 'workspace',
            width: 480,
            height: 240,
            emptyMessage: 'No dependency graph data is available for this workspace.',
            edges: [
              {
                id: 'edge-enriched',
                fromUri: 'file:///workspace/apps/web/src/app.ts',
                toUri: 'file:///workspace/packages/lib/src/index.ts',
                x1: 120,
                y1: 60,
                x2: 260,
                y2: 60,
                isFocus: false,
                kind: 'dynamic',
                bindingCount: 2,
                crossesPackageBoundary: true,
                tooltip: 'dynamic · 2 bindings · cross-package',
              },
            ],
            nodes: [
              {
                uri: 'file:///workspace/apps/web/src/app.ts',
                label: 'app.ts',
                detail: 'apps/web/src/app.ts · 0 importers · 1 importee',
                x: 32,
                y: 24,
                width: 180,
                height: 72,
                isFocus: false,
                isEntryPoint: true,
                isCycleMember: false,
                packageName: '@acme/web',
                countsLine: '0 importers · 1 importee · 4 symbols · 32 LOC · cyc 5',
                tooltip:
                  '0 importers · 1 importee · 4 symbols · 32 LOC · cyc 5 · @acme/web',
              },
              {
                uri: 'file:///workspace/packages/lib/src/index.ts',
                label: 'index.ts',
                detail: 'packages/lib/src/index.ts · 3 importers · 1 importee',
                x: 260,
                y: 24,
                width: 180,
                height: 72,
                isFocus: false,
                isEntryPoint: false,
                isCycleMember: false,
                packageName: '@acme/lib',
                countsLine: '3 importers · 1 importee · 12 symbols · 84 LOC · cyc 7',
                tooltip:
                  '3 importers · 1 importee · 12 symbols · 84 LOC · cyc 7 · @acme/lib',
              },
            ],
          },
          controls: {
            filterChips: [],
            edgeKindChips: [],
            layoutOptions: [],
            blastRadiusUri: null,
            blastRadiusReachableCount: 0,
          },
          filters: {},
          layoutMode: 'layered',
        },
      },
    });

    expect(html).toContain(
      '<title>3 importers · 1 importee · 12 symbols · 84 LOC · cyc 7 · @acme/lib</title>',
    );
    expect(html).toContain('<title>dynamic · 2 bindings · cross-package</title>');
    expect(html).toContain('data-edge-kind="dynamic"');
    expect(html).toContain('data-binding-count="2"');
    expect(html).toContain('data-package="@acme/lib"');
    expect(html).toContain('data-package="@acme/web"');
    expect(html).toMatch(/class="graph-edge[^"]*\bkind-dynamic\b[^"]*\bcross-package\b/);
    expect(html).toContain('class="graph-counts"');
    expect(html).toContain('.graph-edge.kind-dynamic');
    expect(html).toContain('.graph-edge.cross-package');
    expect(html).toContain('.graph-edge.cross-layer');
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
          controls: {
            filterChips: [],
            edgeKindChips: [],
            layoutOptions: [],
            blastRadiusUri: null,
            blastRadiusReachableCount: 0,
          },
          filters: {},
          layoutMode: 'radial',
        },
      },
    });

    expect(html).toContain('<title>Codepol: Architecture Links</title>');
    expect(html).toContain('Focused Graph');
    expect(html).toContain('incoming');
    expect(html).toContain('import sharedValue from @acme/lib');
  });

  it('renders graph controls (filter chips, layout selector, blast-radius row) with active states', () => {
    const html = codepolPanelHtmlRender({
      nonce: 'nonce-controls',
      model: {
        kind: 'dependencyGraph',
        title: 'Codepol: Dependency Graph',
        data: {
          focusUri: 'file:///workspace/packages/lib/src/index.ts',
          summaryCard: null,
          graph: {
            mode: 'workspace',
            focusUri: 'file:///workspace/packages/lib/src/index.ts',
            width: 100,
            height: 100,
            emptyMessage: 'No dependency graph data is available for this workspace.',
            edges: [],
            nodes: [
              {
                uri: 'file:///workspace/packages/lib/src/index.ts',
                label: 'index.ts',
                detail: 'packages/lib/src/index.ts',
                x: 32,
                y: 24,
                width: 180,
                height: 72,
                isFocus: true,
                isEntryPoint: false,
                isCycleMember: false,
                isDimmed: true,
              },
            ],
          },
          controls: {
            filterChips: [
              {
                id: 'crossPackageOnly',
                label: 'Cross-package only',
                active: true,
                description: 'Show only edges that cross monorepo package boundaries.',
              },
              {
                id: 'hideTests',
                label: 'Hide tests',
                active: false,
                description: 'Hide files that look like test or spec sources.',
              },
            ],
            edgeKindChips: [
              {
                id: 'edgeKind:type_only',
                label: 'Type-only',
                active: true,
              },
            ],
            layoutOptions: [
              { id: 'layered', label: 'Layered', active: false },
              { id: 'radial', label: 'Radial', active: true },
              { id: 'force', label: 'Force (alpha)', active: false },
            ],
            blastRadiusUri: 'file:///workspace/packages/lib/src/index.ts',
            blastRadiusReachableCount: 1,
          },
          filters: {
            crossPackageOnly: true,
            edgeKinds: ['type_only'],
          },
          layoutMode: 'radial',
          blastRadiusUri: 'file:///workspace/packages/lib/src/index.ts',
        },
      },
    });

    expect(html).toContain('data-control-filter="crossPackageOnly"');
    expect(html).toContain('control-chip active');
    expect(html).toContain('data-control-edge-kind="edgeKind:type_only"');
    expect(html).toContain('data-control-layout="radial"');
    expect(html).toContain('data-control-blast-radius=""');
    expect(html).toContain('1 reachable');
    expect(html).toContain('graph-node focus');
    expect(html).toContain(' dimmed');
  });

  it('renders Phase 8 metrics sections (instability table, longest chain, SCC distribution, complexity hotspots) when present', () => {
    const html = codepolPanelHtmlRender({
      nonce: 'nonce-phase-8',
      model: {
        kind: 'architectureSummary',
        title: 'Codepol: Architecture Summary',
        data: {
          summaryCard: {
            summary: 'Indexed 4 files, 8 symbols, 1 entry points, 1 cycles.',
            metrics: [
              { label: 'Indexed Files', value: '4' },
              { label: 'Cycles', value: '1' },
              { label: 'Longest Chain', value: '3 hops' },
            ],
            hotspots: [
              {
                uri: 'file:///workspace/src/utils.ts',
                line: 0,
                character: 0,
                label: 'src/utils.ts',
                detail: '2 importers • 0 importees',
                importerCount: 2,
                importeeCount: 0,
              },
            ],
            complexityHotspots: [
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
            ],
            instabilityRows: [
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
            ],
            longestChainPath: [
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
            ],
            sccDistributionRows: [
              { size: 4, count: 1, label: '4-file SCC × 1 cycle' },
              { size: 2, count: 2, label: '2-file SCC × 2 cycles' },
            ],
          },
        },
      },
    });

    // Complexity hotspots section now exposes the score in the row detail.
    expect(html).toContain('Complexity Hotspots');
    expect(html).toContain('= score 28');
    // Full instability table renders as a clickable list with the
    // pre-formatted detail string.
    expect(html).toContain('Instability (top 2)');
    expect(html).toContain('I=1.00 • Ce=2 Ca=0');
    // Longest chain section header reports the hop count and lists each
    // step.
    expect(html).toContain('Longest Chain (3 hops)');
    expect(html).toContain('hop 1 of 4');
    expect(html).toContain('hop 4 of 4');
    // SCC distribution lists the largest cycle first and carries the
    // structured data attributes for downstream styling.
    expect(html).toContain('Cycle Size Distribution');
    expect(html).toContain('data-scc-size="4"');
    expect(html).toContain('4-file SCC × 1 cycle');
    expect(html).toContain('2-file SCC × 2 cycles');
  });

  it('omits Phase 8 sections when the summary view model does not provide them', () => {
    const html = codepolPanelHtmlRender({
      nonce: 'nonce-phase-8-empty',
      model: {
        kind: 'architectureSummary',
        title: 'Codepol: Architecture Summary',
        data: {
          summaryCard: {
            summary: 'Indexed 1 files, 0 symbols, 0 entry points, 0 cycles.',
            metrics: [{ label: 'Indexed Files', value: '1' }],
            hotspots: [],
          },
        },
      },
    });

    expect(html).not.toContain('Instability (top');
    expect(html).not.toContain('Longest Chain (');
    expect(html).not.toContain('Cycle Size Distribution');
    expect(html).not.toContain('Complexity Hotspots');
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
