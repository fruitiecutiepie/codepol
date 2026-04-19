import type {
  ClientSessionId,
  CodepolConfig,
  DaemonSessionId,
  IndexStatusResult,
  PolicyFile,
  PolicyViolation,
  WorkspaceApplyResult,
  WorkspaceArchitectureSummaryResult,
  WorkspaceCallGraphDirection,
  WorkspaceCodeAction,
  WorkspaceDeadModulesResult,
  WorkspaceDependencyDiffResult,
  WorkspaceDependencyGraphResult,
  WorkspaceDependencyPathResult,
  WorkspaceDiagnostic,
  WorkspaceImpactRadiusDirection,
  WorkspaceInstanceId,
  WorkspaceLintRuleDetailsResult,
  WorkspaceLintRulesResult,
  WorkspacePrepareRenameResult,
  WorkspaceRenamePreviewResult,
  WorkspaceRenameTarget,
  WorkspacePosition,
  WorkspaceSearchResult,
  WorkspaceSemanticDefinitionResult,
  WorkspaceSemanticHoverResult,
  WorkspaceSemanticReferencesResult,
  WorkspaceSymbolAtPositionResult,
  WorkspaceSymbolDescriptorKind,
  WorkspaceSymbolFlowDirection,
  WorkspaceSymbolFlowResult,
  WorkspaceSymbolLookupResult,
  WorkspaceSymbolResult,
  WorkspaceSymbolsInFileWithCallCountsResult,
  WorkspaceTypeHierarchyDirection,
  WorkspaceTypeHierarchyEdgeConfidence,
} from '@codepol/core';

export type WorkspaceClientKind = 'lsp' | 'cli' | 'test';

export type WorkspaceDiagnosticsSubscriptionScope = 'workspace';

export type WorkspaceDiagnosticsSubscriptionResult = {
  workspaceId: string;
  workspaceInstanceId: WorkspaceInstanceId;
  scope: WorkspaceDiagnosticsSubscriptionScope;
  subscriptionState: 'active';
};

export type WorkspacePolicyCheckOptions = {
  config?: CodepolConfig;
  configPath: string;
  fix: boolean;
  cwd: string;
};

export type WorkspacePolicyCheckResult = {
  policy: PolicyFile;
  files: string[];
  violations: PolicyViolation[];
  treeViolations: PolicyViolation[];
  workspaceDiagnostics: WorkspaceDiagnostic[];
  eslintOutput: string;
  eslintHasErrors: boolean;
};

export type WorkspaceReplayResult = {
  workspaceId: string;
  workspaceInstanceId: WorkspaceInstanceId;
  replayEpoch: number;
  replayState: 'applied';
};

export type WorkspaceService = {
  registerClientSession: (input: {
    clientKind: WorkspaceClientKind;
    clientInstanceId: string;
    clientSessionId?: ClientSessionId;
  }) => Promise<{ clientSessionId: ClientSessionId; daemonSessionId: DaemonSessionId }>;
  closeClientSession: (input: { clientSessionId: ClientSessionId }) => Promise<void>;
  attachWorkspace: (input: {
    clientSessionId: ClientSessionId;
    rootPath: string;
    configPath: string;
  }) => Promise<{ workspaceId: string; workspaceInstanceId: WorkspaceInstanceId }>;
  subscribeDiagnostics: (input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    workspaceInstanceId: WorkspaceInstanceId;
    scope: WorkspaceDiagnosticsSubscriptionScope;
  }) => Promise<WorkspaceDiagnosticsSubscriptionResult>;
  completeReplay: (input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    workspaceInstanceId: WorkspaceInstanceId;
  }) => Promise<WorkspaceReplayResult>;
  openOverlay: (input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
    version: number;
    text: string;
  }) => Promise<void>;
  updateOverlay: (input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
    version: number;
    text: string;
  }) => Promise<void>;
  closeOverlay: (input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
  }) => Promise<void>;
  queryDiagnostics: (input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri?: string;
    requestId?: string;
    documentVersion?: number;
    signal?: AbortSignal;
  }) => Promise<WorkspaceDiagnostic[]>;
  queryCodeActions: (input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
    version: number;
    diagnosticIds?: string[];
    requestId?: string;
    signal?: AbortSignal;
  }) => Promise<WorkspaceCodeAction[]>;
  planSourceFixAll: (input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
    version: number;
    requestId?: string;
    signal?: AbortSignal;
  }) => Promise<WorkspaceCodeAction | null>;
  planFileFixAll: (input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
    version: number;
    includeRuleIds?: string[];
    requestId?: string;
    signal?: AbortSignal;
  }) => Promise<WorkspaceCodeAction | null>;
  applyEditPlan: (input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    planId: string;
    documentVersions: Record<string, number>;
    requestId?: string;
    signal?: AbortSignal;
  }) => Promise<WorkspaceApplyResult>;
  queryIndexStatus: (input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }) => Promise<IndexStatusResult>;
  queryLintRules: (input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }) => Promise<WorkspaceLintRulesResult>;
  queryLintRuleDetails: (input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    ruleId: string;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }) => Promise<WorkspaceLintRuleDetailsResult | null>;
  queryWorkspaceSymbols: (input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    query: string;
    limit?: number;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }) => Promise<WorkspaceSymbolResult[]>;
  queryDependencyGraph: (input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }) => Promise<WorkspaceDependencyGraphResult>;
  queryImpactRadius: (input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
    direction: WorkspaceImpactRadiusDirection;
    depth?: number;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }) => Promise<WorkspaceDependencyGraphResult>;
  queryDependencyPath: (input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    fromUri: string;
    toUri: string;
    maxPaths?: number;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }) => Promise<WorkspaceDependencyPathResult>;
  queryDeadModules: (input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    entryPointUris?: string[];
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }) => Promise<WorkspaceDeadModulesResult>;
  /**
   * Diff the live workspace dependency graph against a baseline.
   *
   * The baseline is identified by either:
   *
   * - a `baselineLabel` previously written to the workspace's snapshot
   *   store (sidecar at `<rootPath>/.codepol/graph-snapshots/`), or
   * - an inline `baselineGraph` payload (a captured
   *   {@link WorkspaceDependencyGraphResult}, e.g. from
   *   `codepol graph export` on another git ref). The inline form lets
   *   CI compare without writing to the snapshot store.
   *
   * Exactly one of the two must be supplied; passing both is rejected.
   */
  queryDependencyDiff: (input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    baselineLabel?: string;
    baselineGraph?: WorkspaceDependencyGraphResult;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }) => Promise<WorkspaceDependencyDiffResult>;
  /**
   * Symbol-level call graph centered on a stable symbol identifier.
   *
   * Returns a {@link WorkspaceDependencyGraphResult} so the panel can
   * render call graphs with the same render path used for the
   * file-level dependency graph. Nodes carry the synthetic URI
   * `codepol-symbol://<symbolId>` plus optional `symbolId`,
   * `symbolName`, `symbolKind`, and `declarationUri` fields. Edges are
   * oriented `from = caller`, `to = callee` regardless of the requested
   * traversal direction.
   *
   * Fidelity caveat: this is the structural call graph derived from the
   * tree-sitter index. Dynamic dispatch, higher-order calls, and calls
   * that cross re-exports are not tracked in MVP. See Phase 7 / open
   * question Q5 in the architecture-graph TODO note for the
   * over-approximation strategy that may follow.
   */
  queryCallGraph: (input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    symbolId: string;
    direction: WorkspaceCallGraphDirection;
    depth?: number;
    /**
     * When true, fail with a structured error
     * `{ code: 'type-aware-source-missing', languageId }` when no
     * `TypeAwareCallGraphSource` is registered for the seed symbol's
     * language. When false / absent (the default), the workspace
     * silently falls back to the structural-only result so behavior is
     * byte-identical to today.
     */
    requireTypeAware?: boolean;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }) => Promise<WorkspaceDependencyGraphResult>;
  /**
   * Symbol-level type hierarchy centered on a stable symbol identifier
   * (typically a class or interface declaration).
   *
   * Returns a {@link WorkspaceDependencyGraphResult} so the panel can
   * reuse its rendering pipeline. Edges are oriented
   * `from = subtype/child`, `to = supertype/parent` so a visual
   * top-to-bottom layout matches the natural reading direction of an
   * `extends` / `implements` chain.
   *
   * Fidelity caveat: only `extends` / `implements` relations that
   * resolved to a concrete symbol target during indexing are followed.
   * Structural typing and conditional types are not modeled.
   */
  queryTypeHierarchy: (input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    symbolId: string;
    direction: WorkspaceTypeHierarchyDirection;
    depth?: number;
    /**
     * Phase 9.4 / Gap 3. When `true`, structural-shape edges from the
     * cross-file member-shape comparison are included in the result
     * (tagged `typeRelationConfidence: 'structural-shape'`). Default
     * `false` — guarantees byte-identical output to today's result for
     * every existing caller.
     */
    includeStructural?: boolean;
    /**
     * Phase 9.4 / 9.5. Filter edges by minimum confidence tier. Default
     * `'declared'`. Values:
     *
     * - `'declared'`: keep only declared edges. Equivalent to today's
     *   default behavior.
     * - `'structural-shape'`: keep declared and structural-shape edges
     *   (set `includeStructural: true` first).
     * - `'type-aware'`: keep only type-aware edges (typically used to
     *   verify a {@link TypeAwareTypeHierarchySource} contributed
     *   results).
     */
    minConfidence?: WorkspaceTypeHierarchyEdgeConfidence;
    /**
     * Phase 9.5. When `true`, fail with a structured error
     * `{ code: 'type-aware-source-missing', languageId }` when no
     * {@link TypeAwareTypeHierarchySource} is registered for the seed
     * symbol's language. When `false` / absent (the default), the
     * workspace silently falls back to the structural answer (declared
     * edges + opt-in shape match).
     */
    requireTypeAware?: boolean;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }) => Promise<WorkspaceDependencyGraphResult>;
  querySemanticSearch: (input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    query: string;
    limit?: number;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }) => Promise<WorkspaceSearchResult[]>;
  querySemanticDefinition: (input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }) => Promise<WorkspaceSemanticDefinitionResult | null>;
  querySemanticReferences: (input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }) => Promise<WorkspaceSemanticReferencesResult | null>;
  querySemanticHover: (input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }) => Promise<WorkspaceSemanticHoverResult | null>;
  prepareRename: (input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    target: WorkspaceRenameTarget;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }) => Promise<WorkspacePrepareRenameResult>;
  previewRename: (input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    target: WorkspaceRenameTarget;
    newName: string;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }) => Promise<WorkspaceRenamePreviewResult>;
  queryArchitectureSummary: (input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }) => Promise<WorkspaceArchitectureSummaryResult>;
  /**
   * "Function-as-argument" flow surface (Phase 9.1 / Gap 1).
   *
   * Surfaces the `SymbolFlowRelation` data the index extracts as a
   * separate edge stream from the call graph. Answers two distinct
   * questions depending on `direction`:
   *
   * - `'outgoing'`: list flow sites where `symbolId` is passed as an
   *   argument (e.g. `arr.forEach(handler)` ⇒ `handler` flows out).
   * - `'incoming'`: list flow sites whose receiving call resolves to
   *   `symbolId` (e.g. callbacks passed to this function).
   *
   * Distinct from `queryCallGraph` — the flow surface does NOT
   * fabricate call-graph edges from argument flow, and the call graph
   * does NOT include flow sites in its edges.
   */
  querySymbolFlow: (input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    symbolId: string;
    direction: WorkspaceSymbolFlowDirection;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }) => Promise<WorkspaceSymbolFlowResult>;
  /**
   * Symbol-id discovery by name (with optional kind / file scope).
   *
   * Closes the Phase 7 "symbol-id discovery is out of scope for MVP"
   * gap: editor surfaces (CodeLens, hover, peek) can resolve a stable
   * symbol id from a user-visible name without walking file-level
   * structures by hand. The returned descriptors share the same shape
   * as the symbol fields on {@link WorkspaceDependencyGraphNode}, so
   * callers can feed the result straight into `queryCallGraph` /
   * `queryTypeHierarchy` without translation.
   *
   * Sorted by `(declarationUri, byteRange.start)` for determinism.
   * Trimmed to {@link limit} (default 50) — pick a smaller value when
   * you only need a single deterministic best match. The query never
   * fans out across re-exports; callers that need to follow re-export
   * chains must use `symbolCanonicalIdGet` on the returned id.
   */
  querySymbolLookup: (input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    name: string;
    kind?: WorkspaceSymbolDescriptorKind;
    /** Restrict the lookup to a single file's declarations. */
    scopeUri?: string;
    /** Maximum descriptors to return. Defaults to 50. */
    limit?: number;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }) => Promise<WorkspaceSymbolLookupResult>;
  /**
   * Symbol-id discovery by editor cursor position.
   *
   * Returns the smallest (innermost) indexed symbol whose declaration
   * byte range contains {@link position} in {@link uri}. Returns
   * `{ symbol: undefined }` when the position is on whitespace,
   * inside a comment, in an unindexed file, or outside any
   * declaration. Mirrors the inline byte-range containment check the
   * Phase 5 CodeLens already performs.
   */
  querySymbolAtPosition: (input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
    position: WorkspacePosition;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }) => Promise<WorkspaceSymbolAtPositionResult>;
  /**
   * Per-symbol structural caller/callee counts for every function or
   * method declared in `uri`. One round-trip backs the editor's
   * per-symbol CodeLens — without this batched query, the lens would
   * fan out N RPCs per file open (one `queryCallGraph` per symbol).
   *
   * Sort order is `(declarationRange.start.line, character, symbolId)`
   * so two runs on byte-identical input produce byte-identical output
   * and the editor can lay out lenses deterministically. Empty array
   * for files with no indexed function/method declarations (never
   * `undefined`).
   *
   * Counts come from the structural call graph and silently upgrade
   * when a `TypeAwareCallGraphSource` binding is wired — there is no
   * `requireTypeAware` option here on purpose: editor CodeLenses must
   * never fail on missing type-aware data.
   */
  querySymbolsInFileWithCallCounts: (input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }) => Promise<WorkspaceSymbolsInFileWithCallCountsResult>;
};
