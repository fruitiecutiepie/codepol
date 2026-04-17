import type {
  ClientSessionId,
  CodepolConfig,
  DaemonSessionId,
  IndexStatusResult,
  PolicyFile,
  PolicyViolation,
  WorkspaceApplyResult,
  WorkspaceArchitectureSummaryResult,
  WorkspaceCodeAction,
  WorkspaceDependencyGraphResult,
  WorkspaceDiagnostic,
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
  eslintConfigPath?: string;
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
