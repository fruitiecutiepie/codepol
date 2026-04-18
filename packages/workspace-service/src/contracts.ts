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
  WorkspaceSearchResult,
  WorkspaceSemanticDefinitionResult,
  WorkspaceSemanticHoverResult,
  WorkspaceSemanticReferencesResult,
  WorkspaceSymbolResult,
  WorkspaceTypeHierarchyDirection,
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
};
