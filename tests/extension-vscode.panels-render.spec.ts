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

  it('omits SVG <title> on bare nodes/edges and skips data-edge-kind when no enrichment is present', () => {
    const html = codepolPanelHtmlRender({
      nonce: 'nonce-bare',
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
                id: 'edge-bare',
                fromUri: 'file:///workspace/src/a.ts',
                toUri: 'file:///workspace/src/b.ts',
                x1: 120,
                y1: 60,
                x2: 260,
                y2: 60,
                isFocus: false,
              },
            ],
            nodes: [
              {
                uri: 'file:///workspace/src/a.ts',
                label: 'a.ts',
                detail: 'src/a.ts',
                x: 32,
                y: 24,
                width: 180,
                height: 72,
                isFocus: false,
                isEntryPoint: false,
                isCycleMember: false,
              },
              {
                uri: 'file:///workspace/src/b.ts',
                label: 'b.ts',
                detail: 'src/b.ts',
                x: 260,
                y: 24,
                width: 180,
                height: 72,
                isFocus: false,
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

    // Bare nodes/edges must not emit any SVG <title>, kind/binding data
    // attributes, package data attributes, or count tspans — the only
    // <title> in the document is the panel `<head><title>` itself.
    const titleMatches = html.match(/<title>/g) ?? [];
    expect(titleMatches).toHaveLength(1);
    expect(html).toContain('<title>Codepol: Dependency Graph</title>');
    expect(html).not.toContain('data-edge-kind=');
    expect(html).not.toContain('data-binding-count=');
    expect(html).not.toContain('data-package=');
    expect(html).not.toContain('class="graph-counts"');
    expect(html).not.toMatch(/class="graph-edge[^"]*\bkind-/);
    expect(html).not.toMatch(/class="graph-edge[^"]*\bcross-/);
  });

  it('emits the cross-layer class for edges whose crossesLayerBoundary flag is true', () => {
    const html = codepolPanelHtmlRender({
      nonce: 'nonce-cross-layer',
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
                id: 'edge-cross-layer',
                fromUri: 'file:///workspace/src/ui/button.ts',
                toUri: 'file:///workspace/src/domain/order.ts',
                x1: 120,
                y1: 60,
                x2: 260,
                y2: 60,
                isFocus: false,
                kind: 'static',
                bindingCount: 1,
                crossesPackageBoundary: true,
                crossesLayerBoundary: true,
                tooltip: 'static · 1 binding · cross-package · cross-layer',
              },
            ],
            nodes: [
              {
                uri: 'file:///workspace/src/ui/button.ts',
                label: 'button.ts',
                detail: 'src/ui/button.ts',
                x: 32,
                y: 24,
                width: 180,
                height: 72,
                isFocus: false,
                isEntryPoint: false,
                isCycleMember: false,
                layer: 'ui',
              },
              {
                uri: 'file:///workspace/src/domain/order.ts',
                label: 'order.ts',
                detail: 'src/domain/order.ts',
                x: 260,
                y: 24,
                width: 180,
                height: 72,
                isFocus: false,
                isEntryPoint: false,
                isCycleMember: false,
                layer: 'domain',
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

    expect(html).toMatch(
      /class="graph-edge[^"]*\bkind-static\b[^"]*\bcross-package\b[^"]*\bcross-layer\b/,
    );
    expect(html).toContain(
      '<title>static · 1 binding · cross-package · cross-layer</title>',
    );
    expect(html).toContain('data-layer="ui"');
    expect(html).toContain('data-layer="domain"');
  });

  it('renders enriched nodes and edges through the architecture-links panel via the shared graph SVG', () => {
    const html = codepolPanelHtmlRender({
      nonce: 'nonce-links-enriched',
      model: {
        kind: 'architectureLinks',
        title: 'Codepol: Architecture Links',
        uri: 'file:///workspace/packages/lib/src/index.ts',
        data: {
          uri: 'file:///workspace/packages/lib/src/index.ts',
          hoverCard: null,
          workspaceSummaryCard: null,
          graph: {
            mode: 'focus',
            focusUri: 'file:///workspace/packages/lib/src/index.ts',
            width: 480,
            height: 240,
            emptyMessage: 'No dependency graph context is available for this target.',
            edges: [
              {
                id: 'edge-links-enriched',
                fromUri: 'file:///workspace/apps/web/src/app.ts',
                toUri: 'file:///workspace/packages/lib/src/index.ts',
                x1: 120,
                y1: 60,
                x2: 260,
                y2: 60,
                isFocus: true,
                kind: 'cjs',
                bindingCount: 1,
                crossesPackageBoundary: true,
                tooltip: 'cjs · 1 binding · cross-package',
              },
            ],
            nodes: [
              {
                uri: 'file:///workspace/packages/lib/src/index.ts',
                label: 'index.ts',
                detail: 'packages/lib/src/index.ts · 1 importer · 0 importees',
                x: 260,
                y: 24,
                width: 180,
                height: 72,
                isFocus: true,
                isEntryPoint: false,
                isCycleMember: false,
                packageName: '@acme/lib',
                countsLine: '1 importer · 0 importees · 12 symbols · 84 LOC',
                tooltip: '1 importer · 0 importees · 12 symbols · 84 LOC · @acme/lib',
              },
            ],
          },
          totalItems: 0,
          totalAvailableItems: 0,
          truncated: false,
          groups: [],
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

    // The architecture-links panel reuses the same graphSvgHtml renderer
    // as the dependency-graph panel, so all enrichment must surface here
    // too.
    expect(html).toContain(
      '<title>1 importer · 0 importees · 12 symbols · 84 LOC · @acme/lib</title>',
    );
    expect(html).toContain('<title>cjs · 1 binding · cross-package</title>');
    expect(html).toContain('data-edge-kind="cjs"');
    expect(html).toContain('data-package="@acme/lib"');
    expect(html).toMatch(/class="graph-edge[^"]*\bkind-cjs\b[^"]*\bcross-package\b/);
    expect(html).toContain('class="graph-counts"');
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

  it('renders the dependency-path panel with chips, headline, and clickable nodes', () => {
    const fromUri = 'file:///workspace/src/app.ts';
    const middleUri = 'file:///workspace/src/middle.ts';
    const toUri = 'file:///workspace/src/leaf.ts';

    const html = codepolPanelHtmlRender({
      nonce: 'nonce-dep-path',
      model: {
        kind: 'dependencyPath',
        title: 'Codepol: Dependency Path (src/app.ts → src/leaf.ts)',
        data: {
          fromUri,
          toUri,
          fromWorkspaceRelativePath: 'src/app.ts',
          toWorkspaceRelativePath: 'src/leaf.ts',
          headline: 'Shortest path: 2 hops',
          summary: '1 path shown',
          maxPaths: 5,
          truncated: false,
          shortestLength: 2,
          paths: [
            {
              hops: 2,
              nodes: [
                { uri: fromUri, workspaceRelativePath: 'src/app.ts' },
                { uri: middleUri, workspaceRelativePath: 'src/middle.ts' },
                { uri: toUri, workspaceRelativePath: 'src/leaf.ts' },
              ],
            },
          ],
          chips: [
            { id: '5', label: '5', active: true },
            { id: '10', label: '10', active: false },
            { id: '20', label: '20', active: false },
          ],
        },
      },
    });

    expect(html).toContain(
      '<title>Codepol: Dependency Path (src/app.ts → src/leaf.ts)</title>',
    );
    expect(html).toContain('class="dp-summary">Shortest path: 2 hops · 1 path shown');
    expect(html).toContain('data-dp-chip-value="5"');
    expect(html).toContain('data-dp-chip-value="10"');
    expect(html).toContain('data-dp-chip-value="20"');
    expect(html).toContain('class="dp-chip dp-chip-active"');
    expect(html).toContain(`data-open-uri="${fromUri}"`);
    expect(html).toContain(`data-open-uri="${middleUri}"`);
    expect(html).toContain(`data-open-uri="${toUri}"`);
  });

  it('renders the dead-modules panel with one details per group and the root group as "/"', () => {
    const html = codepolPanelHtmlRender({
      nonce: 'nonce-dead-modules',
      model: {
        kind: 'deadModules',
        title: 'Codepol: Dead Modules',
        data: {
          headline: '3 unreachable files in 2 directories',
          summary: 'Entry points: natural',
          entryPointUris: [],
          entryPointLabels: [],
          totalUnreachable: 3,
          groups: [
            {
              directoryWorkspaceRelativePath: '',
              files: [
                {
                  uri: 'file:///workspace/orphan.ts',
                  workspaceRelativePath: 'orphan.ts',
                  basename: 'orphan.ts',
                },
              ],
            },
            {
              directoryWorkspaceRelativePath: 'src/foo',
              files: [
                {
                  uri: 'file:///workspace/src/foo/a.ts',
                  workspaceRelativePath: 'src/foo/a.ts',
                  basename: 'a.ts',
                },
                {
                  uri: 'file:///workspace/src/foo/b.ts',
                  workspaceRelativePath: 'src/foo/b.ts',
                  basename: 'b.ts',
                },
              ],
            },
          ],
        },
      },
    });

    expect(html).toContain('<title>Codepol: Dead Modules</title>');
    expect(html).toContain('3 unreachable files in 2 directories');
    expect(html).toContain('class="dm-summary">Entry points: natural');
    expect(html).toContain('data-dm-control="configure"');
    expect(html).toContain('data-dm-control="natural"');
    // Root-files group renders the literal "/" label
    expect(html).toContain('class="dm-group-label">/');
    // Each file row carries data-open-uri (existing handler) + dm-file-rel
    expect(html).toContain('data-open-uri="file:///workspace/orphan.ts"');
    expect(html).toContain('data-open-uri="file:///workspace/src/foo/a.ts"');
    expect(html).toContain('class="dm-file-rel">src/foo/b.ts');
    // Two <details> wrappers, one per group
    const detailsCount = html.split('<details').length - 1;
    expect(detailsCount).toBe(2);
  });

  it('renders the dependency-diff panel with baseline controls and clickable rows', () => {
    const html = codepolPanelHtmlRender({
      nonce: 'nonce-dependency-diff',
      model: {
        kind: 'dependencyDiff',
        title: 'Codepol: Dependency Diff',
        data: {
          baselineLabel: 'base',
          headline: 'Diff against baseline "base"',
          summary: '1 added node · 1 removed edge · 1 new cycle',
          currentAnalysisGeneration: 7,
          baselineAnalysisGeneration: 3,
          isEmpty: false,
          sections: {
            addedNodes: {
              title: 'Added Nodes',
              count: 1,
              rows: [
                {
                  uri: 'file:///workspace/src/new.ts',
                  label: 'src/new.ts',
                },
              ],
            },
            removedNodes: {
              title: 'Removed Nodes',
              count: 0,
              rows: [],
            },
            addedEdges: {
              title: 'Added Edges',
              count: 0,
              rows: [],
            },
            removedEdges: {
              title: 'Removed Edges',
              count: 1,
              rows: [
                {
                  uri: 'file:///workspace/src/a.ts',
                  label: 'src/a.ts → src/b.ts',
                  detail:
                    'file:///workspace/src/a.ts → file:///workspace/src/b.ts',
                },
              ],
            },
            newCycles: {
              title: 'New Cycles',
              count: 1,
              rows: [
                {
                  uri: 'file:///workspace/src/a.ts',
                  label: 'src/a.ts',
                  detail: 'src/a.ts → src/b.ts → src/c.ts',
                },
              ],
            },
            removedCycles: {
              title: 'Removed Cycles',
              count: 0,
              rows: [],
            },
          },
        },
      },
    });

    expect(html).toContain('<title>Codepol: Dependency Diff</title>');
    expect(html).toContain('Diff against baseline &quot;base&quot;');
    expect(html).toContain('data-dd-control="choose-baseline"');
    expect(html).toContain('data-dd-control="configured-baseline"');
    expect(html).toContain('Current generation: 7 · Baseline generation: 3');
    expect(html).toContain('data-open-uri="file:///workspace/src/new.ts"');
    expect(html).toContain('data-open-uri="file:///workspace/src/a.ts"');
    expect(html).toContain('1 added node · 1 removed edge · 1 new cycle');
  });
});
