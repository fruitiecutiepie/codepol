import { describe, expect, it, vi } from 'vitest';
import type {
  IndexStatusResult,
  WorkspaceLintRuleDetailsResult,
  WorkspaceSearchResult,
} from '@codepol/core';
import { CodepolCommandController } from '../extension-vscode/src/commands';
import type { CodepolProtocolQuickFixAction } from '../extension-vscode/src/protocolClient';
import type { RenameTargetCandidate } from '../extension-vscode/src/discovery';

function readinessStatusCreate(
  overrides: Partial<IndexStatusResult> = {},
): IndexStatusResult {
  return {
    workspaceId: 'workspace-1',
    workspaceInstanceId: 'instance-1',
    status: 'ready',
    replayState: 'applied',
    workspaceReady: true,
    indexedFileCount: 12,
    openDocumentCount: 1,
    overlayCount: 1,
    analysisGeneration: 3,
    ...overrides,
  };
}

function hostCreate(overrides: Partial<{
  activeUriGet: () => string | undefined;
  readinessSnapshotGet: () => { status: IndexStatusResult | null; errorMessage?: string };
  semanticSearchInitialQueryResolve: () => string | undefined;
  semanticSearchPick: (input: {
    initialQuery: string;
    queryResults(query: string): Promise<WorkspaceSearchResult[] | null>;
  }) => Promise<WorkspaceSearchResult | null | undefined>;
  renameTargetsLoad: () => Promise<RenameTargetCandidate[]>;
  renameTargetPick: (
    candidates: RenameTargetCandidate[],
  ) => Promise<RenameTargetCandidate | undefined>;
  renamePrompt: (input: {
    title: string;
    value: string;
    namingRules: string[];
  }) => Promise<string | undefined>;
  quickPick: <T>(input: {
    title: string;
    placeholder?: string;
    items: Array<{
      label: string;
      description?: string;
      detail?: string;
      value: T;
    }>;
  }) => Promise<T | undefined>;
}> = {}) {
  return {
    activeUriGet: overrides.activeUriGet ?? (() => 'file:///workspace/packages/lib/src/index.ts'),
    readinessSnapshotGet:
      overrides.readinessSnapshotGet ??
      (() => ({
        status: readinessStatusCreate(),
      })),
    semanticSearchInitialQueryResolve:
      overrides.semanticSearchInitialQueryResolve ?? (() => undefined),
    semanticSearchPick:
      overrides.semanticSearchPick ??
      (async () => undefined),
    renameTargetsLoad: overrides.renameTargetsLoad ?? (async () => []),
    renameTargetPick:
      overrides.renameTargetPick ??
      (async (candidates: RenameTargetCandidate[]) => candidates[0]),
    renamePrompt:
      overrides.renamePrompt ??
      (async () => undefined),
    quickPick:
      overrides.quickPick ??
      (async <T>(input: {
        items: Array<{
          value: T;
        }>;
      }) => input.items[0]?.value),
    infoShow: vi.fn(async () => {}),
    errorShow: vi.fn(async () => {}),
    openLocation: vi.fn(async () => {}),
  };
}

function protocolCreate() {
  return {
    queryIndexStatus: vi.fn(),
    queryLintRuleDetails: vi.fn(),
    queryCodeActions: vi.fn(),
    queryArchitectureSummary: vi.fn(),
    queryDependencyGraph: vi.fn(),
    queryImpactRadius: vi.fn(),
    queryDependencyPath: vi.fn(),
    queryDeadModules: vi.fn(),
    querySemanticSearch: vi.fn(),
    querySemanticDefinition: vi.fn(),
    querySemanticReferences: vi.fn(),
    querySemanticHover: vi.fn(),
    prepareRename: vi.fn(),
    previewRename: vi.fn(),
    applyEditPlan: vi.fn(),
  };
}

function requestSupersededErrorCreate(): Error & {
  code: string;
  data: {
    kind: 'request_superseded';
    requestType: string;
    requestKey: string;
    requestId: string;
    replacedByRequestId: string;
  };
} {
  const error = new Error('Request superseded') as Error & {
    code: string;
    data: {
      kind: 'request_superseded';
      requestType: string;
      requestKey: string;
      requestId: string;
      replacedByRequestId: string;
    };
  };
  error.code = 'request_superseded';
  error.data = {
    kind: 'request_superseded',
    requestType: 'query_semantic_search',
    requestKey: 'query_semantic_search:client-1:workspace-1',
    requestId: 'semantic-search-request-1',
    replacedByRequestId: 'semantic-search-request-2',
  };
  return error;
}

function panelsCreate() {
  return {
    showArchitectureSummary: vi.fn(),
    showDependencyGraph: vi.fn(),
    showSemanticDefinition: vi.fn(),
    showArchitectureLinks: vi.fn(),
    showLintRuleDetails: vi.fn(),
    showRenamePreview: vi.fn(),
  };
}

const renameTargetCandidate: RenameTargetCandidate = {
  kind: 'workspace_package',
  label: '@acme/lib',
  description: 'packages/lib',
  detail: 'Workspace package',
  target: {
    semanticClass: 'domain_entity',
    targetId: 'package:@acme/lib',
  },
};

const configRenameTargetCandidate: RenameTargetCandidate = {
  kind: 'config_target',
  label: 'web',
  description: 'codepol.toml',
  detail: 'Codepol config target',
  target: {
    semanticClass: 'config_component',
    targetId: 'target:web',
  },
};

const semanticSearchResult: WorkspaceSearchResult = {
  name: 'sharedValue',
  kind: 'exported_symbol',
  location: {
    uri: 'file:///workspace/packages/lib/src/index.ts',
    range: {
      start: { line: 0, character: 13 },
      end: { line: 0, character: 24 },
    },
  },
  detail: 'packages/lib/src/index.ts • const',
  source: 'codepol',
  semanticClass: 'exported_symbol',
  score: 180,
};

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
  ],
  edges: [
    {
      fromUri: 'file:///workspace/apps/web/src/app.ts',
      toUri: 'file:///workspace/packages/lib/src/index.ts',
    },
  ],
  entryPoints: ['file:///workspace/apps/web/src/app.ts'],
  cycles: [] as string[][],
};

const architectureSummaryResult = {
  summary: 'Indexed 2 files, 4 symbols, 1 entry points, 0 cycles.',
  indexedFileCount: 2,
  symbolCount: 4,
  scopeCount: 2,
  relationCount: 1,
  entryPointCount: 1,
  cycleCount: 0,
  hotspots: [
    {
      uri: 'file:///workspace/packages/lib/src/index.ts',
      workspaceRelativePath: 'packages/lib/src/index.ts',
      importerCount: 1,
      importeeCount: 0,
    },
    {
      uri: 'file:///workspace/apps/web/src/app.ts',
      workspaceRelativePath: 'apps/web/src/app.ts',
      importerCount: 0,
      importeeCount: 1,
    },
  ],
};

const lintRuleDetailsResult: WorkspaceLintRuleDetailsResult = {
  rule: {
    ruleId: '@codepol/plugin/no-interface',
    severities: ['error'],
    targetPatterns: ['src/**/*.ts'],
    providers: [
      {
        platform: 'tree-sitter',
        languages: ['typescript'],
      },
    ],
    languages: ['typescript'],
    ownership: 'native_preferred',
    hasNativeOwner: true,
    recentNativeDiagnosticCount: 1,
    recentWrappedDiagnosticCount: 0,
    recentNativeLatencyMs: 5,
    recentWrappedLatencyMs: 0,
    fixSurfaceNotes: ['tree_check'],
    analysisState: 'ready',
    analyzerIssues: [],
  },
  totalDiagnosticCount: 1,
  groups: [
    {
      uri: 'file:///workspace/packages/lib/src/index.ts',
      workspaceRelativePath: 'packages/lib/src/index.ts',
      diagnostics: [
        {
          severity: 'error',
          message: 'Interfaces are not allowed.',
          range: {
            start: { line: 0, character: 7 },
            end: { line: 0, character: 16 },
          },
        },
      ],
    },
  ],
};

const quickFixAction: CodepolProtocolQuickFixAction = {
  title: 'Remove interface declaration',
  kind: 'quickfix',
  isPreferred: true,
  planId: 'plan-1',
};

const alternateQuickFixAction: CodepolProtocolQuickFixAction = {
  title: 'Convert interface to type alias',
  kind: 'quickfix',
  planId: 'plan-2',
};

describe('CodepolCommandController', () => {
  it('blocks semantic search while the workspace index is warming', async () => {
    const protocol = protocolCreate();
    const panels = panelsCreate();
    const host = hostCreate({
      readinessSnapshotGet: () => ({
        status: readinessStatusCreate({
          status: 'warming',
          replayState: 'pending',
          workspaceReady: false,
        }),
      }),
    });
    const controller = new CodepolCommandController(protocol as never, panels, host);

    await expect(controller.showSemanticSearch({ query: 'sharedValue' })).resolves.toBeNull();
    expect(host.errorShow).toHaveBeenCalledWith(
      'Codepol semantic search is blocked while Codepol restores workspace state.',
    );
    expect(protocol.querySemanticSearch).not.toHaveBeenCalled();
  });

  it('reports unavailable semantic search results clearly', async () => {
    const protocol = protocolCreate();
    protocol.querySemanticSearch.mockResolvedValue(null);
    const panels = panelsCreate();
    const host = hostCreate({
      semanticSearchInitialQueryResolve: () => 'sharedValue',
    });
    const controller = new CodepolCommandController(protocol as never, panels, host);

    await expect(
      controller.showSemanticSearch({ autoOpenFirstResult: true }),
    ).resolves.toBeNull();
    expect(protocol.querySemanticSearch).toHaveBeenCalledWith('sharedValue');
    expect(host.errorShow).toHaveBeenCalledWith(
      'Codepol semantic search is not available for this workspace yet.',
    );
    expect(host.openLocation).not.toHaveBeenCalled();
  });

  it('silently drops superseded semantic search requests', async () => {
    const protocol = protocolCreate();
    protocol.querySemanticSearch.mockRejectedValue(requestSupersededErrorCreate());
    const panels = panelsCreate();
    const host = hostCreate({
      semanticSearchInitialQueryResolve: () => 'sharedValue',
    });
    const controller = new CodepolCommandController(protocol as never, panels, host);

    await expect(
      controller.showSemanticSearch({ autoOpenFirstResult: true }),
    ).resolves.toBeNull();
    expect(host.errorShow).not.toHaveBeenCalled();
    expect(host.infoShow).not.toHaveBeenCalled();
    expect(host.openLocation).not.toHaveBeenCalled();
  });

  it('opens the first semantic search result for non-interactive execution', async () => {
    const protocol = protocolCreate();
    protocol.querySemanticSearch.mockResolvedValue([semanticSearchResult]);
    const panels = panelsCreate();
    const host = hostCreate();
    const controller = new CodepolCommandController(protocol as never, panels, host);

    const result = await controller.showSemanticSearch({
      query: 'sharedValue',
      autoOpenFirstResult: true,
    });

    expect(protocol.querySemanticSearch).toHaveBeenCalledWith('sharedValue');
    expect(host.openLocation).toHaveBeenCalledWith({
      uri: 'file:///workspace/packages/lib/src/index.ts',
      line: 0,
      character: 13,
    });
    expect(result).toEqual(semanticSearchResult);
  });

  it('does not open a location when semantic search is cancelled', async () => {
    const protocol = protocolCreate();
    const panels = panelsCreate();
    const host = hostCreate({
      semanticSearchInitialQueryResolve: () => 'sharedValue',
      semanticSearchPick: async () => undefined,
    });
    const controller = new CodepolCommandController(protocol as never, panels, host);

    await expect(controller.showSemanticSearch()).resolves.toBeNull();
    expect(host.openLocation).not.toHaveBeenCalled();
  });

  it('reports a missing active file for semantic definition requests', async () => {
    const protocol = protocolCreate();
    const panels = panelsCreate();
    const host = hostCreate({ activeUriGet: () => undefined });
    const controller = new CodepolCommandController(protocol as never, panels, host);

    await expect(controller.showSemanticDefinition()).resolves.toBeNull();
    expect(host.errorShow).toHaveBeenCalledWith(
      'Open a workspace file before requesting a semantic definition.',
    );
    expect(protocol.querySemanticDefinition).not.toHaveBeenCalled();
  });

  it('keeps semantic definition rendering when only hover is superseded', async () => {
    const protocol = protocolCreate();
    protocol.querySemanticDefinition.mockResolvedValue({
      kind: 'single_location',
      target: {
        uri: 'file:///workspace/packages/lib/src/index.ts',
        semanticClass: 'exported_symbol',
      },
      location: {
        uri: 'file:///workspace/packages/lib/src/index.ts',
        range: {
          start: { line: 0, character: 13 },
          end: { line: 0, character: 24 },
        },
      },
      source: 'codepol',
      semanticClass: 'exported_symbol',
    });
    protocol.querySemanticHover.mockRejectedValue(requestSupersededErrorCreate());
    const panels = panelsCreate();
    const host = hostCreate();
    const controller = new CodepolCommandController(protocol as never, panels, host);

    const result = await controller.showSemanticDefinition();

    expect(result).not.toBeNull();
    expect(host.errorShow).not.toHaveBeenCalled();
    expect(host.openLocation).toHaveBeenCalledWith({
      uri: 'file:///workspace/packages/lib/src/index.ts',
      line: 0,
      character: 13,
    });
    expect(panels.showSemanticDefinition).toHaveBeenCalledWith(result);
  });

  it('opens semantic definition results and renders the structured panel', async () => {
    const protocol = protocolCreate();
    protocol.querySemanticDefinition.mockResolvedValue({
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
    });
    protocol.querySemanticHover.mockResolvedValue({
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
    });
    const panels = panelsCreate();
    const host = hostCreate();
    const controller = new CodepolCommandController(protocol as never, panels, host);

    const result = await controller.showSemanticDefinition();

    expect(protocol.querySemanticDefinition).toHaveBeenCalledWith(
      'file:///workspace/packages/lib/src/index.ts',
    );
    expect(protocol.querySemanticHover).toHaveBeenCalledWith(
      'file:///workspace/packages/lib/src/index.ts',
    );
    expect(host.openLocation).toHaveBeenCalledWith({
      uri: 'file:///workspace/packages/lib/src/index.ts',
      line: 0,
      character: 0,
    });
    expect(panels.showSemanticDefinition).toHaveBeenCalledWith(result);
  });

  it('keeps lint rule detail rendering available through the explicit panel command', async () => {
    const protocol = protocolCreate();
    protocol.queryLintRuleDetails.mockResolvedValue(lintRuleDetailsResult);
    const panels = panelsCreate();
    const host = hostCreate();
    const controller = new CodepolCommandController(protocol as never, panels, host);

    const result = await controller.showLintRuleDetails(
      '@codepol/plugin/no-interface',
    );

    expect(protocol.queryLintRuleDetails).toHaveBeenCalledWith(
      '@codepol/plugin/no-interface',
    );
    expect(host.errorShow).not.toHaveBeenCalled();
    expect(result).toEqual(lintRuleDetailsResult);
    expect(panels.showLintRuleDetails).toHaveBeenCalledWith(
      expect.objectContaining({
        ruleId: '@codepol/plugin/no-interface',
        totalDiagnosticCount: 1,
      }),
    );
  });

  it('applies a single lint-rule diagnostic quick fix without prompting', async () => {
    const protocol = protocolCreate();
    protocol.queryCodeActions.mockResolvedValue([quickFixAction]);
    const panels = panelsCreate();
    const host = hostCreate();
    const controller = new CodepolCommandController(protocol as never, panels, host);

    const result = await controller.showLintRuleDiagnosticFixes({
      ruleId: '@codepol/plugin/no-interface',
      uri: 'file:///workspace/packages/lib/src/index.ts',
      message: 'Interfaces are not allowed.',
      range: {
        start: { line: 0, character: 7 },
        end: { line: 0, character: 16 },
      },
    });

    expect(protocol.queryCodeActions).toHaveBeenCalledWith({
      uri: 'file:///workspace/packages/lib/src/index.ts',
      range: {
        start: { line: 0, character: 7 },
        end: { line: 0, character: 16 },
      },
    });
    expect(protocol.applyEditPlan).toHaveBeenCalledWith('plan-1');
    expect(result).toEqual(quickFixAction);
  });

  it('prompts when multiple lint-rule diagnostic quick fixes are available', async () => {
    const protocol = protocolCreate();
    protocol.queryCodeActions.mockResolvedValue([
      alternateQuickFixAction,
      quickFixAction,
    ]);
    const panels = panelsCreate();
    const quickPick = vi.fn(async <T>(input: {
      items: Array<{
        label: string;
        value: T;
      }>;
    }) => {
      expect(input.items.map((item) => item.label)).toEqual([
        'Remove interface declaration',
        'Convert interface to type alias',
      ]);
      return input.items[1]?.value;
    });
    const host = hostCreate({
      quickPick,
    });
    const controller = new CodepolCommandController(protocol as never, panels, host);

    const result = await controller.showLintRuleDiagnosticFixes({
      ruleId: '@codepol/plugin/no-interface',
      uri: 'file:///workspace/packages/lib/src/index.ts',
      message: 'Interfaces are not allowed.',
      range: {
        start: { line: 0, character: 7 },
        end: { line: 0, character: 16 },
      },
    });

    expect(quickPick).toHaveBeenCalledWith({
      title: 'Quick Fix: @codepol/plugin/no-interface',
      placeholder: 'Select a Codepol quick fix to apply',
      items: [
        {
          label: 'Remove interface declaration',
          description: 'Preferred quick fix',
          detail: 'Interfaces are not allowed.',
          value: quickFixAction,
        },
        {
          label: 'Convert interface to type alias',
          description: 'Quick fix',
          detail: 'Interfaces are not allowed.',
          value: alternateQuickFixAction,
        },
      ],
    });
    expect(protocol.applyEditPlan).toHaveBeenCalledWith('plan-2');
    expect(result).toEqual(alternateQuickFixAction);
  });

  it('reports when a lint-rule diagnostic has no quick fixes', async () => {
    const protocol = protocolCreate();
    protocol.queryCodeActions.mockResolvedValue([]);
    const panels = panelsCreate();
    const host = hostCreate();
    const controller = new CodepolCommandController(protocol as never, panels, host);

    await expect(
      controller.showLintRuleDiagnosticFixes({
        ruleId: '@codepol/plugin/no-interface',
        uri: 'file:///workspace/packages/lib/src/index.ts',
        message: 'Interfaces are not allowed.',
        range: {
          start: { line: 0, character: 7 },
          end: { line: 0, character: 16 },
        },
      }),
    ).resolves.toBeNull();

    expect(protocol.applyEditPlan).not.toHaveBeenCalled();
    expect(host.infoShow).toHaveBeenCalledWith(
      'No Codepol quick fixes are available for @codepol/plugin/no-interface at this diagnostic.',
    );
  });

  it('shows the workspace architecture summary without requiring an active file', async () => {
    const protocol = protocolCreate();
    protocol.queryArchitectureSummary.mockResolvedValue(architectureSummaryResult);
    const panels = panelsCreate();
    const host = hostCreate({ activeUriGet: () => undefined });
    const controller = new CodepolCommandController(protocol as never, panels, host);

    const result = await controller.showArchitectureSummary();

    expect(protocol.queryArchitectureSummary).toHaveBeenCalledTimes(1);
    expect(host.errorShow).not.toHaveBeenCalled();
    expect(result).toEqual({
      summaryCard: expect.objectContaining({
        summary: architectureSummaryResult.summary,
      }),
    });
    expect(panels.showArchitectureSummary).toHaveBeenCalledWith(result);
  });

  it('reports unavailable workspace architecture summaries clearly', async () => {
    const protocol = protocolCreate();
    protocol.queryArchitectureSummary.mockResolvedValue(null);
    const panels = panelsCreate();
    const host = hostCreate();
    const controller = new CodepolCommandController(protocol as never, panels, host);

    await expect(controller.showArchitectureSummary()).resolves.toBeNull();
    expect(host.errorShow).toHaveBeenCalledWith(
      'Codepol architecture summary is not available for this workspace yet.',
    );
    expect(panels.showArchitectureSummary).not.toHaveBeenCalled();
  });

  it('shows the dependency graph without requiring an active file', async () => {
    const protocol = protocolCreate();
    protocol.queryDependencyGraph.mockResolvedValue(dependencyGraphResult);
    protocol.queryArchitectureSummary.mockResolvedValue(architectureSummaryResult);
    const panels = panelsCreate();
    const host = hostCreate({ activeUriGet: () => undefined });
    const controller = new CodepolCommandController(protocol as never, panels, host);

    const result = await controller.showDependencyGraph();

    expect(protocol.queryDependencyGraph).toHaveBeenCalledTimes(1);
    expect(protocol.queryArchitectureSummary).toHaveBeenCalledTimes(1);
    expect(result).toEqual(
      expect.objectContaining({
        focusUri: undefined,
        graph: expect.objectContaining({
          mode: 'workspace',
          nodes: expect.any(Array),
        }),
      }),
    );
    expect(panels.showDependencyGraph).toHaveBeenCalledWith(result, expect.any(Function));
  });

  it('highlights the active file in the workspace dependency graph when available', async () => {
    const protocol = protocolCreate();
    protocol.queryDependencyGraph.mockResolvedValue(dependencyGraphResult);
    protocol.queryArchitectureSummary.mockResolvedValue(architectureSummaryResult);
    const panels = panelsCreate();
    const host = hostCreate();
    const controller = new CodepolCommandController(protocol as never, panels, host);

    const result = await controller.showDependencyGraph();

    expect(result).toEqual(
      expect.objectContaining({
        focusUri: 'file:///workspace/packages/lib/src/index.ts',
      }),
    );
    expect(result?.graph.nodes.find((node) => node.uri === 'file:///workspace/packages/lib/src/index.ts')?.isFocus).toBe(true);
  });

  it('reports unavailable dependency graphs clearly', async () => {
    const protocol = protocolCreate();
    protocol.queryDependencyGraph.mockResolvedValue(null);
    protocol.queryArchitectureSummary.mockResolvedValue(architectureSummaryResult);
    const panels = panelsCreate();
    const host = hostCreate();
    const controller = new CodepolCommandController(protocol as never, panels, host);

    await expect(controller.showDependencyGraph()).resolves.toBeNull();
    expect(host.errorShow).toHaveBeenCalledWith(
      'Codepol dependency graph is not available for this workspace yet.',
    );
    expect(panels.showDependencyGraph).not.toHaveBeenCalled();
  });

  it('blocks architecture links while the workspace index is cold', async () => {
    const protocol = protocolCreate();
    const panels = panelsCreate();
    const host = hostCreate({
      readinessSnapshotGet: () => ({
        status: readinessStatusCreate({
          status: 'cold',
          replayState: 'applied',
          workspaceReady: false,
        }),
      }),
    });
    const controller = new CodepolCommandController(protocol as never, panels, host);

    await expect(controller.showArchitectureLinks()).resolves.toBeNull();
    expect(host.errorShow).toHaveBeenCalledWith(
      'Codepol architecture links are blocked while the workspace index is preparing.',
    );
    expect(protocol.querySemanticReferences).not.toHaveBeenCalled();
  });

  it('renders graph-first architecture links for the active file', async () => {
    const protocol = protocolCreate();
    protocol.queryDependencyGraph.mockResolvedValue(dependencyGraphResult);
    protocol.queryArchitectureSummary.mockResolvedValue(architectureSummaryResult);
    protocol.querySemanticReferences.mockResolvedValue({
      target: {
        uri: 'file:///workspace/packages/lib/src/index.ts',
        semanticClass: 'architecture_node',
      },
      presentation: 'grouped_list',
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
    });
    protocol.querySemanticHover.mockResolvedValue({
      target: {
        uri: 'file:///workspace/packages/lib/src/index.ts',
        semanticClass: 'architecture_node',
      },
      title: 'index.ts',
      subtitle: 'packages/lib/src/index.ts',
      summary: 'Indexed architecture node for the workspace module graph.',
      fields: [],
      actions: ['find_references', 'show_graph'],
      source: 'codepol',
      semanticClass: 'architecture_node',
    });
    const panels = panelsCreate();
    const host = hostCreate();
    const controller = new CodepolCommandController(protocol as never, panels, host);

    const result = await controller.showArchitectureLinks();

    expect(protocol.querySemanticReferences).toHaveBeenCalledWith(
      'file:///workspace/packages/lib/src/index.ts',
    );
    expect(protocol.querySemanticHover).toHaveBeenCalledWith(
      'file:///workspace/packages/lib/src/index.ts',
    );
    expect(protocol.queryDependencyGraph).toHaveBeenCalledTimes(1);
    expect(protocol.queryArchitectureSummary).toHaveBeenCalledTimes(1);
    expect(result).toEqual(
      expect.objectContaining({
        uri: 'file:///workspace/packages/lib/src/index.ts',
        graph: expect.objectContaining({
          mode: 'focus',
          focusUri: 'file:///workspace/packages/lib/src/index.ts',
        }),
        workspaceSummaryCard: expect.objectContaining({
          summary: architectureSummaryResult.summary,
        }),
      }),
    );
    expect(result?.graph.nodes).toHaveLength(2);
    expect(panels.showArchitectureLinks).toHaveBeenCalledWith(result, expect.any(Function));
  });

  it('peeks architecture using queryImpactRadius for the active file', async () => {
    const protocol = protocolCreate();
    protocol.queryImpactRadius.mockResolvedValue(dependencyGraphResult);
    protocol.queryArchitectureSummary.mockResolvedValue(architectureSummaryResult);
    protocol.querySemanticReferences.mockResolvedValue(null);
    protocol.querySemanticHover.mockResolvedValue(null);
    const panels = panelsCreate();
    const host = hostCreate();
    const controller = new CodepolCommandController(protocol as never, panels, host);

    const result = await controller.peekArchitecture();

    expect(protocol.queryImpactRadius).toHaveBeenCalledWith({
      uri: 'file:///workspace/packages/lib/src/index.ts',
      direction: 'both',
      depth: 2,
    });
    expect(protocol.queryDependencyGraph).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        uri: 'file:///workspace/packages/lib/src/index.ts',
        layoutMode: 'radial',
      }),
    );
    expect(panels.showArchitectureLinks).toHaveBeenCalledWith(
      result,
      expect.any(Function),
    );
  });

  it('rejects peek architecture without an active file', async () => {
    const protocol = protocolCreate();
    const panels = panelsCreate();
    const host = hostCreate({ activeUriGet: () => undefined });
    const controller = new CodepolCommandController(protocol as never, panels, host);

    await expect(controller.peekArchitecture()).resolves.toBeNull();
    expect(host.errorShow).toHaveBeenCalledWith(
      'Open a workspace file before peeking architecture.',
    );
    expect(protocol.queryImpactRadius).not.toHaveBeenCalled();
  });

  it('keeps architecture links active-file scoped while workspace commands remain available', async () => {
    const protocol = protocolCreate();
    const panels = panelsCreate();
    const host = hostCreate({ activeUriGet: () => undefined });
    const controller = new CodepolCommandController(protocol as never, panels, host);

    await expect(controller.showArchitectureLinks()).resolves.toBeNull();
    expect(host.errorShow).toHaveBeenCalledWith(
      'Open a workspace file before requesting architecture links.',
    );

    protocol.queryArchitectureSummary.mockResolvedValue(architectureSummaryResult);
    await expect(controller.showArchitectureSummary()).resolves.not.toBeNull();
    expect(panels.showArchitectureSummary).toHaveBeenCalledTimes(1);
  });

  it('shows rename preview for a successful rename flow', async () => {
    const protocol = protocolCreate();
    protocol.prepareRename.mockResolvedValue({
      ok: true,
      target: renameTargetCandidate.target,
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
    });
    protocol.previewRename.mockResolvedValue({
      ok: true,
      target: renameTargetCandidate.target,
      oldName: '@acme/lib',
      newName: '@acme/lib-next',
      normalizedNewName: '@acme/lib-next',
      namespaceId: 'workspace.packages:file:///workspace',
      groups: [],
      totalEdits: 2,
      warnings: [],
      blockingIssues: [],
      canApply: true,
      plan: {
        id: 'plan-1',
        title: 'Rename workspace package',
        kind: 'rename',
        edits: [],
        diagnosticIds: [],
      },
    });
    const panels = panelsCreate();
    const host = hostCreate({
      renameTargetsLoad: async () => [renameTargetCandidate],
      renamePrompt: async () => '@acme/lib-next',
    });
    const controller = new CodepolCommandController(protocol as never, panels, host);

    const result = await controller.renameCodepolEntity();

    expect(protocol.prepareRename).toHaveBeenCalledWith(renameTargetCandidate.target);
    expect(protocol.previewRename).toHaveBeenCalledWith(
      renameTargetCandidate.target,
      '@acme/lib-next',
    );
    expect(panels.showRenamePreview).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: true,
      newName: '@acme/lib-next',
      canApply: true,
    });
  });

  it('renders blocked rename previews without applying them', async () => {
    const protocol = protocolCreate();
    protocol.prepareRename.mockResolvedValue({
      ok: true,
      target: renameTargetCandidate.target,
      displayName: '@acme/lib',
      currentName: '@acme/lib',
      normalizedCurrentName: '@acme/lib',
      namespaceId: 'workspace.packages:file:///workspace',
      impactedSiteCount: 2,
      requiresPreview: true,
      namingRules: {
        minLength: 1,
      },
    });
    protocol.previewRename.mockResolvedValue({
      ok: true,
      target: renameTargetCandidate.target,
      oldName: '@acme/lib',
      newName: '@acme/lib-next',
      normalizedNewName: '@acme/lib-next',
      namespaceId: 'workspace.packages:file:///workspace',
      groups: [],
      totalEdits: 2,
      warnings: [],
      blockingIssues: [{ code: 'collision', message: 'Package already exists.' }],
      canApply: false,
    });
    const panels = panelsCreate();
    const host = hostCreate({
      renameTargetsLoad: async () => [renameTargetCandidate],
      renamePrompt: async () => '@acme/lib-next',
    });
    const controller = new CodepolCommandController(protocol as never, panels, host);

    const result = await controller.renameCodepolEntity();

    expect(protocol.applyEditPlan).not.toHaveBeenCalled();
    expect(panels.showRenamePreview).toHaveBeenCalledWith(
      expect.objectContaining({
        canApply: false,
        blockingIssues: ['Package already exists.'],
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      canApply: false,
    });
  });

  it('blocks workspace package rename while the workspace index is warming', async () => {
    const protocol = protocolCreate();
    const panels = panelsCreate();
    const host = hostCreate({
      readinessSnapshotGet: () => ({
        status: readinessStatusCreate({
          status: 'warming',
          replayState: 'applied',
          workspaceReady: false,
        }),
      }),
    });
    const controller = new CodepolCommandController(protocol as never, panels, host);

    await expect(
      controller.renameCodepolEntity({ target: renameTargetCandidate.target }),
    ).resolves.toBeNull();
    expect(host.errorShow).toHaveBeenCalledWith(
      'Codepol workspace package rename is blocked while the workspace index is warming.',
    );
    expect(protocol.prepareRename).not.toHaveBeenCalled();
  });

  it('keeps config target rename available while workspace package rename is blocked', async () => {
    const protocol = protocolCreate();
    protocol.prepareRename.mockResolvedValue({
      ok: true,
      target: configRenameTargetCandidate.target,
      displayName: 'web',
      currentName: 'web',
      normalizedCurrentName: 'web',
      namespaceId: 'workspace.targets:file:///workspace',
      impactedSiteCount: 1,
      requiresPreview: true,
      namingRules: {
        minLength: 1,
      },
    });
    protocol.previewRename.mockResolvedValue({
      ok: true,
      target: configRenameTargetCandidate.target,
      oldName: 'web',
      newName: 'frontend',
      normalizedNewName: 'frontend',
      namespaceId: 'workspace.targets:file:///workspace',
      groups: [],
      totalEdits: 1,
      warnings: [],
      blockingIssues: [],
      canApply: true,
    });
    const panels = panelsCreate();
    const host = hostCreate({
      readinessSnapshotGet: () => ({
        status: readinessStatusCreate({
          status: 'warming',
          replayState: 'applied',
          workspaceReady: false,
        }),
      }),
      renameTargetsLoad: async () => [
        renameTargetCandidate,
        configRenameTargetCandidate,
      ],
      renamePrompt: async () => 'frontend',
    });
    const controller = new CodepolCommandController(protocol as never, panels, host);

    const result = await controller.renameCodepolEntity();

    expect(host.infoShow).toHaveBeenCalledWith(
      'Codepol workspace package rename is blocked while the workspace index is warming. Config target rename is still available.',
    );
    expect(protocol.prepareRename).toHaveBeenCalledWith(configRenameTargetCandidate.target);
    expect(result).toMatchObject({
      ok: true,
      newName: 'frontend',
    });
  });

  it('reports prepare failures and empty target discovery clearly', async () => {
    const protocol = protocolCreate();
    protocol.prepareRename.mockResolvedValue({
      ok: false,
      code: 'unsupported_context',
      message: 'Rename is not available in the current workspace.',
    });
    const panels = panelsCreate();
    const host = hostCreate({
      renameTargetsLoad: async () => [renameTargetCandidate],
    });
    const controller = new CodepolCommandController(protocol as never, panels, host);

    await expect(
      controller.renameCodepolEntity({ target: renameTargetCandidate.target }),
    ).resolves.toEqual({
      ok: false,
      code: 'unsupported_context',
      message: 'Rename is not available in the current workspace.',
    });
    expect(host.errorShow).toHaveBeenCalledWith(
      'Rename is not available in the current workspace.',
    );

    const emptyHost = hostCreate({
      renameTargetsLoad: async () => [],
    });
    const emptyController = new CodepolCommandController(
      protocol as never,
      panelsCreate(),
      emptyHost,
    );
    await expect(emptyController.renameCodepolEntity()).resolves.toBeNull();
    expect(emptyHost.errorShow).toHaveBeenCalledWith(
      'No renameable Codepol targets were discovered in the current workspace.',
    );
  });
});
