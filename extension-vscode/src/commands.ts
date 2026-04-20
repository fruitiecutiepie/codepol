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
  WorkspaceSymbolDescriptorKind,
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
import {
  dependencyPathPanelViewModelCreate,
  type DependencyPathPanelMaxPaths,
  type DependencyPathPanelViewModel,
} from './dependencyPathViewModels';
import {
  deadModulesPanelViewModelCreate,
  type DeadModulesPanelViewModel,
} from './deadModulesViewModels';
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

export type DependencyPathPanelRebuilder = (
  input: { maxPaths: DependencyPathPanelMaxPaths },
) => Promise<DependencyPathPanelViewModel | null>;

export type DeadModulesPanelRebuilder = (
  input: { entryPointUris?: string[] },
) => Promise<DeadModulesPanelViewModel | null>;

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
  showDependencyPath(
    input: DependencyPathPanelViewModel,
    rebuilder?: DependencyPathPanelRebuilder,
  ): void;
  showDeadModules(
    input: DeadModulesPanelViewModel,
    rebuilder?: DeadModulesPanelRebuilder,
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
  /**
   * Multi-select picker for the dead-modules panel's "Configure entry
   * points..." button. Items show the workspace-relative path; values
   * are file URIs. Returns the chosen URIs in pick order, or
   * `undefined` when the user cancels.
   */
  multiSelectPick?<T>(input: {
    title: string;
    placeholder?: string;
    items: Array<{
      label: string;
      description?: string;
      detail?: string;
      picked?: boolean;
      value: T;
    }>;
  }): Promise<T[] | undefined>;
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
  /**
   * Phase 6 cycle highlight, captured by the rebuilder closure. Stays
   * constant across re-renders triggered by control messages
   * (filter/layout/blast-radius changes) because the cycle the user
   * clicked on does not move.
   */
  cycleHighlightUris?: readonly string[];
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
      ...(input.cycleHighlightUris !== undefined
        ? { cycleHighlightUris: input.cycleHighlightUris }
        : {}),
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
  /**
   * Symbol kinds that have a meaningful type hierarchy. Used by the
   * `showTypeHierarchy` cursor-path guard — non-eligible kinds (e.g.
   * `function`, `variable`) bail with a friendly error instead of
   * opening an empty panel. The set is intentionally narrow — adding
   * kinds here is a deliberate design choice, not a copy-paste
   * change. Method-override hierarchies, when they ship, will be a
   * separate command rather than a kind extension here.
   */
  private static readonly HIERARCHY_KINDS = new Set<WorkspaceSymbolDescriptorKind>([
    'class',
    'interface',
    'type',
  ]);

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

  /**
   * "Peek architecture" command. Three caller paths converge here:
   *
   * 1. CodeLens click on the architecture lens (head-of-file): one
   *    string argument with the file URI, no position.
   * 2. Per-export CodeLens click: `{ uri, position }` argument
   *    pointing at the declaration identifier.
   * 3. Editor `editor/context` menu (right-click): no arguments;
   *    cursor URI + position read from `host.activeUriGet` /
   *    `host.activePositionGet`.
   *
   * When a `position` is available (paths 2 and 3), the controller
   * resolves the symbol via `querySymbolAtPosition` and delegates to:
   *
   * - `showCallGraph` for `function | method` symbols
   * - `showTypeHierarchy` for `class | interface | type` symbols
   * - the file-level impact-radius peek for any other kind, or when
   *   the cursor does not resolve to a symbol
   *
   * Path 1 always falls through to the file-level peek.
   *
   * Backwards-compatible: bare `string` arguments are still accepted
   * by the registered command handler (`extension.ts` parses `string |
   * { uri, position }` before forwarding), so existing CodeLens / smoke
   * test paths keep working.
   */
  async peekArchitecture(
    args?: { uri?: string; position?: WorkspacePosition },
  ): Promise<ArchitectureLinksPanelViewModel | null> {
    const targetUri = args?.uri ?? this.host.activeUriGet();
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

    // Symbol-aware routing: when the caller supplied a position
    // (per-export CodeLens, right-click menu) try to resolve the
    // cursor symbol and delegate to the right panel.
    const cursorPosition = args?.position ?? this.host.activePositionGet();
    if (cursorPosition) {
      const positionResult = await this.protocolRequestRun(
        this.protocol.querySymbolAtPosition({
          uri: targetUri,
          position: cursorPosition,
        }),
      );
      if (positionResult === CodepolCommandController.REQUEST_SUPERSEDED) {
        return null;
      }
      const symbol = positionResult?.symbol;
      if (symbol) {
        if (symbol.kind === 'function' || symbol.kind === 'method') {
          await this.showCallGraph({
            symbolId: symbol.symbolId,
            focusSymbolName: symbol.name.length > 0 ? symbol.name : '<anonymous>',
          });
          return null;
        }
        if (CodepolCommandController.HIERARCHY_KINDS.has(symbol.kind)) {
          await this.showTypeHierarchy({
            symbolId: symbol.symbolId,
            focusSymbolName: symbol.name.length > 0 ? symbol.name : '<anonymous>',
          });
          return null;
        }
        // Other kinds (variable, const, enumMember, etc.): fall
        // through to the file-level peek so the user always sees
        // *something* relevant when they peek an export.
      }
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
   * Open the Architecture Links panel scoped to a single import cycle.
   *
   * Invoked by the Phase 6 "Show full cycle" code action on
   * `codepol/architecture` cycle diagnostics. The action passes every
   * cycle member URI in `args.memberUris`; the controller picks the
   * alphabetically-first member as the focus URI (matches the cycle
   * anchor convention from `noCyclesCheck`), runs the standard impact
   * radius + summary fan-out, and hands the rebuilder a
   * `cycleHighlightUris` set so the panel renders the cycle members
   * in full opacity and dims the rest.
   *
   * Returns `null` when:
   * - `args.memberUris` is missing or empty (defensive: a malformed
   *   command invocation should be surfaced via the error host, not
   *   crash the extension)
   * - The architecture-links feature is gated off
   * - The supersession sentinel is observed before the panel can open
   */
  async showArchitectureCycle(
    args?: { memberUris?: string[] },
  ): Promise<ArchitectureLinksPanelViewModel | null> {
    const memberUris = args?.memberUris ?? [];
    if (memberUris.length === 0) {
      await this.host.errorShow(
        'Codepol: Show Full Cycle was invoked without any cycle members.',
      );
      return null;
    }

    const blockedMessage = this.featureBlockedMessageResolve('architectureLinks');
    if (blockedMessage) {
      await this.host.errorShow(blockedMessage);
      return null;
    }

    // Anchor on the alphabetically-first member so the focus URI
    // matches the diagnostic anchor noCyclesCheck picks. Keeping the
    // rest of the list in its incoming order preserves any intent the
    // caller had about presentation order in the panel side panel.
    const focusUri =
      memberUris
        .slice()
        .sort((left, right) =>
          left < right ? -1 : left > right ? 1 : 0,
        )[0] ?? memberUris[0]!;

    const [impactRadius, references, hover, summary] = await Promise.all([
      this.protocolRequestRun(
        this.protocol.queryImpactRadius({
          uri: focusUri,
          direction: 'both',
          depth: 2,
        }),
      ),
      this.protocolOptionalRequestRun(
        this.protocol.querySemanticReferences(focusUri),
      ),
      this.protocolOptionalRequestRun(this.protocol.querySemanticHover(focusUri)),
      this.protocolOptionalRequestRun(this.protocol.queryArchitectureSummary()),
    ]);
    if (impactRadius === CodepolCommandController.REQUEST_SUPERSEDED) {
      return null;
    }

    const buildModel = architectureLinksRebuilderCreate({
      uri: focusUri,
      references: references ?? null,
      hover: hover ?? null,
      graph: impactRadius ?? null,
      summary: summary ?? null,
      cycleHighlightUris: memberUris,
    });
    // Default to layered for cycle peeks because the radial focus
    // canvas hides nodes that are not adjacent to the focus URI, which
    // would obscure cycle members two hops away.
    const model = buildModel({ filters: {}, layoutMode: 'layered' });
    this.panels.showArchitectureLinks(model, buildModel);
    return model;
  }

  /**
   * Open the dedicated dependency-path panel scoped to the source URI
   * (`fromUri`) the caller passes via `args` (sidebar action / Command
   * Palette) or to the active editor URI. When `args.toUri` is missing
   * the controller drives a quick-pick over the workspace-indexed file
   * set so the user can choose the destination interactively. The
   * `maxPaths` chip in the panel re-fires the rebuilder to ask for a
   * different cap.
   */
  async showDependencyPath(
    args?: {
      fromUri?: string;
      toUri?: string;
      maxPaths?: DependencyPathPanelMaxPaths;
    },
  ): Promise<DependencyPathPanelViewModel | null> {
    const blockedMessage = this.featureBlockedMessageResolve('architectureLinks');
    if (blockedMessage) {
      await this.host.errorShow(blockedMessage);
      return null;
    }

    const fromUri = args?.fromUri ?? this.host.activeUriGet();
    if (!fromUri) {
      await this.host.errorShow(
        'Open a workspace file before requesting a dependency path.',
      );
      return null;
    }

    // Pull the indexed-file set from the existing dependency graph so
    // the picker only offers files Codepol actually knows about.
    const graph = await this.protocolOptionalRequestRun(
      this.protocol.queryDependencyGraph(),
    );
    if (!graph) {
      await this.host.errorShow(
        this.featureUnavailableMessageResolve(
          'architectureLinks',
          'Codepol does not have a workspace dependency graph yet.',
        ),
      );
      return null;
    }
    const fromNode = graph.nodes.find((node) => node.uri === fromUri);
    if (!fromNode) {
      await this.host.errorShow(
        'Codepol has not indexed the active file yet.',
      );
      return null;
    }
    const nodeRelGet = (uri: string): string => {
      return (
        graph.nodes.find((node) => node.uri === uri)?.workspaceRelativePath ??
        uri
      );
    };

    let toUri = args?.toUri;
    if (!toUri) {
      const items = graph.nodes
        .filter((node) => node.uri !== fromUri)
        .map((node) => ({
          label: node.workspaceRelativePath,
          description: node.uri,
          value: node.uri,
        }))
        .sort((left, right) => left.label.localeCompare(right.label));
      const picked = await this.host.quickPick({
        title: `Dependency path from ${fromNode.workspaceRelativePath}`,
        placeholder: `Choose the file you want to reach from ${fromNode.workspaceRelativePath}`,
        items,
      });
      if (!picked) {
        return null;
      }
      toUri = picked;
    }
    const targetToUri = toUri;

    const initialMaxPaths: DependencyPathPanelMaxPaths = args?.maxPaths ?? 5;

    const buildModel = async (
      input: { maxPaths: DependencyPathPanelMaxPaths },
    ): Promise<DependencyPathPanelViewModel | null> => {
      const result = await this.protocolRequestRun(
        this.protocol.queryDependencyPath({
          fromUri,
          toUri: targetToUri,
          maxPaths: input.maxPaths,
        }),
      );
      if (result === CodepolCommandController.REQUEST_SUPERSEDED) return null;
      if (!result) return null;
      return dependencyPathPanelViewModelCreate({
        result,
        fromUri,
        toUri: targetToUri,
        fromWorkspaceRelativePath: nodeRelGet(fromUri),
        toWorkspaceRelativePath: nodeRelGet(targetToUri),
        nodeWorkspaceRelativePathGet: nodeRelGet,
        maxPaths: input.maxPaths,
      });
    };

    const initial = await buildModel({ maxPaths: initialMaxPaths });
    if (!initial) {
      await this.host.errorShow(
        this.featureUnavailableMessageResolve(
          'architectureLinks',
          'Codepol could not compute a dependency path.',
        ),
      );
      return null;
    }
    this.panels.showDependencyPath(initial, buildModel);
    return initial;
  }

  /**
   * Open the dedicated dead-modules panel. Defaults to the workspace's
   * natural entry points; the panel header carries control buttons that
   * re-fire `queryDeadModules` with caller-supplied entry points.
   */
  async showDeadModules(
    args?: { entryPointUris?: string[] },
  ): Promise<DeadModulesPanelViewModel | null> {
    const blockedMessage = this.featureBlockedMessageResolve('architectureLinks');
    if (blockedMessage) {
      await this.host.errorShow(blockedMessage);
      return null;
    }

    // The graph is optional: when present we resolve workspace-relative
    // paths through it; otherwise we fall back to the URI itself in the
    // view model.
    const graph = await this.protocolOptionalRequestRun(
      this.protocol.queryDependencyGraph(),
    );
    const nodeRelGet = (uri: string): string => {
      return (
        graph?.nodes.find((node) => node.uri === uri)?.workspaceRelativePath ??
        uri
      );
    };

    const initialEntryPointUris = args?.entryPointUris;

    const buildModel = async (
      input: { entryPointUris?: string[] },
    ): Promise<DeadModulesPanelViewModel | null> => {
      const result = await this.protocolRequestRun(
        this.protocol.queryDeadModules({
          entryPointUris: input.entryPointUris,
        }),
      );
      if (result === CodepolCommandController.REQUEST_SUPERSEDED) return null;
      if (!result) return null;
      return deadModulesPanelViewModelCreate({
        result,
        entryPointUris: input.entryPointUris,
        nodeWorkspaceRelativePathGet: nodeRelGet,
      });
    };

    const initial = await buildModel({ entryPointUris: initialEntryPointUris });
    if (!initial) {
      await this.host.errorShow(
        this.featureUnavailableMessageResolve(
          'architectureLinks',
          'Codepol could not compute the dead-module set.',
        ),
      );
      return null;
    }
    this.panels.showDeadModules(initial, buildModel);
    return initial;
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
      // Guard the cursor path only — the CodeLens path (when
      // `args.symbolId` is supplied) is trusted because the
      // type-hierarchy CodeLens only fires on declarations whose
      // surface text already matches `class | interface | type`.
      // This mirrors the `showCallGraph` symmetry where the lens
      // path is also unguarded.
      if (!CodepolCommandController.HIERARCHY_KINDS.has(cursor.kind)) {
        await this.host.errorShow(
          'Type hierarchy is only available for classes, interfaces, and type aliases.',
        );
        return null;
      }
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
  ): Promise<
    | {
        symbolId: string;
        name: string;
        kind: WorkspaceSymbolDescriptorKind;
      }
    | null
  > {
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
    return {
      symbolId: symbol.symbolId,
      name: symbol.name,
      kind: symbol.kind,
    };
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
