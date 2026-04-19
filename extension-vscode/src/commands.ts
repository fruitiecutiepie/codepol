import type {
  WorkspaceArchitectureSummaryResult,
  WorkspaceDependencyGraphResult,
  WorkspaceLintRuleDetailsResult,
  WorkspacePosition,
  WorkspacePrepareRenameResult,
  WorkspaceRange,
  WorkspaceRenamePreviewResult,
  WorkspaceSearchResult,
  WorkspaceSemanticHoverResult,
  WorkspaceSemanticReferencesResult,
  WorkspaceSupportedRenameTarget,
} from '@codepol/core';
import {
  callGraphPanelViewModelCreate,
  type CallGraphPanelDepth,
  type CallGraphPanelDirection,
  type CallGraphPanelViewModel,
} from './callGraphViewModels';
import {
  typeHierarchyPanelViewModelCreate,
  type TypeHierarchyPanelDepth,
  type TypeHierarchyPanelDirection,
  type TypeHierarchyPanelViewModel,
} from './typeHierarchyViewModels';
import type { RenameTargetCandidate } from './discovery';
import type {
  CodepolProtocolQuickFixAction,
  CodepolProtocolClient,
} from './protocolClient';
import type {
  CodepolReadinessFeature,
  CodepolReadinessSnapshot,
} from './readiness';
import {
  codepolFeatureGateResolve,
  codepolFeatureUnavailableMessageResolve,
  codepolRequestSupersededErrorIs,
  codepolReadinessStateResolve,
} from './readiness';
import type {
  ArchitectureLinksPanelViewModel,
  ArchitectureSummaryPanelViewModel,
  DependencyGraphFilterState,
  DependencyGraphLayoutMode,
  DependencyGraphPanelViewModel,
  LintRuleDetailsPanelViewModel,
  RenamePreviewPanelViewModel,
  SemanticDefinitionPanelViewModel,
} from './viewModels';
import {
  architectureLinksPanelViewModelCreate,
  architectureSummaryPanelViewModelCreate,
  dependencyGraphPanelViewModelCreate,
  lintRuleDetailsPanelViewModelCreate,
  renamePreviewPanelViewModelCreate,
  semanticDefinitionPanelViewModelCreate,
} from './viewModels';

export type RenameCommandOptions = {
  target?: WorkspaceSupportedRenameTarget;
  newName?: string;
  autoApply?: boolean;
};

export type SemanticSearchCommandOptions = {
  query?: string;
  autoOpenFirstResult?: boolean;
};

type OpenLocationInput = {
  uri: string;
  line: number;
  character: number;
};

export type LintRuleDiagnosticQuickFixCommandInput = {
  ruleId: string;
  uri: string;
  message: string;
  range: WorkspaceRange;
};

export type DependencyGraphPanelControlState = {
  filters: DependencyGraphFilterState;
  layoutMode: DependencyGraphLayoutMode;
  blastRadiusUri?: string;
};

export type DependencyGraphPanelRebuilder = (
  state: DependencyGraphPanelControlState,
) => DependencyGraphPanelViewModel;

export type ArchitectureLinksPanelRebuilder = (
  state: DependencyGraphPanelControlState,
) => ArchitectureLinksPanelViewModel;

export type CallGraphPanelRebuilder = (input: {
  direction: CallGraphPanelDirection;
  depth: CallGraphPanelDepth;
}) => Promise<CallGraphPanelViewModel | null>;

export type TypeHierarchyPanelRebuilder = (input: {
  direction: TypeHierarchyPanelDirection;
  depth: TypeHierarchyPanelDepth;
}) => Promise<TypeHierarchyPanelViewModel | null>;

export type CodepolPanels = {
  showArchitectureSummary(input: ArchitectureSummaryPanelViewModel): void;
  showDependencyGraph(
    input: DependencyGraphPanelViewModel,
    rebuilder?: DependencyGraphPanelRebuilder,
  ): void;
  showSemanticDefinition(input: SemanticDefinitionPanelViewModel): void;
  showArchitectureLinks(
    input: ArchitectureLinksPanelViewModel,
    rebuilder?: ArchitectureLinksPanelRebuilder,
  ): void;
  showLintRuleDetails(input: LintRuleDetailsPanelViewModel): void;
  showRenamePreview(input: RenamePreviewPanelViewModel): void;
  showCallGraph(
    input: CallGraphPanelViewModel,
    rebuilder?: CallGraphPanelRebuilder,
  ): void;
  showTypeHierarchy(
    input: TypeHierarchyPanelViewModel,
    rebuilder?: TypeHierarchyPanelRebuilder,
  ): void;
};

export type FlowSitePeekLocation = {
  uri: string;
  line: number;
  character: number;
};

export type CodepolCommandHost = {
  activeUriGet(): string | undefined;
  /**
   * Cursor position in the active editor, when one exists. Used by
   * `showCallGraph` and `findCallbacks` to anchor the cursor-resolved
   * symbol-id discovery (`querySymbolAtPosition`).
   */
  activePositionGet(): WorkspacePosition | undefined;
  /**
   * Open VS Code's peek view at `(uri, position)` populated with
   * `locations`. Used by `findCallbacks` to surface the flow sites
   * inline rather than as a panel. Implementations typically call
   * `vscode.commands.executeCommand('editor.action.peekLocations', ...)`.
   */
  peekLocations(input: {
    sourceUri: string;
    sourcePosition: WorkspacePosition;
    locations: FlowSitePeekLocation[];
  }): Promise<void>;
  readinessSnapshotGet(): CodepolReadinessSnapshot;
  semanticSearchInitialQueryResolve(): string | undefined;
  semanticSearchPick(input: {
    initialQuery: string;
    queryResults(query: string): Promise<WorkspaceSearchResult[] | null>;
  }): Promise<WorkspaceSearchResult | null | undefined>;
  renameTargetsLoad(): Promise<RenameTargetCandidate[]>;
  renameTargetPick(
    candidates: RenameTargetCandidate[],
  ): Promise<RenameTargetCandidate | undefined>;
  renamePrompt(input: {
    title: string;
    value: string;
    namingRules: string[];
  }): Promise<string | undefined>;
  quickPick<T>(input: {
    title: string;
    placeholder?: string;
    items: Array<{
      label: string;
      description?: string;
      detail?: string;
      value: T;
    }>;
  }): Promise<T | undefined>;
  infoShow(message: string): void | Promise<void>;
  errorShow(message: string): void | Promise<void>;
  openLocation(input: OpenLocationInput): Promise<void>;
};

function namingRulesCreate(prepare: WorkspacePrepareRenameResult): string[] {
  if (!prepare.ok) {
    return [];
  }

  const rules: string[] = [];
  if (prepare.namingRules.patternDescription) {
    rules.push(prepare.namingRules.patternDescription);
  }
  if (prepare.namingRules.casePolicy) {
    rules.push(`Case: ${prepare.namingRules.casePolicy}`);
  }
  return rules;
}

function architectureLinksRebuilderCreate(input: {
  uri: string;
  references: WorkspaceSemanticReferencesResult | null;
  hover: WorkspaceSemanticHoverResult | null;
  graph: WorkspaceDependencyGraphResult | null;
  summary: WorkspaceArchitectureSummaryResult | null;
}): ArchitectureLinksPanelRebuilder {
  return (state) =>
    architectureLinksPanelViewModelCreate({
      uri: input.uri,
      references: input.references,
      hover: input.hover,
      graph: input.graph,
      summary: input.summary,
      filters: state.filters,
      layoutMode: state.layoutMode,
      blastRadiusUri: state.blastRadiusUri,
    });
}

function lintRuleQuickFixesSort(
  left: CodepolProtocolQuickFixAction,
  right: CodepolProtocolQuickFixAction,
): number {
  const preferredDelta =
    Number(Boolean(right.isPreferred)) - Number(Boolean(left.isPreferred));
  if (preferredDelta !== 0) {
    return preferredDelta;
  }
  return left.title.localeCompare(right.title);
}

export class CodepolCommandController {
  private static readonly REQUEST_SUPERSEDED = Symbol('request_superseded');

  constructor(
    private readonly protocol: CodepolProtocolClient,
    private readonly panels: CodepolPanels,
    private readonly host: CodepolCommandHost,
  ) {}

  private async protocolRequestRun<TResult>(
    request: Promise<TResult>,
  ): Promise<TResult | typeof CodepolCommandController.REQUEST_SUPERSEDED> {
    try {
      return await request;
    } catch (error) {
      if (codepolRequestSupersededErrorIs(error)) {
        return CodepolCommandController.REQUEST_SUPERSEDED;
      }
      throw error;
    }
  }

  private async protocolOptionalRequestRun<TResult>(
    request: Promise<TResult>,
  ): Promise<TResult | null> {
    const result = await this.protocolRequestRun(request);
    return result === CodepolCommandController.REQUEST_SUPERSEDED ? null : result;
  }

  private featureBlockedMessageResolve(
    feature: CodepolReadinessFeature,
  ): string | undefined {
    return codepolFeatureGateResolve(
      this.host.readinessSnapshotGet(),
      feature,
    ).message;
  }

  private featureUnavailableMessageResolve(
    feature: CodepolReadinessFeature,
    fallback: string,
  ): string {
    const snapshot = this.host.readinessSnapshotGet();
    const state = codepolReadinessStateResolve(snapshot);
    if (state === 'error' || state === 'unknown') {
      return codepolFeatureUnavailableMessageResolve(snapshot, feature);
    }
    return fallback;
  }

  async showSemanticSearch(
    options: SemanticSearchCommandOptions = {},
  ): Promise<WorkspaceSearchResult | null> {
    const blockedMessage = this.featureBlockedMessageResolve('semanticSearch');
    if (blockedMessage) {
      await this.host.errorShow(blockedMessage);
      return null;
    }

    const initialQuery =
      options.query ?? this.host.semanticSearchInitialQueryResolve() ?? '';

    if (options.autoOpenFirstResult === true) {
      const results = await this.protocolRequestRun(
        this.protocol.querySemanticSearch(initialQuery),
      );
      if (results === CodepolCommandController.REQUEST_SUPERSEDED) {
        return null;
      }
      if (!results) {
        await this.host.errorShow(
          this.featureUnavailableMessageResolve(
            'semanticSearch',
            'Codepol semantic search is not available for this workspace yet.',
          ),
        );
        return null;
      }
      const firstResult = results[0];
      if (!firstResult) {
        await this.host.infoShow(
          initialQuery.length > 0
            ? `No Codepol semantic search results matched "${initialQuery}".`
            : 'No Codepol semantic search results are available yet.',
        );
        return null;
      }
      await this.host.openLocation({
        uri: firstResult.location.uri,
        line: firstResult.location.range.start.line,
        character: firstResult.location.range.start.character,
      });
      return firstResult;
    }

    const picked = await this.host.semanticSearchPick({
      initialQuery,
      queryResults: (query) => this.protocol.querySemanticSearch(query),
    });
    if (picked === null) {
      await this.host.errorShow(
        this.featureUnavailableMessageResolve(
          'semanticSearch',
          'Codepol semantic search is not available for this workspace yet.',
        ),
      );
      return null;
    }
    if (!picked) {
      return null;
    }

    await this.host.openLocation({
      uri: picked.location.uri,
      line: picked.location.range.start.line,
      character: picked.location.range.start.character,
    });
    return picked;
  }

  async showSemanticDefinition(uri?: string): Promise<SemanticDefinitionPanelViewModel | null> {
    const targetUri = uri ?? this.host.activeUriGet();
    if (!targetUri) {
      await this.host.errorShow('Open a workspace file before requesting a semantic definition.');
      return null;
    }

    const [definition, hover] = await Promise.all([
      this.protocolRequestRun(this.protocol.querySemanticDefinition(targetUri)),
      this.protocolOptionalRequestRun(this.protocol.querySemanticHover(targetUri)),
    ]);
    if (definition === CodepolCommandController.REQUEST_SUPERSEDED) {
      return null;
    }
    const model = semanticDefinitionPanelViewModelCreate({
      uri: targetUri,
      definition,
      hover,
    });

    this.panels.showSemanticDefinition(model);
    if (definition) {
      await this.host.openLocation({
        uri: definition.location.uri,
        line: definition.location.range.start.line,
        character: definition.location.range.start.character,
      });
    }
    return model;
  }

  async showArchitectureSummary(): Promise<ArchitectureSummaryPanelViewModel | null> {
    const blockedMessage = this.featureBlockedMessageResolve('architectureSummary');
    if (blockedMessage) {
      await this.host.errorShow(blockedMessage);
      return null;
    }

    const summary = await this.protocolRequestRun(
      this.protocol.queryArchitectureSummary(),
    );
    if (summary === CodepolCommandController.REQUEST_SUPERSEDED) {
      return null;
    }
    if (!summary) {
      await this.host.errorShow(
        this.featureUnavailableMessageResolve(
          'architectureSummary',
          'Codepol architecture summary is not available for this workspace yet.',
        ),
      );
      return null;
    }

    const model = architectureSummaryPanelViewModelCreate({ summary });
    this.panels.showArchitectureSummary(model);
    return model;
  }

  async showDependencyGraph(
    uri?: string,
  ): Promise<DependencyGraphPanelViewModel | null> {
    const blockedMessage = this.featureBlockedMessageResolve('dependencyGraph');
    if (blockedMessage) {
      await this.host.errorShow(blockedMessage);
      return null;
    }

    const focusUri = uri ?? this.host.activeUriGet();
    const [graph, summary] = await Promise.all([
      this.protocolRequestRun(this.protocol.queryDependencyGraph()),
      this.protocolOptionalRequestRun(this.protocol.queryArchitectureSummary()),
    ]);
    if (graph === CodepolCommandController.REQUEST_SUPERSEDED) {
      return null;
    }
    if (!graph) {
      await this.host.errorShow(
        this.featureUnavailableMessageResolve(
          'dependencyGraph',
          'Codepol dependency graph is not available for this workspace yet.',
        ),
      );
      return null;
    }

    const summaryResolved: WorkspaceArchitectureSummaryResult | null =
      summary ?? null;
    const buildModel = (
      state: DependencyGraphPanelControlState,
    ): DependencyGraphPanelViewModel =>
      dependencyGraphPanelViewModelCreate({
        graph,
        summary: summaryResolved,
        focusUri,
        filters: state.filters,
        layoutMode: state.layoutMode,
        blastRadiusUri: state.blastRadiusUri,
      });
    const model = buildModel({ filters: {}, layoutMode: 'layered' });
    this.panels.showDependencyGraph(model, buildModel);
    return model;
  }

  async showArchitectureLinks(uri?: string): Promise<ArchitectureLinksPanelViewModel | null> {
    const targetUri = uri ?? this.host.activeUriGet();
    if (!targetUri) {
      await this.host.errorShow('Open a workspace file before requesting architecture links.');
      return null;
    }

    const blockedMessage = this.featureBlockedMessageResolve('architectureLinks');
    if (blockedMessage) {
      await this.host.errorShow(blockedMessage);
      return null;
    }

    const [references, hover, graph, summary] = await Promise.all([
      this.protocolRequestRun(this.protocol.querySemanticReferences(targetUri)),
      this.protocolOptionalRequestRun(this.protocol.querySemanticHover(targetUri)),
      this.protocolOptionalRequestRun(this.protocol.queryDependencyGraph()),
      this.protocolOptionalRequestRun(this.protocol.queryArchitectureSummary()),
    ]);
    if (references === CodepolCommandController.REQUEST_SUPERSEDED) {
      return null;
    }
    const buildModel = architectureLinksRebuilderCreate({
      uri: targetUri,
      references: references ?? null,
      hover: hover ?? null,
      graph: graph ?? null,
      summary: summary ?? null,
    });
    const model = buildModel({ filters: {}, layoutMode: 'radial' });
    this.panels.showArchitectureLinks(model, buildModel);
    return model;
  }

  async peekArchitecture(
    uri?: string,
  ): Promise<ArchitectureLinksPanelViewModel | null> {
    const targetUri = uri ?? this.host.activeUriGet();
    if (!targetUri) {
      await this.host.errorShow(
        'Open a workspace file before peeking architecture.',
      );
      return null;
    }

    const blockedMessage = this.featureBlockedMessageResolve('architectureLinks');
    if (blockedMessage) {
      await this.host.errorShow(blockedMessage);
      return null;
    }

    const [impactRadius, references, hover, summary] = await Promise.all([
      this.protocolRequestRun(
        this.protocol.queryImpactRadius({
          uri: targetUri,
          direction: 'both',
          depth: 2,
        }),
      ),
      this.protocolOptionalRequestRun(
        this.protocol.querySemanticReferences(targetUri),
      ),
      this.protocolOptionalRequestRun(this.protocol.querySemanticHover(targetUri)),
      this.protocolOptionalRequestRun(this.protocol.queryArchitectureSummary()),
    ]);
    if (impactRadius === CodepolCommandController.REQUEST_SUPERSEDED) {
      return null;
    }
    const buildModel = architectureLinksRebuilderCreate({
      uri: targetUri,
      references: references ?? null,
      hover: hover ?? null,
      graph: impactRadius ?? null,
      summary: summary ?? null,
    });
    const model = buildModel({ filters: {}, layoutMode: 'radial' });
    this.panels.showArchitectureLinks(model, buildModel);
    return model;
  }

  /**
   * Open the dedicated call-graph panel scoped to the symbol the
   * caller passes via `args` (CodeLens click) or to the symbol under
   * the editor cursor (right-click flow). The handler chains
   * `querySymbolAtPosition` for cursor resolution and `queryCallGraph`
   * for the graph itself.
   */
  async showCallGraph(
    args?: { symbolId?: string; focusSymbolName?: string },
  ): Promise<CallGraphPanelViewModel | null> {
    const initialDirection: CallGraphPanelDirection = 'both';
    const initialDepth: CallGraphPanelDepth = 2;

    let symbolId = args?.symbolId;
    let focusSymbolName = args?.focusSymbolName;

    if (!symbolId) {
      const cursor = await this.cursorSymbolResolve(
        'Position your cursor on a function or method to show its call graph.',
      );
      if (!cursor) return null;
      symbolId = cursor.symbolId;
      focusSymbolName = cursor.name.length > 0 ? cursor.name : '<anonymous>';
    }

    const buildModel = async (input: {
      direction: CallGraphPanelDirection;
      depth: CallGraphPanelDepth;
    }): Promise<CallGraphPanelViewModel | null> => {
      const depthValue = input.depth === 'unbounded' ? undefined : input.depth;
      const requestArgs: {
        symbolId: string;
        direction: CallGraphPanelDirection;
        depth?: number;
      } = {
        symbolId: symbolId!,
        direction: input.direction,
      };
      if (depthValue !== undefined) {
        requestArgs.depth = depthValue;
      }
      const graph = await this.protocolRequestRun(
        this.protocol.queryCallGraph(requestArgs),
      );
      if (graph === CodepolCommandController.REQUEST_SUPERSEDED) {
        return null;
      }
      if (!graph) {
        return null;
      }
      const modelInput: {
        graph: typeof graph;
        focusSymbolId: string;
        focusSymbolName?: string;
        direction: CallGraphPanelDirection;
        depth: CallGraphPanelDepth;
      } = {
        graph,
        focusSymbolId: symbolId!,
        direction: input.direction,
        depth: input.depth,
      };
      if (focusSymbolName !== undefined) {
        modelInput.focusSymbolName = focusSymbolName;
      }
      return callGraphPanelViewModelCreate(modelInput);
    };

    const initial = await buildModel({
      direction: initialDirection,
      depth: initialDepth,
    });
    if (!initial) {
      await this.host.errorShow(
        this.featureUnavailableMessageResolve(
          'dependencyGraph',
          `Codepol cannot build a call graph for ${focusSymbolName ?? symbolId} right now.`,
        ),
      );
      return null;
    }
    this.panels.showCallGraph(initial, buildModel);
    return initial;
  }

  /**
   * Open the dedicated type-hierarchy panel scoped to the symbol the
   * caller passes via `args` (CodeLens click) or to the symbol under
   * the editor cursor. Mirrors {@link showCallGraph} but calls
   * `queryTypeHierarchy` and defaults `includeStructural: true` so
   * the panel always shows the shape-matched edges Phase 9.4 added.
   *
   * The legend in the panel and the dashed edge style make the
   * additional edges visually distinct, so the default-on choice
   * does not surprise users.
   */
  async showTypeHierarchy(
    args?: { symbolId?: string; focusSymbolName?: string },
  ): Promise<TypeHierarchyPanelViewModel | null> {
    const initialDirection: TypeHierarchyPanelDirection = 'both';
    const initialDepth: TypeHierarchyPanelDepth = 2;

    let symbolId = args?.symbolId;
    let focusSymbolName = args?.focusSymbolName;

    if (!symbolId) {
      const cursor = await this.cursorSymbolResolve(
        'Position your cursor on a class, interface, or type alias to show its type hierarchy.',
      );
      if (!cursor) return null;
      symbolId = cursor.symbolId;
      focusSymbolName = cursor.name.length > 0 ? cursor.name : '<anonymous>';
    }

    const buildModel = async (input: {
      direction: TypeHierarchyPanelDirection;
      depth: TypeHierarchyPanelDepth;
    }): Promise<TypeHierarchyPanelViewModel | null> => {
      const depthValue = input.depth === 'unbounded' ? undefined : input.depth;
      const requestArgs: {
        symbolId: string;
        direction: TypeHierarchyPanelDirection;
        depth?: number;
        includeStructural: boolean;
      } = {
        symbolId: symbolId!,
        direction: input.direction,
        // Phase 9.4 / Gap 3: panel always opts in to the shape-match
        // overlay. The CLI default stays `false` to keep CI stable;
        // the editor surface chooses true so users see the full
        // picture by default.
        includeStructural: true,
      };
      if (depthValue !== undefined) {
        requestArgs.depth = depthValue;
      }
      const graph = await this.protocolRequestRun(
        this.protocol.queryTypeHierarchy(requestArgs),
      );
      if (graph === CodepolCommandController.REQUEST_SUPERSEDED) {
        return null;
      }
      if (!graph) {
        return null;
      }
      const modelInput: {
        graph: typeof graph;
        focusSymbolId: string;
        focusSymbolName?: string;
        direction: TypeHierarchyPanelDirection;
        depth: TypeHierarchyPanelDepth;
      } = {
        graph,
        focusSymbolId: symbolId!,
        direction: input.direction,
        depth: input.depth,
      };
      if (focusSymbolName !== undefined) {
        modelInput.focusSymbolName = focusSymbolName;
      }
      return typeHierarchyPanelViewModelCreate(modelInput);
    };

    const initial = await buildModel({
      direction: initialDirection,
      depth: initialDepth,
    });
    if (!initial) {
      await this.host.errorShow(
        this.featureUnavailableMessageResolve(
          'dependencyGraph',
          `Codepol cannot build a type hierarchy for ${focusSymbolName ?? symbolId} right now.`,
        ),
      );
      return null;
    }
    this.panels.showTypeHierarchy(initial, buildModel);
    return initial;
  }

  /**
   * Open VS Code's peek view populated with the "function passed as
   * argument" flow sites for the symbol under the cursor (or for the
   * symbol the caller passes explicitly). Uses `querySymbolFlow`
   * outgoing direction — answers "where is this function used as a
   * callback?".
   */
  async findCallbacks(
    args?: { symbolId?: string; focusSymbolName?: string },
  ): Promise<number | null> {
    const sourceUri = this.host.activeUriGet();
    const sourcePosition = this.host.activePositionGet();
    if (!sourceUri || !sourcePosition) {
      await this.host.errorShow(
        'Open a workspace file and place your cursor on a function before searching for callbacks.',
      );
      return null;
    }

    let symbolId = args?.symbolId;
    let focusSymbolName = args?.focusSymbolName;

    if (!symbolId) {
      const cursor = await this.cursorSymbolResolve(
        'Position your cursor on a function or method to find callbacks of it.',
      );
      if (!cursor) return null;
      symbolId = cursor.symbolId;
      focusSymbolName = cursor.name.length > 0 ? cursor.name : '<anonymous>';
    }

    const result = await this.protocolRequestRun(
      this.protocol.querySymbolFlow({
        symbolId,
        direction: 'outgoing',
      }),
    );
    if (result === CodepolCommandController.REQUEST_SUPERSEDED) {
      return null;
    }
    if (!result) {
      await this.host.infoShow(`No callback flow sites found for ${focusSymbolName ?? symbolId}.`);
      return 0;
    }

    if (result.edges.length === 0) {
      await this.host.infoShow(`No callback flow sites found for ${focusSymbolName ?? symbolId}.`);
      return 0;
    }

    const locations: FlowSitePeekLocation[] = result.edges.map((edge) => ({
      // `edge.file` is workspace-relative per the contract; the host
      // peek implementation is responsible for resolving it relative
      // to the active workspace folder via `vscode.Uri.joinPath`.
      uri: edge.file,
      line: edge.range.start.line,
      character: edge.range.start.character,
    }));
    await this.host.peekLocations({
      sourceUri,
      sourcePosition,
      locations,
    });
    return locations.length;
  }

  /**
   * Resolve the symbol under the active editor cursor via
   * `querySymbolAtPosition`. Centralised so both `showCallGraph`
   * and `findCallbacks` produce identical "no symbol" UX.
   */
  private async cursorSymbolResolve(
    bailMessage: string,
  ): Promise<{ symbolId: string; name: string } | null> {
    const uri = this.host.activeUriGet();
    const position = this.host.activePositionGet();
    if (!uri || !position) {
      await this.host.errorShow(bailMessage);
      return null;
    }
    const result = await this.protocolRequestRun(
      this.protocol.querySymbolAtPosition({ uri, position }),
    );
    if (result === CodepolCommandController.REQUEST_SUPERSEDED) {
      return null;
    }
    const symbol = result?.symbol;
    if (!symbol) {
      await this.host.errorShow(bailMessage);
      return null;
    }
    return { symbolId: symbol.symbolId, name: symbol.name };
  }

  async showLintRuleDetails(
    ruleId: string,
  ): Promise<WorkspaceLintRuleDetailsResult | null> {
    const details = await this.protocolRequestRun(
      this.protocol.queryLintRuleDetails(ruleId),
    );
    if (details === CodepolCommandController.REQUEST_SUPERSEDED) {
      return null;
    }
    if (!details) {
      await this.host.errorShow(`No Codepol lint rule details are available for ${ruleId}.`);
      return null;
    }

    const model = lintRuleDetailsPanelViewModelCreate({
      details,
    });
    this.panels.showLintRuleDetails(model);
    return details;
  }

  async showLintRuleDiagnosticFixes(
    input: LintRuleDiagnosticQuickFixCommandInput,
  ): Promise<CodepolProtocolQuickFixAction | null> {
    const actions = await this.protocolRequestRun(
      this.protocol.queryCodeActions({
        uri: input.uri,
        range: input.range,
      }),
    );
    if (actions === CodepolCommandController.REQUEST_SUPERSEDED) {
      return null;
    }

    const sortedActions = [...actions].sort(lintRuleQuickFixesSort);
    if (sortedActions.length === 0) {
      await this.host.infoShow(
        `No Codepol quick fixes are available for ${input.ruleId} at this diagnostic.`,
      );
      return null;
    }

    const selectedAction =
      sortedActions.length === 1
        ? sortedActions[0]
        : await this.host.quickPick({
            title: `Quick Fix: ${input.ruleId}`,
            placeholder: 'Select a Codepol quick fix to apply',
            items: sortedActions.map((action) => ({
              label: action.title,
              description: action.isPreferred ? 'Preferred quick fix' : 'Quick fix',
              detail: input.message,
              value: action,
            })),
          });
    if (!selectedAction) {
      return null;
    }

    await this.protocol.applyEditPlan(selectedAction.planId);
    return selectedAction;
  }

  async renameCodepolEntity(
    options: RenameCommandOptions = {},
  ): Promise<WorkspacePrepareRenameResult | WorkspaceRenamePreviewResult | null> {
    const selection = await this.renameTargetResolve(options.target);
    if (!selection) {
      return null;
    }

    const prepare = await this.protocolRequestRun(
      this.protocol.prepareRename(selection.target),
    );
    if (prepare === CodepolCommandController.REQUEST_SUPERSEDED) {
      return null;
    }
    if (!prepare) {
      await this.host.errorShow(
        selection.kind === 'workspace_package'
          ? this.featureUnavailableMessageResolve(
              'workspacePackageRename',
              'Codepol rename is not available for this workspace yet.',
            )
          : 'Codepol rename is not available for this workspace yet.',
      );
      return null;
    }
    if (!prepare.ok) {
      await this.host.errorShow(prepare.message);
      return prepare;
    }

    const newName =
      options.newName ??
      (await this.host.renamePrompt({
        title: `Rename ${selection.label}`,
        value: prepare.currentName,
        namingRules: namingRulesCreate(prepare),
      }));
    if (newName === undefined) {
      return prepare;
    }

    const preview = await this.protocolRequestRun(
      this.protocol.previewRename(selection.target, newName),
    );
    if (preview === CodepolCommandController.REQUEST_SUPERSEDED) {
      return prepare;
    }
    if (!preview) {
      await this.host.errorShow('Rename preview is not available for this workspace yet.');
      return null;
    }

    if (
      options.autoApply === true &&
      preview.ok &&
      preview.canApply &&
      preview.plan
    ) {
      await this.protocol.applyEditPlan(preview.plan.id);
      await this.host.infoShow(`Applied rename for ${selection.label}.`);
      return preview;
    }

    const model = renamePreviewPanelViewModelCreate({
      candidate: selection,
      prepare,
      preview,
    });
    this.panels.showRenamePreview(model);
    return preview;
  }

  private async renameTargetResolve(
    target?: WorkspaceSupportedRenameTarget,
  ): Promise<RenameTargetCandidate | undefined> {
    const renameGate = codepolFeatureGateResolve(
      this.host.readinessSnapshotGet(),
      'workspacePackageRename',
    );

    if (target) {
      if (target.semanticClass === 'domain_entity' && renameGate.blocked) {
        await this.host.errorShow(renameGate.message!);
        return undefined;
      }
      return {
        kind:
          target.semanticClass === 'domain_entity'
            ? 'workspace_package'
            : 'config_target',
        label: target.targetId,
        description: '',
        detail: '',
        target,
      };
    }

    const candidates = await this.host.renameTargetsLoad();
    if (candidates.length === 0) {
      await this.host.errorShow('No renameable Codepol targets were discovered in the current workspace.');
      return undefined;
    }

    if (!renameGate.blocked) {
      return this.host.renameTargetPick(candidates);
    }

    const configTargets = candidates.filter(
      (candidate) => candidate.kind === 'config_target',
    );
    if (configTargets.length === 0) {
      await this.host.errorShow(renameGate.message!);
      return undefined;
    }

    const workspacePackageCount = candidates.length - configTargets.length;
    if (workspacePackageCount > 0) {
      await this.host.infoShow(
        `${renameGate.message!} Config target rename is still available.`,
      );
    }
    return this.host.renameTargetPick(configTargets);
  }
}
