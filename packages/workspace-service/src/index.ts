import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import chokidar from 'chokidar';
import {
  DEFAULT_EXTENSIONS,
  ESLINT_PLUGIN_NAME_DEFAULT,
  configCacheClear,
  configGet,
  configGetFromPath,
  configParseFromSource,
  crossFileResolveForFile,
  indexStoreNew,
  isErr,
  diagnosticsRuntimeGet,
  lintDiagnosticToWorkspaceDiagnostic,
  moduleDeadModulesCompute,
  moduleDependencyDiffCompute,
  moduleDependencyPathCompute,
  moduleImpactRadiusCompute,
  moduleInstabilityCompute,
  moduleLongestChainCompute,
  moduleSccSizeDistributionCompute,
  symbolCallGraphCompute,
  symbolImportersCompute,
  symbolTypeHierarchyCompute,
  policyArchitectureViolationsGetFromDir,
  pluginsMapHasArchitectureProvider,
  pluginGetForRule,
  policyPluginsGet,
  policyViolationsGetForFile,
  policyRuleTargetsResolve,
  policyViolationToWorkspaceDiagnostic,
  policyViolationsGetFromDir,
  projectIndexBuildSync,
  projectIndexCreate,
  projectIndexRemoveFiles,
  projectIndexStoreRestore,
  projectIndexStoreSnapshotCreate,
  projectIndexUpdateFileFromSource,
  projectIndexUpdateFileSync,
  ruleMatchesGet,
  treeCheckProviderSupportsLanguage,
  workspaceIdCreate,
  workspacePackageMapCreate,
  workspacePathToUri,
  workspacePositionToByteOffset,
  workspaceRangeFromByteRange,
  workspacePackageMapDiscover,
  workspacePackageRecordFromManifestSource,
  workspacePackageRecordsDiscover,
  workspaceUriToPath,
  type ClientSessionId,
  type CodepolConfig,
  type DaemonSessionId,
  type EslintProviderConfig,
  type FixProvider,
  type IndexStatusFeatureStatus,
  type IndexCapabilities,
  type IndexStatusResult,
  type LintDiagnostic,
  type LintProvider,
  type LintSeverity,
  type ModuleGraph,
  type PolicyFile,
  type PolicyPluginDeclaration,
  type PolicyPluginsMap,
  type PolicyRule,
  type PolicyRuleTargetContext,
  type PolicyViolation,
  type ProjectIndex,
  type Result,
  type RuffProviderConfig,
  type RuleMatch,
  type WorkspacePackageRecord,
  type WorkspaceApplyResult,
  type WorkspaceArchitectureSummaryComplexityHotspot,
  type WorkspaceArchitectureSummaryHotspot,
  type WorkspaceArchitectureSummaryInstability,
  type WorkspaceArchitectureSummaryLongestChain,
  type WorkspaceArchitectureSummaryResult,
  type WorkspaceCodeAction,
  type WorkspaceDeadModulesResult,
  type WorkspaceDependencyDiffResult,
  type WorkspaceDependencyGraphEdge,
  type WorkspaceDependencyGraphEdgeKind,
  type WorkspaceDependencyGraphNode,
  type WorkspaceDependencyGraphNodeMetrics,
  type WorkspaceDependencyGraphResult,
  type WorkspaceDependencyPathResult,
  type WorkspaceImpactRadiusDirection,
  type WorkspaceImportSpecifierDescriptor,
  type WorkspaceImportSpecifiersInFileResult,
  type WorkspaceCallGraphDirection,
  type WorkspaceTypeHierarchyDirection,
  type WorkspaceTypeHierarchyEdgeConfidence,
  type WorkspaceDiagnostic,
  type WorkspaceDiagnosticSeverity,
  type WorkspaceFeatureStatus,
  type WorkspaceEditPlan,
  type WorkspacePrepareRenameFailure,
  type WorkspacePrepareRenameResult,
  type WorkspaceRenamePreviewGroup,
  type WorkspaceRenamePreviewFailure,
  type WorkspaceRenamePreviewResult,
  type WorkspaceRenamePreviewSuccess,
  type WorkspaceRenameTarget,
  type WorkspaceSemanticDefinitionResult,
  type WorkspaceSemanticHoverResult,
  type WorkspaceSemanticReferenceGroup,
  type WorkspaceSemanticReferenceItem,
  type WorkspaceSemanticReferencesGroup,
  type WorkspaceSemanticReferencesResult,
  type WorkspaceSemanticTarget,
  type WorkspaceInstanceId,
  type WorkspaceLintRuleDetailsResult,
  type WorkspaceLintRuleDiagnosticGroup,
  type WorkspaceLintRuleProviderSummary,
  type WorkspaceLintRulesResult,
  type WorkspaceLintRuleSummary,
  type WorkspacePosition,
  type WorkspaceSearchResult,
  type WorkspaceSymbolAtPositionResult,
  type WorkspaceSymbolDescriptor,
  type WorkspaceSymbolDescriptorKind,
  type WorkspaceSymbolFlowDirection,
  type WorkspaceSymbolFlowEdge,
  type WorkspaceSymbolFlowResult,
  type WorkspaceSymbolLookupResult,
  type WorkspaceSymbolResult,
  type WorkspaceSymbolWithCallCounts,
  type WorkspaceSymbolsInFileWithCallCountsResult,
  type WorkspaceSymbolImporterCountResult,
  type ImportBindingRelation,
  type SymbolFlowRelation,
  type SymbolId,
  type SymbolKind,
  type SymbolRecord,
  type TypeAwareCallEdge,
  type TypeAwareCallGraphSource,
  type TypeAwareCallGraphSourceRegistry,
  type TypeAwareCallKind,
  type TypeAwareTypeHierarchyEdge,
  type TypeAwareTypeHierarchySource,
  type TypeAwareTypeHierarchySourceRegistry,
  type BiomeProviderConfig,
  typeAwareCallGraphSourceRegistryCreate,
  typeAwareTypeHierarchySourceRegistryCreate,
} from '@codepol/core';
import { biomeCheckAsync, biomeFixAsync } from '@codepol/plugin-biome';
import { eslintPluginCreate } from '@codepol/plugin-eslint';
import { ruffCheckAsync, ruffFixAsync } from '@codepol/plugin-ruff';
import {
  fixAllContributionFromViolation,
  treeCheckFixesApply,
  workspaceEditPlanCreateFromFix,
  workspaceFixAllActionCreate,
} from './edits';
import {
  ruleFixModeResolverCreate,
  type RuleFixModeResolver,
} from './fixMode';
import { workspaceFileLineCountGet } from './dependencyGraphLoc';
import {
  builtinPluginArtifactPathsResolve,
  builtinPluginsRefresh,
  ensureWorkspaceRuntimeReady,
} from './runtime';
import {
  WORKSPACE_WARM_CACHE_COMPAT_VERSION,
  type WorkspaceWarmCacheAnalyzerEntry,
  type WorkspaceWarmCacheAnalyzerFileEntry,
  type WorkspaceWarmCacheAnalyzerKey,
  type WorkspaceWarmCacheAnalyzerKeyTuple,
  type WorkspaceWarmCacheExternalToolConfigEntry,
  type WorkspaceWarmCacheFileFingerprint,
  type WorkspaceWarmCacheSnapshot,
  type WorkspaceWarmCacheStore,
} from './warmCache';
import {
  fileSystemGraphSnapshotStoreCreate as graphSnapshotStoreCreateInternal,
  graphSnapshotFromDependencyGraphResult as graphSnapshotFromGraphInternal,
  graphSnapshotWorkspaceRootIdCompute as graphSnapshotWorkspaceRootIdComputeInternal,
} from './graphSnapshotStore';
import type {
  WorkspaceTypeAwareBridgeDefinition,
  WorkspaceTypeAwareBridgeExecutionContext,
  WorkspaceTypeAwareBridgeLifecycle,
  WorkspaceTypeAwareBridgeRegistration,
  WorkspaceTypeAwareBridgeSymbolTable,
} from './typeAwareBridgeHost';
import {
  WORKSPACE_TYPE_AWARE_BRIDGE_DEFINITIONS_DEFAULT,
} from './typeAwareBridgeHost';

export * from './daemon';
export {
  daemonSelfWatchEntryFileStart,
  daemonExitOnFirstWasmAbortInstall,
  type DaemonExitOnFirstWasmAbortOptions,
  type DaemonSelfWatchDispose,
  type DaemonSelfWatchEntryFileOptions,
} from './daemonSelfWatch';
export { builtinPluginsRefresh, ensureWorkspaceRuntimeReady } from './runtime';
export * from './warmCache';
export * from './typeAwareBridgeHost';
export {
  fileSystemGraphSnapshotStoreCreate,
  graphSnapshotFromDependencyGraphResult,
  graphSnapshotLabelSanitize,
  graphSnapshotWorkspaceRootIdCompute,
  type GraphSnapshotStore,
} from './graphSnapshotStore';

const BIOME_FILE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx'];
const ESLINT_BRIDGE_RULE_ID = '@codepol/plugin/eslint';
const BIOME_BRIDGE_RULE_ID = '@codepol/plugin/biome';
const RUFF_BRIDGE_RULE_ID = '@codepol/plugin/ruff';
/**
 * Bridge rule id per external analyzer. Used by `externalToolConfigsResolve`
 * to walk `policy.rules` and collect every `args.configPath` that should
 * participate in warm-cache fingerprinting and file-watcher invalidation.
 */
const EXTERNAL_BRIDGE_RULE_IDS: Readonly<Record<WorkspaceExternalToolAnalyzerKey, string>> = {
  eslint: ESLINT_BRIDGE_RULE_ID,
  biome: BIOME_BRIDGE_RULE_ID,
  ruff: RUFF_BRIDGE_RULE_ID,
};
const PYTHON_FILE_EXTENSIONS = ['.py', '.pyw'];
const WORKSPACE_WATCH_IGNORED = ['**/node_modules/**', '**/.git/**'];
const WORKSPACE_SYMBOL_LIMIT_DEFAULT = 50;
const WORKSPACE_SEARCH_LIMIT_DEFAULT = 20;
const WORKSPACE_SEMANTIC_REFERENCES_TOTAL_LIMIT = 200;
const WORKSPACE_SEMANTIC_REFERENCES_GROUP_LIMIT = 50;
const WORKSPACE_NATIVE_OWNERSHIP_LANGUAGES = ['javascript', 'jsx', 'typescript', 'tsx'];
const WORKSPACE_CONFIG_RENAME_TARGET_ID_PREFIX = 'target:';
const WORKSPACE_CONFIG_RENAME_TARGET_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;
const WORKSPACE_CONFIG_RENAME_TARGET_SEGMENT_DESCRIPTION =
  'bare TOML key segment ([A-Za-z0-9_-]+)';
const WORKSPACE_PACKAGE_RENAME_TARGET_ID_PREFIX = 'package:';
const WORKSPACE_PACKAGE_NAME_PATTERN =
  /^(?:@[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?\/)?[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;
const WORKSPACE_PACKAGE_NAME_DESCRIPTION =
  'npm package name (lowercase, optional @scope/name)';

function workspaceRequestCancelledErrorCreate(): Error {
  return new Error('Request cancelled');
}

function workspaceAbortSignalThrowIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw workspaceRequestCancelledErrorCreate();
  }
}

type LintProviderEntry = {
  provider: LintProvider;
  ruleId: string;
  ruleArgs?: unknown;
  severity?: LintSeverity;
  /**
   * Reference to the source policy rule this entry was derived from. Used for
   * per-group file scoping in external analyzers: `RuleMatch.rule` is compared
   * by reference identity against `entry.rule` so two policy rules that share
   * a ruleId but differ in args/targets remain distinguishable per group.
   */
  rule: PolicyRule;
};

type AnalyzerGroup<TConfig> = {
  /** Stable key identifying the resolved-config identity of this group. */
  key: string;
  /** Resolved provider config shared by every entry in the group. */
  config: TConfig;
  /** Entries (policy-rule derived) that share this resolved config. */
  entries: LintProviderEntry[];
  /**
   * Source policy rules contributing to this group, used to select files from
   * `RuleMatch[]` by reference identity (not ruleId string).
   */
  rules: Set<PolicyRule>;
};

type EslintAnalyzerGroup = {
  key: string;
  /** Absolute path to the ESLint config file for this group. */
  configPath: string;
  /** Bridge + non-bridge ESLint entries effective for this group. */
  entries: LintProviderEntry[];
  /** Only the bridge rules for this group (used for file scoping). */
  rules: Set<PolicyRule>;
};

type WorkspaceAnalyzerFixMode = 'none' | 'inline' | 'external';

type WorkspaceAnalyzerStatus = 'ran' | 'skipped' | 'failed';

type WorkspaceAnalyzerSkippedReason =
  | 'native_preferred'
  | 'no_matching_rules'
  | 'no_matching_files';

type WorkspaceAnalyzerScorecardEntry = {
  analyzerId: string;
  platform: 'codepol_tree' | 'eslint' | 'biome' | 'ruff';
  languages: string[];
  ownedRuleIds: string[];
  skippedRuleIds: string[];
  skippedReason?: WorkspaceAnalyzerSkippedReason;
  diagnosticCount: number;
  violationCount: number;
  issueCount: number;
  fileCount: number;
  fixMode: WorkspaceAnalyzerFixMode;
  status: WorkspaceAnalyzerStatus;
  latencyMs: number;
  issues: string[];
};

type WorkspaceAnalyzerRunResult = {
  diagnostics: WorkspaceDiagnostic[];
  fixableTreeViolationsByDiagnosticId: Map<string, PolicyViolation>;
  hasErrors: boolean;
  issues: string[];
  output: string;
  scorecard: WorkspaceAnalyzerScorecardEntry;
  treeViolations: PolicyViolation[];
  violations: PolicyViolation[];
};

type WorkspaceAnalyzerInventoryOwnership = 'native_preferred' | 'keep_wrapped';

type WorkspaceAnalyzerInventoryEntry = {
  ruleId: string;
  languages: string[];
  wrappedPlatforms: string[];
  hasNativeOwner: boolean;
  ownership: WorkspaceAnalyzerInventoryOwnership;
  recentNativeDiagnosticCount: number;
  recentWrappedDiagnosticCount: number;
  recentNativeLatencyMs: number;
  recentWrappedLatencyMs: number;
  fixSurfaceNotes: string[];
};

type WorkspaceStoredEditPlan = {
  plan: WorkspaceEditPlan;
  analysisRevisionAtCreation: number;
};

type WorkspaceDocument = {
  uri: string;
  filePath: string;
  version: number;
  text: string;
};

type WorkspaceBaseIndexState = {
  files: string[];
  fileKey: string;
  workspacePackages: Map<string, string>;
  workspacePackageRecords?: WorkspacePackageRecord[];
};

type WorkspaceIndexState = {
  store: ReturnType<typeof indexStoreNew>;
  index: ProjectIndex;
  capabilities: IndexCapabilities;
  files: string[];
  fileKey: string;
  workspacePackages: Map<string, string>;
};

type WorkspaceAnalysis = {
  analyzerInventory: WorkspaceAnalyzerInventoryEntry[];
  analyzerScorecard: WorkspaceAnalyzerScorecardEntry[];
  policy: PolicyFile;
  files: string[];
  violations: PolicyViolation[];
  treeViolations: PolicyViolation[];
  diagnostics: WorkspaceDiagnostic[];
  featureStatus: IndexStatusFeatureStatus;
  fixableTreeViolationsByDiagnosticId: Map<string, PolicyViolation>;
  eslintOutput: string;
  eslintHasErrors: boolean;
};

type WorkspaceLintRuleSummaryBuilderState = {
  ruleId: string;
  severities: Set<LintSeverity>;
  targetPatterns: Set<string>;
  providers: Map<string, WorkspaceLintRuleProviderSummary>;
  languages: Set<string>;
  hasNativeOwner: boolean;
  fixSurfaceNotes: Set<string>;
};

/**
 * Discriminator for external linter analyzers whose tool-config files
 * participate in warm-cache fingerprinting and file-watcher invalidation.
 *
 * Mirrors `WorkspaceAnalyzerCacheKey` minus `'tree'` (which has no external
 * config file).
 */
export type WorkspaceExternalToolAnalyzerKey = 'eslint' | 'biome' | 'ruff';

/**
 * One external tool config file referenced by the policy. Resolved to an
 * absolute path against the policy config directory at workspace-context
 * construction time. The orchestrator collects these from the bridge rules
 * (`@codepol/plugin/{eslint,biome,ruff}`) via `externalToolConfigsResolve`.
 */
export type WorkspaceExternalToolConfigEntry = {
  analyzerId: WorkspaceExternalToolAnalyzerKey;
  configPath: string;
};

type WorkspaceContextState = {
  rootPath: string;
  configPath: string;
  /**
   * External tool config files referenced by the policy's bridge rules,
   * sorted by `(analyzerId, configPath)` and deduped. Drives both warm-cache
   * fingerprinting and file-watcher path coverage.
   */
  externalToolConfigs: WorkspaceExternalToolConfigEntry[];
  config: CodepolConfig;
  baseIndexState?: WorkspaceBaseIndexState;
};

type WorkspaceDocumentsState = {
  documents: Map<string, WorkspaceDocument>;
};

/**
 * Per-(analyzer, filePath) cache key. Bundles the file's content fingerprint
 * with every global invariant the analyzer's output depends on. A miss on any
 * field forces a recompute, which is how config / plugin / external-tool
 * changes invalidate cached entries without explicit clear-cache wiring.
 */
type WorkspaceAnalyzerCacheKeyTuple = {
  contentFingerprint: string;
  configFingerprint: string;
  pluginFingerprint: string;
  toolFingerprintKey: string;
  // Tree-only: included for analyzers that consume the project index. Empty
  // string when the analyzer does not depend on the index.
  treeIndexFingerprint: string;
};

type WorkspaceAnalyzerFileCacheEntry = {
  key: WorkspaceAnalyzerCacheKeyTuple;
  violations: PolicyViolation[];
  diagnostics: WorkspaceDiagnostic[];
  treeViolations: PolicyViolation[];
  fixableTreeViolationsByDiagnosticId: Map<string, PolicyViolation>;
  // ESLint only — needed to recompute `eslintHasErrors` from the merged set.
  errorCount?: number;
};

type WorkspaceAnalyzerCacheEntry = {
  // Structural scorecard fields that do not depend on per-file results
  // (analyzerId, platform, languages, ownedRuleIds, skippedRuleIds, skippedReason,
  // fixMode). The orchestrator overlays counts/latency/status on top.
  scorecardTemplate: WorkspaceAnalyzerScorecardEntry;
  fileResults: Map<string, WorkspaceAnalyzerFileCacheEntry>;
};

type WorkspaceAnalyzerCacheKey = 'tree' | 'eslint' | 'biome' | 'ruff';

export type WorkspaceAnalyzerCache = Partial<
  Record<WorkspaceAnalyzerCacheKey, WorkspaceAnalyzerCacheEntry>
>;

type WorkspaceFileFingerprintCacheEntry = {
  size: number;
  mtimeMs: number;
  contentFingerprint: string;
};

type WorkspaceAnalysisCacheState = {
  analysisGeneration: number;
  lastAnalysis?: WorkspaceAnalysis;
  indexState?: WorkspaceIndexState;
  workspaceIndexRequired?: boolean;
  toolFingerprints?: WorkspaceWarmCacheFileFingerprint[];
  // Per-(analyzer, filePath) cache. Each entry's key tuple is checked at
  // lookup time; mismatches naturally miss without explicit invalidation.
  analyzerCache?: WorkspaceAnalyzerCache;
  // Hint set: file paths whose disk content may have changed since the cache
  // was last validated. Forces the orchestrator to re-stat (and re-hash on
  // size/mtime drift) instead of trusting fileFingerprintCache. Cleared after
  // every successful run.
  dirtyFiles?: Set<string>;
  // Memoised disk fingerprints so we only sha1 a file when its size or mtime
  // actually changed. Files in dirtyFiles bypass this cache.
  fileFingerprintCache?: Map<string, WorkspaceFileFingerprintCacheEntry>;
};

export type WorkspaceClientKind = 'lsp' | 'cli' | 'test';

export type WorkspaceWatcher = {
  on: (
    event: 'all' | 'error',
    listener: ((eventName: string, filePath: string) => void) | ((error: Error) => void),
  ) => WorkspaceWatcher;
  close: () => Promise<void> | void;
};

export type WorkspaceWatcherCreate = (input: {
  rootPath: string;
  configPath: string;
  /**
   * Absolute paths of external tool config files (eslint / biome / ruff) that
   * the policy references via bridge rules. Listed as additional watch
   * targets so changes to deep tool configs (e.g. nested `biome.json` or
   * `pyproject.toml`) trigger invalidation even when the watcher is
   * shallowly rooted at the workspace.
   */
  externalToolConfigPaths: string[];
}) => WorkspaceWatcher;

/**
 * Pluggable timer pair used by the engine's per-workspace persist debouncer.
 * Defaults to `setTimeout` / `clearTimeout`. Tests inject a manual queue so
 * the 2s debounce window can be advanced synchronously (matching the
 * `backgroundTaskSchedule` injection pattern).
 */
export type WorkspaceServiceEngineTimers = {
  setTimeout: (handler: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

export type WorkspaceServiceEngineOptions = {
  watcherCreate?: WorkspaceWatcherCreate;
  backgroundWarmup?: boolean;
  backgroundTaskSchedule?: (task: () => Promise<void>) => void;
  warmCache?: WorkspaceWarmCacheStore;
  timers?: WorkspaceServiceEngineTimers;
  /**
   * Type-aware call-graph source registry (Phase 9.2 / Gap 1).
   * Optional — when omitted, the engine creates a fresh empty
   * registry. Hosts that share one registry across multiple engine
   * instances pass it explicitly.
   */
  typeAwareCallGraphSourceRegistry?: TypeAwareCallGraphSourceRegistry;
  /**
   * Type-aware type-hierarchy source registry (Phase 9.5 / Gap 3).
   * Optional — when omitted, the engine creates a fresh empty
   * registry. Independent of `typeAwareCallGraphSourceRegistry`;
   * registering one does not require or affect the other.
   */
  typeAwareTypeHierarchySourceRegistry?: TypeAwareTypeHierarchySourceRegistry;
};

type WorkspaceSessionState = WorkspaceDocumentsState &
  WorkspaceAnalysisCacheState & {
    workspaceId: string;
    workspaceInstanceId: WorkspaceInstanceId;
    replayEpoch: number;
    replayState: 'pending' | 'applied';
    editPlans: Map<string, WorkspaceStoredEditPlan>;
    status: IndexStatusResult['status'];
    lastError?: string;
    analysisRevision: number;
    backgroundWarmupRunning?: boolean;
    backgroundWarmupQueued?: boolean;
  };

type WorkspaceState = WorkspaceContextState & {
  workspaceId: string;
  workspaceInstanceId: WorkspaceInstanceId;
  attachedClientSessionIds: Set<ClientSessionId>;
  configDirty?: boolean;
  watcher?: WorkspaceWatcher;
  watchItemsKey?: string;
};

type ClientSessionState = {
  clientSessionId: ClientSessionId;
  clientKind: WorkspaceClientKind;
  clientInstanceId: string;
  workspaces: Map<string, WorkspaceSessionState>;
};

type PolicyCheckWorkspaceState = WorkspaceContextState &
  WorkspaceDocumentsState &
  WorkspaceAnalysisCacheState;

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
   * Diff the live dependency graph against a baseline. Caller chooses
   * the baseline source: either a `baselineLabel` previously written to
   * the per-workspace snapshot store, or an inline `baselineGraph`
   * payload (e.g. captured from `codepol graph export` on another git
   * ref). Exactly one of the two must be supplied.
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
  queryCallGraph: (input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    symbolId: string;
    direction: WorkspaceCallGraphDirection;
    depth?: number;
    requireTypeAware?: boolean;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }) => Promise<WorkspaceDependencyGraphResult>;
  querySymbolFlow: (input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    symbolId: string;
    direction: WorkspaceSymbolFlowDirection;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }) => Promise<WorkspaceSymbolFlowResult>;
  queryTypeHierarchy: (input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    symbolId: string;
    direction: WorkspaceTypeHierarchyDirection;
    depth?: number;
    /** Phase 9.4 / Gap 3 — opt-in shape match. Default false. */
    includeStructural?: boolean;
    /** Phase 9.4 / 9.5 — minimum confidence tier. Default 'declared'. */
    minConfidence?: WorkspaceTypeHierarchyEdgeConfidence;
    /** Phase 9.5 — fail when no type-aware source is registered. */
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
  querySymbolLookup: (input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    name: string;
    kind?: WorkspaceSymbolDescriptorKind;
    scopeUri?: string;
    limit?: number;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }) => Promise<WorkspaceSymbolLookupResult>;
  querySymbolAtPosition: (input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
    position: WorkspacePosition;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }) => Promise<WorkspaceSymbolAtPositionResult>;
  querySymbolsInFileWithCallCounts: (input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }) => Promise<WorkspaceSymbolsInFileWithCallCountsResult>;
  queryImportSpecifiersInFile: (input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }) => Promise<WorkspaceImportSpecifiersInFileResult>;
  querySymbolImporterCount: (input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    symbolId: string;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }) => Promise<WorkspaceSymbolImporterCountResult>;
};

export type WorkspaceServiceCreateOptions = {
  engine?: WorkspaceServiceEngine;
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

export type WorkspaceDiagnosticsSubscriptionScope = 'workspace';

export type WorkspaceDiagnosticsSubscriptionResult = {
  workspaceId: string;
  workspaceInstanceId: WorkspaceInstanceId;
  scope: WorkspaceDiagnosticsSubscriptionScope;
  subscriptionState: 'active';
};

export type WorkspaceFeatureStatusState = {
  status: 'cold' | 'warming' | 'ready' | 'error';
  lastError?: string;
  lastAnalysis?: {
    featureStatus: IndexStatusFeatureStatus;
  };
  workspaceIndexRequired?: boolean;
};

export type WorkspaceDocumentVersionState = {
  documents: Map<
    string,
    {
      version: number;
    }
  >;
};

export type WorkspaceAnalysisGenerationState = {
  analysisGeneration: number;
};

function fileHasExtension(filePath: string, extensions: string[]): boolean {
  return extensions.some((extension) => filePath.endsWith(extension));
}

export function severityFromLintSeverity(
  severity?: LintSeverity,
): WorkspaceDiagnosticSeverity {
  if (severity === 'warn') {
    return 'warning';
  }
  return 'error';
}

/**
 * Drop the session analyzer caches without disturbing workspace-level state
 * such as `toolFingerprints`, `indexState`, the tree-sitter parser pool, or
 * `workspaceIndexRequired`. Used when a global invariant (config / eslint
 * config / plugin manifest) changed and we want session status to flip back to
 * `cold` even though the tuple-keyed cache would also miss naturally.
 */
function workspaceStateAnalysisInvalidateAll(state: WorkspaceAnalysisCacheState): void {
  state.lastAnalysis = undefined;
  state.analyzerCache = undefined;
  state.dirtyFiles = undefined;
}

/**
 * Mark file paths as dirty so the next run forces a fresh content fingerprint
 * (bypassing fileFingerprintCache). The per-(analyzer, file) cache entries
 * themselves are NOT removed — the tuple lookup decides hit vs miss.
 */
function workspaceStateAnalysisInvalidateFiles(
  state: WorkspaceAnalysisCacheState,
  filePaths: Iterable<string>,
): void {
  if (!state.dirtyFiles) {
    state.dirtyFiles = new Set();
  }
  for (const filePath of filePaths) {
    if (!filePath) {
      continue;
    }
    state.dirtyFiles.add(filePath);
  }
}

/**
 * Drop a single analyzer's bucket from the per-(analyzer, file) cache and
 * force `lastAnalysis` to be re-merged on the next run. Other analyzers'
 * buckets keep their per-file entries so unaffected files continue to hit.
 *
 * Used by the file watcher when an external tool config (eslint / biome /
 * ruff) changes on disk: only that tool's results are stale, but every other
 * analyzer's per-file output is still valid.
 */
function workspaceStateAnalyzerCacheInvalidate(
  state: WorkspaceAnalysisCacheState,
  analyzerKey: WorkspaceAnalyzerCacheKey,
): void {
  if (state.analyzerCache) {
    delete state.analyzerCache[analyzerKey];
  }
  state.lastAnalysis = undefined;
}

function workspaceFeatureStatusCreate(
  input: {
    readiness: WorkspaceFeatureStatus['readiness'];
    detail?: string;
  },
): WorkspaceFeatureStatus {
  return {
    readiness: input.readiness,
    detail: input.detail,
  };
}

export function workspaceFeatureStatusReadyOrDegraded(
  issues: string[],
  options: {
    readyDetail?: string;
  } = {},
): WorkspaceFeatureStatus {
  if (issues.length > 0) {
    return workspaceFeatureStatusCreate({
      readiness: 'degraded',
      detail: issues.join('; '),
    });
  }
  return workspaceFeatureStatusCreate({
    readiness: 'ready',
    detail: options.readyDetail,
  });
}

export function workspaceIndexBackedFeatureStatusCreate(input: {
  indexReady: boolean;
  indexRequired: boolean;
}): WorkspaceFeatureStatus {
  if (input.indexReady) {
    return workspaceFeatureStatusCreate({
      readiness: 'ready',
    });
  }
  if (input.indexRequired) {
    return workspaceFeatureStatusCreate({
      readiness: 'degraded',
      detail: 'Workspace index required but unavailable',
    });
  }
  return workspaceFeatureStatusCreate({
    readiness: 'cold',
    detail: 'Workspace index not built for this session',
  });
}

export function workspaceFeatureStatusesCreate(
  state: WorkspaceFeatureStatusState,
): IndexStatusFeatureStatus {
  if (state.status === 'ready' && state.lastAnalysis) {
    return state.lastAnalysis.featureStatus;
  }
  if (state.status === 'error') {
    return {
      diagnostics: workspaceFeatureStatusCreate({
        readiness: 'error',
        detail: state.lastError,
      }),
      codeActions: workspaceFeatureStatusCreate({
        readiness: 'error',
        detail: state.lastError,
      }),
      editPlans: workspaceFeatureStatusCreate({
        readiness: 'error',
        detail: state.lastError,
      }),
      workspaceIndex: workspaceFeatureStatusCreate({
        readiness: 'error',
        detail: state.lastError,
      }),
      workspaceSymbols: workspaceFeatureStatusCreate({
        readiness: 'error',
        detail: state.lastError,
      }),
      semanticSearch: workspaceFeatureStatusCreate({
        readiness: 'error',
        detail: state.lastError,
      }),
      dependencyGraph: workspaceFeatureStatusCreate({
        readiness: 'error',
        detail: state.lastError,
      }),
      architectureSummary: workspaceFeatureStatusCreate({
        readiness: 'error',
        detail: state.lastError,
      }),
    };
  }
  const indexBackedReadiness =
    state.workspaceIndexRequired === false ? 'cold' : state.status;
  const indexBackedDetail =
    state.workspaceIndexRequired === false
      ? 'Workspace index not built for this session'
      : undefined;
  return {
    diagnostics: workspaceFeatureStatusCreate({
      readiness: state.status,
    }),
    codeActions: workspaceFeatureStatusCreate({
      readiness: state.status,
    }),
    editPlans: workspaceFeatureStatusCreate({
      readiness: state.status,
    }),
    workspaceIndex:
      state.workspaceIndexRequired === false
        ? workspaceFeatureStatusCreate({
            readiness: 'ready',
            detail: 'Not required by current policy',
          })
        : workspaceFeatureStatusCreate({
            readiness: state.status,
          }),
    workspaceSymbols: workspaceFeatureStatusCreate({
      readiness: indexBackedReadiness,
      detail: indexBackedDetail,
    }),
    semanticSearch: workspaceFeatureStatusCreate({
      readiness: indexBackedReadiness,
      detail: indexBackedDetail,
    }),
    dependencyGraph: workspaceFeatureStatusCreate({
      readiness: indexBackedReadiness,
      detail: indexBackedDetail,
    }),
    architectureSummary: workspaceFeatureStatusCreate({
      readiness: indexBackedReadiness,
      detail: indexBackedDetail,
    }),
  };
}

function workspaceSessionInvalidate(
  state: WorkspaceSessionState,
  options: {
    clearIndexState?: boolean;
    bumpAnalysisRevision?: boolean;
    clearWorkspaceIndexRequirement?: boolean;
    // When provided, narrow invalidation: just mark these file paths dirty.
    // Per-analyzer cache entries survive; the orchestrator decides hit vs
    // miss via the cache key tuple at the next run.
    dirtyFiles?: Iterable<string>;
    // When provided, drop only the listed analyzers' buckets from the
    // per-(analyzer, file) cache. Other analyzers' per-file results remain
    // valid. Used by the file watcher when an external tool config (eslint /
    // biome / ruff) changes on disk: only that tool's results are stale.
    invalidateAnalyzers?: Iterable<WorkspaceAnalyzerCacheKey>;
    // When true, drop all session analyzer caches even if dirtyFiles is set.
    // Used by callers that know a global invariant changed (config / plugin
    // manifest). Tuple keys would also miss naturally, but flushing is needed
    // so session status flips back to 'cold' immediately.
    flushAnalyzerCache?: boolean;
  } = {},
): void {
  if (options.clearIndexState) {
    state.indexState = undefined;
  }
  if (options.clearWorkspaceIndexRequirement) {
    state.workspaceIndexRequired = undefined;
  }
  if (options.bumpAnalysisRevision ?? true) {
    state.analysisRevision += 1;
    if (state.backgroundWarmupRunning) {
      state.backgroundWarmupQueued = true;
    }
  }
  const flushRequested =
    options.flushAnalyzerCache === true ||
    options.clearWorkspaceIndexRequirement === true;
  if (flushRequested) {
    // Caller signalled that a global invariant changed (config / plugin /
    // index requirement). Drop the session analyzer caches so status flips
    // back to 'cold'.
    workspaceStateAnalysisInvalidateAll(state);
  } else if (options.invalidateAnalyzers !== undefined) {
    // Per-analyzer invalidation: drop only the listed analyzers' buckets.
    // `lastAnalysis` is dropped so status flips to 'cold' and the next run
    // re-merges fresh outputs from the named analyzers with cached entries
    // from the others.
    for (const analyzerKey of options.invalidateAnalyzers) {
      workspaceStateAnalyzerCacheInvalidate(state, analyzerKey);
    }
    if (options.dirtyFiles !== undefined) {
      workspaceStateAnalysisInvalidateFiles(state, options.dirtyFiles);
    }
  } else if (options.dirtyFiles !== undefined) {
    workspaceStateAnalysisInvalidateFiles(state, options.dirtyFiles);
  }
  // Otherwise: leave lastAnalysis and analyzerCache intact. Tuple keys will
  // re-validate at the next run; e.g. clearIndexState alone shifts the tree
  // analyzer's treeIndexFingerprint slice and naturally misses tree entries
  // while leaving eslint/biome/ruff entries valid.
  state.status = 'cold';
  state.lastError = undefined;
}

function workspaceExternalToolConfigPathsExtract(
  externalToolConfigs: ReadonlyArray<WorkspaceExternalToolConfigEntry>,
): string[] {
  return externalToolConfigs.map((entry) => entry.configPath);
}

function workspaceWatchItemsResolve(workspace: {
  rootPath: string;
  configPath: string;
  externalToolConfigs: ReadonlyArray<WorkspaceExternalToolConfigEntry>;
}): string[] {
  const items = new Set<string>();
  items.add(path.resolve(workspace.rootPath));
  items.add(path.resolve(workspace.configPath));
  for (const toolConfigPath of workspaceExternalToolConfigPathsExtract(
    workspace.externalToolConfigs,
  )) {
    items.add(path.resolve(toolConfigPath));
  }
  return [...items].sort();
}

function workspaceWatchItemsKeyCreate(workspace: {
  rootPath: string;
  configPath: string;
  externalToolConfigs: ReadonlyArray<WorkspaceExternalToolConfigEntry>;
}): string {
  return workspaceWatchItemsResolve(workspace).join('\0');
}

export function workspaceWatcherCreate(input: {
  rootPath: string;
  configPath: string;
  externalToolConfigPaths: string[];
}): WorkspaceWatcher {
  const watchItems = workspaceWatchItemsResolve({
    rootPath: input.rootPath,
    configPath: input.configPath,
    externalToolConfigs: input.externalToolConfigPaths.map((configPath) => ({
      // analyzerId is irrelevant to the watch list itself; the dispatch logic
      // owns the path -> analyzer mapping. Stamp a stable placeholder so
      // dedupe still works when callers pass mixed eslint/biome/ruff paths.
      analyzerId: 'eslint' as WorkspaceExternalToolAnalyzerKey,
      configPath,
    })),
  });
  return chokidar.watch(watchItems, {
    ignoreInitial: true,
    ignored: WORKSPACE_WATCH_IGNORED,
    // Recursive chokidar scans can exhaust file descriptors on remote Linux
    // workspaces before the daemon finishes warming up. Keep the daemon watch
    // surface shallow and rely on open-document overlays for active editor
    // changes instead of walking the entire repository tree.
    depth: 0,
  }) as unknown as WorkspaceWatcher;
}

async function workspaceWatcherClose(workspace: WorkspaceState): Promise<void> {
  const watcher = workspace.watcher;
  workspace.watcher = undefined;
  workspace.watchItemsKey = undefined;
  if (!watcher) {
    return;
  }
  await watcher.close();
}

async function workspaceContextRefreshFromDisk(workspace: WorkspaceState): Promise<void> {
  if (!workspace.configDirty) {
    return;
  }
  configCacheClear();
  const { config, configPath: resolvedConfigPath } = await configGetFromPath(workspace.configPath);
  workspace.config = config;
  workspace.configPath = resolvedConfigPath;
  workspace.externalToolConfigs = externalToolConfigsResolve(
    resolvedConfigPath,
    config,
  );
  workspace.baseIndexState = undefined;
  workspace.configDirty = false;
}

async function workspaceWatcherEnsure(input: {
  workspace: WorkspaceState;
  watcherCreate: WorkspaceWatcherCreate;
  onInvalidate: (filePath: string) => void;
}): Promise<void> {
  const watchItemsKey = workspaceWatchItemsKeyCreate(input.workspace);
  if (input.workspace.watcher && input.workspace.watchItemsKey === watchItemsKey) {
    return;
  }
  await workspaceWatcherClose(input.workspace);
  const watcher = input.watcherCreate({
    rootPath: input.workspace.rootPath,
    configPath: input.workspace.configPath,
    externalToolConfigPaths: workspaceExternalToolConfigPathsExtract(
      input.workspace.externalToolConfigs,
    ),
  });
  watcher.on('all', (_eventName, filePath) => {
    input.onInvalidate(filePath);
  });
  // Chokidar emits EventEmitter "error" events. Without a listener those
  // errors terminate the long-lived daemon process and force endless reconnects.
  watcher.on('error', () => {});
  input.workspace.watcher = watcher;
  input.workspace.watchItemsKey = watchItemsKey;
}

function workspaceGet(
  workspaces: Map<string, WorkspaceState>,
  workspaceId: string,
): WorkspaceState {
  const workspace = workspaces.get(workspaceId);
  if (!workspace) {
    throw new Error(`Unknown workspace: ${workspaceId}`);
  }
  return workspace;
}

function clientSessionGet(
  clientSessions: Map<ClientSessionId, ClientSessionState>,
  clientSessionId: ClientSessionId,
): ClientSessionState {
  const clientSession = clientSessions.get(clientSessionId);
  if (!clientSession) {
    throw new Error(`Unknown client session: ${clientSessionId}`);
  }
  return clientSession;
}

function workspaceSessionGet(
  workspaces: Map<string, WorkspaceState>,
  clientSessions: Map<ClientSessionId, ClientSessionState>,
  clientSessionId: ClientSessionId,
  workspaceId: string,
): {
  workspace: WorkspaceState;
  clientSession: ClientSessionState;
  workspaceSession: WorkspaceSessionState;
} {
  const workspace = workspaceGet(workspaces, workspaceId);
  const clientSession = clientSessionGet(clientSessions, clientSessionId);
  const workspaceSession = clientSession.workspaces.get(workspaceId);
  if (!workspaceSession) {
    throw new Error(
      `Client session ${clientSessionId} is not attached to workspace ${workspaceId}`,
    );
  }
  return {
    workspace,
    clientSession,
    workspaceSession,
  };
}

function opaqueIdCreate(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

function biomeProviderConfigKey(config: BiomeProviderConfig | undefined): string {
  const c = config ?? {};
  return JSON.stringify({
    biomeBin: c.biomeBin ?? 'biome',
    configPath: c.configPath ?? null,
    extraArgs: c.extraArgs ?? [],
  });
}

/**
 * Resolves the effective biome provider config for a policy rule.
 *
 * Args-only semantics: any `BiomeProviderConfig`-shaped field on `entry.ruleArgs`
 * (from `codepol.toml`) replaces the plugin's static `provider.config`. Unknown
 * keys are dropped with a warning so typos surface clearly.
 */
function biomeProviderConfigResolve(entry: LintProviderEntry): BiomeProviderConfig {
  const base = (entry.provider.config ?? {}) as BiomeProviderConfig;
  const args = (entry.ruleArgs ?? {}) as Record<string, unknown>;
  const merged: BiomeProviderConfig = { ...base };
  const allowedKeys = new Set<keyof BiomeProviderConfig>([
    'biomeBin',
    'configPath',
    'extraArgs',
  ]);

  for (const [key, value] of Object.entries(args)) {
    if (!allowedKeys.has(key as keyof BiomeProviderConfig)) {
      console.warn(
        `[codepol] @codepol/plugin/biome rule "${entry.ruleId}" ignoring unknown args key "${key}".`,
      );
      continue;
    }
    if (key === 'biomeBin' || key === 'configPath') {
      if (typeof value === 'string' && value.length > 0) {
        (merged as Record<string, unknown>)[key] = value;
      }
      continue;
    }
    if (key === 'extraArgs') {
      if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
        merged.extraArgs = value as string[];
      }
      continue;
    }
  }
  return merged;
}

/**
 * Resolves the effective ruff provider config for a policy rule.
 *
 * Args-only semantics: any `RuffProviderConfig`-shaped field on `entry.ruleArgs`
 * (from `codepol.toml`) replaces the plugin's static `provider.config`. Unknown
 * keys are dropped with a warning.
 */
function ruffProviderConfigResolve(entry: LintProviderEntry): RuffProviderConfig {
  const base = (entry.provider.config ?? {}) as RuffProviderConfig;
  const args = (entry.ruleArgs ?? {}) as Record<string, unknown>;
  const merged: RuffProviderConfig = { ...base };
  const allowedKeys = new Set<keyof RuffProviderConfig>([
    'ruffBin',
    'select',
    'ignore',
    'fixable',
    'configPath',
    'extraArgs',
  ]);

  for (const [key, value] of Object.entries(args)) {
    if (!allowedKeys.has(key as keyof RuffProviderConfig)) {
      console.warn(
        `[codepol] @codepol/plugin/ruff rule "${entry.ruleId}" ignoring unknown args key "${key}".`,
      );
      continue;
    }
    if (key === 'ruffBin' || key === 'configPath') {
      if (typeof value === 'string' && value.length > 0) {
        (merged as Record<string, unknown>)[key] = value;
      }
      continue;
    }
    if (key === 'select' || key === 'ignore' || key === 'fixable' || key === 'extraArgs') {
      if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
        (merged as Record<string, unknown>)[key] = value as string[];
      }
      continue;
    }
  }
  return merged;
}

/**
 * Stable JSON identity for a resolved ruff provider config. Mirrors
 * `biomeProviderConfigKey`; any two entries that serialize to the same key
 * can safely share a single ruff invocation.
 */
function ruffProviderConfigKey(config: RuffProviderConfig | undefined): string {
  const c = config ?? {};
  return JSON.stringify({
    ruffBin: c.ruffBin ?? 'ruff',
    configPath: c.configPath ?? null,
    select: c.select ?? [],
    ignore: c.ignore ?? [],
    fixable: c.fixable ?? [],
    extraArgs: c.extraArgs ?? [],
  });
}

/**
 * Groups biome `LintProviderEntry`s by resolved-config identity. Two entries
 * that resolve to the same `BiomeProviderConfig` share a group and therefore a
 * single biome invocation; distinct configs each run in their own group.
 *
 * Unlike the prior `biomeRuleIdToConfigMapBuild`, this does NOT throw when the
 * same ruleId resolves to different configs — that is a legitimate multi-bridge
 * policy shape.
 */
function biomeGroupsBuild(
  entries: LintProviderEntry[],
): Map<string, AnalyzerGroup<BiomeProviderConfig>> {
  const groups = new Map<string, AnalyzerGroup<BiomeProviderConfig>>();
  for (const entry of entries) {
    if (entry.provider.platform !== 'biome') {
      continue;
    }
    const config = biomeProviderConfigResolve(entry);
    const key = biomeProviderConfigKey(config);
    let group = groups.get(key);
    if (!group) {
      group = { key, config, entries: [], rules: new Set<PolicyRule>() };
      groups.set(key, group);
    }
    group.entries.push(entry);
    group.rules.add(entry.rule);
  }
  return groups;
}

/**
 * Groups ruff `LintProviderEntry`s by resolved-config identity. Replaces the
 * prior first-entry-wins silent drop; each distinct `RuffProviderConfig`
 * triggers its own ruff invocation.
 */
function ruffGroupsBuild(
  entries: LintProviderEntry[],
): Map<string, AnalyzerGroup<RuffProviderConfig>> {
  const groups = new Map<string, AnalyzerGroup<RuffProviderConfig>>();
  for (const entry of entries) {
    if (entry.provider.platform !== 'ruff') {
      continue;
    }
    const config = ruffProviderConfigResolve(entry);
    const key = ruffProviderConfigKey(config);
    let group = groups.get(key);
    if (!group) {
      group = { key, config, entries: [], rules: new Set<PolicyRule>() };
      groups.set(key, group);
    }
    group.entries.push(entry);
    group.rules.add(entry.rule);
  }
  return groups;
}

/**
 * Groups eslint `LintProviderEntry`s by the bridge rule's resolved `configPath`.
 * Non-bridge eslint entries (codepol-defined ESLint rules) are rule-enablement
 * overrides that are configPath-agnostic, so they're folded into every group so
 * their overrides apply to whichever eslint config the group runs.
 *
 * Bridge entries missing a valid `args.configPath` are dropped; the analyzer
 * surfaces a migration-pointing error when the resulting group map is empty.
 */
function eslintGroupsBuild(
  entries: LintProviderEntry[],
  policyConfigPath: string,
): Map<string, EslintAnalyzerGroup> {
  const groups = new Map<string, EslintAnalyzerGroup>();
  const nonBridgeEntries: LintProviderEntry[] = [];
  for (const entry of entries) {
    if (entry.provider.platform !== 'eslint') {
      continue;
    }
    if (entry.ruleId !== ESLINT_BRIDGE_RULE_ID) {
      nonBridgeEntries.push(entry);
      continue;
    }
    const ruleArgs = (entry.ruleArgs ?? {}) as { configPath?: unknown };
    if (typeof ruleArgs.configPath !== 'string' || ruleArgs.configPath.length === 0) {
      continue;
    }
    const configPath = path.resolve(
      path.dirname(policyConfigPath),
      ruleArgs.configPath,
    );
    let group = groups.get(configPath);
    if (!group) {
      group = {
        key: configPath,
        configPath,
        entries: [],
        rules: new Set<PolicyRule>(),
      };
      groups.set(configPath, group);
    }
    group.entries.push(entry);
    group.rules.add(entry.rule);
  }
  for (const group of groups.values()) {
    for (const entry of nonBridgeEntries) {
      group.entries.push(entry);
    }
  }
  return groups;
}

/**
 * Selects files from `matches` that belong to a group by reference identity on
 * `RuleMatch.rule`, then filters by the analyzer's file extensions. Reference
 * identity (not ruleId string) is what lets two policy rules sharing a ruleId
 * but differing args live in separate groups cleanly.
 */
function analyzerGroupFilesCollect(
  groupRules: ReadonlySet<PolicyRule>,
  matches: RuleMatch[],
  extensions: string[],
): Set<string> {
  const files = new Set<string>();
  for (const match of matches) {
    if (!groupRules.has(match.rule)) {
      continue;
    }
    for (const filePath of match.files) {
      if (fileHasExtension(filePath, extensions)) {
        files.add(filePath);
      }
    }
  }
  return files;
}

const ESLINT_BRIDGE_MIGRATION_HINT =
  'Add the ESLint bridge rule to your policy:\n' +
  '\n' +
  '  [[rules]]\n' +
  '  ruleId = "@codepol/plugin/eslint"\n' +
  '  targets = ["<target-name>"]\n' +
  '  args.configPath = "./eslint.config.mjs"';

/**
 * Walks the policy rules looking for external linter bridge rules
 * (`@codepol/plugin/{eslint,biome,ruff}`) and collects every `args.configPath`
 * into a stable, deduped, sorted list.
 *
 * The returned `configPath` values are absolute, resolved against the
 * directory of the policy config file. Bridge rules without an
 * `args.configPath` contribute nothing (matches biome/ruff's "use the tool's
 * own config discovery" behavior; ESLint enforces presence at analyzer time).
 */
function externalToolConfigsResolve(
  configPath: string,
  config: CodepolConfig,
): WorkspaceExternalToolConfigEntry[] {
  const seen = new Set<string>();
  const entries: WorkspaceExternalToolConfigEntry[] = [];
  const configDir = path.dirname(configPath);

  for (const rule of config.rules) {
    for (const [analyzerId, ruleId] of Object.entries(EXTERNAL_BRIDGE_RULE_IDS) as Array<
      [WorkspaceExternalToolAnalyzerKey, string]
    >) {
      if (rule.ruleId !== ruleId) {
        continue;
      }
      const ruleArgs = (rule.args ?? {}) as { configPath?: unknown };
      if (typeof ruleArgs.configPath !== 'string' || ruleArgs.configPath.length === 0) {
        continue;
      }
      const resolvedPath = path.resolve(configDir, ruleArgs.configPath);
      const dedupeKey = `${analyzerId}\0${resolvedPath}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      entries.push({ analyzerId, configPath: resolvedPath });
    }
  }

  entries.sort((left, right) =>
    left.analyzerId === right.analyzerId
      ? left.configPath.localeCompare(right.configPath)
      : left.analyzerId.localeCompare(right.analyzerId),
  );
  return entries;
}

/**
 * Convenience wrapper for ESLint analyzer-time resolution. Returns the empty
 * string when no `@codepol/plugin/eslint` bridge rule is declared with an
 * `args.configPath`; the analyzer then produces a migration-pointing error.
 *
 * Kept as a wrapper so the analyzer's args-time resolution mirrors ruff/biome
 * (which read their own configs from `LintProviderEntry.ruleArgs`) rather
 * than reaching into `WorkspaceContextState`.
 */
function eslintBridgeConfigPathResolve(
  configPath: string,
  config: CodepolConfig,
): string {
  const eslintEntry = externalToolConfigsResolve(configPath, config).find(
    (entry) => entry.analyzerId === 'eslint',
  );
  return eslintEntry?.configPath ?? '';
}

function policyRuleTargetsGet(policy: PolicyFile): PolicyRuleTargetContext[] {
  const targets: PolicyRuleTargetContext[] = [];
  for (const rule of policy.rules) {
    const resolvedTargets = policyRuleTargetsResolve(rule, policy);
    for (const target of resolvedTargets) {
      targets.push({
        ruleId: rule.ruleId,
        description: rule.description,
        args: rule.args,
        target,
      });
    }
  }
  return targets;
}

function eslintConfigGet(
  providers: LintProviderEntry[],
  context: {
    policy: PolicyFile;
    configPath: string;
    cwd: string;
    ruleTargets: PolicyRuleTargetContext[];
  },
): Record<string, unknown> {
  const rules: Record<string, unknown> = {};

  for (const entry of providers) {
    if (entry.provider.platform !== 'eslint') {
      continue;
    }
    if (entry.ruleId === ESLINT_BRIDGE_RULE_ID) {
      // The bridge rule triggers ESLint invocation but contributes no rules
      // to the override config; the user's eslint.config.mjs drives enablement.
      continue;
    }
    const eslintConfig = entry.provider.config as EslintProviderConfig;
    const ruleNameFull = entry.ruleId;
    const lastSlashIndex = ruleNameFull.lastIndexOf('/');
    const ruleNameShort =
      lastSlashIndex !== -1 ? ruleNameFull.slice(lastSlashIndex + 1) : ruleNameFull;

    const pluginName = eslintConfig.pluginName ?? ESLINT_PLUGIN_NAME_DEFAULT;
    const configKey = `${pluginName}/${ruleNameShort}`;
    if (rules[configKey]) {
      throw new Error(`Duplicate ESLint rule configuration detected: ${configKey}.`);
    }
    const options =
      eslintConfig.ruleOptions?.({
        ...context,
        ruleId: entry.ruleId,
        ruleArgs: entry.ruleArgs,
      }) ?? {};
    const severity = entry.severity ?? 'error';
    rules[configKey] = [severity, options];
  }

  return { rules };
}

function eslintPluginRedefinitionErrorIs(error: unknown, pluginName: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes(`Cannot redefine plugin "${pluginName}"`) ||
    message.includes(`Cannot redefine plugin '${pluginName}'`)
  );
}

function policyRuleMatches(policyRuleId: string, candidateRuleId: string): boolean {
  if (policyRuleId === candidateRuleId) {
    return true;
  }
  return (
    policyRuleId.endsWith(`/${candidateRuleId}`) ||
    candidateRuleId.endsWith(`/${policyRuleId}`)
  );
}

function policyRuleGet(policy: PolicyFile, ruleId: string): PolicyRule | undefined {
  return policy.rules.find((rule) => policyRuleMatches(rule.ruleId, ruleId));
}

function workspaceLanguageIsNativeOwnershipCandidate(language: string): boolean {
  return WORKSPACE_NATIVE_OWNERSHIP_LANGUAGES.includes(language);
}

function workspaceAnalyzerRuleIdsNormalize(ruleIds: Iterable<string>): string[] {
  return [...new Set(ruleIds)].sort();
}

function workspaceAnalyzerScorecardCreate(input: {
  analyzerId: string;
  platform: WorkspaceAnalyzerScorecardEntry['platform'];
  languages: string[];
  ownedRuleIds: Iterable<string>;
  skippedRuleIds?: Iterable<string>;
  skippedReason?: WorkspaceAnalyzerSkippedReason;
  diagnosticCount?: number;
  violationCount?: number;
  fileCount?: number;
  fixMode: WorkspaceAnalyzerFixMode;
  status: WorkspaceAnalyzerStatus;
  latencyMs?: number;
  issues?: string[];
}): WorkspaceAnalyzerScorecardEntry {
  const issues = [...(input.issues ?? [])];
  return {
    analyzerId: input.analyzerId,
    platform: input.platform,
    languages: [...input.languages],
    ownedRuleIds: workspaceAnalyzerRuleIdsNormalize(input.ownedRuleIds),
    skippedRuleIds: workspaceAnalyzerRuleIdsNormalize(input.skippedRuleIds ?? []),
    skippedReason: input.skippedReason,
    diagnosticCount: input.diagnosticCount ?? 0,
    violationCount: input.violationCount ?? 0,
    issueCount: issues.length,
    fileCount: input.fileCount ?? 0,
    fixMode: input.fixMode,
    status: input.status,
    latencyMs: input.latencyMs ?? 0,
    issues,
  };
}

function workspaceAnalyzerRunResultCreate(
  scorecard: WorkspaceAnalyzerScorecardEntry,
  input: {
    diagnostics?: WorkspaceDiagnostic[];
    fixableTreeViolationsByDiagnosticId?: Map<string, PolicyViolation>;
    hasErrors?: boolean;
    output?: string;
    treeViolations?: PolicyViolation[];
    violations?: PolicyViolation[];
  } = {},
): WorkspaceAnalyzerRunResult {
  return {
    diagnostics: [...(input.diagnostics ?? [])],
    fixableTreeViolationsByDiagnosticId:
      input.fixableTreeViolationsByDiagnosticId ?? new Map<string, PolicyViolation>(),
    hasErrors: input.hasErrors ?? false,
    issues: [...scorecard.issues],
    output: input.output ?? '',
    scorecard,
    treeViolations: [...(input.treeViolations ?? [])],
    violations: [...(input.violations ?? [])],
  };
}

function workspaceAnalyzerCacheKeyTupleEquals(
  left: WorkspaceAnalyzerCacheKeyTuple,
  right: WorkspaceAnalyzerCacheKeyTuple,
): boolean {
  return (
    left.contentFingerprint === right.contentFingerprint &&
    left.configFingerprint === right.configFingerprint &&
    left.pluginFingerprint === right.pluginFingerprint &&
    left.toolFingerprintKey === right.toolFingerprintKey &&
    left.treeIndexFingerprint === right.treeIndexFingerprint
  );
}

function workspaceAnalyzerFileCacheEntryCreate(
  key: WorkspaceAnalyzerCacheKeyTuple,
): WorkspaceAnalyzerFileCacheEntry {
  return {
    key,
    violations: [],
    diagnostics: [],
    treeViolations: [],
    fixableTreeViolationsByDiagnosticId: new Map(),
  };
}

/**
 * Bucket an analyzer's per-file output (violations/diagnostics/etc.) into
 * cache entries keyed by file path. Files that the analyzer was asked to look
 * at but emitted nothing for still get a (key, empty) entry so the next run
 * can distinguish "analyzed, clean" from "never analyzed".
 *
 * The caller supplies a `keyForFile` function that computes the cache key
 * tuple per file path (typically the same global slice with the per-file
 * contentFingerprint substituted in).
 */
function workspaceAnalyzerFileResultsGroup(input: {
  filesInScope: Iterable<string>;
  keyForFile: (filePath: string) => WorkspaceAnalyzerCacheKeyTuple;
  violations: PolicyViolation[];
  diagnostics: WorkspaceDiagnostic[];
  treeViolations?: PolicyViolation[];
  fixableTreeViolationsByDiagnosticId?: Map<string, PolicyViolation>;
  errorCountByFilePath?: Map<string, number>;
}): Map<string, WorkspaceAnalyzerFileCacheEntry> {
  const map = new Map<string, WorkspaceAnalyzerFileCacheEntry>();
  for (const filePath of input.filesInScope) {
    if (!map.has(filePath)) {
      map.set(filePath, workspaceAnalyzerFileCacheEntryCreate(input.keyForFile(filePath)));
    }
  }
  const ensure = (filePath: string): WorkspaceAnalyzerFileCacheEntry => {
    let entry = map.get(filePath);
    if (!entry) {
      entry = workspaceAnalyzerFileCacheEntryCreate(input.keyForFile(filePath));
      map.set(filePath, entry);
    }
    return entry;
  };
  const length = Math.min(input.violations.length, input.diagnostics.length);
  for (let i = 0; i < length; i++) {
    const violation = input.violations[i];
    const diagnostic = input.diagnostics[i];
    const entry = ensure(violation.filePath);
    entry.violations.push(violation);
    entry.diagnostics.push(diagnostic);
  }
  if (input.treeViolations) {
    for (const violation of input.treeViolations) {
      ensure(violation.filePath).treeViolations.push(violation);
    }
  }
  if (input.fixableTreeViolationsByDiagnosticId) {
    for (const [id, violation] of input.fixableTreeViolationsByDiagnosticId) {
      ensure(violation.filePath).fixableTreeViolationsByDiagnosticId.set(id, violation);
    }
  }
  if (input.errorCountByFilePath) {
    for (const [filePath, errorCount] of input.errorCountByFilePath) {
      ensure(filePath).errorCount = errorCount;
    }
  }
  return map;
}

/**
 * Compose a per-analyzer cache entry from a freshly-run result. `filesInScope`
 * is the set of files the analyzer actually looked at this run; the cache will
 * have an entry for every one of them (empty when no violation was emitted).
 */
function workspaceAnalyzerCacheEntryCreate(input: {
  result: WorkspaceAnalyzerRunResult;
  filesInScope: Iterable<string>;
  keyForFile: (filePath: string) => WorkspaceAnalyzerCacheKeyTuple;
  errorCountByFilePath?: Map<string, number>;
}): WorkspaceAnalyzerCacheEntry {
  return {
    scorecardTemplate: input.result.scorecard,
    fileResults: workspaceAnalyzerFileResultsGroup({
      filesInScope: input.filesInScope,
      keyForFile: input.keyForFile,
      violations: input.result.violations,
      diagnostics: input.result.diagnostics,
      treeViolations: input.result.treeViolations,
      fixableTreeViolationsByDiagnosticId: input.result.fixableTreeViolationsByDiagnosticId,
      errorCountByFilePath: input.errorCountByFilePath,
    }),
  };
}

/**
 * Rebuild a `WorkspaceAnalyzerRunResult` from a per-file cache (after merging
 * fresh and cached entries). Callers supply the structural scorecard fields
 * (analyzerId/platform/etc.) plus the latency / issues from the most recent
 * partial run; counts are derived from the merged map.
 */
function workspaceAnalyzerRunResultFromCache(input: {
  fileResults: Map<string, WorkspaceAnalyzerFileCacheEntry>;
  scorecardTemplate: WorkspaceAnalyzerScorecardEntry;
  issues: string[];
  latencyMs: number;
  status?: WorkspaceAnalyzerStatus;
  output?: string;
}): WorkspaceAnalyzerRunResult {
  const violations: PolicyViolation[] = [];
  const diagnostics: WorkspaceDiagnostic[] = [];
  const treeViolations: PolicyViolation[] = [];
  const fixableTreeViolationsByDiagnosticId = new Map<string, PolicyViolation>();
  let totalErrorCount = 0;
  for (const entry of input.fileResults.values()) {
    violations.push(...entry.violations);
    diagnostics.push(...entry.diagnostics);
    treeViolations.push(...entry.treeViolations);
    for (const [id, violation] of entry.fixableTreeViolationsByDiagnosticId) {
      fixableTreeViolationsByDiagnosticId.set(id, violation);
    }
    if (entry.errorCount !== undefined) {
      totalErrorCount += entry.errorCount;
    }
  }
  const status = input.status ?? (input.issues.length > 0 ? 'failed' : input.scorecardTemplate.status);
  return workspaceAnalyzerRunResultCreate(
    workspaceAnalyzerScorecardCreate({
      analyzerId: input.scorecardTemplate.analyzerId,
      platform: input.scorecardTemplate.platform,
      languages: input.scorecardTemplate.languages,
      ownedRuleIds: input.scorecardTemplate.ownedRuleIds,
      skippedRuleIds: input.scorecardTemplate.skippedRuleIds,
      skippedReason: input.scorecardTemplate.skippedReason,
      diagnosticCount: diagnostics.length,
      violationCount: violations.length,
      fileCount: input.fileResults.size,
      fixMode: input.scorecardTemplate.fixMode,
      status,
      latencyMs: input.latencyMs,
      issues: input.issues,
    }),
    {
      diagnostics,
      fixableTreeViolationsByDiagnosticId,
      hasErrors: totalErrorCount > 0,
      output: input.output ?? '',
      treeViolations,
      violations,
    },
  );
}

function workspaceNativeOwnedWrappedRuleIdsResolve(input: {
  policy: PolicyFile;
  ruleTargets: PolicyRuleTargetContext[];
  pluginRulesMap: Awaited<ReturnType<typeof policyPluginsGet>> extends Result<infer T, string>
    ? T
    : never;
}): Set<string> {
  const ruleIds = new Set<string>();

  for (const rule of input.policy.rules) {
    const lookup = pluginGetForRule(input.pluginRulesMap, rule.ruleId);
    if (!lookup) {
      continue;
    }

    const treeCheckProvider = lookup.plugin.pluginRule.capabilities.treeCheckProvider;
    const lintProviders = lookup.plugin.pluginRule.capabilities.lintProviders ?? [];
    if (!treeCheckProvider || lintProviders.length === 0) {
      continue;
    }

    const hasNativeJsTsTarget = input.ruleTargets.some((targetContext) => {
      if (!policyRuleMatches(targetContext.ruleId, lookup.resolvedId)) {
        return false;
      }
      return (
        workspaceLanguageIsNativeOwnershipCandidate(targetContext.target.language) &&
        treeCheckProviderSupportsLanguage(treeCheckProvider, targetContext.target.language)
      );
    });
    if (!hasNativeJsTsTarget) {
      continue;
    }

    const hasWrappedJsTsProvider = lintProviders.some((provider) =>
      provider.languages.some(workspaceLanguageIsNativeOwnershipCandidate),
    );
    if (hasWrappedJsTsProvider) {
      ruleIds.add(lookup.resolvedId);
    }
  }

  return ruleIds;
}

function workspaceLintProviderEntryIsNativePreferred(
  entry: LintProviderEntry,
  nativeOwnedWrappedRuleIds: ReadonlySet<string>,
): boolean {
  return (
    nativeOwnedWrappedRuleIds.has(entry.ruleId) &&
    entry.provider.languages.some(workspaceLanguageIsNativeOwnershipCandidate)
  );
}

function workspaceAnalyzerInventoryFixSurfaceNotesResolve(input: {
  hasNativeOwner: boolean;
  pluginRule: {
    capabilities: {
      fixProvider?: FixProvider;
    };
  };
  wrappedPlatforms: string[];
}): string[] {
  const notes: string[] = [];
  if (input.hasNativeOwner) {
    notes.push('tree_check');
    notes.push('tree_only_code_actions');
  }
  if (input.pluginRule.capabilities.fixProvider) {
    notes.push('fix_provider');
  }
  for (const platform of input.wrappedPlatforms) {
    notes.push(`wrapped_external_fix:${platform}`);
  }
  return notes.sort();
}

function workspaceAnalyzerInventoryBuild(input: {
  analyzerResults: WorkspaceAnalyzerRunResult[];
  lintProviderEntries: LintProviderEntry[];
  pluginRulesMap: Awaited<ReturnType<typeof policyPluginsGet>> extends Result<infer T, string>
    ? T
    : never;
  policy: PolicyFile;
  ruleTargets: PolicyRuleTargetContext[];
}): WorkspaceAnalyzerInventoryEntry[] {
  const inventory: WorkspaceAnalyzerInventoryEntry[] = [];
  const treeResult = input.analyzerResults.find(
    (result) => result.scorecard.platform === 'codepol_tree',
  );
  const wrappedResults = input.analyzerResults.filter(
    (result) => result.scorecard.platform !== 'codepol_tree',
  );

  for (const rule of input.policy.rules) {
    const lookup = pluginGetForRule(input.pluginRulesMap, rule.ruleId);
    if (!lookup) {
      continue;
    }
    const wrappedPlatforms = workspaceAnalyzerRuleIdsNormalize(
      input.lintProviderEntries
        .filter(
          (entry) =>
            entry.ruleId === lookup.resolvedId &&
            entry.provider.languages.some(workspaceLanguageIsNativeOwnershipCandidate),
        )
        .map((entry) => entry.provider.platform),
    );
    if (wrappedPlatforms.length === 0) {
      continue;
    }

    const matchingLanguages = workspaceAnalyzerRuleIdsNormalize(
      input.ruleTargets
        .filter(
          (targetContext) =>
            policyRuleMatches(targetContext.ruleId, lookup.resolvedId) &&
            workspaceLanguageIsNativeOwnershipCandidate(targetContext.target.language),
        )
        .map((targetContext) => targetContext.target.language),
    );
    const treeCheckProvider = lookup.plugin.pluginRule.capabilities.treeCheckProvider;
    const hasNativeOwner =
      Boolean(treeCheckProvider) &&
      matchingLanguages.some((language) =>
        treeCheckProviderSupportsLanguage(treeCheckProvider!, language),
      );
    const ownership: WorkspaceAnalyzerInventoryOwnership = hasNativeOwner
      ? 'native_preferred'
      : 'keep_wrapped';

    const recentNativeDiagnosticCount =
      hasNativeOwner && treeResult
        ? treeResult.violations.filter((violation) =>
            policyRuleMatches(violation.ruleId, lookup.resolvedId),
          ).length
        : 0;
    const recentWrappedDiagnosticCount = wrappedResults
      .filter((result) =>
        result.scorecard.ownedRuleIds.includes(lookup.resolvedId),
      )
      .reduce((sum, result) => sum + result.scorecard.diagnosticCount, 0);
    const recentNativeLatencyMs =
      hasNativeOwner && treeResult && treeResult.scorecard.ownedRuleIds.includes(lookup.resolvedId)
        ? treeResult.scorecard.latencyMs
        : 0;
    const recentWrappedLatencyMs = wrappedResults
      .filter((result) =>
        result.scorecard.ownedRuleIds.includes(lookup.resolvedId) ||
        result.scorecard.skippedRuleIds.includes(lookup.resolvedId),
      )
      .reduce((sum, result) => sum + result.scorecard.latencyMs, 0);

    inventory.push({
      ruleId: lookup.resolvedId,
      languages: matchingLanguages,
      wrappedPlatforms,
      hasNativeOwner,
      ownership,
      recentNativeDiagnosticCount,
      recentWrappedDiagnosticCount,
      recentNativeLatencyMs,
      recentWrappedLatencyMs,
      fixSurfaceNotes: workspaceAnalyzerInventoryFixSurfaceNotesResolve({
        hasNativeOwner,
        pluginRule: lookup.plugin.pluginRule,
        wrappedPlatforms,
      }),
    });
  }

  return inventory.sort((left, right) => left.ruleId.localeCompare(right.ruleId));
}

function workspaceLintRuleProviderConfigSummaryCreate(
  provider: LintProvider,
): string | undefined {
  if (provider.config === undefined) {
    return undefined;
  }
  try {
    const summary = JSON.stringify(provider.config);
    if (!summary || summary === '{}') {
      return undefined;
    }
    return summary;
  } catch {
    return '[unserializable config]';
  }
}

function workspaceLintRuleProviderSummaryKeyCreate(
  summary: WorkspaceLintRuleProviderSummary,
): string {
  return [
    summary.platform,
    ...workspaceAnalyzerRuleIdsNormalize(summary.languages),
    summary.configSummary ?? '',
  ].join('\0');
}

function workspaceLintRuleTreeProviderEnabled(rule: PolicyRule): boolean {
  return !rule.providers || rule.providers.length === 0 || rule.providers.includes('tree-sitter');
}

function workspaceLintRuleSummaryBuilderStateGet(
  states: Map<string, WorkspaceLintRuleSummaryBuilderState>,
  ruleId: string,
): WorkspaceLintRuleSummaryBuilderState {
  let state = states.get(ruleId);
  if (state) {
    return state;
  }
  state = {
    ruleId,
    severities: new Set<LintSeverity>(),
    targetPatterns: new Set<string>(),
    providers: new Map<string, WorkspaceLintRuleProviderSummary>(),
    languages: new Set<string>(),
    hasNativeOwner: false,
    fixSurfaceNotes: new Set<string>(),
  };
  states.set(ruleId, state);
  return state;
}

function workspaceLintRuleRuleIssuesByRuleIdCreate(
  analysis: WorkspaceAnalysis,
): Map<string, string[]> {
  const issuesByRuleId = new Map<string, Set<string>>();

  for (const scorecard of analysis.analyzerScorecard) {
    if (scorecard.issues.length === 0) {
      continue;
    }
    for (const ruleId of [...scorecard.ownedRuleIds, ...scorecard.skippedRuleIds]) {
      const ruleIssues = issuesByRuleId.get(ruleId) ?? new Set<string>();
      for (const issue of scorecard.issues) {
        ruleIssues.add(issue);
      }
      issuesByRuleId.set(ruleId, ruleIssues);
    }
  }

  return new Map(
    [...issuesByRuleId.entries()].map(([ruleId, issues]) => [
      ruleId,
      [...issues].sort(),
    ]),
  );
}

function workspaceLintRuleSummariesStaticBuild(input: {
  policy: PolicyFile;
  pluginRulesMap: Awaited<ReturnType<typeof policyPluginsGet>> extends Result<infer T, string>
    ? T
    : never;
  ruleTargets: PolicyRuleTargetContext[];
  analysisState: WorkspaceLintRuleSummary['analysisState'];
  analyzerIssues?: string[];
}): WorkspaceLintRuleSummary[] {
  const states = new Map<string, WorkspaceLintRuleSummaryBuilderState>();

  for (const rule of input.policy.rules) {
    const lookup = pluginGetForRule(input.pluginRulesMap, rule.ruleId);
    if (!lookup) {
      continue;
    }

    const pluginRule = lookup.plugin.pluginRule;
    const treeCheckProvider = pluginRule.capabilities.treeCheckProvider;
    const treeCheckEnabled = workspaceLintRuleTreeProviderEnabled(rule);
    const lintProviders = (pluginRule.capabilities.lintProviders ?? []).filter(
      (provider) =>
        !rule.providers ||
        rule.providers.length === 0 ||
        rule.providers.includes(provider.platform),
    );

    const state = workspaceLintRuleSummaryBuilderStateGet(states, lookup.resolvedId);
    state.severities.add(rule.severity ?? 'error');

    const targets = policyRuleTargetsResolve(rule, input.policy);
    for (const target of targets) {
      for (const pattern of target.files) {
        state.targetPatterns.add(pattern);
      }
    }

    const matchingLanguages = workspaceAnalyzerRuleIdsNormalize(
      input.ruleTargets
        .filter((targetContext) =>
          policyRuleMatches(targetContext.ruleId, lookup.resolvedId),
        )
        .map((targetContext) => targetContext.target.language),
    );
    const treeLanguages =
      treeCheckProvider && treeCheckEnabled
        ? matchingLanguages.filter((language) =>
            treeCheckProviderSupportsLanguage(treeCheckProvider, language),
          )
        : [];

    const wrappedPlatforms = workspaceAnalyzerRuleIdsNormalize(
      lintProviders.map((provider) => provider.platform),
    );
    for (const provider of lintProviders) {
      const summary: WorkspaceLintRuleProviderSummary = {
        platform: provider.platform,
        languages: workspaceAnalyzerRuleIdsNormalize(provider.languages),
        configSummary: workspaceLintRuleProviderConfigSummaryCreate(provider),
      };
      state.providers.set(
        workspaceLintRuleProviderSummaryKeyCreate(summary),
        summary,
      );
      for (const language of summary.languages) {
        state.languages.add(language);
      }
    }

    const hasNativeOwner =
      Boolean(treeCheckProvider) &&
      treeCheckEnabled &&
      matchingLanguages.some(
        (language) =>
          workspaceLanguageIsNativeOwnershipCandidate(language) &&
          treeCheckProviderSupportsLanguage(treeCheckProvider!, language),
      );
    if (state.providers.size === 0 && treeLanguages.length > 0) {
      const summary: WorkspaceLintRuleProviderSummary = {
        platform: 'tree-sitter',
        languages: treeLanguages,
      };
      state.providers.set(
        workspaceLintRuleProviderSummaryKeyCreate(summary),
        summary,
      );
      for (const language of treeLanguages) {
        state.languages.add(language);
      }
    }
    if (state.languages.size === 0) {
      for (const language of matchingLanguages) {
        state.languages.add(language);
      }
    }
    state.hasNativeOwner ||= hasNativeOwner;

    for (const note of workspaceAnalyzerInventoryFixSurfaceNotesResolve({
      hasNativeOwner,
      pluginRule,
      wrappedPlatforms,
    })) {
      state.fixSurfaceNotes.add(note);
    }
  }

  const analyzerIssues = [...(input.analyzerIssues ?? [])].sort();
  return [...states.values()]
    .map((state) => {
      const ownership: WorkspaceLintRuleSummary['ownership'] =
        input.analysisState === 'ready'
          ? state.hasNativeOwner
            ? 'native_preferred'
            : 'keep_wrapped'
          : 'pending_analysis';
      return {
        ruleId: state.ruleId,
        severities: workspaceAnalyzerRuleIdsNormalize(state.severities) as LintSeverity[],
        targetPatterns: workspaceAnalyzerRuleIdsNormalize(state.targetPatterns),
        providers: [...state.providers.values()].sort((left, right) =>
          left.platform === right.platform
            ? left.languages.join('\0').localeCompare(right.languages.join('\0'))
            : left.platform.localeCompare(right.platform),
        ),
        languages: workspaceAnalyzerRuleIdsNormalize(state.languages),
        ownership,
        hasNativeOwner: state.hasNativeOwner,
        recentNativeDiagnosticCount: 0,
        recentWrappedDiagnosticCount: 0,
        recentNativeLatencyMs: 0,
        recentWrappedLatencyMs: 0,
        fixSurfaceNotes: workspaceAnalyzerRuleIdsNormalize(state.fixSurfaceNotes),
        analysisState: input.analysisState,
        analyzerIssues,
      };
    })
    .sort((left, right) => left.ruleId.localeCompare(right.ruleId));
}

function workspaceLintRuleSummariesMergeAnalysis(
  summaries: WorkspaceLintRuleSummary[],
  analysis: WorkspaceAnalysis,
): WorkspaceLintRuleSummary[] {
  const inventoryByRuleId = new Map(
    analysis.analyzerInventory.map((entry) => [entry.ruleId, entry]),
  );
  const ruleIssuesByRuleId = workspaceLintRuleRuleIssuesByRuleIdCreate(analysis);
  const treeScorecard = analysis.analyzerScorecard.find(
    (scorecard) => scorecard.platform === 'codepol_tree',
  );

  return summaries
    .map((summary) => {
      const inventory = inventoryByRuleId.get(summary.ruleId);
      const ruleIssues =
        ruleIssuesByRuleId.get(summary.ruleId) ??
        summary.analyzerIssues;
      const matchingViolations = analysis.violations.filter((violation) =>
        policyRuleMatches(violation.ruleId, summary.ruleId),
      );
      const matchingTreeViolations = analysis.treeViolations.filter((violation) =>
        policyRuleMatches(violation.ruleId, summary.ruleId),
      );
      const wrappedLatencyMs = inventory
        ? inventory.recentWrappedLatencyMs
        : analysis.analyzerScorecard
            .filter(
              (scorecard) =>
                scorecard.platform !== 'codepol_tree' &&
                (scorecard.ownedRuleIds.includes(summary.ruleId) ||
                  scorecard.skippedRuleIds.includes(summary.ruleId)),
            )
            .reduce((sum, scorecard) => sum + scorecard.latencyMs, 0);
      const nativeLatencyMs = inventory
        ? inventory.recentNativeLatencyMs
        : summary.hasNativeOwner &&
            treeScorecard?.ownedRuleIds.includes(summary.ruleId)
          ? treeScorecard.latencyMs
          : 0;
      const ownership: WorkspaceLintRuleSummary['ownership'] =
        inventory?.ownership ?? (summary.hasNativeOwner
          ? 'native_preferred'
          : 'keep_wrapped');
      const analysisState: WorkspaceLintRuleSummary['analysisState'] =
        ruleIssues.length > 0 ? 'error' : 'ready';

      return {
        ...summary,
        ownership,
        hasNativeOwner: inventory?.hasNativeOwner ?? summary.hasNativeOwner,
        recentNativeDiagnosticCount:
          inventory?.recentNativeDiagnosticCount ??
          (summary.hasNativeOwner ? matchingTreeViolations.length : 0),
        recentWrappedDiagnosticCount:
          inventory?.recentWrappedDiagnosticCount ??
          (summary.hasNativeOwner
            ? Math.max(0, matchingViolations.length - matchingTreeViolations.length)
            : matchingViolations.length),
        recentNativeLatencyMs: nativeLatencyMs,
        recentWrappedLatencyMs: wrappedLatencyMs,
        fixSurfaceNotes: workspaceAnalyzerRuleIdsNormalize([
          ...summary.fixSurfaceNotes,
          ...(inventory?.fixSurfaceNotes ?? []),
        ]),
        analysisState,
        analyzerIssues: ruleIssues,
      };
    })
    .sort((left, right) => left.ruleId.localeCompare(right.ruleId));
}

function lintProviderEntriesCollect(
  policy: PolicyFile,
  pluginRulesMap: Awaited<ReturnType<typeof policyPluginsGet>> extends Result<infer T, string>
    ? T
    : never,
): LintProviderEntry[] {
  const lintProviderEntries: LintProviderEntry[] = [];
  for (const rule of policy.rules) {
    const lookup = pluginGetForRule(pluginRulesMap, rule.ruleId);
    if (!lookup) {
      continue;
    }
    const lintProviders = lookup.plugin.pluginRule.capabilities.lintProviders ?? [];
    for (const provider of lintProviders) {
      if (rule.providers && rule.providers.length > 0 && !rule.providers.includes(provider.platform)) {
        continue;
      }
      lintProviderEntries.push({
        provider,
        ruleId: lookup.resolvedId,
        ruleArgs: rule.args,
        severity: rule.severity,
        rule,
      });
    }
  }
  return lintProviderEntries;
}

function fixProvidersCollect(
  pluginRulesMap: Awaited<ReturnType<typeof policyPluginsGet>> extends Result<infer T, string>
    ? T
    : never,
): FixProvider[] {
  return Array.from(pluginRulesMap.values())
    .map((entry) => entry.pluginRule.capabilities.fixProvider)
    .filter((provider): provider is FixProvider => provider !== undefined);
}

function configuredRulesRequireProjectIndex(
  rules: PolicyRule[],
  pluginRulesMap: Awaited<ReturnType<typeof policyPluginsGet>> extends Result<infer T, string>
    ? T
    : never,
): boolean {
  for (const rule of rules) {
    const lookup = pluginGetForRule(pluginRulesMap, rule.ruleId);
    if (lookup?.plugin.pluginRule.capabilities.requiresProjectIndex) {
      return true;
    }
  }
  return false;
}

function matchedRulesRequireProjectIndex(
  matches: RuleMatch[],
  pluginRulesMap: Awaited<ReturnType<typeof policyPluginsGet>> extends Result<infer T, string>
    ? T
    : never,
): boolean {
  for (const match of matches) {
    if (match.files.length === 0) {
      continue;
    }
    const lookup = pluginGetForRule(pluginRulesMap, match.rule.ruleId);
    const capabilities = lookup?.plugin.pluginRule.capabilities;
    if (!capabilities) continue;
    // Architecture providers always need the project index (Phase 3 wired
    // the implicit dependency through `pluginCapabilitiesRequireProjectIndex`).
    if (capabilities.requiresProjectIndex || capabilities.architectureCheckProvider) {
      return true;
    }
  }
  return false;
}

async function fixProvidersApply(
  providers: FixProvider[],
  context: {
    policy: PolicyFile;
    configPath: string;
    cwd: string;
    files: string[];
    ruleTargets: PolicyRuleTargetContext[];
    projectIndex?: ProjectIndex;
  },
): Promise<void> {
  for (const provider of providers) {
    await provider.apply(context);
  }
}

function workspaceSourceOverridesGet(
  state: WorkspaceDocumentsState,
): Map<string, string> {
  const overrides = new Map<string, string>();
  for (const document of state.documents.values()) {
    overrides.set(document.filePath, document.text);
  }
  return overrides;
}

function workspaceDocumentGetByFilePath(
  state: WorkspaceDocumentsState,
  filePath: string,
): WorkspaceDocument | undefined {
  for (const document of state.documents.values()) {
    if (document.filePath === filePath) {
      return document;
    }
  }
  return undefined;
}

function workspaceSourceGet(
  state: WorkspaceDocumentsState,
  filePath: string,
): string {
  return workspaceDocumentGetByFilePath(state, filePath)?.text ?? fs.readFileSync(filePath, 'utf8');
}

function workspaceRelativePathCreate(
  rootPath: string,
  filePath: string,
): string {
  const relativePath = path.relative(rootPath, filePath);
  return relativePath.length > 0
    ? relativePath.split(path.sep).join('/')
    : path.basename(filePath);
}

function workspaceSearchTokensNormalize(
  query: string,
): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

function workspaceSearchScoreResolve(
  query: string,
  candidates: string[],
): number | undefined {
  const normalizedCandidates = candidates
    .map((candidate) => candidate.toLowerCase())
    .filter((candidate) => candidate.length > 0);
  const tokens = workspaceSearchTokensNormalize(query);

  if (tokens.length === 0) {
    return 1;
  }

  let score = 0;
  for (const token of tokens) {
    let tokenScore = 0;
    for (const candidate of normalizedCandidates) {
      if (candidate === token) {
        tokenScore = Math.max(tokenScore, 120);
        continue;
      }
      if (candidate.startsWith(token)) {
        tokenScore = Math.max(tokenScore, 90);
        continue;
      }
      if (candidate.includes(token)) {
        tokenScore = Math.max(tokenScore, 60);
      }

      const segments = candidate.split(/[\/._-]/).filter((segment) => segment.length > 0);
      if (segments.some((segment) => segment === token)) {
        tokenScore = Math.max(tokenScore, 80);
        continue;
      }
      if (segments.some((segment) => segment.startsWith(token))) {
        tokenScore = Math.max(tokenScore, 70);
      }
    }
    if (tokenScore === 0) {
      return undefined;
    }
    score += tokenScore;
  }

  return score;
}

function workspaceSearchLimitResolve(
  limit: number | undefined,
  fallback: number,
): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return fallback;
  }
  return Math.max(1, Math.floor(limit));
}

function workspaceModuleSymbolResultsGet(
  workspace: WorkspaceContextState,
  index: ProjectIndex,
  input: {
    query: string;
    limit?: number;
  },
): WorkspaceSymbolResult[] {
  const limit = workspaceSearchLimitResolve(
    input.limit,
    WORKSPACE_SYMBOL_LIMIT_DEFAULT,
  );
  const results: WorkspaceSymbolResult[] = [];

  for (const filePath of index.filesGet()) {
    const workspaceRelativePath = workspaceRelativePathCreate(
      workspace.rootPath,
      filePath,
    );
    const basename = path.basename(filePath);
    const score = workspaceSearchScoreResolve(input.query, [
      basename,
      workspaceRelativePath,
    ]);
    if (score === undefined) {
      continue;
    }

    results.push({
      name: basename,
      kind: 'module',
      location: {
        uri: workspacePathToUri(filePath),
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
      },
      containerName: path.dirname(workspaceRelativePath) === '.'
        ? undefined
        : path.dirname(workspaceRelativePath),
      detail: workspaceRelativePath,
      source: 'codepol',
      semanticClass: 'workspace_module',
      score,
    });
  }

  results.sort((left, right) => {
    const scoreDifference = (right.score ?? 0) - (left.score ?? 0);
    if (scoreDifference !== 0) {
      return scoreDifference;
    }
    const detailDifference = (left.detail ?? '').localeCompare(right.detail ?? '');
    if (detailDifference !== 0) {
      return detailDifference;
    }
    return left.name.localeCompare(right.name);
  });
  return results.slice(0, limit);
}

function workspaceSemanticSearchResultsGet(
  workspace: WorkspaceContextState,
  state: WorkspaceDocumentsState,
  index: ProjectIndex,
  input: {
    query: string;
    limit?: number;
  },
): WorkspaceSearchResult[] {
  const limit = workspaceSearchLimitResolve(
    input.limit,
    WORKSPACE_SEARCH_LIMIT_DEFAULT,
  );
  const results: WorkspaceSearchResult[] = [];

  for (const filePath of index.filesGet()) {
    const workspaceRelativePath = workspaceRelativePathCreate(
      workspace.rootPath,
      filePath,
    );
    const basename = path.basename(filePath);
    const score = workspaceSearchScoreResolve(input.query, [
      basename,
      workspaceRelativePath,
    ]);
    if (score === undefined) {
      continue;
    }

    results.push({
      name: basename,
      kind: 'module',
      location: {
        uri: workspacePathToUri(filePath),
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
      },
      detail: workspaceRelativePath,
      source: 'codepol',
      semanticClass: 'workspace_module',
      score,
    });
  }

  for (const symbol of index.exportedSymbolsGet()) {
    const workspaceRelativePath = workspaceRelativePathCreate(
      workspace.rootPath,
      symbol.file,
    );
    const basename = path.basename(symbol.file);
    const score = workspaceSearchScoreResolve(input.query, [
      symbol.name,
      symbol.qualName,
      basename,
      workspaceRelativePath,
    ]);
    if (score === undefined) {
      continue;
    }

    results.push({
      name: symbol.name,
      kind: 'exported_symbol',
      location: {
        uri: workspacePathToUri(symbol.file),
        range: workspaceRangeFromByteRange(
          workspaceSourceGet(state, symbol.file),
          symbol.byteRange,
        ),
      },
      detail: `${workspaceRelativePath} • ${symbol.kind}`,
      source: 'codepol',
      semanticClass: 'exported_symbol',
      score: score + 20,
    });
  }

  results.sort((left, right) => {
    const scoreDifference = right.score - left.score;
    if (scoreDifference !== 0) {
      return scoreDifference;
    }
    const kindDifference =
      left.kind === right.kind ? 0 : left.kind === 'exported_symbol' ? -1 : 1;
    if (kindDifference !== 0) {
      return kindDifference;
    }
    const detailDifference = (left.detail ?? '').localeCompare(right.detail ?? '');
    if (detailDifference !== 0) {
      return detailDifference;
    }
    return left.name.localeCompare(right.name);
  });
  return results.slice(0, limit);
}

type WorkspaceSemanticReferenceCandidate = WorkspaceSemanticReferenceItem & {
  filePath: string;
};

function workspaceSemanticTargetResolve(
  index: ProjectIndex,
  uri: string,
): { filePath: string; target: WorkspaceSemanticTarget } | undefined {
  let filePath: string;
  try {
    filePath = workspaceUriToPath(uri);
  } catch {
    return undefined;
  }
  if (!index.filesGet().includes(filePath)) {
    return undefined;
  }
  return {
    filePath,
    target: {
      uri: workspacePathToUri(filePath),
      semanticClass: 'architecture_node',
    },
  };
}

function workspaceLocationFileAnchorCreate(filePath: string) {
  return {
    uri: workspacePathToUri(filePath),
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
    },
  };
}

function workspaceSemanticDefinitionResultCreate(
  target: WorkspaceSemanticTarget,
): WorkspaceSemanticDefinitionResult {
  return {
    kind: 'single_location',
    target,
    location: workspaceLocationFileAnchorCreate(workspaceUriToPath(target.uri)),
    source: 'codepol',
    semanticClass: 'architecture_node',
  };
}

function workspaceSemanticReferenceCandidatesGet(
  workspace: WorkspaceContextState,
  state: WorkspaceDocumentsState,
  index: ProjectIndex,
  input: {
    fromFilePath: string;
    targetFilePath: string;
    relationKind: Exclude<WorkspaceSemanticReferenceGroup, 'declarations'>;
  },
): WorkspaceSemanticReferenceCandidate[] {
  const candidates: WorkspaceSemanticReferenceCandidate[] = [];
  const seen = new Set<string>();
  const source = workspaceSourceGet(state, input.fromFilePath);
  const workspaceRelativePath = workspaceRelativePathCreate(
    workspace.rootPath,
    input.fromFilePath,
  );
  const candidateAdd = (
    byteRange: { start: number; end: number },
    detail: string,
  ) => {
    const dedupeKey = [
      input.fromFilePath,
      input.targetFilePath,
      byteRange.start,
      byteRange.end,
      input.relationKind,
    ].join(':');
    if (seen.has(dedupeKey)) {
      return;
    }
    seen.add(dedupeKey);
    candidates.push({
      location: {
        uri: workspacePathToUri(input.fromFilePath),
        range: workspaceRangeFromByteRange(source, byteRange),
      },
      label: workspaceRelativePath,
      detail,
      relationKind: input.relationKind,
      semanticClass: 'architecture_node',
      filePath: input.fromFilePath,
    });
  };

  for (const binding of index.importBindingsGet(input.fromFilePath)) {
    if (binding.resolvedModulePath !== input.targetFilePath) {
      continue;
    }
    const localSymbol = index.symbolGet(binding.localSymbolId);
    const importLabel = binding.isNamespace
      ? `namespace import from ${binding.moduleSpec}`
      : binding.isDefault
        ? `default import from ${binding.moduleSpec}`
        : `import ${binding.importedName} from ${binding.moduleSpec}`;
    candidateAdd(binding.byteRange, localSymbol ? importLabel : importLabel);
  }

  for (const imp of index.importsGet(input.fromFilePath)) {
    if (imp.resolvedModulePath !== input.targetFilePath) {
      continue;
    }
    candidateAdd(imp.byteRange, `import from ${imp.spec}`);
  }

  candidates.sort((left, right) => {
    const fileDifference = left.filePath.localeCompare(right.filePath);
    if (fileDifference !== 0) {
      return fileDifference;
    }
    const lineDifference = left.location.range.start.line - right.location.range.start.line;
    if (lineDifference !== 0) {
      return lineDifference;
    }
    const characterDifference =
      left.location.range.start.character - right.location.range.start.character;
    if (characterDifference !== 0) {
      return characterDifference;
    }
    const labelDifference = left.label.localeCompare(right.label);
    if (labelDifference !== 0) {
      return labelDifference;
    }
    return (left.detail ?? '').localeCompare(right.detail ?? '');
  });

  return candidates;
}

function workspaceSemanticReferencesGroupResultCreate(
  group: WorkspaceSemanticReferenceGroup,
  candidates: WorkspaceSemanticReferenceCandidate[],
  remainingLimit: number,
): {
  groupResult: WorkspaceSemanticReferencesGroup;
  nextRemainingLimit: number;
} {
  const allowedCount = Math.max(
    0,
    Math.min(
      remainingLimit,
      WORKSPACE_SEMANTIC_REFERENCES_GROUP_LIMIT,
      candidates.length,
    ),
  );
  return {
    groupResult: {
      group,
      totalCount: candidates.length,
      truncated: allowedCount < candidates.length,
      items: candidates.slice(0, allowedCount).map(({ filePath: _filePath, ...item }) => item),
    },
    nextRemainingLimit: Math.max(0, remainingLimit - allowedCount),
  };
}

function workspaceSemanticReferencesResultCreate(
  workspace: WorkspaceContextState,
  state: WorkspaceDocumentsState,
  index: ProjectIndex,
  input: {
    target: WorkspaceSemanticTarget;
    filePath: string;
  },
): WorkspaceSemanticReferencesResult {
  const workspaceRelativePath = workspaceRelativePathCreate(
    workspace.rootPath,
    input.filePath,
  );
  const declarations: WorkspaceSemanticReferenceCandidate[] = [{
    location: workspaceLocationFileAnchorCreate(input.filePath),
    label: workspaceRelativePath,
    detail: 'module declaration',
    relationKind: 'declarations',
    semanticClass: 'architecture_node',
    filePath: input.filePath,
  }];
  const incoming = index
    .moduleImportersGet(input.filePath)
    .sort()
    .flatMap((filePath) =>
      workspaceSemanticReferenceCandidatesGet(workspace, state, index, {
        fromFilePath: filePath,
        targetFilePath: input.filePath,
        relationKind: 'incoming',
      }),
    );
  const outgoing = index
    .moduleImporteesGet(input.filePath)
    .sort()
    .flatMap((filePath) =>
      workspaceSemanticReferenceCandidatesGet(workspace, state, index, {
        fromFilePath: input.filePath,
        targetFilePath: filePath,
        relationKind: 'outgoing',
      }),
    );

  let remainingLimit = WORKSPACE_SEMANTIC_REFERENCES_TOTAL_LIMIT;
  const { groupResult: declarationsGroup, nextRemainingLimit: afterDeclarations } =
    workspaceSemanticReferencesGroupResultCreate('declarations', declarations, remainingLimit);
  remainingLimit = afterDeclarations;
  const { groupResult: incomingGroup, nextRemainingLimit: afterIncoming } =
    workspaceSemanticReferencesGroupResultCreate('incoming', incoming, remainingLimit);
  remainingLimit = afterIncoming;
  const { groupResult: outgoingGroup, nextRemainingLimit: afterOutgoing } =
    workspaceSemanticReferencesGroupResultCreate('outgoing', outgoing, remainingLimit);
  remainingLimit = afterOutgoing;

  const groups = [declarationsGroup, incomingGroup, outgoingGroup];
  const totalAvailableItems = groups.reduce((count, group) => count + group.totalCount, 0);
  const totalItems = groups.reduce((count, group) => count + group.items.length, 0);

  return {
    target: input.target,
    presentation: 'grouped_list',
    totalItems,
    totalAvailableItems,
    truncated: totalItems < totalAvailableItems,
    groups,
    source: 'codepol',
    semanticClass: 'architecture_node',
  };
}

function workspaceSemanticHoverResultCreate(
  workspace: WorkspaceContextState,
  index: ProjectIndex,
  input: {
    target: WorkspaceSemanticTarget;
    filePath: string;
  },
): WorkspaceSemanticHoverResult {
  const workspaceRelativePath = workspaceRelativePathCreate(
    workspace.rootPath,
    input.filePath,
  );
  const importerCount = index.moduleImportersGet(input.filePath).length;
  const importeeCount = index.moduleImporteesGet(input.filePath).length;
  const isEntryPoint = index.moduleEntryPointsGet().includes(input.filePath);
  const isCycleMember = index
    .moduleCyclesGet()
    .some((cycle) => cycle.includes(input.filePath));
  const containerName = path.dirname(workspaceRelativePath);
  const tags: string[] = [];
  if (isEntryPoint) {
    tags.push('entry-point');
  }
  if (isCycleMember) {
    tags.push('cycle');
  }

  return {
    target: input.target,
    title: path.basename(input.filePath),
    subtitle: workspaceRelativePath,
    summary: 'Indexed architecture node for the workspace module graph.',
    fields: [
      {
        label: 'Directory',
        value: containerName === '.' ? '(root)' : containerName,
      },
      {
        label: 'Inbound edges',
        value: String(importerCount),
      },
      {
        label: 'Outbound edges',
        value: String(importeeCount),
      },
      {
        label: 'Entry point',
        value: isEntryPoint ? 'Yes' : 'No',
      },
      {
        label: 'Cycle member',
        value: isCycleMember ? 'Yes' : 'No',
      },
    ],
    tags: tags.length > 0 ? tags : undefined,
    actions: ['go_to_definition', 'find_references', 'show_graph'],
    source: 'codepol',
    semanticClass: 'architecture_node',
  };
}

type WorkspaceByteRange = {
  start: number;
  end: number;
};

type WorkspaceConfigRenameAnchor = {
  uri: string;
  range: ReturnType<typeof workspaceRangeFromByteRange>;
  byteRange: WorkspaceByteRange;
  oldText: string;
  group: 'declarations' | 'config';
  editKind: 'declaration' | 'config_key';
};

type WorkspaceConfigRenameRegistryEntry = {
  targetId: string;
  name: string;
  normalizedName: string;
  namespaceId: string;
  declarationAnchor: WorkspaceConfigRenameAnchor;
  declarationAnchors: WorkspaceConfigRenameAnchor[];
  referenceAnchors: WorkspaceConfigRenameAnchor[];
  impactedSiteCount: number;
};

type WorkspaceConfigRenameRegistryResolution =
  | {
      ok: true;
      source: string;
      entry: WorkspaceConfigRenameRegistryEntry;
      targetNames: string[];
    }
  | {
      ok: false;
      code: WorkspacePrepareRenameFailure['code'];
      message: string;
    };

type WorkspacePackageRenameAnchor = {
  uri: string;
  range: ReturnType<typeof workspaceRangeFromByteRange>;
  byteRange: WorkspaceByteRange;
  oldText: string;
  group: 'declarations' | 'references';
  editKind: 'declaration' | 'reference';
};

type WorkspacePackageRenameRegistryEntry = {
  targetId: string;
  name: string;
  normalizedName: string;
  namespaceId: string;
  packageJsonPath: string;
  entryPointPath: string;
  declarationAnchor: WorkspacePackageRenameAnchor;
  declarationAnchors: WorkspacePackageRenameAnchor[];
  referenceAnchors: WorkspacePackageRenameAnchor[];
  impactedSiteCount: number;
};

type WorkspacePackageRenameRegistryResolution =
  | {
      ok: true;
      source: string;
      entry: WorkspacePackageRenameRegistryEntry;
      packageNames: string[];
    }
  | {
      ok: false;
      code: WorkspacePrepareRenameFailure['code'];
      message: string;
    };

type WorkspaceTomlStringArrayEntry = {
  value: string;
  start: number;
  end: number;
};

function workspaceCodeUnitIndexByteOffsetResolve(
  source: string,
  codeUnitIndex: number,
): number {
  return Buffer.byteLength(source.slice(0, codeUnitIndex), 'utf8');
}

function workspaceByteRangeFromCodeUnitRangeCreate(
  source: string,
  start: number,
  end: number,
): WorkspaceByteRange {
  return {
    start: workspaceCodeUnitIndexByteOffsetResolve(source, start),
    end: workspaceCodeUnitIndexByteOffsetResolve(source, end),
  };
}

function workspaceByteRangeTextRead(
  source: string,
  byteRange: WorkspaceByteRange,
): string {
  return Buffer.from(source, 'utf8')
    .subarray(byteRange.start, byteRange.end)
    .toString('utf8');
}

function workspaceRegexEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function workspaceConfigRenameNameNormalize(name: string): string {
  return name.trim().toLowerCase();
}

function workspacePackageRenameNameNormalize(name: string): string {
  return name.trim().toLowerCase();
}

function workspaceConfigRenameTargetNameResolve(targetId: string): string | undefined {
  if (!targetId.startsWith(WORKSPACE_CONFIG_RENAME_TARGET_ID_PREFIX)) {
    return undefined;
  }
  const targetName = targetId.slice(WORKSPACE_CONFIG_RENAME_TARGET_ID_PREFIX.length);
  if (!WORKSPACE_CONFIG_RENAME_TARGET_SEGMENT_PATTERN.test(targetName)) {
    return undefined;
  }
  return targetName;
}

function workspacePackageRenameTargetNameResolve(targetId: string): string | undefined {
  if (!targetId.startsWith(WORKSPACE_PACKAGE_RENAME_TARGET_ID_PREFIX)) {
    return undefined;
  }
  const packageName = targetId.slice(WORKSPACE_PACKAGE_RENAME_TARGET_ID_PREFIX.length).trim();
  return packageName.length > 0 ? packageName : undefined;
}

function workspaceConfigRenameAnchorCreate(input: {
  source: string;
  filePath: string;
  start: number;
  end: number;
  group: WorkspaceConfigRenameAnchor['group'];
  editKind: WorkspaceConfigRenameAnchor['editKind'];
}): WorkspaceConfigRenameAnchor {
  const byteRange = workspaceByteRangeFromCodeUnitRangeCreate(
    input.source,
    input.start,
    input.end,
  );
  return {
    uri: workspacePathToUri(input.filePath),
    range: workspaceRangeFromByteRange(input.source, byteRange),
    byteRange,
    oldText: input.source.slice(input.start, input.end),
    group: input.group,
    editKind: input.editKind,
  };
}

function workspaceConfigRenameAnchorsSort(
  anchors: WorkspaceConfigRenameAnchor[],
): WorkspaceConfigRenameAnchor[] {
  return [...anchors].sort((left, right) => {
    const uriDifference = left.uri.localeCompare(right.uri);
    if (uriDifference !== 0) {
      return uriDifference;
    }
    if (left.byteRange.start !== right.byteRange.start) {
      return left.byteRange.start - right.byteRange.start;
    }
    return left.byteRange.end - right.byteRange.end;
  });
}

function workspacePackageRenameAnchorCreate(input: {
  source: string;
  filePath: string;
  byteRange: WorkspaceByteRange;
  group: WorkspacePackageRenameAnchor['group'];
  editKind: WorkspacePackageRenameAnchor['editKind'];
}): WorkspacePackageRenameAnchor {
  return {
    uri: workspacePathToUri(input.filePath),
    range: workspaceRangeFromByteRange(input.source, input.byteRange),
    byteRange: input.byteRange,
    oldText: workspaceByteRangeTextRead(input.source, input.byteRange),
    group: input.group,
    editKind: input.editKind,
  };
}

function workspacePackageRenameAnchorsSort(
  anchors: WorkspacePackageRenameAnchor[],
): WorkspacePackageRenameAnchor[] {
  return [...anchors].sort((left, right) => {
    const uriDifference = left.uri.localeCompare(right.uri);
    if (uriDifference !== 0) {
      return uriDifference;
    }
    if (left.byteRange.start !== right.byteRange.start) {
      return left.byteRange.start - right.byteRange.start;
    }
    return left.byteRange.end - right.byteRange.end;
  });
}

function workspaceJsonWhitespaceSkip(source: string, index: number): number {
  let nextIndex = index;
  while (nextIndex < source.length && /\s/.test(source[nextIndex]!)) {
    nextIndex += 1;
  }
  return nextIndex;
}

function workspaceJsonStringLiteralRead(
  source: string,
  startQuoteIndex: number,
): {
  start: number;
  end: number;
  value: string;
  nextIndex: number;
} | undefined {
  if (source[startQuoteIndex] !== '"') {
    return undefined;
  }
  let index = startQuoteIndex + 1;
  let value = '';

  while (index < source.length) {
    const char = source[index]!;
    if (char === '\\') {
      const nextChar = source[index + 1];
      if (nextChar === undefined) {
        return undefined;
      }
      value += char;
      value += nextChar;
      index += 2;
      continue;
    }
    if (char === '"') {
      return {
        start: startQuoteIndex + 1,
        end: index,
        value,
        nextIndex: index + 1,
      };
    }
    value += char;
    index += 1;
  }

  return undefined;
}

function workspaceJsonTopLevelStringPropertyRangeResolve(
  source: string,
  propertyName: string,
): {
  start: number;
  end: number;
  value: string;
} | undefined {
  let depth = 0;
  let index = 0;

  while (index < source.length) {
    const char = source[index]!;
    if (char === '"') {
      if (depth !== 1) {
        const parsedString = workspaceJsonStringLiteralRead(source, index);
        if (!parsedString) {
          return undefined;
        }
        index = parsedString.nextIndex;
        continue;
      }

      const parsedKey = workspaceJsonStringLiteralRead(source, index);
      if (!parsedKey) {
        return undefined;
      }
      let cursor = workspaceJsonWhitespaceSkip(source, parsedKey.nextIndex);
      if (source[cursor] !== ':') {
        index = parsedKey.nextIndex;
        continue;
      }
      cursor = workspaceJsonWhitespaceSkip(source, cursor + 1);
      if (parsedKey.value !== propertyName) {
        index = parsedKey.nextIndex;
        continue;
      }
      if (source[cursor] !== '"') {
        return undefined;
      }
      const parsedValue = workspaceJsonStringLiteralRead(source, cursor);
      if (!parsedValue) {
        return undefined;
      }
      return {
        start: parsedValue.start,
        end: parsedValue.end,
        value: parsedValue.value,
      };
    }
    if (char === '{' || char === '[') {
      depth += 1;
      index += 1;
      continue;
    }
    if (char === '}' || char === ']') {
      depth = Math.max(0, depth - 1);
      index += 1;
      continue;
    }
    index += 1;
  }

  return undefined;
}

function workspacePackageDeclarationAnchorsCollect(input: {
  source: string;
  filePath: string;
}): WorkspacePackageRenameAnchor[] {
  const nameRange = workspaceJsonTopLevelStringPropertyRangeResolve(input.source, 'name');
  if (!nameRange) {
    return [];
  }
  return [
    workspacePackageRenameAnchorCreate({
      source: input.source,
      filePath: input.filePath,
      byteRange: workspaceByteRangeFromCodeUnitRangeCreate(
        input.source,
        nameRange.start,
        nameRange.end,
      ),
      group: 'declarations',
      editKind: 'declaration',
    }),
  ];
}

function workspaceImportSpecifierInnerByteRangeResolve(
  source: string,
  byteRange: WorkspaceByteRange,
): WorkspaceByteRange | undefined {
  const rawText = workspaceByteRangeTextRead(source, byteRange);
  const quote = rawText[0];
  if (
    rawText.length < 2 ||
    (quote !== '"' && quote !== "'") ||
    rawText[rawText.length - 1] !== quote
  ) {
    return undefined;
  }
  return {
    start: byteRange.start + 1,
    end: byteRange.end - 1,
  };
}

function workspaceConfigTargetDeclarationAnchorsCollect(input: {
  source: string;
  filePath: string;
  targetId: string;
  targetName: string;
}): WorkspaceConfigRenameAnchor[] {
  const escapedTargetName = workspaceRegexEscape(input.targetName);
  const anchors: WorkspaceConfigRenameAnchor[] = [];
  const seen = new Set<string>();
  const expressions = [
    new RegExp(
      `^[ \\t]*\\[targets\\.${escapedTargetName}\\][ \\t]*(?:#.*)?$`,
      'gm',
    ),
    new RegExp(
      `^[ \\t]*targets\\.${escapedTargetName}(?:\\.[A-Za-z0-9_-]+)*[ \\t]*=`,
      'gm',
    ),
  ];

  const anchorAdd = (matchIndex: number, matchText: string) => {
    const relativeStart = matchText.indexOf(input.targetName);
    if (relativeStart < 0) {
      return;
    }
    const start = matchIndex + relativeStart;
    const end = start + input.targetName.length;
    const dedupeKey = `${start}:${end}`;
    if (seen.has(dedupeKey)) {
      return;
    }
    seen.add(dedupeKey);
    anchors.push(
      workspaceConfigRenameAnchorCreate({
        source: input.source,
        filePath: input.filePath,
        start,
        end,
        group: 'declarations',
        editKind: 'declaration',
      }),
    );
  };

  for (const expression of expressions) {
    for (const match of input.source.matchAll(expression)) {
      if (match.index === undefined) {
        continue;
      }
      anchorAdd(match.index, match[0]);
    }
  }

  return workspaceConfigRenameAnchorsSort(anchors);
}

function workspaceTomlStringArrayEntriesCollect(
  source: string,
  arrayStartIndex: number,
  maxIndex: number,
): WorkspaceTomlStringArrayEntry[] | undefined {
  const entries: WorkspaceTomlStringArrayEntry[] = [];
  let index = arrayStartIndex + 1;
  let quote: '"' | "'" | undefined;
  let valueStart = -1;
  let value = '';
  let escaping = false;

  while (index < source.length && index < maxIndex) {
    const char = source[index];
    if (quote) {
      if (quote === '"' && escaping) {
        value += char;
        escaping = false;
        index += 1;
        continue;
      }
      if (quote === '"' && char === '\\') {
        escaping = true;
        index += 1;
        continue;
      }
      if (char === quote) {
        entries.push({
          value,
          start: valueStart,
          end: index,
        });
        quote = undefined;
        valueStart = -1;
        value = '';
        escaping = false;
        index += 1;
        continue;
      }
      value += char;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      valueStart = index + 1;
      value = '';
      escaping = false;
      index += 1;
      continue;
    }
    if (char === '#') {
      while (index < source.length && source[index] !== '\n') {
        index += 1;
      }
      continue;
    }
    if (char === ']') {
      return entries;
    }
    index += 1;
  }

  return undefined;
}

function workspaceConfigTargetReferenceAnchorsCollect(input: {
  source: string;
  filePath: string;
  targetId: string;
  targetName: string;
}): {
  anchors: WorkspaceConfigRenameAnchor[];
  complete: boolean;
} {
  const anchors: WorkspaceConfigRenameAnchor[] = [];
  const ruleBlockStarts = [
    ...input.source.matchAll(/^[ \t]*\[\[rules\]\][ \t]*(?:#.*)?$/gm),
  ].map((match) => match.index ?? 0);

  for (let index = 0; index < ruleBlockStarts.length; index += 1) {
    const blockStart = ruleBlockStarts[index]!;
    const blockEnd = ruleBlockStarts[index + 1] ?? input.source.length;
    const blockSource = input.source.slice(blockStart, blockEnd);
    const targetsAssignments = blockSource.matchAll(/^[ \t]*targets[ \t]*=[ \t]*\[/gm);
    for (const match of targetsAssignments) {
      if (match.index === undefined) {
        continue;
      }
      const arrayRelativeStart = match[0].lastIndexOf('[');
      if (arrayRelativeStart < 0) {
        return { anchors: [], complete: false };
      }
      const arrayStart = blockStart + match.index + arrayRelativeStart;
      const entries = workspaceTomlStringArrayEntriesCollect(
        input.source,
        arrayStart,
        blockEnd,
      );
      if (!entries) {
        return { anchors: [], complete: false };
      }
      for (const entry of entries) {
        if (entry.value !== input.targetName) {
          continue;
        }
        anchors.push(
          workspaceConfigRenameAnchorCreate({
            source: input.source,
            filePath: input.filePath,
            start: entry.start,
            end: entry.end,
            group: 'config',
            editKind: 'config_key',
          }),
        );
      }
    }
  }

  return {
    anchors: workspaceConfigRenameAnchorsSort(anchors),
    complete: true,
  };
}

function workspacePackageRegistryNamespaceIdCreate(
  workspace: WorkspaceContextState,
): string {
  return `workspace.packages:${workspacePathToUri(workspace.rootPath)}`;
}

function workspacePackageRecordsResolve(
  workspace: WorkspaceContextState,
  state: WorkspaceDocumentsState,
  files: string[],
): WorkspacePackageRecord[] {
  const baseIndexState = workspaceBaseIndexStateGetOrBuild(workspace, files);
  const baseRecords =
    baseIndexState.workspacePackageRecords ??
    workspacePackageRecordsDiscover(workspace.rootPath);

  if (!baseIndexState.workspacePackageRecords) {
    baseIndexState.workspacePackageRecords = baseRecords;
    baseIndexState.workspacePackages = workspacePackageMapCreate(baseRecords);
  }

  const records: WorkspacePackageRecord[] = [];
  for (const record of baseRecords) {
    const overlayDocument = workspaceDocumentGetByFilePath(state, record.packageJsonPath);
    if (!overlayDocument) {
      records.push(record);
      continue;
    }

    try {
      const nextRecord = workspacePackageRecordFromManifestSource(
        record.packageJsonPath,
        overlayDocument.text,
      );
      if (nextRecord) {
        records.push(nextRecord);
      }
    } catch {
      continue;
    }
  }

  return records.sort((left, right) =>
    left.packageJsonPath.localeCompare(right.packageJsonPath),
  );
}

function workspacePackageMapResolve(
  workspace: WorkspaceContextState,
  state: WorkspaceDocumentsState,
  files: string[],
): Map<string, string> {
  return workspacePackageMapCreate(
    workspacePackageRecordsResolve(workspace, state, files),
  );
}

function workspacePackageReferenceAnchorsCollect(
  state: WorkspaceDocumentsState,
  index: ProjectIndex,
  input: {
    packageName: string;
    entryPointPath: string;
  },
): {
  anchors: WorkspacePackageRenameAnchor[];
  complete: boolean;
} {
  const anchors: WorkspacePackageRenameAnchor[] = [];
  const seen = new Set<string>();

  for (const filePath of index.filesGet()) {
    const source = workspaceSourceGet(state, filePath);
    for (const imp of index.importsGet(filePath)) {
      if (
        imp.spec !== input.packageName ||
        imp.resolvedModulePath !== input.entryPointPath
      ) {
        continue;
      }
      const innerByteRange = workspaceImportSpecifierInnerByteRangeResolve(
        source,
        imp.byteRange,
      );
      if (!innerByteRange) {
        return { anchors: [], complete: false };
      }
      const dedupeKey = `${filePath}:${innerByteRange.start}:${innerByteRange.end}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      anchors.push(
        workspacePackageRenameAnchorCreate({
          source,
          filePath,
          byteRange: innerByteRange,
          group: 'references',
          editKind: 'reference',
        }),
      );
    }
  }

  return {
    anchors: workspacePackageRenameAnchorsSort(anchors),
    complete: true,
  };
}

function workspacePackageRenameRegistryResolve(
  workspace: WorkspaceContextState,
  state: WorkspaceDocumentsState,
  index: ProjectIndex,
  targetId: string,
): WorkspacePackageRenameRegistryResolution {
  const targetName = workspacePackageRenameTargetNameResolve(targetId);
  if (!targetName) {
    return {
      ok: false,
      code: 'unsupported_context',
      message: `Package rename target ${targetId} is not a supported v1 target id.`,
    };
  }

  const packageRecords = workspacePackageRecordsResolve(
    workspace,
    state,
    index.filesGet(),
  );
  const normalizedTargetName = workspacePackageRenameNameNormalize(targetName);
  const matchingRecords = packageRecords.filter(
    (record) => workspacePackageRenameNameNormalize(record.name) === normalizedTargetName,
  );
  if (matchingRecords.length === 0) {
    return {
      ok: false,
      code: 'unsupported_context',
      message:
        `Workspace package ${targetId} is not defined in the active workspace package registry.`,
    };
  }
  if (matchingRecords.length > 1) {
    return {
      ok: false,
      code: 'ambiguous_target',
      message:
        `Workspace package ${targetName} does not resolve to one canonical package declaration.`,
    };
  }

  const record = matchingRecords[0]!;
  const source = workspaceSourceGet(state, record.packageJsonPath);
  const declarationAnchors = workspacePackageDeclarationAnchorsCollect({
    source,
    filePath: record.packageJsonPath,
  });
  if (declarationAnchors.length === 0) {
    return {
      ok: false,
      code: 'declaration_missing',
      message:
        `Workspace package ${record.name} does not have a canonical package.json "name" anchor.`,
    };
  }

  const referenceAnchorsResult = workspacePackageReferenceAnchorsCollect(
    state,
    index,
    {
      packageName: record.name,
      entryPointPath: record.entryPointPath,
    },
  );
  if (!referenceAnchorsResult.complete) {
    return {
      ok: false,
      code: 'reference_set_incomplete',
      message:
        `Workspace package ${record.name} does not have a fully materialized closed-world ` +
        'reference set in the indexed workspace.',
    };
  }

  return {
    ok: true,
    source,
    packageNames: packageRecords.map((packageRecord) => packageRecord.name),
    entry: {
      targetId,
      name: record.name,
      normalizedName: workspacePackageRenameNameNormalize(record.name),
      namespaceId: workspacePackageRegistryNamespaceIdCreate(workspace),
      packageJsonPath: record.packageJsonPath,
      entryPointPath: record.entryPointPath,
      declarationAnchor: declarationAnchors[0]!,
      declarationAnchors,
      referenceAnchors: referenceAnchorsResult.anchors,
      impactedSiteCount:
        declarationAnchors.length + referenceAnchorsResult.anchors.length,
    },
  };
}

function workspaceDomainEntityPrepareResultResolve(
  workspace: WorkspaceContextState,
  state: WorkspaceDocumentsState,
  index: ProjectIndex,
  targetId: string,
): WorkspacePrepareRenameResult {
  const resolved = workspacePackageRenameRegistryResolve(workspace, state, index, targetId);
  if (!resolved.ok) {
    return workspacePrepareRenameFailureCreate(resolved.code, resolved.message);
  }

  return {
    ok: true,
    target: {
      semanticClass: 'domain_entity',
      targetId: resolved.entry.targetId,
    },
    displayName: resolved.entry.name,
    currentName: resolved.entry.name,
    normalizedCurrentName: resolved.entry.normalizedName,
    namespaceId: resolved.entry.namespaceId,
    declarationLocation: {
      uri: resolved.entry.declarationAnchor.uri,
      range: resolved.entry.declarationAnchor.range,
    },
    placeholderRange: resolved.entry.declarationAnchor.range,
    impactedSiteCount: resolved.entry.impactedSiteCount,
    requiresPreview: true,
    namingRules: {
      minLength: 1,
      patternDescription: WORKSPACE_PACKAGE_NAME_DESCRIPTION,
    },
  };
}

function workspaceDomainEntityPreviewResultResolve(
  workspace: WorkspaceContextState,
  state: WorkspaceDocumentsState,
  index: ProjectIndex,
  input: {
    targetId: string;
    newName: string;
  },
): WorkspaceRenamePreviewResult {
  const resolved = workspacePackageRenameRegistryResolve(
    workspace,
    state,
    index,
    input.targetId,
  );
  if (!resolved.ok) {
    return workspaceRenamePreviewFailureCreate(resolved.code, resolved.message);
  }

  const proposedName = input.newName.trim();
  if (proposedName.length === 0) {
    return workspaceRenamePreviewFailureCreate(
      'validation_failed',
      'Workspace package rename must not be empty.',
    );
  }
  if (!WORKSPACE_PACKAGE_NAME_PATTERN.test(proposedName)) {
    return workspaceRenamePreviewFailureCreate(
      'validation_failed',
      `Workspace package rename must match ${WORKSPACE_PACKAGE_NAME_DESCRIPTION}.`,
    );
  }

  const normalizedNewName = workspacePackageRenameNameNormalize(proposedName);
  if (normalizedNewName === resolved.entry.normalizedName) {
    const message = proposedName === resolved.entry.name
      ? 'Workspace package rename is unchanged after normalization.'
      : 'Case-only workspace package renames are not supported in MVP.';
    return workspaceRenamePreviewFailureCreate('validation_failed', message);
  }

  const conflictingPackageName = resolved.packageNames.find((candidate) => {
    if (candidate === resolved.entry.name) {
      return false;
    }
    return workspacePackageRenameNameNormalize(candidate) === normalizedNewName;
  });

  const declarations = resolved.entry.declarationAnchors.map((anchor) => ({
    uri: anchor.uri,
    range: anchor.range,
    oldText: anchor.oldText,
    newText: proposedName,
    kind: anchor.editKind,
    semanticClass: 'domain_entity' as const,
    targetId: resolved.entry.targetId,
  }));
  const references = resolved.entry.referenceAnchors.map((anchor) => ({
    uri: anchor.uri,
    range: anchor.range,
    oldText: anchor.oldText,
    newText: proposedName,
    kind: anchor.editKind,
    semanticClass: 'domain_entity' as const,
    targetId: resolved.entry.targetId,
  }));
  const blockingIssues = conflictingPackageName
    ? [{
        code: 'collision' as const,
        message:
          `Workspace package ${proposedName} conflicts with existing package ` +
          `${conflictingPackageName} in ${resolved.entry.namespaceId}.`,
      }]
    : [];
  const groups: WorkspaceRenamePreviewGroup[] = [];
  if (declarations.length > 0) {
    groups.push({
      group: 'declarations',
      edits: declarations,
    });
  }
  if (references.length > 0) {
    groups.push({
      group: 'references',
      edits: references,
    });
  }

  return {
    ok: true,
    target: {
      semanticClass: 'domain_entity',
      targetId: resolved.entry.targetId,
    },
    oldName: resolved.entry.name,
    newName: proposedName,
    normalizedNewName,
    namespaceId: resolved.entry.namespaceId,
    groups,
    totalEdits: declarations.length + references.length,
    warnings: [],
    blockingIssues,
    canApply: blockingIssues.length === 0,
  };
}

function workspaceConfigTargetRenameRegistryResolve(
  workspace: WorkspaceContextState,
  state: WorkspaceDocumentsState,
  targetId: string,
): WorkspaceConfigRenameRegistryResolution {
  const targetName = workspaceConfigRenameTargetNameResolve(targetId);
  if (!targetName) {
    return {
      ok: false,
      code: 'unsupported_context',
      message: `Config rename target ${targetId} is not a supported v1 target id.`,
    };
  }

  const source = workspaceSourceGet(state, workspace.configPath);
  let config: CodepolConfig;
  try {
    config = configParseFromSource(source, {
      configPath: workspace.configPath,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      code: 'unsupported_context',
      message: `Active Codepol config source is not parseable: ${message}`,
    };
  }

  if (!Object.prototype.hasOwnProperty.call(config.targets, targetName)) {
    return {
      ok: false,
      code: 'unsupported_context',
      message: `Config target ${targetId} is not defined in the active Codepol config.`,
    };
  }

  const configUri = workspacePathToUri(workspace.configPath);
  const declarationAnchors = workspaceConfigTargetDeclarationAnchorsCollect({
    source,
    filePath: workspace.configPath,
    targetId,
    targetName,
  });
  if (declarationAnchors.length === 0) {
    return {
      ok: false,
      code: 'declaration_missing',
      message: `Config target ${targetName} does not have a canonical bare-key declaration anchor in codepol.toml.`,
    };
  }

  const expectedReferenceCount = config.rules.reduce((count, rule) => {
    return count + rule.targets.filter((name) => name === targetName).length;
  }, 0);
  const referenceAnchorsResult = workspaceConfigTargetReferenceAnchorsCollect({
    source,
    filePath: workspace.configPath,
    targetId,
    targetName,
  });
  if (
    !referenceAnchorsResult.complete ||
    referenceAnchorsResult.anchors.length !== expectedReferenceCount
  ) {
    return {
      ok: false,
      code: 'reference_set_incomplete',
      message:
        `Config target ${targetName} does not have a fully materialized closed-world ` +
        'reference set in codepol.toml.',
    };
  }

  return {
    ok: true,
    source,
    targetNames: Object.keys(config.targets),
    entry: {
      targetId,
      name: targetName,
      normalizedName: workspaceConfigRenameNameNormalize(targetName),
      namespaceId: `config.targets:${configUri}`,
      declarationAnchor: declarationAnchors[0]!,
      declarationAnchors,
      referenceAnchors: referenceAnchorsResult.anchors,
      impactedSiteCount:
        declarationAnchors.length + referenceAnchorsResult.anchors.length,
    },
  };
}

function workspaceConfigComponentPrepareResultResolve(
  workspace: WorkspaceContextState,
  state: WorkspaceDocumentsState,
  targetId: string,
): WorkspacePrepareRenameResult {
  const resolved = workspaceConfigTargetRenameRegistryResolve(workspace, state, targetId);
  if (!resolved.ok) {
    return workspacePrepareRenameFailureCreate(resolved.code, resolved.message);
  }

  return {
    ok: true,
    target: {
      semanticClass: 'config_component',
      targetId: resolved.entry.targetId,
    },
    displayName: resolved.entry.name,
    currentName: resolved.entry.name,
    normalizedCurrentName: resolved.entry.normalizedName,
    namespaceId: resolved.entry.namespaceId,
    declarationLocation: {
      uri: resolved.entry.declarationAnchor.uri,
      range: resolved.entry.declarationAnchor.range,
    },
    placeholderRange: resolved.entry.declarationAnchor.range,
    impactedSiteCount: resolved.entry.impactedSiteCount,
    requiresPreview: true,
    namingRules: {
      minLength: 1,
      patternDescription: WORKSPACE_CONFIG_RENAME_TARGET_SEGMENT_DESCRIPTION,
      casePolicy: 'preserve',
    },
  };
}

function workspaceConfigComponentPreviewResultResolve(
  workspace: WorkspaceContextState,
  state: WorkspaceDocumentsState,
  input: {
    targetId: string;
    newName: string;
  },
): WorkspaceRenamePreviewResult {
  const resolved = workspaceConfigTargetRenameRegistryResolve(
    workspace,
    state,
    input.targetId,
  );
  if (!resolved.ok) {
    return workspaceRenamePreviewFailureCreate(resolved.code, resolved.message);
  }

  const proposedName = input.newName.trim();
  if (proposedName.length === 0) {
    return workspaceRenamePreviewFailureCreate(
      'validation_failed',
      'Config target rename must not be empty.',
    );
  }
  if (!WORKSPACE_CONFIG_RENAME_TARGET_SEGMENT_PATTERN.test(proposedName)) {
    return workspaceRenamePreviewFailureCreate(
      'validation_failed',
      `Config target rename must match ${WORKSPACE_CONFIG_RENAME_TARGET_SEGMENT_DESCRIPTION}.`,
    );
  }

  const normalizedNewName = workspaceConfigRenameNameNormalize(proposedName);
  if (normalizedNewName === resolved.entry.normalizedName) {
    const message = proposedName === resolved.entry.name
      ? 'Config target rename is unchanged after normalization.'
      : 'Case-only config target renames are not supported in MVP.';
    return workspaceRenamePreviewFailureCreate('validation_failed', message);
  }

  const conflictingTargetName = resolved.targetNames.find((candidate) => {
    if (candidate === resolved.entry.name) {
      return false;
    }
    return workspaceConfigRenameNameNormalize(candidate) === normalizedNewName;
  });

  const declarations = resolved.entry.declarationAnchors.map((anchor) => ({
    uri: anchor.uri,
    range: anchor.range,
    oldText: anchor.oldText,
    newText: proposedName,
    kind: anchor.editKind,
    semanticClass: 'config_component' as const,
    targetId: resolved.entry.targetId,
  }));
  const configEdits = resolved.entry.referenceAnchors.map((anchor) => ({
    uri: anchor.uri,
    range: anchor.range,
    oldText: anchor.oldText,
    newText: proposedName,
    kind: anchor.editKind,
    semanticClass: 'config_component' as const,
    targetId: resolved.entry.targetId,
  }));
  const blockingIssues = conflictingTargetName
    ? [{
        code: 'collision' as const,
        message:
          `Config target ${proposedName} conflicts with existing target ` +
          `${conflictingTargetName} in ${resolved.entry.namespaceId}.`,
      }]
    : [];
  const groups: WorkspaceRenamePreviewGroup[] = [];
  if (declarations.length > 0) {
    groups.push({
      group: 'declarations',
      edits: declarations,
    });
  }
  if (configEdits.length > 0) {
    groups.push({
      group: 'config',
      edits: configEdits,
    });
  }

  return {
    ok: true,
    target: {
      semanticClass: 'config_component',
      targetId: resolved.entry.targetId,
    },
    oldName: resolved.entry.name,
    newName: proposedName,
    normalizedNewName,
    namespaceId: resolved.entry.namespaceId,
    groups,
    totalEdits: declarations.length + configEdits.length,
    warnings: [],
    blockingIssues,
    canApply: blockingIssues.length === 0,
  };
}

function workspaceRenamePreviewPlanCreate(input: {
  preview: WorkspaceRenamePreviewSuccess;
  idSalt: string;
}): WorkspaceEditPlan {
  const edits = input.preview.groups.flatMap((group) =>
    group.edits.map((edit) => ({
      uri: edit.uri,
      range: edit.range,
      newText: edit.newText,
    })),
  );
  const title = input.preview.target.semanticClass === 'config_component'
    ? `Rename config target "${input.preview.oldName}" to "${input.preview.newName}"`
    : `Rename workspace package "${input.preview.oldName}" to "${input.preview.newName}"`;
  const id = createHash('sha256')
    .update(input.idSalt)
    .update('\0')
    .update(title)
    .update('\0')
    .update(JSON.stringify(edits))
    .digest('hex')
    .slice(0, 16);

  return {
    id,
    title,
    kind: 'rename',
    edits,
    diagnosticIds: [],
    execution: {
      intent: 'rename',
      mode: 'preview_then_apply',
      stalePlanPolicy: 'reject',
      atomicity: 'all_or_nothing',
      details: {
        kind: 'rename',
        targetId: input.preview.target.targetId,
        oldName: input.preview.oldName,
        newName: input.preview.newName,
      },
    },
  };
}

function workspaceSessionEditPlanStore(
  workspaceSession: WorkspaceSessionState,
  plan: WorkspaceEditPlan,
): void {
  workspaceSession.editPlans.set(plan.id, {
    plan,
    analysisRevisionAtCreation: workspaceSession.analysisRevision,
  });
}

function workspacePrepareRenameFailureCreate(
  code: WorkspacePrepareRenameFailure['code'],
  message: string,
): WorkspacePrepareRenameFailure {
  return {
    ok: false,
    code,
    message,
  };
}

function workspaceRenamePreviewFailureCreate(
  code: WorkspaceRenamePreviewFailure['code'],
  message: string,
): WorkspaceRenamePreviewFailure {
  return {
    ok: false,
    code,
    message,
  };
}

function workspaceRenameTargetPrepareFailureResolve(
  index: ProjectIndex,
  target: WorkspaceRenameTarget,
): WorkspacePrepareRenameFailure {
  if (target.semanticClass === 'architecture_node') {
    const resolvedTarget = workspaceSemanticTargetResolve(index, target.uri);
    if (!resolvedTarget) {
      return workspacePrepareRenameFailureCreate(
        'not_codepol_owned',
        'Target is not a Codepol-owned semantic target in this workspace.',
      );
    }
    return workspacePrepareRenameFailureCreate(
      'not_renameable_class',
      'Semantic class architecture_node is not renameable in MVP.',
    );
  }

  if (
    target.semanticClass === 'generated_artifact' ||
    target.semanticClass === 'relation_anchor'
  ) {
    return workspacePrepareRenameFailureCreate(
      'not_renameable_class',
      `Semantic class ${target.semanticClass} is not renameable in MVP.`,
    );
  }

  return workspacePrepareRenameFailureCreate(
    'unsupported_context',
    `Rename foundations are wired, but ${target.semanticClass} does not have a materialized Codepol rename registry yet.`,
  );
}

function workspaceRenameTargetPreviewFailureResolve(
  index: ProjectIndex,
  target: WorkspaceRenameTarget,
): WorkspaceRenamePreviewFailure {
  const prepareFailure = workspaceRenameTargetPrepareFailureResolve(index, target);
  return workspaceRenamePreviewFailureCreate(prepareFailure.code, prepareFailure.message);
}

/**
 * Build a resolver that maps an absolute file path to the monorepo
 * package that owns it (if any). A file belongs to a package when its
 * absolute path is a descendant of the package's `package.json`
 * directory; when multiple packages match, the longest matching prefix
 * wins so nested workspaces are handled correctly.
 */
function workspaceFilePackageNameResolverCreate(
  records: WorkspacePackageRecord[] | undefined,
): (filePath: string) => string | undefined {
  if (!records || records.length === 0) {
    return () => undefined;
  }
  const entries = records
    .map((record) => ({
      name: record.name,
      packageDir: path.dirname(record.packageJsonPath),
    }))
    .sort((left, right) => right.packageDir.length - left.packageDir.length);
  return (filePath: string): string | undefined => {
    for (const entry of entries) {
      if (workspacePathIsWithinDirectory(filePath, entry.packageDir)) {
        return entry.name;
      }
    }
    return undefined;
  };
}

/**
 * Check whether `filePath` is at or below `directory`. Uses `path.relative`
 * instead of string prefix matching so `foo/barely` is not treated as
 * inside `foo/bar`.
 */
function workspacePathIsWithinDirectory(
  filePath: string,
  directory: string,
): boolean {
  const relative = path.relative(directory, filePath);
  if (relative === '') return true;
  if (relative.startsWith('..')) return false;
  return !path.isAbsolute(relative);
}

/**
 * Aggregate cyclomatic complexity across every function/method symbol in
 * a file. Returns `undefined` when no symbol in the file has an attached
 * CFG (the capability is unavailable for that file), so callers can
 * distinguish "no data" from "complexity of zero".
 */
function workspaceFileAggregateCyclomaticComplexityGet(
  index: ProjectIndex,
  filePath: string,
): number | undefined {
  const symbols = index.symbolsInFileGet(filePath);
  let aggregate = 0;
  let counted = 0;
  for (const symbol of symbols) {
    if (symbol.kind !== 'function' && symbol.kind !== 'method') continue;
    const complexity = index.cyclomaticComplexityGet(symbol.id);
    if (complexity === undefined) continue;
    aggregate += complexity;
    counted += 1;
  }
  return counted > 0 ? aggregate : undefined;
}

function workspaceDependencyGraphResultCreate(
  workspace: WorkspaceContextState,
  index: ProjectIndex,
  state: WorkspaceDocumentsState,
): WorkspaceDependencyGraphResult {
  const files = [...index.filesGet()].sort();
  const cycles = index.moduleCyclesGet();
  const entryPoints = index.moduleEntryPointsGet();
  const entryPointSet = new Set(entryPoints);
  const cycleMemberSet = new Set<string>();
  for (const cycle of cycles) {
    for (const filePath of cycle) {
      cycleMemberSet.add(filePath);
    }
  }

  const filePackageNameGet = workspaceFilePackageNameResolverCreate(
    workspace.baseIndexState?.workspacePackageRecords,
  );

  const nodes: WorkspaceDependencyGraphNode[] = files.map((filePath) => {
    const importerCount = index.moduleImportersGet(filePath).length;
    const importeeCount = index.moduleImporteesGet(filePath).length;
    const symbolCount = index.symbolsInFileGet(filePath).length;
    const loc = workspaceFileLineCountGet(() => workspaceSourceGet(state, filePath));
    const aggregateCyclomaticComplexity =
      workspaceFileAggregateCyclomaticComplexityGet(index, filePath);
    const metrics: WorkspaceDependencyGraphNodeMetrics = {
      importerCount,
      importeeCount,
      symbolCount,
      isEntryPoint: entryPointSet.has(filePath),
      isInCycle: cycleMemberSet.has(filePath),
      ...(loc !== undefined ? { loc } : {}),
      ...(aggregateCyclomaticComplexity !== undefined
        ? { aggregateCyclomaticComplexity }
        : {}),
    };
    const packageName = filePackageNameGet(filePath);
    return {
      uri: workspacePathToUri(filePath),
      workspaceRelativePath: workspaceRelativePathCreate(workspace.rootPath, filePath),
      metrics,
      ...(packageName !== undefined ? { packageName } : {}),
    };
  });

  const edges: WorkspaceDependencyGraphEdge[] = files.flatMap((filePath) => {
    const fromPackage = filePackageNameGet(filePath);
    return index
      .moduleImporteesGet(filePath)
      .sort()
      .map((importeePath): WorkspaceDependencyGraphEdge => {
        const edgeInfo = index.moduleEdgeInfoGet(filePath, importeePath);
        const toPackage = filePackageNameGet(importeePath);
        const crossesPackageBoundary =
          fromPackage !== undefined && toPackage !== undefined
            ? fromPackage !== toPackage
            : undefined;
        const kind: WorkspaceDependencyGraphEdgeKind | undefined = edgeInfo?.kind;
        const bindingCount = edgeInfo?.bindingCount;
        return {
          fromUri: workspacePathToUri(filePath),
          toUri: workspacePathToUri(importeePath),
          ...(kind !== undefined ? { kind } : {}),
          ...(bindingCount !== undefined ? { bindingCount } : {}),
          ...(crossesPackageBoundary !== undefined
            ? { crossesPackageBoundary }
            : {}),
        };
      });
  });

  return {
    nodes,
    edges,
    entryPoints: entryPoints.map((filePath) => workspacePathToUri(filePath)),
    cycles: cycles.map((cycle) => cycle.map((filePath) => workspacePathToUri(filePath))),
  };
}

/**
 * Expose a {@link ProjectIndex} through the {@link ModuleGraph} interface
 * without rebuilding the graph. The workspace service already pays the
 * cost of lazy graph construction inside `ProjectIndex`, so we just
 * forward each method.
 *
 * This adapter keeps the pure graph-query helpers in
 * `@codepol/core/index/moduleGraphQueries` decoupled from `ProjectIndex`:
 * the helpers speak only `ModuleGraph`, and the workspace layer is the
 * only place that knows about project indexes.
 */
function moduleGraphFromIndexAdapt(index: ProjectIndex): ModuleGraph {
  return {
    moduleGraphImportersGet(file: string): string[] {
      return index.moduleImportersGet(file);
    },
    moduleGraphImporteesGet(file: string): string[] {
      return index.moduleImporteesGet(file);
    },
    moduleGraphDependencyOrderGet(): string[] {
      return index.moduleDependencyOrderGet();
    },
    moduleGraphCyclesGet(): string[][] {
      return index.moduleCyclesGet();
    },
    moduleGraphEntryPointsGet(): string[] {
      return index.moduleEntryPointsGet();
    },
  };
}

function workspaceImpactRadiusResultCreate(
  workspace: WorkspaceContextState,
  index: ProjectIndex,
  input: {
    uri: string;
    direction: WorkspaceImpactRadiusDirection;
    depth?: number;
  },
): WorkspaceDependencyGraphResult {
  const focusPath = workspaceUriToPath(input.uri);
  const graph = moduleGraphFromIndexAdapt(index);
  const impact = moduleImpactRadiusCompute(graph, {
    file: focusPath,
    direction: input.direction,
    depth: input.depth,
  });

  const includedFiles = new Set(impact.files);
  const indexedFileSet = new Set(index.filesGet());
  const cycles = index.moduleCyclesGet();
  const entryPoints = index.moduleEntryPointsGet();
  const entryPointSet = new Set(entryPoints);
  const cycleMemberSet = new Set<string>();
  for (const cycle of cycles) {
    for (const filePath of cycle) {
      cycleMemberSet.add(filePath);
    }
  }

  const filePackageNameGet = workspaceFilePackageNameResolverCreate(
    workspace.baseIndexState?.workspacePackageRecords,
  );

  const nodes: WorkspaceDependencyGraphNode[] = impact.files.map((filePath) => {
    if (!indexedFileSet.has(filePath)) {
      return {
        uri: workspacePathToUri(filePath),
        workspaceRelativePath: workspaceRelativePathCreate(workspace.rootPath, filePath),
      };
    }
    const importerCount = index.moduleImportersGet(filePath).length;
    const importeeCount = index.moduleImporteesGet(filePath).length;
    const symbolCount = index.symbolsInFileGet(filePath).length;
    const aggregateCyclomaticComplexity =
      workspaceFileAggregateCyclomaticComplexityGet(index, filePath);
    const metrics: WorkspaceDependencyGraphNodeMetrics = {
      importerCount,
      importeeCount,
      symbolCount,
      isEntryPoint: entryPointSet.has(filePath),
      isInCycle: cycleMemberSet.has(filePath),
      ...(aggregateCyclomaticComplexity !== undefined
        ? { aggregateCyclomaticComplexity }
        : {}),
    };
    const packageName = filePackageNameGet(filePath);
    return {
      uri: workspacePathToUri(filePath),
      workspaceRelativePath: workspaceRelativePathCreate(workspace.rootPath, filePath),
      metrics,
      ...(packageName !== undefined ? { packageName } : {}),
    };
  });

  const edges: WorkspaceDependencyGraphEdge[] = impact.edges.map((edge) => {
    const fromPackage = filePackageNameGet(edge.from);
    const toPackage = filePackageNameGet(edge.to);
    const crossesPackageBoundary =
      fromPackage !== undefined && toPackage !== undefined
        ? fromPackage !== toPackage
        : undefined;
    const edgeInfo = index.moduleEdgeInfoGet(edge.from, edge.to);
    const kind: WorkspaceDependencyGraphEdgeKind | undefined = edgeInfo?.kind;
    const bindingCount = edgeInfo?.bindingCount;
    return {
      fromUri: workspacePathToUri(edge.from),
      toUri: workspacePathToUri(edge.to),
      ...(kind !== undefined ? { kind } : {}),
      ...(bindingCount !== undefined ? { bindingCount } : {}),
      ...(crossesPackageBoundary !== undefined
        ? { crossesPackageBoundary }
        : {}),
    };
  });

  const filteredEntryPoints = entryPoints
    .filter((filePath) => includedFiles.has(filePath))
    .map((filePath) => workspacePathToUri(filePath));
  const filteredCycles = cycles
    .filter((cycle) => cycle.every((filePath) => includedFiles.has(filePath)))
    .map((cycle) => cycle.map((filePath) => workspacePathToUri(filePath)));

  return {
    nodes,
    edges,
    entryPoints: filteredEntryPoints,
    cycles: filteredCycles,
  };
}

function workspaceDependencyPathResultCreate(
  index: ProjectIndex,
  input: {
    fromUri: string;
    toUri: string;
    maxPaths?: number;
  },
): WorkspaceDependencyPathResult {
  const graph = moduleGraphFromIndexAdapt(index);
  const result = moduleDependencyPathCompute(graph, {
    fromFile: workspaceUriToPath(input.fromUri),
    toFile: workspaceUriToPath(input.toUri),
    maxPaths: input.maxPaths,
  });
  return {
    paths: result.paths.map((path) => path.map((filePath) => workspacePathToUri(filePath))),
    shortestLength: result.shortestLength,
    truncated: result.truncated,
  };
}

function workspaceDeadModulesResultCreate(
  index: ProjectIndex,
  input: {
    entryPointUris?: string[];
  },
): WorkspaceDeadModulesResult {
  const graph = moduleGraphFromIndexAdapt(index);
  const entryPoints = input.entryPointUris?.map((uri) => workspaceUriToPath(uri));
  const result = moduleDeadModulesCompute(graph, {
    ...(entryPoints !== undefined ? { entryPoints } : {}),
  });
  return {
    unreachable: result.unreachable.map((filePath) => workspacePathToUri(filePath)),
  };
}

/**
 * Synthetic URI scheme used for symbol-level graph nodes
 * (`queryCallGraph`, `queryTypeHierarchy`). Carrying the symbol id in
 * the URI keeps the panel's `uri`-as-key invariant intact: every
 * symbol-level node has a unique URI even when several nodes resolve
 * to the same declaration file.
 */
const WORKSPACE_SYMBOL_URI_SCHEME = 'codepol-symbol';

function workspaceSymbolUriCreate(symbolId: string): string {
  return `${WORKSPACE_SYMBOL_URI_SCHEME}://${encodeURIComponent(symbolId)}`;
}

function workspaceSymbolGraphNodeBuild(
  workspace: WorkspaceContextState,
  index: ProjectIndex,
  symbolId: string,
): WorkspaceDependencyGraphNode {
  const symbol = index.symbolGet(symbolId);
  if (!symbol) {
    return {
      uri: workspaceSymbolUriCreate(symbolId),
      workspaceRelativePath: symbolId,
      symbolId,
    };
  }
  const declarationUri = workspacePathToUri(symbol.file);
  const workspaceRelative = workspaceRelativePathCreate(workspace.rootPath, symbol.file);
  return {
    uri: workspaceSymbolUriCreate(symbolId),
    workspaceRelativePath:
      symbol.name.length > 0
        ? `${workspaceRelative}::${symbol.name}`
        : workspaceRelative,
    symbolId,
    symbolName: symbol.name,
    symbolKind: symbol.kind,
    declarationUri,
  };
}

function workspaceSymbolGraphResultCreate(input: {
  workspace: WorkspaceContextState;
  index: ProjectIndex;
  symbols: string[];
  edges: Array<{ from: string; to: string }>;
}): WorkspaceDependencyGraphResult {
  const nodes: WorkspaceDependencyGraphNode[] = input.symbols.map((symbolId) =>
    workspaceSymbolGraphNodeBuild(input.workspace, input.index, symbolId),
  );
  const edges: WorkspaceDependencyGraphEdge[] = input.edges.map((edge) => ({
    fromUri: workspaceSymbolUriCreate(edge.from),
    toUri: workspaceSymbolUriCreate(edge.to),
  }));
  return {
    nodes,
    edges,
    entryPoints: [],
    cycles: [],
  };
}

/**
 * Default soft timeout (ms) the workspace applies on top of a
 * {@link TypeAwareCallGraphSource} call. On timeout, the merge degrades
 * silently to the structural-only result and logs once at debug level.
 *
 * Pinned to the same value Phase 9.5 uses for the type-hierarchy source
 * (2000 ms) so the two surfaces share one knob; bump only by editing
 * both together.
 */
const WORKSPACE_TYPE_AWARE_CALL_GRAPH_SOURCE_TIMEOUT_MS = 2000;

/**
 * Structured error raised when `queryCallGraph` is invoked with
 * `requireTypeAware: true` but no `TypeAwareCallGraphSource` is
 * registered for the seed symbol's language. The shape mirrors the
 * spec table in Phase 9.2 / Step 4.
 */
export type TypeAwareCallGraphSourceMissingError = Error & {
  code: 'type-aware-source-missing';
  languageId: string;
};

function typeAwareCallGraphSourceMissingErrorCreate(
  languageId: string,
): TypeAwareCallGraphSourceMissingError {
  const error = new Error(
    `No TypeAwareCallGraphSource registered for language "${languageId}"`,
  ) as TypeAwareCallGraphSourceMissingError;
  error.code = 'type-aware-source-missing';
  error.languageId = languageId;
  return error;
}

/**
 * Best-effort language-id detection for the file containing a symbol.
 * Used to look up the right `TypeAwareCallGraphSource`. Mirrors the
 * extension map from `indexBuilder.languageIdFromFile` so the workspace
 * surface stays in sync without a hard import dependency on that
 * private helper.
 */
function workspaceTypeAwareBridgeRegistrationsCollect(
  definitions: readonly WorkspaceTypeAwareBridgeDefinition[],
): WorkspaceTypeAwareBridgeRegistration[] {
  return definitions.flatMap((definition) => [...definition.registrations]);
}

function workspaceTypeAwareBridgeLanguageIdsByExtensionCreate(
  definitions: readonly WorkspaceTypeAwareBridgeDefinition[],
): Map<string, string> {
  const byExtension = new Map<string, string>();
  for (const registration of workspaceTypeAwareBridgeRegistrationsCollect(definitions)) {
    for (const fileExtension of registration.fileExtensions) {
      byExtension.set(fileExtension.toLowerCase(), registration.languageId);
    }
  }
  return byExtension;
}

function workspaceSymbolLanguageIdGet(
  index: ProjectIndex,
  symbolId: SymbolId,
  languageIdsByExtension: ReadonlyMap<string, string>,
): string | undefined {
  const symbol = index.symbolGet(symbolId);
  if (!symbol) return undefined;
  const ext = symbol.file.slice(symbol.file.lastIndexOf('.')).toLowerCase();
  return languageIdsByExtension.get(ext);
}

/**
 * Run `op` with a soft timeout. Resolves with `op`'s value on success,
 * or `undefined` on timeout or rejection. Cancellable via `signal` —
 * when aborted, the helper returns `undefined` immediately. The
 * underlying `op` is responsible for honoring `signal` itself; this
 * helper only stops *waiting* for it.
 */
async function workspaceTypeAwareSourceCallWithBudget<T>(
  op: () => Promise<T>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<T | undefined> {
  if (signal?.aborted) return undefined;
  return await new Promise<T | undefined>((resolve) => {
    let settled = false;
    const settle = (value: T | undefined): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timeoutHandle = setTimeout(() => settle(undefined), timeoutMs);
    const onAbort = (): void => {
      clearTimeout(timeoutHandle);
      settle(undefined);
    };
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
    op().then(
      (value) => {
        clearTimeout(timeoutHandle);
        if (signal) signal.removeEventListener('abort', onAbort);
        settle(value);
      },
      () => {
        clearTimeout(timeoutHandle);
        if (signal) signal.removeEventListener('abort', onAbort);
        settle(undefined);
      },
    );
  });
}

/**
 * Conflict-resolution merge between the structural call-graph edges
 * (`structuralEdges`) and an optional set of type-aware edges
 * (`typeAwareEdges`). Implements the table in Phase 9.2 / Step 4
 * exactly:
 *
 * | In S? | In T? | Output `callGraphConfidence` | Output `callGraphKind`         |
 * | ----- | ----- | ---------------------------- | ------------------------------ |
 * | yes   | yes   | `'type-aware'`               | `T`'s `callKind` (≥ `'direct'`)|
 * | yes   | no    | `'structural'`               | `'direct'`                     |
 * | no    | yes   | `'type-aware'`               | `T`'s `callKind`               |
 *
 * Type-aware never demotes a structural edge: an edge in `S` that is
 * missing from `T` is preserved as `'structural'`. This is the
 * intentional conservative choice — language servers can lag, fail to
 * index a file, or return partial results, and silently dropping
 * structural edges to a transient `T` would be a correctness
 * regression.
 *
 * When `typeAwareEdges` is `undefined` (no source registered, source
 * timed out, or source threw) the merge returns the structural edges
 * with no confidence/kind fields set — byte-identical to the legacy
 * Phase 7 output.
 */
function workspaceCallGraphEdgesMerge(input: {
  structuralEdges: ReadonlyArray<{ from: SymbolId; to: SymbolId }>;
  typeAwareEdges: TypeAwareCallEdge[] | undefined;
  symbolUriCreate: (symbolId: SymbolId) => string;
}): WorkspaceDependencyGraphEdge[] {
  const structuralKeys = new Set<string>();
  const merged = new Map<string, WorkspaceDependencyGraphEdge>();

  if (!input.typeAwareEdges) {
    // Untagged path: byte-identical to the legacy result. Sorted by
    // (from, to) for determinism.
    const sorted = [...input.structuralEdges].sort((left, right) => {
      if (left.from !== right.from) return left.from < right.from ? -1 : 1;
      if (left.to !== right.to) return left.to < right.to ? -1 : 1;
      return 0;
    });
    return sorted.map((edge) => ({
      fromUri: input.symbolUriCreate(edge.from),
      toUri: input.symbolUriCreate(edge.to),
    }));
  }

  for (const edge of input.structuralEdges) {
    const key = `${edge.from}\u0000${edge.to}`;
    structuralKeys.add(key);
    merged.set(key, {
      fromUri: input.symbolUriCreate(edge.from),
      toUri: input.symbolUriCreate(edge.to),
      callGraphConfidence: 'structural',
      callGraphKind: 'direct',
    });
  }

  for (const edge of input.typeAwareEdges) {
    const key = `${edge.callerSymbolId}\u0000${edge.calleeSymbolId}`;
    merged.set(key, {
      fromUri: input.symbolUriCreate(edge.callerSymbolId),
      toUri: input.symbolUriCreate(edge.calleeSymbolId),
      callGraphConfidence: 'type-aware',
      callGraphKind: edge.callKind,
    });
  }

  const sortedKeys = [...merged.keys()].sort();
  return sortedKeys.map((key) => merged.get(key)!);
}

/**
 * Pull the type-aware edge set for a single seed symbol, applying the
 * shared timeout/cancellation budget. Returns `undefined` on no
 * source, source error, source timeout, or signal abort — every
 * non-success path collapses to "fall back to structural-only".
 */
async function workspaceCallGraphTypeAwareEdgesGet(input: {
  source: TypeAwareCallGraphSource;
  symbolId: SymbolId;
  direction: WorkspaceCallGraphDirection;
  signal: AbortSignal | undefined;
}): Promise<TypeAwareCallEdge[] | undefined> {
  const wantsCallers = input.direction === 'callers' || input.direction === 'both';
  const wantsCallees = input.direction === 'callees' || input.direction === 'both';

  const callersOp =
    wantsCallers && input.source.typeAwareCallersGet
      ? workspaceTypeAwareSourceCallWithBudget(
          () => input.source.typeAwareCallersGet!(input.symbolId),
          WORKSPACE_TYPE_AWARE_CALL_GRAPH_SOURCE_TIMEOUT_MS,
          input.signal,
        )
      : Promise.resolve<TypeAwareCallEdge[] | undefined>(undefined);
  const calleesOp =
    wantsCallees && input.source.typeAwareCalleesGet
      ? workspaceTypeAwareSourceCallWithBudget(
          () => input.source.typeAwareCalleesGet!(input.symbolId),
          WORKSPACE_TYPE_AWARE_CALL_GRAPH_SOURCE_TIMEOUT_MS,
          input.signal,
        )
      : Promise.resolve<TypeAwareCallEdge[] | undefined>(undefined);

  const [callersResult, calleesResult] = await Promise.all([callersOp, calleesOp]);

  // If we wanted both directions but neither source method exists or
  // both timed out, treat as "no type-aware data" and fall back.
  if (callersResult === undefined && calleesResult === undefined) {
    if (!wantsCallers && !wantsCallees) return [];
    if (
      (wantsCallers && !input.source.typeAwareCallersGet) &&
      (wantsCallees && !input.source.typeAwareCalleesGet)
    ) {
      return undefined;
    }
    return undefined;
  }

  return [...(callersResult ?? []), ...(calleesResult ?? [])];
}

async function workspaceCallGraphResultCreate(
  workspace: WorkspaceContextState,
  index: ProjectIndex,
  registry: TypeAwareCallGraphSourceRegistry,
  input: {
    symbolId: string;
    direction: WorkspaceCallGraphDirection;
    depth?: number;
    requireTypeAware?: boolean;
    signal?: AbortSignal;
    languageIdResolve(symbolId: SymbolId): string | undefined;
  },
): Promise<WorkspaceDependencyGraphResult> {
  const structural = symbolCallGraphCompute(
    {
      callersGet: (id) => index.callersGet(id),
      calleesGet: (id) => index.calleesGet(id),
    },
    {
      symbolId: input.symbolId,
      direction: input.direction,
      depth: input.depth,
    },
  );

  const languageId = input.languageIdResolve(input.symbolId);
  const source = languageId
    ? registry.typeAwareCallGraphSourceGet(languageId)
    : undefined;

  if (!source) {
    if (input.requireTypeAware) {
      throw typeAwareCallGraphSourceMissingErrorCreate(languageId ?? 'unknown');
    }
    // No source → byte-identical to the legacy result.
    return workspaceSymbolGraphResultCreateMerged({
      workspace,
      index,
      symbols: structural.symbols,
      edges: workspaceCallGraphEdgesMerge({
        structuralEdges: structural.edges,
        typeAwareEdges: undefined,
        symbolUriCreate: workspaceSymbolUriCreate,
      }),
    });
  }

  const typeAwareEdges = await workspaceCallGraphTypeAwareEdgesGet({
    source,
    symbolId: input.symbolId,
    direction: input.direction,
    signal: input.signal,
  });

  // Merge edges. We keep the structural BFS-derived `symbols` set as
  // the seed because the structural traversal already enforces
  // depth-bounded visited-set semantics — the type-aware source only
  // contributes edges, not new nodes, in this MVP. Adding new nodes
  // from `T` is left to a follow-up once the merge proves itself.
  const mergedEdges = workspaceCallGraphEdgesMerge({
    structuralEdges: structural.edges,
    typeAwareEdges,
    symbolUriCreate: workspaceSymbolUriCreate,
  });

  return workspaceSymbolGraphResultCreateMerged({
    workspace,
    index,
    symbols: structural.symbols,
    edges: mergedEdges,
  });
}

/**
 * Like {@link workspaceSymbolGraphResultCreate} but accepts already-built
 * edges. Used by the call-graph merge so the symbol-uri-derived edges
 * carry the optional `callGraphConfidence` / `callGraphKind` tags.
 */
function workspaceSymbolGraphResultCreateMerged(input: {
  workspace: WorkspaceContextState;
  index: ProjectIndex;
  symbols: string[];
  edges: WorkspaceDependencyGraphEdge[];
}): WorkspaceDependencyGraphResult {
  const nodes: WorkspaceDependencyGraphNode[] = input.symbols.map((symbolId) =>
    workspaceSymbolGraphNodeBuild(input.workspace, input.index, symbolId),
  );
  return {
    nodes,
    edges: input.edges,
    entryPoints: [],
    cycles: [],
  };
}

/**
 * Build a {@link WorkspaceSymbolFlowResult} from the indexed
 * {@link SymbolFlowRelation}s. Edges are sorted by
 * `(file, range.start, argumentIndex ?? 0)` so byte-identical inputs
 * produce byte-identical outputs.
 */
function workspaceSymbolFlowResultCreate(input: {
  workspace: WorkspaceContextState;
  state: WorkspaceDocumentsState;
  index: ProjectIndex;
  symbolId: string;
  direction: WorkspaceSymbolFlowDirection;
}): WorkspaceSymbolFlowResult {
  const relations = input.direction === 'outgoing'
    ? input.index.symbolFlowsForSymbolGet(input.symbolId)
    : input.index.symbolFlowsForReceiverGet(input.symbolId);

  const edges: WorkspaceSymbolFlowEdge[] = relations
    .map((relation) => workspaceSymbolFlowEdgeFromRelation({
      workspace: input.workspace,
      state: input.state,
      index: input.index,
      relation,
    }))
    .filter((edge): edge is WorkspaceSymbolFlowEdge => edge !== undefined);

  edges.sort((left, right) => {
    if (left.file !== right.file) return left.file < right.file ? -1 : 1;
    const leftStart = left.range.start;
    const rightStart = right.range.start;
    if (leftStart.line !== rightStart.line) return leftStart.line - rightStart.line;
    if (leftStart.character !== rightStart.character)
      return leftStart.character - rightStart.character;
    const leftIndex = left.argumentIndex ?? 0;
    const rightIndex = right.argumentIndex ?? 0;
    return leftIndex - rightIndex;
  });

  return { edges };
}

function workspaceSymbolFlowEdgeFromRelation(input: {
  workspace: WorkspaceContextState;
  state: WorkspaceDocumentsState;
  index: ProjectIndex;
  relation: SymbolFlowRelation;
}): WorkspaceSymbolFlowEdge | undefined {
  const { relation } = input;
  const flowingSymbol = input.index.symbolGet(relation.flowingSymbolId);
  if (!flowingSymbol) return undefined;
  const ownerSymbol = workspaceFlowOwnerSymbolGet(input.index, relation);
  const source = workspaceSourceGet(input.state, relation.file);
  const range = workspaceRangeFromByteRange(source, relation.byteRange);
  return {
    flowingSymbolId: relation.flowingSymbolId,
    flowingSymbolUri: workspacePathToUri(flowingSymbol.file),
    ...(ownerSymbol
      ? {
          ownerSymbolId: ownerSymbol.id,
          ownerSymbolUri: workspacePathToUri(ownerSymbol.file),
        }
      : {}),
    file: workspaceRelativePathCreate(input.workspace.rootPath, relation.file),
    range,
    flowKind: 'argument',
    ...(relation.receivingCallSymbolId !== undefined
      ? { receivingCallSymbolId: relation.receivingCallSymbolId }
      : {}),
    ...(relation.argumentIndex !== undefined
      ? { argumentIndex: relation.argumentIndex }
      : {}),
  };
}

/**
 * Resolve the function/method symbol that owns the flow site's
 * scope, when one exists. Used to populate
 * {@link WorkspaceSymbolFlowEdge.ownerSymbolId}.
 *
 * Walks up from `relation.ownerScopeId` looking for the first scope
 * whose byte range matches a function/method symbol declared in the
 * same file. Returns `undefined` for top-level flow sites.
 */
function workspaceFlowOwnerSymbolGet(
  index: ProjectIndex,
  relation: SymbolFlowRelation,
): SymbolRecord | undefined {
  const ownerScope = index.scopeGet(relation.ownerScopeId);
  if (!ownerScope) return undefined;
  const fileSymbols = index.symbolsInFileGet(relation.file);
  for (const symbol of fileSymbols) {
    if (symbol.kind !== 'function' && symbol.kind !== 'method') continue;
    if (symbol.byteRange.start <= ownerScope.byteRange.start &&
        symbol.byteRange.end >= ownerScope.byteRange.end) {
      return symbol;
    }
  }
  return undefined;
}

/**
 * Structured error raised when `queryTypeHierarchy` is invoked with
 * `requireTypeAware: true` but no `TypeAwareTypeHierarchySource` is
 * registered for the seed symbol's language. Mirrors
 * {@link TypeAwareCallGraphSourceMissingError} (Phase 9.2).
 */
export type TypeAwareTypeHierarchySourceMissingError = Error & {
  code: 'type-aware-source-missing';
  languageId: string;
};

function typeAwareTypeHierarchySourceMissingErrorCreate(
  languageId: string,
): TypeAwareTypeHierarchySourceMissingError {
  const error = new Error(
    `No TypeAwareTypeHierarchySource registered for language "${languageId}"`,
  ) as TypeAwareTypeHierarchySourceMissingError;
  error.code = 'type-aware-source-missing';
  error.languageId = languageId;
  return error;
}

/**
 * Pull the type-aware type-hierarchy edge set for a single seed
 * symbol, applying the shared timeout/cancellation budget. Returns
 * `undefined` on no source method, source error, source timeout, or
 * signal abort — every non-success path collapses to "fall back to the
 * structural answer".
 */
async function workspaceTypeHierarchyTypeAwareEdgesGet(input: {
  source: TypeAwareTypeHierarchySource;
  symbolId: SymbolId;
  direction: WorkspaceTypeHierarchyDirection;
  signal: AbortSignal | undefined;
}): Promise<TypeAwareTypeHierarchyEdge[] | undefined> {
  const wantsImplementers =
    input.direction === 'subtypes' || input.direction === 'both';
  const wantsSupertypes =
    input.direction === 'supertypes' || input.direction === 'both';

  const implementersOp =
    wantsImplementers && input.source.typeAwareImplementersGet
      ? workspaceTypeAwareSourceCallWithBudget(
          () => input.source.typeAwareImplementersGet!(input.symbolId),
          // Pinned to the same value Phase 9.2 uses for the call-graph
          // source so the two surfaces share one knob.
          WORKSPACE_TYPE_AWARE_CALL_GRAPH_SOURCE_TIMEOUT_MS,
          input.signal,
        )
      : Promise.resolve<TypeAwareTypeHierarchyEdge[] | undefined>(undefined);
  const supertypesOp =
    wantsSupertypes && input.source.typeAwareSupertypesGet
      ? workspaceTypeAwareSourceCallWithBudget(
          () => input.source.typeAwareSupertypesGet!(input.symbolId),
          WORKSPACE_TYPE_AWARE_CALL_GRAPH_SOURCE_TIMEOUT_MS,
          input.signal,
        )
      : Promise.resolve<TypeAwareTypeHierarchyEdge[] | undefined>(undefined);

  const [implementersResult, supertypesResult] = await Promise.all([
    implementersOp,
    supertypesOp,
  ]);

  if (implementersResult === undefined && supertypesResult === undefined) {
    return undefined;
  }
  return [...(implementersResult ?? []), ...(supertypesResult ?? [])];
}

/**
 * Numeric ordering for {@link WorkspaceTypeHierarchyEdgeConfidence} so
 * `minConfidence` filtering can compare tiers.
 */
const WORKSPACE_TYPE_HIERARCHY_CONFIDENCE_RANK: Record<
  WorkspaceTypeHierarchyEdgeConfidence,
  number
> = {
  declared: 0,
  'structural-shape': 1,
  'type-aware': 2,
};

/**
 * Pick the confidence label for the merged result, given whether the
 * edge appeared in the structural set, the structural-shape set, and
 * the type-aware set. Implements the merge table in Phase 9.5 / Step 3:
 *
 * - structural + type-aware → `'type-aware'`
 * - shape + type-aware     → `'type-aware'`
 * - type-aware only        → `'type-aware'`
 * - structural only        → `'declared'`
 * - shape only             → `'structural-shape'`
 */
function workspaceTypeHierarchyEdgeConfidencePick(input: {
  inDeclared: boolean;
  inStructuralShape: boolean;
  inTypeAware: boolean;
}): WorkspaceTypeHierarchyEdgeConfidence {
  if (input.inTypeAware) return 'type-aware';
  if (input.inDeclared) return 'declared';
  return 'structural-shape';
}

async function workspaceTypeHierarchyResultCreate(
  workspace: WorkspaceContextState,
  index: ProjectIndex,
  registry: TypeAwareTypeHierarchySourceRegistry,
  input: {
    symbolId: string;
    direction: WorkspaceTypeHierarchyDirection;
    depth?: number;
    includeStructural?: boolean;
    minConfidence?: WorkspaceTypeHierarchyEdgeConfidence;
    requireTypeAware?: boolean;
    signal?: AbortSignal;
    languageIdResolve(symbolId: SymbolId): string | undefined;
  },
): Promise<WorkspaceDependencyGraphResult> {
  const includeStructural = input.includeStructural === true;

  // Build the structural answer. Default-mode `subTypesGet` /
  // `typeRelationsGet` are byte-identical to the pre-Phase-9.4 result
  // when `includeStructural` is false (the queries default to
  // `confidence: 'declared'`).
  const view = {
    superTypesGet(symbolId: string): string[] {
      const ids = new Set<string>();
      const relations = includeStructural
        ? index.typeRelationsGet(symbolId, { confidence: 'all' })
        : index.typeRelationsGet(symbolId);
      for (const relation of relations) {
        if (relation.resolvedTargetId === undefined) continue;
        ids.add(relation.resolvedTargetId);
      }
      return [...ids].sort();
    },
    subTypesGet(symbolId: string): string[] {
      const ids = new Set<string>();
      const relations = includeStructural
        ? index.subTypesGet(symbolId, { confidence: 'all' })
        : index.subTypesGet(symbolId);
      for (const relation of relations) {
        if (relation.resolvedTargetId !== symbolId) continue;
        ids.add(relation.symbolId);
      }
      return [...ids].sort();
    },
  };
  const structural = symbolTypeHierarchyCompute(view, {
    symbolId: input.symbolId,
    direction: input.direction,
    depth: input.depth,
  });

  // Determine the per-edge confidence label by inspecting the
  // underlying relation's `confidence` field. The structural BFS
  // already produced edges oriented `from = subtype`, `to = supertype`;
  // we re-walk them and tag each one.
  const declaredKeys = new Set<string>();
  const structuralShapeKeys = new Set<string>();
  for (const edge of structural.edges) {
    const declaredRelations = index.typeRelationsGet(edge.from);
    if (
      declaredRelations.some(
        (rel) =>
          rel.resolvedTargetId === edge.to &&
          (rel.confidence === undefined || rel.confidence === 'declared'),
      )
    ) {
      declaredKeys.add(`${edge.from}\u0000${edge.to}`);
    }
    if (includeStructural) {
      const allRelations = index.typeRelationsGet(edge.from, { confidence: 'all' });
      if (
        allRelations.some(
          (rel) =>
            rel.resolvedTargetId === edge.to &&
            rel.confidence === 'structural-shape',
        )
      ) {
        structuralShapeKeys.add(`${edge.from}\u0000${edge.to}`);
      }
    }
  }

  // Pull the type-aware overlay (if any).
  const languageId = input.languageIdResolve(input.symbolId);
  const source = languageId
    ? registry.typeAwareTypeHierarchySourceGet(languageId)
    : undefined;

  if (!source) {
    if (input.requireTypeAware) {
      throw typeAwareTypeHierarchySourceMissingErrorCreate(languageId ?? 'unknown');
    }
  }

  let typeAwareEdges: TypeAwareTypeHierarchyEdge[] | undefined;
  if (source) {
    typeAwareEdges = await workspaceTypeHierarchyTypeAwareEdgesGet({
      source,
      symbolId: input.symbolId,
      direction: input.direction,
      signal: input.signal,
    });
  }

  // Merge: keep the structural symbols set (the BFS already enforced
  // depth + visited-set) and rebuild the edge list with confidence
  // labels. Type-aware edges may add new edges (and therefore new
  // symbols); add those too.
  const symbolsSet = new Set<string>(structural.symbols);
  type MergedEdge = {
    from: string;
    to: string;
    confidence: WorkspaceTypeHierarchyEdgeConfidence;
  };
  const mergedEdgesByKey = new Map<string, MergedEdge>();

  for (const edge of structural.edges) {
    const key = `${edge.from}\u0000${edge.to}`;
    const inDeclared = declaredKeys.has(key);
    const inStructuralShape = structuralShapeKeys.has(key);
    mergedEdgesByKey.set(key, {
      from: edge.from,
      to: edge.to,
      confidence: workspaceTypeHierarchyEdgeConfidencePick({
        inDeclared,
        inStructuralShape,
        inTypeAware: false,
      }),
    });
  }

  if (typeAwareEdges) {
    for (const edge of typeAwareEdges) {
      const key = `${edge.subtypeSymbolId}\u0000${edge.supertypeSymbolId}`;
      symbolsSet.add(edge.subtypeSymbolId);
      symbolsSet.add(edge.supertypeSymbolId);
      mergedEdgesByKey.set(key, {
        from: edge.subtypeSymbolId,
        to: edge.supertypeSymbolId,
        confidence: 'type-aware',
      });
    }
  }

  // Apply `minConfidence` filter (default `'declared'` keeps all
  // tiers since `'declared'` is the lowest rank).
  const minConfidence = input.minConfidence ?? 'declared';
  const minRank = WORKSPACE_TYPE_HIERARCHY_CONFIDENCE_RANK[minConfidence];

  const filteredEdges: WorkspaceDependencyGraphEdge[] = [];
  const sortedKeys = [...mergedEdgesByKey.keys()].sort();
  for (const key of sortedKeys) {
    const edge = mergedEdgesByKey.get(key)!;
    if (WORKSPACE_TYPE_HIERARCHY_CONFIDENCE_RANK[edge.confidence] < minRank) continue;
    filteredEdges.push({
      fromUri: workspaceSymbolUriCreate(edge.from),
      toUri: workspaceSymbolUriCreate(edge.to),
      typeRelationConfidence: edge.confidence,
    });
  }

  // Default callers (no `includeStructural`, no source registered)
  // get an output that matches the legacy shape — strip the optional
  // `typeRelationConfidence` field so the JSON is byte-identical.
  if (!includeStructural && !typeAwareEdges) {
    return workspaceSymbolGraphResultCreate({
      workspace,
      index,
      symbols: structural.symbols,
      edges: structural.edges,
    });
  }

  const symbolsList = [...symbolsSet];
  const nodes = symbolsList.map((symbolId) =>
    workspaceSymbolGraphNodeBuild(workspace, index, symbolId),
  );
  return {
    nodes,
    edges: filteredEdges,
    entryPoints: [],
    cycles: [],
  };
}

// ============================================================================
// Symbol-id discovery (querySymbolLookup / querySymbolAtPosition)
// ============================================================================

/**
 * Default upper bound on `querySymbolLookup` results when the caller
 * does not pass an explicit `limit`. Picked to be large enough to
 * include every overload in a typical file but small enough to keep
 * the editor round-trip cheap.
 */
const WORKSPACE_SYMBOL_LOOKUP_LIMIT_DEFAULT = 50;

/**
 * The set of `SymbolKind` values the workspace surface accepts as a
 * `WorkspaceSymbolDescriptorKind`. Mirrors the union one-for-one; kept
 * as a runtime guard so the lookup surface can validate the caller's
 * `kind` filter without depending on the core enum.
 */
const WORKSPACE_SYMBOL_DESCRIPTOR_KINDS: readonly WorkspaceSymbolDescriptorKind[] = [
  'module',
  'namespace',
  'class',
  'interface',
  'type',
  'function',
  'method',
  'variable',
  'const',
  'field',
  'parameter',
  'enum',
  'enumMember',
];

function workspaceSymbolDescriptorKindIs(
  value: SymbolKind,
): value is WorkspaceSymbolDescriptorKind {
  return (WORKSPACE_SYMBOL_DESCRIPTOR_KINDS as readonly string[]).includes(value);
}

/**
 * Build a {@link WorkspaceSymbolDescriptor} from an indexed symbol.
 * Centralizes the "byte-range to workspace-range" conversion so both
 * the lookup and the at-position queries return identical shapes.
 */
function workspaceSymbolDescriptorCreate(
  state: WorkspaceDocumentsState,
  symbol: SymbolRecord,
): WorkspaceSymbolDescriptor {
  const source = workspaceSourceGet(state, symbol.file);
  return {
    symbolId: symbol.id,
    name: symbol.name,
    kind: symbol.kind as WorkspaceSymbolDescriptorKind,
    declarationUri: workspacePathToUri(symbol.file),
    declarationRange: workspaceRangeFromByteRange(source, symbol.byteRange),
  };
}

function workspaceTypeAwareBridgeSymbolTableCreate(
  state: WorkspaceDocumentsState,
  index: ProjectIndex,
): WorkspaceTypeAwareBridgeSymbolTable {
  return {
    symbolLocate(symbolId) {
      const symbol = index.symbolGet(symbolId);
      if (!symbol || !workspaceSymbolDescriptorKindIs(symbol.kind)) {
        return undefined;
      }
      const source = workspaceSourceGet(state, symbol.file);
      let targetByteStart = symbol.byteRange.start;
      if (symbol.name) {
        const declarationSlice = source.slice(symbol.byteRange.start, symbol.byteRange.end);
        const nameOffset = declarationSlice.indexOf(symbol.name);
        if (nameOffset >= 0) {
          targetByteStart = symbol.byteRange.start + nameOffset;
        }
      }
      const nameRange = workspaceRangeFromByteRange(source, {
        start: targetByteStart,
        end: Math.min(targetByteStart + Math.max(symbol.name.length, 1), symbol.byteRange.end),
      });
      return {
        uri: workspacePathToUri(symbol.file),
        line: nameRange.start.line,
        character: nameRange.start.character,
      };
    },
    symbolIdResolve(location) {
      const result = workspaceSymbolAtPositionResultCreate(state, index, {
        uri: location.uri,
        position: {
          line: location.line,
          character: location.character,
        },
      });
      return result.symbol?.symbolId;
    },
    symbolKindResolve(symbolId) {
      const symbol = index.symbolGet(symbolId);
      if (!symbol || !workspaceSymbolDescriptorKindIs(symbol.kind)) {
        return undefined;
      }
      if (symbol.kind === 'interface') return 'interface';
      if (symbol.kind === 'class') return 'class';
      return 'other';
    },
  };
}

type WorkspaceTypeAwareBridgeActiveContext = {
  execution: WorkspaceTypeAwareBridgeExecutionContext;
  symbolTable: WorkspaceTypeAwareBridgeSymbolTable;
};

async function workspaceTypeAwareBridgeLifecycleCall(
  lifecycleCall: Promise<void> | void,
): Promise<void> {
  try {
    await lifecycleCall;
  } catch {
    // Type-aware backends are optional upgrades; lifecycle failures
    // must not break core workspace attach / overlay behavior.
  }
}

function workspaceTypeAwareBridgeExecutionContextCreate(input: {
  clientSessionId: ClientSessionId;
  workspace: WorkspaceContextState & { workspaceId: string };
}): WorkspaceTypeAwareBridgeExecutionContext {
  return {
    clientSessionId: input.clientSessionId,
    workspaceId: input.workspace.workspaceId,
    rootPath: input.workspace.rootPath,
    configPath: input.workspace.configPath,
  };
}

function workspaceSymbolLookupResultCreate(
  state: WorkspaceDocumentsState,
  index: ProjectIndex,
  input: {
    name: string;
    kind?: WorkspaceSymbolDescriptorKind;
    scopeUri?: string;
    limit?: number;
  },
): WorkspaceSymbolLookupResult {
  let scopeFilePath: string | undefined;
  if (input.scopeUri !== undefined) {
    try {
      scopeFilePath = workspaceUriToPath(input.scopeUri);
    } catch {
      return { symbols: [] };
    }
  }
  const filter: { name: string; kind?: SymbolKind; file?: string } = {
    name: input.name,
  };
  if (input.kind !== undefined) {
    filter.kind = input.kind;
  }
  if (scopeFilePath !== undefined) {
    filter.file = scopeFilePath;
  }
  const matches = index.symbolsGet(filter);
  matches.sort((left, right) => {
    const fileDifference = left.file.localeCompare(right.file);
    if (fileDifference !== 0) return fileDifference;
    const startDifference = left.byteRange.start - right.byteRange.start;
    if (startDifference !== 0) return startDifference;
    return left.id.localeCompare(right.id);
  });
  const limit =
    input.limit !== undefined && input.limit > 0
      ? Math.floor(input.limit)
      : WORKSPACE_SYMBOL_LOOKUP_LIMIT_DEFAULT;
  const trimmed = matches.slice(0, limit);
  return {
    symbols: trimmed
      .filter((symbol) => workspaceSymbolDescriptorKindIs(symbol.kind))
      .map((symbol) => workspaceSymbolDescriptorCreate(state, symbol)),
  };
}

/**
 * Find the smallest (innermost) symbol whose declaration byte range
 * contains the editor cursor position. Returns `{ symbol: undefined }`
 * when nothing matches — never throws on an unindexed file or an
 * out-of-range position so the editor surfaces stay forgiving.
 */
function workspaceSymbolAtPositionResultCreate(
  state: WorkspaceDocumentsState,
  index: ProjectIndex,
  input: {
    uri: string;
    position: WorkspacePosition;
  },
): WorkspaceSymbolAtPositionResult {
  let filePath: string;
  try {
    filePath = workspaceUriToPath(input.uri);
  } catch {
    return { symbol: undefined };
  }
  const symbols = index.symbolsInFileGet(filePath);
  if (symbols.length === 0) {
    return { symbol: undefined };
  }
  const source = workspaceSourceGet(state, filePath);
  const byteOffset = workspacePositionToByteOffset(source, input.position);
  let best: SymbolRecord | undefined;
  let bestSize = Number.POSITIVE_INFINITY;
  for (const symbol of symbols) {
    if (!workspaceSymbolDescriptorKindIs(symbol.kind)) continue;
    if (byteOffset < symbol.byteRange.start) continue;
    if (byteOffset >= symbol.byteRange.end) continue;
    const size = symbol.byteRange.end - symbol.byteRange.start;
    if (size < bestSize) {
      best = symbol;
      bestSize = size;
    }
  }
  if (!best) {
    return { symbol: undefined };
  }
  return { symbol: workspaceSymbolDescriptorCreate(state, best) };
}

/**
 * Build the per-symbol caller/callee count payload for one file.
 *
 * Walks every indexed function/method in the file and asks the call
 * graph for its caller and callee sets. Both lookups are O(N) over
 * the in-memory index — a file with 30 functions is ~60 cheap calls
 * and well under a millisecond on typical projects. The editor's
 * CodeLens fires this once per file open instead of N+1 times, so
 * the batched shape matters even though the per-call cost is tiny.
 *
 * Sort order is `(declaration line, character, symbol id)` so two
 * runs over byte-identical input produce byte-identical output. The
 * editor uses the order directly when laying out lenses.
 *
 * Symbols whose `kind` is not in the workspace descriptor union
 * (e.g. `module`-level or anonymous symbols that the descriptor type
 * cannot represent) are skipped — the lens has no row to attach to
 * for those, and emitting a descriptor with a foreign kind would
 * weaken the type guarantee. Returns `{ items: [] }` (never
 * `undefined`) for files without indexed function/method
 * declarations or for paths the URI parser rejects.
 */
function workspaceSymbolsInFileWithCallCountsResultCreate(
  state: WorkspaceDocumentsState,
  index: ProjectIndex,
  input: { uri: string },
): WorkspaceSymbolsInFileWithCallCountsResult {
  let filePath: string;
  try {
    filePath = workspaceUriToPath(input.uri);
  } catch {
    return { items: [] };
  }
  const fileSymbols = index.symbolsInFileGet(filePath);
  const items: WorkspaceSymbolWithCallCounts[] = [];
  for (const symbol of fileSymbols) {
    if (symbol.kind !== 'function' && symbol.kind !== 'method') continue;
    if (!workspaceSymbolDescriptorKindIs(symbol.kind)) continue;
    const descriptor = workspaceSymbolDescriptorCreate(state, symbol);
    items.push({
      symbol: descriptor,
      callerCount: index.callersGet(symbol.id).length,
      calleeCount: index.calleesGet(symbol.id).length,
    });
  }
  items.sort((left, right) => {
    const lineDifference =
      left.symbol.declarationRange.start.line -
      right.symbol.declarationRange.start.line;
    if (lineDifference !== 0) return lineDifference;
    const charDifference =
      left.symbol.declarationRange.start.character -
      right.symbol.declarationRange.start.character;
    if (charDifference !== 0) return charDifference;
    return left.symbol.symbolId.localeCompare(right.symbol.symbolId);
  });
  return { items };
}

/**
 * Build the per-symbol importer-count payload that powers the
 * per-export CodeLens (Phase 5 follow-up).
 *
 * Wraps {@link symbolImportersCompute} to translate file paths to
 * `file://` URIs and to count distinct importer files. Returns an
 * empty payload (with the input symbol id echoed unchanged) when the
 * input symbol id is unknown to the index — the canonical-id helper
 * normalizes unknown ids to themselves.
 */
function workspaceSymbolImporterCountResultCreate(
  index: ProjectIndex,
  input: { symbolId: string },
): WorkspaceSymbolImporterCountResult {
  const computed = symbolImportersCompute(index, { symbolId: input.symbolId });
  return {
    symbolId: computed.symbolId,
    importerCount: computed.importerFilePaths.length,
    importerUris: computed.importerFilePaths.map((filePath) =>
      workspacePathToUri(filePath),
    ),
  };
}

// ============================================================================
// Per-file import specifier discovery (queryImportSpecifiersInFile)
// ============================================================================

/**
 * Build the per-file import-specifier descriptors used by the editor's
 * import-specifier hover marker layer.
 *
 * Walks `ImportBindingRelation` and `ImportsRelation` for one file,
 * groups the bindings by their import statement byte range, and emits
 * one {@link WorkspaceImportSpecifierDescriptor} per statement whose
 * target resolves to a file inside the indexed workspace. External /
 * unresolved specifiers are dropped because the per-file metric the
 * hover card surfaces (importer / importee counts, layer / package
 * boundary) is meaningful only for in-workspace targets.
 *
 * Edge-kind precedence when multiple bindings on the same statement
 * disagree mirrors `moduleGraphEdgeInfoBuild`: `dynamic > cjs >
 * static`. A statement with no bindings (pure side-effect import or
 * dynamic import without assignment) falls through to the
 * `ImportsRelation` walk and emits with `edgeKind: 'side_effect'` and
 * `bindingCount: 0`.
 *
 * Sort order is `(range.start.line, range.start.character)` so two
 * runs over byte-identical input produce byte-identical output. The
 * marker layer applies the order directly.
 *
 * Returns `{ specifiers: [] }` (never `undefined`) for unindexed
 * files, malformed URIs, or files with no workspace-resolved imports.
 */
function workspaceImportSpecifiersInFileResultCreate(
  workspace: WorkspaceContextState,
  state: WorkspaceDocumentsState,
  index: ProjectIndex,
  input: { uri: string },
): WorkspaceImportSpecifiersInFileResult {
  let filePath: string;
  try {
    filePath = workspaceUriToPath(input.uri);
  } catch {
    return { specifiers: [] };
  }

  const indexedFiles = new Set(index.filesGet());
  if (!indexedFiles.has(filePath)) {
    return { specifiers: [] };
  }

  const filePackageNameGet = workspaceFilePackageNameResolverCreate(
    workspace.baseIndexState?.workspacePackageRecords,
  );
  const fromPackage = filePackageNameGet(filePath);

  type SpecifierAccumulator = {
    byteRange: WorkspaceByteRange;
    resolvedModulePath: string;
    edgeKind: WorkspaceDependencyGraphEdgeKind;
    bindingCount: number;
  };

  // The imports query emits one `@import.source`-class
  // `ImportsRelation` per statement — that capture is the only one
  // whose `spec` parses as a module path, so the cross-file resolver
  // sets `resolvedModulePath` exactly once per statement. We treat
  // each resolved `ImportsRelation` as the canonical anchor for one
  // statement.
  type ResolvedImport = {
    target: string;
    byteRange: WorkspaceByteRange;
  };
  const resolvedImports: ResolvedImport[] = [];
  const resolvedImportsByTarget = new Map<string, ResolvedImport[]>();
  // The TS imports query has overlapping patterns: every
  // `import_statement` matches both the specific pattern (named /
  // default / namespace / require / dynamic) AND the catch-all
  // side-effect pattern, so the same `(string)` source node is
  // captured twice and produces two `ImportsRelation` entries with
  // identical byte ranges. Dedupe by `(byteRange.start,
  // byteRange.end, target)` so each statement contributes exactly one
  // resolved import.
  const seenResolvedImports = new Set<string>();
  for (const imp of index.importsGet(filePath)) {
    const target = imp.resolvedModulePath;
    if (!target || !indexedFiles.has(target) || target === filePath) {
      continue;
    }
    const dedupKey = `${imp.byteRange.start}\0${imp.byteRange.end}\0${target}`;
    if (seenResolvedImports.has(dedupKey)) continue;
    seenResolvedImports.add(dedupKey);
    const entry: ResolvedImport = { target, byteRange: imp.byteRange };
    resolvedImports.push(entry);
    let bucket = resolvedImportsByTarget.get(target);
    if (!bucket) {
      bucket = [];
      resolvedImportsByTarget.set(target, bucket);
    }
    bucket.push(entry);
  }

  // Each binding belongs to the closest resolved `ImportsRelation`
  // with the same target (distance measured by `byteRange.start`).
  // This pairs a binding to its own statement even when the binding's
  // range is just the local-name token (the case for dynamic
  // `const x = await import(...)` and CJS
  // `const { x } = require(...)`). Multi-binding statements
  // (`import { a, b, c } from './util'`) all map to the same
  // `ImportsRelation` because every binding is at the same byteRange.
  // Multi-statement same-target (`import { a } from './x'; import
  // './x'`) still discriminates correctly because each statement's
  // binding sits closer to its own source-string capture.
  const bindingsByImport = new Map<ResolvedImport, ImportBindingRelation[]>();
  const orphanBindingsByTarget = new Map<string, ImportBindingRelation[]>();
  const bindings = index.importBindingsGet(filePath);
  for (const binding of bindings) {
    const target = binding.resolvedModulePath;
    if (!target || !indexedFiles.has(target) || target === filePath) {
      continue;
    }
    const candidates = resolvedImportsByTarget.get(target);
    const nearest = workspaceImportSpecifierNearestImport(
      binding.byteRange,
      candidates,
    );
    if (nearest) {
      let list = bindingsByImport.get(nearest);
      if (!list) {
        list = [];
        bindingsByImport.set(nearest, list);
      }
      list.push(binding);
    } else {
      // No resolved `ImportsRelation` for the binding's target — rare
      // in practice. Fall through to emit using the binding's own
      // range so the marker still appears.
      let list = orphanBindingsByTarget.get(target);
      if (!list) {
        list = [];
        orphanBindingsByTarget.set(target, list);
      }
      list.push(binding);
    }
  }

  const accumulators: SpecifierAccumulator[] = [];

  for (const imp of resolvedImports) {
    const list = bindingsByImport.get(imp) ?? [];
    if (list.length === 0) {
      // No binding picked this statement — pure side-effect import.
      accumulators.push({
        byteRange: imp.byteRange,
        resolvedModulePath: imp.target,
        edgeKind: 'side_effect',
        bindingCount: 0,
      });
      continue;
    }
    let edgeKind: WorkspaceDependencyGraphEdgeKind = workspaceImportSpecifierEdgeKindFromBinding(
      list[0]!.importStyle,
    );
    let union = workspaceImportSpecifierByteRangeUnion(
      imp.byteRange,
      list[0]!.byteRange,
    );
    for (let i = 1; i < list.length; i += 1) {
      const binding = list[i]!;
      edgeKind = workspaceImportSpecifierEdgeKindMerge(
        edgeKind,
        workspaceImportSpecifierEdgeKindFromBinding(binding.importStyle),
      );
      union = workspaceImportSpecifierByteRangeUnion(union, binding.byteRange);
    }
    accumulators.push({
      byteRange: union,
      resolvedModulePath: imp.target,
      edgeKind,
      bindingCount: list.length,
    });
  }

  // Orphan bindings: emit one descriptor per (target, byteRange) so
  // multi-binding orphan statements still collapse correctly.
  for (const [target, list] of orphanBindingsByTarget) {
    const grouped = new Map<string, SpecifierAccumulator>();
    for (const binding of list) {
      const key = `${binding.byteRange.start}\0${binding.byteRange.end}`;
      const existing = grouped.get(key);
      const bindingKind = workspaceImportSpecifierEdgeKindFromBinding(
        binding.importStyle,
      );
      if (existing) {
        existing.bindingCount += 1;
        existing.edgeKind = workspaceImportSpecifierEdgeKindMerge(
          existing.edgeKind,
          bindingKind,
        );
      } else {
        grouped.set(key, {
          byteRange: binding.byteRange,
          resolvedModulePath: target,
          edgeKind: bindingKind,
          bindingCount: 1,
        });
      }
    }
    for (const accumulator of grouped.values()) {
      accumulators.push(accumulator);
    }
  }

  if (accumulators.length === 0) {
    return { specifiers: [] };
  }

  const source = workspaceSourceGet(state, filePath);
  const specifiers: WorkspaceImportSpecifierDescriptor[] = [];
  for (const accumulator of accumulators) {
    const range = workspaceRangeFromByteRange(source, accumulator.byteRange);
    const resolvedModuleUri = workspacePathToUri(accumulator.resolvedModulePath);
    const resolvedModuleWorkspaceRelativePath = workspaceRelativePathCreate(
      workspace.rootPath,
      accumulator.resolvedModulePath,
    );
    const toPackage = filePackageNameGet(accumulator.resolvedModulePath);
    const crossesPackageBoundary =
      fromPackage !== undefined && toPackage !== undefined
        ? fromPackage !== toPackage
        : undefined;
    specifiers.push({
      range,
      resolvedModuleUri,
      resolvedModuleWorkspaceRelativePath,
      edgeKind: accumulator.edgeKind,
      bindingCount: accumulator.bindingCount,
      ...(crossesPackageBoundary !== undefined
        ? { crossesPackageBoundary }
        : {}),
    });
  }

  specifiers.sort((left, right) => {
    const lineDifference = left.range.start.line - right.range.start.line;
    if (lineDifference !== 0) return lineDifference;
    return left.range.start.character - right.range.start.character;
  });

  return { specifiers };
}

/**
 * Pair a binding to its nearest unclaimed `ImportsRelation` for the
 * same target. Distance is measured by `byteRange.start` — for bindings
 * whose own range is just the local-name token (dynamic / CJS), the
 * source-string capture on the same line is the closest unclaimed
 * import; for bindings whose range is the full statement (static),
 * the binding's start sits before the source string but still wins
 * over any later statement's import. Multi-statement-same-target is
 * handled because each statement's binding is closer to its own
 * source string than to the other statement's.
 *
 * Mutates the matched entry's `claimed` flag so subsequent bindings
 * cannot double-claim it. Returns `undefined` when no unclaimed
 * import for the target exists (the caller emits a binding-only
 * descriptor in that case).
 */
/**
 * Find the candidate (resolved {@link ImportsRelation}) whose
 * `byteRange.start` is nearest to `bindingRange.start`. Used to
 * associate each binding with its own statement: the nearest
 * source-string capture for the same target is — by construction —
 * the one on the same line as the binding.
 *
 * Multiple bindings on the same statement (`import { a, b } from
 * './x'`) all map to the same candidate because each binding is
 * equidistant from that single source-string capture.
 *
 * Multi-statement same-target (`import { a } from './x'; import './x'`)
 * still discriminates correctly: the first statement's binding sits
 * closer to the first source string than to the second.
 */
function workspaceImportSpecifierNearestImport<
  T extends { byteRange: WorkspaceByteRange },
>(
  bindingRange: WorkspaceByteRange,
  candidates: readonly T[] | undefined,
): T | undefined {
  if (!candidates || candidates.length === 0) return undefined;
  let best: T | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate.byteRange.start - bindingRange.start);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

/**
 * Map `ImportBindingRelation.importStyle` (a syntactic axis from the
 * extractor) to the workspace-surface `WorkspaceDependencyGraphEdgeKind`
 * (the kind axis the hover card surfaces). `static` is the default
 * when the extractor omits the field.
 */
function workspaceImportSpecifierEdgeKindFromBinding(
  importStyle: ImportBindingRelation['importStyle'],
): WorkspaceDependencyGraphEdgeKind {
  switch (importStyle) {
    case 'dynamic':
      return 'dynamic';
    case 'cjs':
      return 'cjs';
    default:
      return 'static';
  }
}

/**
 * Smallest byte range covering both inputs. Used to merge a binding's
 * range with its claimed `ImportsRelation`'s range so the marker
 * underlines the broadest signal available — the full statement for
 * static imports, the variable-name span plus the source string for
 * dynamic / CJS.
 */
function workspaceImportSpecifierByteRangeUnion(
  left: WorkspaceByteRange,
  right: WorkspaceByteRange,
): WorkspaceByteRange {
  return {
    start: Math.min(left.start, right.start),
    end: Math.max(left.end, right.end),
  };
}

/**
 * Pick the dominant edge kind when multiple bindings on the same
 * import statement disagree. Mirrors `edgeKindMerge` in
 * `moduleGraph.ts` so the workspace surface and the dependency-graph
 * surface report the same kind for the same statement.
 */
function workspaceImportSpecifierEdgeKindMerge(
  existing: WorkspaceDependencyGraphEdgeKind,
  next: WorkspaceDependencyGraphEdgeKind,
): WorkspaceDependencyGraphEdgeKind {
  const rank = (kind: WorkspaceDependencyGraphEdgeKind): number => {
    switch (kind) {
      case 'dynamic':
        return 3;
      case 'cjs':
        return 2;
      case 'static':
        return 1;
      case 'side_effect':
        return 0;
      case 'type_only':
        return 0;
    }
  };
  return rank(next) > rank(existing) ? next : existing;
}

/**
 * Reconstruct a {@link WorkspaceDependencyGraphResult} from a
 * persisted {@link GraphSnapshot}. The snapshot only carries the
 * structural primitives the diff depends on; node metrics and edge
 * kinds are intentionally absent.
 */
function workspaceDependencyGraphResultFromSnapshot(
  snapshot: import('@codepol/core').GraphSnapshot,
): WorkspaceDependencyGraphResult {
  return {
    nodes: snapshot.nodes.map((node) => ({
      uri: node.uri,
      workspaceRelativePath: node.workspaceRelativePath,
    })),
    edges: snapshot.edges.map((edge) => ({
      fromUri: edge.fromUri,
      toUri: edge.toUri,
    })),
    entryPoints: [...snapshot.entryPoints],
    cycles: snapshot.cycles.map((cycle) => [...cycle]),
  };
}

/**
 * Resolve the workspace-relative path for a node URI by consulting the
 * baseline snapshot first (so deletions still carry a path) and then
 * the live graph. Falls back to the URI when neither side knows.
 */
function workspaceDependencyDiffNodePathResolve(input: {
  uri: string;
  baselinePathByUri: Map<string, string>;
  currentPathByUri: Map<string, string>;
}): string {
  return (
    input.currentPathByUri.get(input.uri) ??
    input.baselinePathByUri.get(input.uri) ??
    input.uri
  );
}

/**
 * Compose the diff result for {@link queryDependencyDiff}. Both inputs
 * are already-built workspace dependency graphs; the underlying
 * computation is delegated to `moduleDependencyDiffCompute` so the
 * pure / deterministic semantics live in core.
 */
function workspaceDependencyDiffResultCreate(input: {
  workspace: WorkspaceContextState;
  workspaceId: string;
  baseline: WorkspaceDependencyGraphResult;
  current: WorkspaceDependencyGraphResult;
  baselineLabel: string | undefined;
  currentAnalysisGeneration: number;
  baselineAnalysisGeneration: number | undefined;
}): WorkspaceDependencyDiffResult {
  const workspaceRootId = graphSnapshotWorkspaceRootIdComputeInternal(
    input.workspace.rootPath,
  );
  const baselineSnapshot = graphSnapshotFromGraphInternal({
    graph: input.baseline,
    workspaceRootId,
  });
  const currentSnapshot = graphSnapshotFromGraphInternal({
    graph: input.current,
    workspaceRootId,
  });
  const diff = moduleDependencyDiffCompute({
    baseline: baselineSnapshot,
    current: currentSnapshot,
  });

  const baselinePathByUri = new Map(
    input.baseline.nodes.map((node) => [node.uri, node.workspaceRelativePath]),
  );
  const currentPathByUri = new Map(
    input.current.nodes.map((node) => [node.uri, node.workspaceRelativePath]),
  );

  return {
    workspaceId: input.workspaceId,
    ...(input.baselineLabel !== undefined ? { baselineLabel: input.baselineLabel } : {}),
    currentAnalysisGeneration: input.currentAnalysisGeneration,
    ...(input.baselineAnalysisGeneration !== undefined
      ? { baselineAnalysisGeneration: input.baselineAnalysisGeneration }
      : {}),
    addedNodes: diff.addedNodes.map((node) => ({
      uri: node.uri,
      workspaceRelativePath: workspaceDependencyDiffNodePathResolve({
        uri: node.uri,
        baselinePathByUri,
        currentPathByUri,
      }),
    })),
    removedNodes: diff.removedNodes.map((node) => ({
      uri: node.uri,
      workspaceRelativePath: workspaceDependencyDiffNodePathResolve({
        uri: node.uri,
        baselinePathByUri,
        currentPathByUri,
      }),
    })),
    addedEdges: diff.addedEdges.map((edge) => ({
      fromUri: edge.fromUri,
      toUri: edge.toUri,
    })),
    removedEdges: diff.removedEdges.map((edge) => ({
      fromUri: edge.fromUri,
      toUri: edge.toUri,
    })),
    newCycles: diff.newCycles.map((cycle) => [...cycle]),
    removedCycles: diff.removedCycles.map((cycle) => [...cycle]),
  };
}

/**
 * Maximum number of files the {@link WorkspaceArchitectureSummaryResult.instability}
 * panel field returns. The underlying core helper computes one entry per
 * non-isolated file, so a cap is necessary to keep the summary payload
 * bounded on monorepos with thousands of modules.
 */
const WORKSPACE_ARCHITECTURE_INSTABILITY_TOP_N = 10;
/**
 * Maximum number of files the {@link WorkspaceArchitectureSummaryResult.complexityHotspots}
 * panel field returns. Mirrors the existing fan-in `hotspots` cap so the
 * UI hotspot card stays visually balanced.
 */
const WORKSPACE_ARCHITECTURE_COMPLEXITY_HOTSPOT_TOP_N = 5;

function workspaceArchitectureSummaryResultCreate(
  workspace: WorkspaceContextState,
  index: ProjectIndex,
): WorkspaceArchitectureSummaryResult {
  const stats = index.statsGet();
  const allFilesByImporters: WorkspaceArchitectureSummaryHotspot[] = index
    .filesGet()
    .map((filePath) => ({
      uri: workspacePathToUri(filePath),
      workspaceRelativePath: workspaceRelativePathCreate(workspace.rootPath, filePath),
      importerCount: index.moduleImportersGet(filePath).length,
      importeeCount: index.moduleImporteesGet(filePath).length,
    }))
    .sort((left, right) => {
      const importerDifference = right.importerCount - left.importerCount;
      if (importerDifference !== 0) {
        return importerDifference;
      }
      const importeeDifference = right.importeeCount - left.importeeCount;
      if (importeeDifference !== 0) {
        return importeeDifference;
      }
      return left.workspaceRelativePath.localeCompare(right.workspaceRelativePath);
    });
  const hotspots = allFilesByImporters.slice(0, 5);
  const cycleCount = index.moduleCyclesGet().length;
  const entryPointCount = index.moduleEntryPointsGet().length;
  const hottestModule = hotspots[0];
  const hottestModuleSummary = hottestModule
    ? ` Hotspot: ${hottestModule.workspaceRelativePath} (${hottestModule.importerCount} importers, ${hottestModule.importeeCount} importees).`
    : '';

  const phase8Metrics = workspaceArchitectureSummaryPhase8MetricsCompute(workspace, index);

  return {
    summary:
      `Indexed ${stats.files} files, ${stats.symbols} symbols, ` +
      `${entryPointCount} entry points, ${cycleCount} cycles.` +
      hottestModuleSummary,
    indexedFileCount: stats.files,
    symbolCount: stats.symbols,
    scopeCount: stats.scopes,
    relationCount: stats.relations,
    entryPointCount,
    cycleCount,
    hotspots,
    ...(phase8Metrics.instability !== undefined
      ? { instability: phase8Metrics.instability }
      : {}),
    ...(phase8Metrics.longestChain !== undefined
      ? { longestChain: phase8Metrics.longestChain }
      : {}),
    ...(phase8Metrics.sccSizeDistribution !== undefined
      ? { sccSizeDistribution: phase8Metrics.sccSizeDistribution }
      : {}),
    ...(phase8Metrics.complexityHotspots !== undefined
      ? { complexityHotspots: phase8Metrics.complexityHotspots }
      : {}),
  };
}

/**
 * Compute the Phase 8 health metrics on top of the live `ProjectIndex`.
 *
 * Each field is independently optional: a workspace with no edges and no
 * cycles legitimately returns no instability values, no longest chain,
 * no SCC distribution, and no complexity hotspots — every field is
 * omitted from the result rather than set to an empty payload, so older
 * consumers that key off `field !== undefined` keep working.
 */
function workspaceArchitectureSummaryPhase8MetricsCompute(
  workspace: WorkspaceContextState,
  index: ProjectIndex,
): {
  instability?: WorkspaceArchitectureSummaryInstability[];
  longestChain?: WorkspaceArchitectureSummaryLongestChain;
  sccSizeDistribution?: Record<number, number>;
  complexityHotspots?: WorkspaceArchitectureSummaryComplexityHotspot[];
} {
  const graph = moduleGraphFromIndexAdapt(index);

  const instabilityRaw = moduleInstabilityCompute(graph).values;
  const instability =
    instabilityRaw.length === 0
      ? undefined
      : instabilityRaw.slice(0, WORKSPACE_ARCHITECTURE_INSTABILITY_TOP_N).map((entry) => ({
          uri: workspacePathToUri(entry.file),
          workspaceRelativePath: workspaceRelativePathCreate(workspace.rootPath, entry.file),
          value: entry.value,
          importerCount: entry.importerCount,
          importeeCount: entry.importeeCount,
        }));

  const longestChainRaw = moduleLongestChainCompute(graph);
  const longestChain =
    longestChainRaw.path.length === 0
      ? undefined
      : {
          length: longestChainRaw.length,
          uriPath: longestChainRaw.path.map((file) => workspacePathToUri(file)),
          workspaceRelativePathPath: longestChainRaw.path.map((file) =>
            workspaceRelativePathCreate(workspace.rootPath, file),
          ),
        };

  const sccDistribution = moduleSccSizeDistributionCompute(graph).bySize;
  const sccSizeDistribution =
    Object.keys(sccDistribution).length === 0 ? undefined : sccDistribution;

  const complexityHotspotsRaw: WorkspaceArchitectureSummaryComplexityHotspot[] = [];
  for (const filePath of index.filesGet()) {
    const aggregateCyclomaticComplexity = workspaceFileAggregateCyclomaticComplexityGet(
      index,
      filePath,
    );
    if (aggregateCyclomaticComplexity === undefined) continue;
    const importerCount = index.moduleImportersGet(filePath).length;
    const score = aggregateCyclomaticComplexity * importerCount;
    if (score === 0) continue;
    complexityHotspotsRaw.push({
      uri: workspacePathToUri(filePath),
      workspaceRelativePath: workspaceRelativePathCreate(workspace.rootPath, filePath),
      aggregateCyclomaticComplexity,
      importerCount,
      score,
    });
  }
  complexityHotspotsRaw.sort((left, right) => {
    if (left.score !== right.score) return right.score - left.score;
    if (left.importerCount !== right.importerCount) {
      return right.importerCount - left.importerCount;
    }
    if (left.aggregateCyclomaticComplexity !== right.aggregateCyclomaticComplexity) {
      return right.aggregateCyclomaticComplexity - left.aggregateCyclomaticComplexity;
    }
    return left.workspaceRelativePath.localeCompare(right.workspaceRelativePath);
  });
  const complexityHotspots =
    complexityHotspotsRaw.length === 0
      ? undefined
      : complexityHotspotsRaw.slice(0, WORKSPACE_ARCHITECTURE_COMPLEXITY_HOTSPOT_TOP_N);

  return {
    instability,
    longestChain,
    sccSizeDistribution,
    complexityHotspots,
  };
}

export function workspaceDocumentVersionValidate(
  state: WorkspaceDocumentVersionState,
  input: {
    uri: string;
    documentVersion?: number;
  },
): void {
  if (input.documentVersion === undefined) {
    return;
  }
  const document = state.documents.get(input.uri);
  if (!document || document.version === input.documentVersion) {
    return;
  }
  throw new Error(
    `Document version mismatch for ${input.uri}: expected ${document.version}, received ${input.documentVersion}`,
  );
}

export function workspaceAnalysisGenerationValidate(
  state: WorkspaceAnalysisGenerationState,
  input: {
    analysisGeneration?: number;
  },
): void {
  if (input.analysisGeneration === undefined) {
    return;
  }
  if (state.analysisGeneration === input.analysisGeneration) {
    return;
  }
  throw new Error(
    `Analysis generation mismatch: expected ${state.analysisGeneration}, received ${input.analysisGeneration}`,
  );
}

function workspaceBaseIndexStateGetOrBuild(
  state: WorkspaceContextState,
  files: string[],
): WorkspaceBaseIndexState {
  const normalizedFiles = [...new Set(files)].sort();
  const fileKey = normalizedFiles.join('\0');
  let baseIndexState = state.baseIndexState;

  if (!baseIndexState || baseIndexState.fileKey !== fileKey) {
    const workspacePackageRecords = workspacePackageRecordsDiscover(state.rootPath);
    baseIndexState = {
      files: normalizedFiles,
      fileKey,
      workspacePackages: workspacePackageMapCreate(workspacePackageRecords),
      workspacePackageRecords,
    };
    state.baseIndexState = baseIndexState;
  }
  if (!baseIndexState.workspacePackageRecords) {
    const workspacePackageRecords = workspacePackageRecordsDiscover(state.rootPath);
    baseIndexState.workspacePackageRecords = workspacePackageRecords;
    baseIndexState.workspacePackages = workspacePackageMapCreate(workspacePackageRecords);
  }

  return baseIndexState;
}

/**
 * Decide whether to incrementally re-index just the added/removed files
 * versus rebuilding the whole project index from scratch. The incremental
 * path costs roughly `O(|delta|)` per-file parses + cross-file resolves,
 * while a rebuild is `O(|files|)`. Once the delta exceeds
 * `WORKSPACE_WARM_CACHE_INCREMENTAL_INDEX_DELTA_THRESHOLD` of the file set,
 * the rebuild dominates.
 *
 * "Same file set" is also affordable (delta size 0, `previousFiles` matches
 * exactly), but in that case the caller doesn't even reach here because
 * `fileKey` already matches.
 */
function workspaceIndexDeltaIsAffordable(input: {
  currentFiles: string[];
  previousFiles: string[];
}): boolean {
  if (input.currentFiles.length === 0) {
    return true;
  }
  const previousSet = new Set(input.previousFiles);
  const currentSet = new Set(input.currentFiles);
  let added = 0;
  for (const filePath of currentSet) {
    if (!previousSet.has(filePath)) {
      added += 1;
    }
  }
  let removed = 0;
  for (const filePath of previousSet) {
    if (!currentSet.has(filePath)) {
      removed += 1;
    }
  }
  const churn = added + removed;
  return churn / input.currentFiles.length <= WORKSPACE_WARM_CACHE_INCREMENTAL_INDEX_DELTA_THRESHOLD;
}

/**
 * Mutate `indexState` in place so its store / file list reflects the new
 * `baseIndexState` file set.
 *
 * Removals: query the live module graph for each removed file's importers
 * BEFORE removal so we can re-resolve those importers after the file is
 * gone (otherwise stale `resolvedModulePath` edges would survive). Then
 * drop the file from the store.
 *
 * Additions: parse + index each added file, then run
 * `crossFileResolveForFile`, which handles BOTH the outgoing imports of
 * the added file AND the incoming imports from existing files that
 * previously could not resolve to it.
 *
 * Workspace-package mapping is assumed unchanged (caller verifies via
 * `workspacePackageMapEquals`); we keep the existing
 * `indexState.workspacePackages`.
 */
function workspaceIndexStateApplyFileDelta(input: {
  workspace: WorkspaceContextState;
  indexState: WorkspaceIndexState;
  baseIndexState: WorkspaceBaseIndexState;
}): void {
  const previousSet = new Set(input.indexState.files);
  const currentSet = new Set(input.baseIndexState.files);
  const removedFiles: string[] = [];
  for (const filePath of previousSet) {
    if (!currentSet.has(filePath)) {
      removedFiles.push(filePath);
    }
  }
  const addedFiles: string[] = [];
  for (const filePath of currentSet) {
    if (!previousSet.has(filePath)) {
      addedFiles.push(filePath);
    }
  }

  const importersToReresolve = new Set<string>();
  if (removedFiles.length > 0) {
    for (const removedFile of removedFiles) {
      for (const importer of input.indexState.index.moduleImportersGet(removedFile)) {
        if (currentSet.has(importer)) {
          importersToReresolve.add(importer);
        }
      }
    }
    projectIndexRemoveFiles(input.indexState.store, removedFiles);
  }

  const resolveOptions = {
    baseDir: input.workspace.rootPath,
    extensions: DEFAULT_EXTENSIONS,
    workspacePackages: input.indexState.workspacePackages,
  };
  for (const filePath of addedFiles) {
    if (!projectIndexUpdateFileSync(input.indexState.store, filePath)) {
      continue;
    }
    crossFileResolveForFile(input.indexState.store, filePath, resolveOptions);
    importersToReresolve.delete(filePath);
  }
  for (const importer of importersToReresolve) {
    crossFileResolveForFile(input.indexState.store, importer, resolveOptions);
  }

  input.indexState.files = input.baseIndexState.files;
  input.indexState.fileKey = input.baseIndexState.fileKey;
  input.indexState.index = projectIndexCreate(
    input.indexState.store,
    input.indexState.capabilities,
  );
}

function workspaceIndexGetOrBuild(
  workspace: WorkspaceContextState,
  state: WorkspaceDocumentsState & WorkspaceAnalysisCacheState,
  files: string[],
): ProjectIndex {
  const baseIndexState = workspaceBaseIndexStateGetOrBuild(workspace, files);
  const effectiveWorkspacePackages = workspacePackageMapResolve(
    workspace,
    state,
    baseIndexState.files,
  );
  let indexState = state.indexState;

  const packageMapMatches =
    indexState && workspacePackageMapEquals(indexState.workspacePackages, effectiveWorkspacePackages);
  const canApplyDelta =
    indexState !== undefined &&
    indexState.fileKey !== baseIndexState.fileKey &&
    packageMapMatches === true &&
    workspaceIndexDeltaIsAffordable({
      currentFiles: baseIndexState.files,
      previousFiles: indexState.files,
    });

  if (
    !indexState ||
    (indexState.fileKey !== baseIndexState.fileKey && !canApplyDelta) ||
    packageMapMatches === false
  ) {
    const store = indexStoreNew();
    const { index } = projectIndexBuildSync({
      files: baseIndexState.files,
      dir: workspace.rootPath,
      store,
      workspacePackages: effectiveWorkspacePackages,
    });

    indexState = {
      store,
      index,
      capabilities: index.capabilities,
      files: baseIndexState.files,
      fileKey: baseIndexState.fileKey,
      workspacePackages: effectiveWorkspacePackages,
    };
    state.indexState = indexState;
  } else if (indexState.fileKey !== baseIndexState.fileKey && canApplyDelta) {
    workspaceIndexStateApplyFileDelta({
      workspace,
      indexState,
      baseIndexState,
    });
  }

  const indexedFiles = new Set(indexState.files);
  let updated = false;
  for (const document of state.documents.values()) {
    if (!indexedFiles.has(document.filePath)) {
      continue;
    }
    const didUpdate = projectIndexUpdateFileFromSource(
      indexState.store,
      document.filePath,
      document.text,
    );
    if (!didUpdate) {
      continue;
    }
    crossFileResolveForFile(indexState.store, document.filePath, {
      baseDir: workspace.rootPath,
      extensions: DEFAULT_EXTENSIONS,
      workspacePackages: indexState.workspacePackages,
    });
    updated = true;
  }

  if (updated) {
    indexState.index = projectIndexCreate(indexState.store, indexState.capabilities);
  }

  return indexState.index;
}

function workspaceSessionIndexEnable(
  state: WorkspaceSessionState,
): void {
  if (state.workspaceIndexRequired === true && state.indexState) {
    return;
  }
  state.workspaceIndexRequired = true;
  workspaceSessionInvalidate(state, {
    clearIndexState: true,
    clearWorkspaceIndexRequirement: false,
  });
  state.workspaceIndexRequired = true;
}

function workspaceIndexRefreshFromDisk(
  workspace: WorkspaceContextState,
  state: WorkspaceAnalysisCacheState,
  filePath: string,
): void {
  const indexState = state.indexState;
  if (!indexState || !indexState.files.includes(filePath)) {
    return;
  }

  const didUpdate = projectIndexUpdateFileSync(indexState.store, filePath);
  if (!didUpdate) {
    return;
  }

  crossFileResolveForFile(indexState.store, filePath, {
    baseDir: workspace.rootPath,
    extensions: DEFAULT_EXTENSIONS,
    workspacePackages: indexState.workspacePackages,
  });
  indexState.index = projectIndexCreate(indexState.store, indexState.capabilities);
}

function workspaceFilesNormalize(files: string[]): string[] {
  return [...new Set(files.map((filePath) => path.resolve(filePath)))].sort();
}

function workspaceWarmCacheKeyCreate(workspace: WorkspaceContextState & { workspaceId: string }): {
  workspaceId: string;
  rootPath: string;
  configPath: string;
} {
  return {
    workspaceId: workspace.workspaceId,
    rootPath: workspace.rootPath,
    configPath: workspace.configPath,
  };
}

function workspaceWarmCacheFileFingerprintRead(
  filePath: string,
): WorkspaceWarmCacheFileFingerprint | undefined {
  try {
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) {
      return undefined;
    }
    return {
      path: path.resolve(filePath),
      size: stats.size,
      mtimeMs: stats.mtimeMs,
    };
  } catch {
    return undefined;
  }
}

function workspaceWarmCacheFingerprintsRead(input: {
  files: string[];
  configPath: string;
  externalToolConfigs: WorkspaceExternalToolConfigEntry[];
}): {
  configFingerprint: WorkspaceWarmCacheFileFingerprint;
  externalToolConfigFingerprints: WorkspaceWarmCacheExternalToolConfigEntry[];
  fileFingerprints: WorkspaceWarmCacheFileFingerprint[];
} | undefined {
  const configFingerprint = workspaceWarmCacheFileFingerprintRead(input.configPath);
  if (!configFingerprint) {
    return undefined;
  }

  const fileFingerprints: WorkspaceWarmCacheFileFingerprint[] = [];
  for (const filePath of workspaceFilesNormalize(input.files)) {
    const fingerprint = workspaceWarmCacheFileFingerprintRead(filePath);
    if (!fingerprint) {
      return undefined;
    }
    fileFingerprints.push(fingerprint);
  }

  // Tool config files may legitimately be missing on disk (e.g. user removed
  // their `biome.json` between sessions); the snapshot still records the
  // path with a "missing" sentinel fingerprint so restore picks up the
  // change as a mismatch instead of silently passing.
  const externalToolConfigFingerprints: WorkspaceWarmCacheExternalToolConfigEntry[] =
    input.externalToolConfigs.map((entry) => ({
      analyzerId: entry.analyzerId,
      configPath: entry.configPath,
      fingerprint:
        workspaceWarmCacheFileFingerprintRead(entry.configPath) ?? {
          path: path.resolve(entry.configPath),
          size: -1,
          mtimeMs: -1,
        },
    }));

  return {
    configFingerprint,
    externalToolConfigFingerprints,
    fileFingerprints,
  };
}

function workspaceWarmCacheExternalToolConfigEntriesEqual(
  left: WorkspaceWarmCacheExternalToolConfigEntry[],
  right: WorkspaceWarmCacheExternalToolConfigEntry[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const leftEntry = left[index];
    const rightEntry = right[index];
    if (leftEntry.analyzerId !== rightEntry.analyzerId) {
      return false;
    }
    if (path.resolve(leftEntry.configPath) !== path.resolve(rightEntry.configPath)) {
      return false;
    }
    if (!workspaceWarmCacheFingerprintEquals(leftEntry.fingerprint, rightEntry.fingerprint)) {
      return false;
    }
  }
  return true;
}

function workspaceWarmCacheFingerprintEquals(
  left: WorkspaceWarmCacheFileFingerprint | undefined,
  right: WorkspaceWarmCacheFileFingerprint | undefined,
): boolean {
  if (!left || !right) {
    return left === right;
  }
  return left.path === right.path && left.size === right.size && left.mtimeMs === right.mtimeMs;
}

function workspaceWarmCacheFingerprintListEquals(
  left: WorkspaceWarmCacheFileFingerprint[],
  right: WorkspaceWarmCacheFileFingerprint[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((fingerprint, index) =>
    workspaceWarmCacheFingerprintEquals(fingerprint, right[index]),
  );
}

function workspacePackageMapEquals(
  left: Map<string, string>,
  right: Map<string, string>,
): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const [packageName, entryPoint] of left) {
    if (right.get(packageName) !== entryPoint) {
      return false;
    }
  }
  return true;
}

function workspaceExternalToolPathResolve(
  workspace: WorkspaceContextState,
  candidate: string | undefined,
): string | undefined {
  if (!candidate) {
    return undefined;
  }
  const hasPathSyntax =
    path.isAbsolute(candidate) ||
    candidate.startsWith('.') ||
    candidate.includes('/') ||
    candidate.includes('\\');
  if (!hasPathSyntax) {
    return undefined;
  }
  return path.resolve(path.dirname(workspace.configPath), candidate);
}

function workspacePathLikeResolve(baseDir: string, candidate: string | undefined): string | undefined {
  if (!candidate) {
    return undefined;
  }
  const hasPathSyntax =
    path.isAbsolute(candidate) ||
    candidate.startsWith('.') ||
    candidate.includes('/') ||
    candidate.includes('\\');
  if (!hasPathSyntax) {
    return undefined;
  }
  return path.resolve(baseDir, candidate);
}

/**
 * Resolve `<package>/package.json` from the workspace root using Node module
 * resolution. Used to fingerprint Node-loaded lint packages (ESLint and its
 * plugins live in the user's `node_modules`); `package.json` is rewritten by
 * every `npm install` / `pnpm install`, so a version bump always flips the
 * fingerprint regardless of whether the package contents themselves moved.
 */
function workspaceNodeModulePackageManifestResolve(
  rootPath: string,
  packageName: string,
): string | undefined {
  try {
    const requireFromWorkspace = createRequire(path.join(rootPath, 'noop.js'));
    return requireFromWorkspace.resolve(`${packageName}/package.json`);
  } catch {
    return undefined;
  }
}

/**
 * Pluggable contract for collecting the file paths a lint provider depends on
 * (binaries, config files, Node-loaded package manifests). Adding a new
 * provider platform is a one-line entry in `WORKSPACE_PROVIDER_FINGERPRINT_EXTRACTORS`
 * — there is no other place in the workspace-service that should know about
 * a specific platform discriminator.
 *
 * Returned paths are absolute and may be `undefined` (filtered out by the
 * caller). The extractor receives the workspace context so it can derive tool
 * config paths from `externalToolConfigs` (resolved by
 * `externalToolConfigsResolve` from the bridge rules in the policy).
 */
type WorkspaceProviderFingerprintExtractor = (
  workspace: WorkspaceContextState,
  providerConfig: unknown,
) => Array<string | undefined>;

function workspaceExternalToolConfigPathGet(
  workspace: WorkspaceContextState,
  analyzerId: WorkspaceExternalToolAnalyzerKey,
): string | undefined {
  return workspace.externalToolConfigs.find(
    (entry) => entry.analyzerId === analyzerId,
  )?.configPath;
}

const WORKSPACE_PROVIDER_FINGERPRINT_EXTRACTORS: Record<
  string,
  WorkspaceProviderFingerprintExtractor
> = {
  eslint: (workspace) => [
    workspaceExternalToolConfigPathGet(workspace, 'eslint'),
    workspaceNodeModulePackageManifestResolve(workspace.rootPath, 'eslint'),
  ],
  biome: (workspace, providerConfig) => {
    const config = providerConfig as BiomeProviderConfig | undefined;
    return [config?.biomeBin, config?.configPath].map((candidate) =>
      workspaceExternalToolPathResolve(workspace, candidate),
    );
  },
  ruff: (workspace, providerConfig) => {
    const config = providerConfig as RuffProviderConfig | undefined;
    return [config?.ruffBin, config?.configPath].map((candidate) =>
      workspaceExternalToolPathResolve(workspace, candidate),
    );
  },
};

function workspaceToolFingerprintsRead(
  workspace: WorkspaceContextState,
  lintProviderEntries: LintProviderEntry[],
): WorkspaceWarmCacheFileFingerprint[] {
  const resolvedPaths = new Set<string>();
  for (const entry of lintProviderEntries) {
    const extractor = WORKSPACE_PROVIDER_FINGERPRINT_EXTRACTORS[entry.provider.platform];
    if (!extractor) {
      continue;
    }
    for (const candidate of extractor(workspace, entry.provider.config)) {
      if (candidate) {
        resolvedPaths.add(path.resolve(candidate));
      }
    }
  }
  return [...resolvedPaths]
    .sort()
    .flatMap((filePath) => {
      const fingerprint = workspaceWarmCacheFileFingerprintRead(filePath);
      return fingerprint ? [fingerprint] : [];
    });
}

function workspacePluginSignatureNormalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => workspacePluginSignatureNormalize(entry));
  }
  if (typeof value === 'function') {
    return '[function]';
  }
  if (value && typeof value === 'object') {
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      normalized[key] = workspacePluginSignatureNormalize(
        (value as Record<string, unknown>)[key],
      );
    }
    return normalized;
  }
  if (value === undefined) {
    return '[undefined]';
  }
  return value;
}

function workspacePluginSignatureCreate(
  policy: PolicyFile,
  pluginRulesMap: PolicyPluginsMap,
): string {
  const declarations = [...(policy.plugins ?? [])]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((declaration) => ({
      id: declaration.id,
      source: workspacePluginSignatureNormalize(declaration.source),
    }));
  const rules = [...pluginRulesMap.entries()]
    .sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
    .map(([resolvedRuleId, plugin]) => ({
      resolvedRuleId,
      capabilities: workspacePluginSignatureNormalize(plugin.pluginRule.capabilities),
    }));
  return JSON.stringify({
    declarations,
    rules,
  });
}

function workspacePluginFingerprintsRead(
  workspace: WorkspaceContextState,
  declarations: PolicyPluginDeclaration[],
): WorkspaceWarmCacheFileFingerprint[] {
  const resolvedPaths = new Set<string>();
  const configDir = path.dirname(workspace.configPath);

  for (const declaration of declarations) {
    if (declaration.source.kind === 'builtin') {
      for (const candidate of builtinPluginArtifactPathsResolve(declaration.id)) {
        resolvedPaths.add(candidate);
      }
      continue;
    }

    if (declaration.source.kind === 'process') {
      const processCwd = declaration.source.cwd
        ? path.resolve(configDir, declaration.source.cwd)
        : configDir;
      const commandPath = workspacePathLikeResolve(processCwd, declaration.source.command);
      if (commandPath) {
        resolvedPaths.add(commandPath);
      }
      for (const arg of declaration.source.args ?? []) {
        const argPath = workspacePathLikeResolve(processCwd, arg);
        if (argPath) {
          resolvedPaths.add(argPath);
        }
      }
    }
  }

  return [...resolvedPaths]
    .sort()
    .flatMap((filePath) => {
      const fingerprint = workspaceWarmCacheFileFingerprintRead(filePath);
      return fingerprint ? [fingerprint] : [];
    });
}

function workspacePluginCompatibilityRead(
  workspace: WorkspaceContextState,
  policy: PolicyFile,
  pluginRulesMap: PolicyPluginsMap,
): {
  pluginSignature: string;
  pluginFingerprints: WorkspaceWarmCacheFileFingerprint[];
} {
  return {
    pluginSignature: workspacePluginSignatureCreate(policy, pluginRulesMap),
    pluginFingerprints: workspacePluginFingerprintsRead(
      workspace,
      policy.plugins ?? [],
    ),
  };
}

function workspaceFingerprintListSerialize(
  fingerprints: WorkspaceWarmCacheFileFingerprint[],
): string {
  return fingerprints
    .map((fingerprint) => `${fingerprint.path}:${fingerprint.size}:${fingerprint.mtimeMs}`)
    .join('|');
}

/**
 * Hash of the codepol-level inputs that affect every analyzer:
 * the normalised policy JSON plus the codepol config file. Provider-specific
 * config files (eslint config, biome.json, ruff.toml, …) intentionally live in
 * `toolFingerprintKey` via `WORKSPACE_PROVIDER_FINGERPRINT_EXTRACTORS`, so this
 * function stays free of any per-platform knowledge.
 */
function workspaceConfigFingerprintCompute(input: {
  workspace: WorkspaceContextState;
  policy: PolicyFile;
}): string {
  const policyJson = JSON.stringify(workspacePluginSignatureNormalize(input.policy));
  const codepolConfigFingerprint = workspaceWarmCacheFileFingerprintRead(
    input.workspace.configPath,
  );
  const hash = createHash('sha1');
  hash.update(policyJson);
  hash.update('\0');
  hash.update(
    codepolConfigFingerprint
      ? workspaceFingerprintListSerialize([codepolConfigFingerprint])
      : '',
  );
  return hash.digest('hex');
}

function workspacePluginFingerprintCompute(
  pluginCompatibility: ReturnType<typeof workspacePluginCompatibilityRead>,
): string {
  const hash = createHash('sha1');
  hash.update(pluginCompatibility.pluginSignature);
  hash.update('\0');
  hash.update(workspaceFingerprintListSerialize(pluginCompatibility.pluginFingerprints));
  return hash.digest('hex');
}

function workspaceToolFingerprintKeyCompute(
  toolFingerprints: WorkspaceWarmCacheFileFingerprint[],
): string {
  const hash = createHash('sha1');
  hash.update(workspaceFingerprintListSerialize(toolFingerprints));
  return hash.digest('hex');
}

/**
 * Tree analyzer's slice of the cache key. Carries the base index file set and,
 * when the policy requires cross-file analysis, a digest of overlay document
 * versions. Overlay-touching edits in any file flip the slice so every
 * tree-cached entry misses on the next run — correct by construction, because
 * a cross-file rule (e.g. no-unused-exports) running on file A can depend on
 * file B's overlay contents.
 */
function workspaceTreeIndexFingerprintCompute(
  state: WorkspaceDocumentsState & WorkspaceAnalysisCacheState,
  crossFileSensitive: boolean,
): string {
  const baseKey = state.indexState?.fileKey ?? '';
  if (!crossFileSensitive || state.documents.size === 0) {
    return baseKey;
  }
  const overlayDigest = [...state.documents.values()]
    .map((document) => `${document.filePath}:${document.version}`)
    .sort()
    .join('|');
  const hash = createHash('sha1');
  hash.update(baseKey);
  hash.update('\0');
  hash.update(overlayDigest);
  return hash.digest('hex');
}

/**
 * Compute the cache key tuple's per-file `contentFingerprint`. Overlay
 * documents key on `version` (a monotonic integer the LSP already maintains);
 * closed files key on `size + mtime + sha1(contents)`. The sha1 is required —
 * size+mtime alone misses same-size rewrites and git checkouts that touch
 * mtime without changing bytes. We memoise the tuple in
 * `state.fileFingerprintCache` so the only re-hash is when size or mtime drift
 * (or the file path is in `state.dirtyFiles`).
 *
 * Returns `undefined` when the file does not exist on disk and has no overlay,
 * which the orchestrator treats as "skip / drop cache entry".
 */
function workspaceContentFingerprintForFile(
  state: WorkspaceDocumentsState & WorkspaceAnalysisCacheState,
  filePath: string,
): string | undefined {
  const overlay = workspaceDocumentGetByFilePath(state, filePath);
  if (overlay) {
    return `overlay:${overlay.version}`;
  }
  let stats: fs.Stats;
  try {
    stats = fs.statSync(filePath);
  } catch {
    return undefined;
  }
  if (!stats.isFile()) {
    return undefined;
  }
  const isDirty = state.dirtyFiles?.has(filePath) === true;
  if (!state.fileFingerprintCache) {
    state.fileFingerprintCache = new Map();
  }
  const cached = state.fileFingerprintCache.get(filePath);
  if (cached && !isDirty && cached.size === stats.size && cached.mtimeMs === stats.mtimeMs) {
    return cached.contentFingerprint;
  }
  let contents: Buffer;
  try {
    contents = fs.readFileSync(filePath);
  } catch {
    return undefined;
  }
  const sha1 = createHash('sha1').update(contents).digest('hex');
  const contentFingerprint = `disk:${stats.size}:${stats.mtimeMs}:${sha1}`;
  state.fileFingerprintCache.set(filePath, {
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    contentFingerprint,
  });
  return contentFingerprint;
}

/**
 * Fraction of `currentFiles` whose disk content (or membership) may diverge
 * from the snapshot before we abandon incremental restore and rebuild the
 * project index from scratch. Below the threshold we apply per-file deltas
 * via the existing core APIs; above it the full rebuild is cheaper.
 */
const WORKSPACE_WARM_CACHE_INCREMENTAL_INDEX_DELTA_THRESHOLD = 0.25;

export type WorkspaceWarmCacheFileDelta = {
  unchangedFiles: string[];
  changedFiles: string[];
  addedFiles: string[];
  removedFiles: string[];
};

/**
 * Diff the snapshot's recorded file set + fingerprints against the current
 * workspace file list (typically produced by `workspaceFilesNormalize` over
 * `ruleMatchesGet`). Returns disjoint sets so the caller can:
 *
 * - reuse cache entries for `unchangedFiles`
 * - drop entries for `removedFiles` and `changedFiles`
 * - hand `addedFiles ∪ changedFiles` back to the incremental analysis path
 *   as the dirty set on the next run
 *
 * The diff is fingerprint-strict: even if `currentFiles` matches `snapshot.files`,
 * any file whose live `(size, mtimeMs)` diverged from the snapshot is treated
 * as `changed`.
 */
export function workspaceWarmCacheFileDeltaCompute(input: {
  snapshotFiles: string[];
  snapshotFileFingerprints: WorkspaceWarmCacheFileFingerprint[];
  currentFiles: string[];
  currentFileFingerprints: WorkspaceWarmCacheFileFingerprint[];
}): WorkspaceWarmCacheFileDelta {
  const snapshotFingerprintByPath = new Map<string, WorkspaceWarmCacheFileFingerprint>();
  for (const fingerprint of input.snapshotFileFingerprints) {
    snapshotFingerprintByPath.set(path.resolve(fingerprint.path), fingerprint);
  }
  const snapshotFileSet = new Set(input.snapshotFiles.map((filePath) => path.resolve(filePath)));
  const currentFingerprintByPath = new Map<string, WorkspaceWarmCacheFileFingerprint>();
  for (const fingerprint of input.currentFileFingerprints) {
    currentFingerprintByPath.set(path.resolve(fingerprint.path), fingerprint);
  }
  const currentFileSet = new Set(input.currentFiles.map((filePath) => path.resolve(filePath)));

  const unchangedFiles: string[] = [];
  const changedFiles: string[] = [];
  const addedFiles: string[] = [];
  const removedFiles: string[] = [];

  for (const filePath of currentFileSet) {
    if (!snapshotFileSet.has(filePath)) {
      addedFiles.push(filePath);
      continue;
    }
    const snapshotFingerprint = snapshotFingerprintByPath.get(filePath);
    const currentFingerprint = currentFingerprintByPath.get(filePath);
    if (
      snapshotFingerprint &&
      currentFingerprint &&
      workspaceWarmCacheFingerprintEquals(snapshotFingerprint, currentFingerprint)
    ) {
      unchangedFiles.push(filePath);
    } else {
      changedFiles.push(filePath);
    }
  }
  for (const filePath of snapshotFileSet) {
    if (!currentFileSet.has(filePath)) {
      removedFiles.push(filePath);
    }
  }

  return {
    unchangedFiles: unchangedFiles.sort(),
    changedFiles: changedFiles.sort(),
    addedFiles: addedFiles.sort(),
    removedFiles: removedFiles.sort(),
  };
}

/**
 * Restore the in-memory `WorkspaceAnalyzerCache` from a warm-cache snapshot,
 * keeping only the slice that is provably still valid: files in
 * `unchangedFiles` whose persisted key tuple matches every current
 * workspace-wide invariant (config / plugin / tool / treeIndex).
 *
 * Per-file `contentFingerprint` divergences are already filtered upstream by
 * `workspaceWarmCacheFileDeltaCompute` (we only feed `unchangedFiles` here),
 * but we re-compare it for paranoia in case the disk fingerprint and the
 * persisted key tuple ever drift.
 *
 * Entries for added / changed / removed files are dropped unconditionally,
 * which is correct: the next analysis run treats them as misses and re-runs
 * the analyzer on just that delta via `workspaceAnalysisRunIncremental`.
 */
export function workspaceAnalyzerCacheRestoreFromSnapshot(input: {
  snapshotEntries: WorkspaceWarmCacheAnalyzerEntry[] | undefined;
  unchangedFiles: ReadonlySet<string>;
  currentConfigFingerprint: string;
  currentPluginFingerprint: string;
  currentToolFingerprintKey: string;
  currentTreeIndexFingerprint: string;
}): WorkspaceAnalyzerCache {
  if (!input.snapshotEntries) {
    return {};
  }
  const restored: WorkspaceAnalyzerCache = {};
  for (const snapshotEntry of input.snapshotEntries) {
    const fileResults = new Map<string, WorkspaceAnalyzerFileCacheEntry>();
    const expectedTreeIndexFingerprint =
      snapshotEntry.analyzer === 'tree' ? input.currentTreeIndexFingerprint : '';
    for (const fileEntry of snapshotEntry.fileResults) {
      const filePath = path.resolve(fileEntry.filePath);
      if (!input.unchangedFiles.has(filePath)) {
        continue;
      }
      if (
        fileEntry.key.configFingerprint !== input.currentConfigFingerprint ||
        fileEntry.key.pluginFingerprint !== input.currentPluginFingerprint ||
        fileEntry.key.toolFingerprintKey !== input.currentToolFingerprintKey ||
        fileEntry.key.treeIndexFingerprint !== expectedTreeIndexFingerprint
      ) {
        continue;
      }
      const fixableTreeViolationsByDiagnosticId = new Map<string, PolicyViolation>();
      const treeViolationsByPosition = new Map<string, PolicyViolation>();
      for (const violation of fileEntry.treeViolations) {
        treeViolationsByPosition.set(
          `${violation.ruleId}\0${violation.line}\0${violation.column}`,
          violation,
        );
      }
      for (const id of fileEntry.fixableTreeViolationDiagnosticIds) {
        const matchingDiagnostic = fileEntry.diagnostics.find((diagnostic) => diagnostic.id === id);
        if (!matchingDiagnostic) {
          continue;
        }
        const matchingViolation = treeViolationsByPosition.get(
          `${matchingDiagnostic.code}\0${matchingDiagnostic.range.start.line + 1}\0${
            matchingDiagnostic.range.start.character + 1
          }`,
        );
        if (matchingViolation) {
          fixableTreeViolationsByDiagnosticId.set(id, matchingViolation);
        }
      }
      fileResults.set(filePath, {
        key: { ...fileEntry.key },
        violations: [...fileEntry.violations],
        diagnostics: [...fileEntry.diagnostics],
        treeViolations: [...fileEntry.treeViolations],
        fixableTreeViolationsByDiagnosticId,
        errorCount: fileEntry.errorCount,
      });
    }
    restored[snapshotEntry.analyzer] = {
      scorecardTemplate: { ...snapshotEntry.scorecardTemplate },
      fileResults,
    };
  }
  return restored;
}

/**
 * Compose a `WorkspaceAnalysis` from the restored per-(analyzer, file) cache
 * slice produced by `workspaceAnalyzerCacheRestoreFromSnapshot`. Only files
 * present in the slice contribute; added / changed files contribute nothing
 * yet and the caller relies on the next incremental run to fill them in.
 */
export function workspaceAnalysisRebuildFromCache(input: {
  policy: PolicyFile;
  files: string[];
  cache: WorkspaceAnalyzerCache;
  scorecardTemplates: Partial<Record<WorkspaceWarmCacheAnalyzerKey, WorkspaceAnalyzerScorecardEntry>>;
  analyzerInventory: WorkspaceAnalyzerInventoryEntry[];
  featureStatus: IndexStatusFeatureStatus;
}): WorkspaceAnalysis {
  const analyzerOrder: WorkspaceWarmCacheAnalyzerKey[] = ['tree', 'eslint', 'biome', 'ruff'];
  const violations: PolicyViolation[] = [];
  const treeViolations: PolicyViolation[] = [];
  const diagnostics: WorkspaceDiagnostic[] = [];
  const fixableTreeViolationsByDiagnosticId = new Map<string, PolicyViolation>();
  const scorecard: WorkspaceAnalyzerScorecardEntry[] = [];
  for (const analyzerKey of analyzerOrder) {
    const entry = input.cache[analyzerKey];
    const template =
      input.scorecardTemplates[analyzerKey] ??
      entry?.scorecardTemplate ??
      workspaceAnalyzerScorecardTemplateForEmpty(analyzerKey);
    let analyzerDiagnosticCount = 0;
    let analyzerViolationCount = 0;
    let analyzerFileCount = 0;
    if (entry) {
      for (const fileEntry of entry.fileResults.values()) {
        violations.push(...fileEntry.violations);
        treeViolations.push(...fileEntry.treeViolations);
        diagnostics.push(...fileEntry.diagnostics);
        for (const [id, violation] of fileEntry.fixableTreeViolationsByDiagnosticId) {
          fixableTreeViolationsByDiagnosticId.set(id, violation);
        }
        analyzerDiagnosticCount += fileEntry.diagnostics.length;
        analyzerViolationCount += fileEntry.violations.length;
        analyzerFileCount += 1;
      }
    }
    scorecard.push(
      workspaceAnalyzerScorecardCreate({
        analyzerId: template.analyzerId,
        platform: template.platform,
        languages: template.languages,
        ownedRuleIds: template.ownedRuleIds,
        skippedRuleIds: template.skippedRuleIds,
        skippedReason: template.skippedReason,
        diagnosticCount: analyzerDiagnosticCount,
        violationCount: analyzerViolationCount,
        fileCount: analyzerFileCount,
        fixMode: template.fixMode,
        status: template.status,
        latencyMs: 0,
        issues: [],
      }),
    );
  }
  return {
    analyzerInventory: input.analyzerInventory,
    analyzerScorecard: scorecard,
    policy: input.policy,
    files: input.files,
    violations,
    treeViolations,
    diagnostics,
    featureStatus: input.featureStatus,
    fixableTreeViolationsByDiagnosticId,
    eslintOutput: '',
    eslintHasErrors: false,
  };
}

/**
 * Pure projection of an in-memory `WorkspaceAnalyzerCache`: returns a new
 * cache whose per-(analyzer, file) entries pass the given predicate. Bucket
 * presence is preserved -- a bucket whose entries were all filtered out
 * remains as an empty `fileResults` map. This matters for the
 * `allHitsCovered` fast path in `workspaceAnalysisRunIncremental`, which
 * treats a missing bucket as "analyzer never ran" rather than "analyzer
 * ran with zero in-scope files," forcing a redundant analysis on restore.
 *
 * Used by the persist path to drop entries fingerprinted against overlay
 * text (`key.contentFingerprint` starting with `overlay:`) before writing
 * the snapshot to disk. Persisting overlay-keyed entries would let next
 * session's restore return diagnostics keyed on a fingerprint no disk file
 * can produce, so they'd remain stuck as cache hits forever.
 */
export function workspaceAnalyzerCacheFilterEntries(
  cache: WorkspaceAnalyzerCache | undefined,
  predicate: (entry: WorkspaceAnalyzerFileCacheEntry, filePath: string) => boolean,
): WorkspaceAnalyzerCache {
  const result: WorkspaceAnalyzerCache = {};
  if (!cache) {
    return result;
  }
  for (const analyzer of ['tree', 'eslint', 'biome', 'ruff'] as const) {
    const entry = cache[analyzer];
    if (!entry) {
      continue;
    }
    const fileResults = new Map<string, WorkspaceAnalyzerFileCacheEntry>();
    for (const [filePath, fileEntry] of entry.fileResults) {
      if (predicate(fileEntry, filePath)) {
        fileResults.set(filePath, fileEntry);
      }
    }
    result[analyzer] = {
      scorecardTemplate: entry.scorecardTemplate,
      fileResults,
    };
  }
  return result;
}

/**
 * Snapshot-side serialiser for the in-memory `WorkspaceAnalyzerCache`. The
 * `Map<diagnosticId, PolicyViolation>` shape is reduced to a parallel id list
 * because Maps don't survive `JSON.stringify`, and the violation itself is
 * already serialised inside `treeViolations`.
 */
export function workspaceAnalyzerCacheSerialize(
  cache: WorkspaceAnalyzerCache | undefined,
): WorkspaceWarmCacheAnalyzerEntry[] {
  if (!cache) {
    return [];
  }
  const analyzerOrder: WorkspaceWarmCacheAnalyzerKey[] = ['tree', 'eslint', 'biome', 'ruff'];
  const entries: WorkspaceWarmCacheAnalyzerEntry[] = [];
  for (const analyzer of analyzerOrder) {
    const cacheEntry = cache[analyzer];
    if (!cacheEntry) {
      continue;
    }
    const fileResults: WorkspaceWarmCacheAnalyzerFileEntry[] = [];
    for (const [filePath, fileEntry] of cacheEntry.fileResults) {
      fileResults.push({
        filePath: path.resolve(filePath),
        key: { ...fileEntry.key },
        violations: fileEntry.violations.map((violation) => ({ ...violation })),
        diagnostics: fileEntry.diagnostics.map((diagnostic) => ({ ...diagnostic })),
        treeViolations: fileEntry.treeViolations.map((violation) => ({ ...violation })),
        fixableTreeViolationDiagnosticIds: [
          ...fileEntry.fixableTreeViolationsByDiagnosticId.keys(),
        ],
        errorCount: fileEntry.errorCount,
      });
    }
    fileResults.sort((left, right) => left.filePath.localeCompare(right.filePath));
    entries.push({
      analyzer,
      scorecardTemplate: { ...cacheEntry.scorecardTemplate },
      fileResults,
    });
  }
  return entries;
}

/**
 * Per-(analyzer) scorecard templates extracted from the analyzer cache, used
 * by `workspaceAnalysisRebuildFromCache` to keep the recomposed
 * `analyzerScorecard` consistent with what the writer side recorded.
 */
function workspaceAnalyzerCacheScorecardTemplatesGet(
  cache: WorkspaceAnalyzerCache,
): Partial<Record<WorkspaceWarmCacheAnalyzerKey, WorkspaceAnalyzerScorecardEntry>> {
  const templates: Partial<Record<WorkspaceWarmCacheAnalyzerKey, WorkspaceAnalyzerScorecardEntry>> = {};
  for (const analyzer of ['tree', 'eslint', 'biome', 'ruff'] as const) {
    const entry = cache[analyzer];
    if (entry) {
      templates[analyzer] = entry.scorecardTemplate;
    }
  }
  return templates;
}

function workspaceWarmCacheBaseIndexSnapshotCreate(
  baseIndexState: WorkspaceBaseIndexState | undefined,
) {
  if (!baseIndexState) {
    return undefined;
  }
  return {
    files: [...baseIndexState.files],
    fileKey: baseIndexState.fileKey,
    workspacePackages: Array.from(baseIndexState.workspacePackages.entries()),
  };
}

function workspaceWarmCacheBaseIndexRestore(
  snapshot:
    | WorkspaceWarmCacheSnapshot['baseIndexState']
    | undefined,
): WorkspaceBaseIndexState | undefined {
  if (!snapshot) {
    return undefined;
  }
  return {
    files: [...snapshot.files],
    fileKey: snapshot.fileKey,
    workspacePackages: new Map(snapshot.workspacePackages),
  };
}

function workspaceWarmCacheAnalysisRestore(
  workspace: WorkspaceContextState,
  snapshot: WorkspaceWarmCacheSnapshot,
): WorkspaceAnalysis {
  const policy = workspace.config as PolicyFile;
  const fixableTreeViolationsByDiagnosticId = new Map<string, PolicyViolation>();
  for (const violation of snapshot.treeViolations) {
    const severity = severityFromLintSeverity(policyRuleGet(policy, violation.ruleId)?.severity);
    const diagnostic = policyViolationToWorkspaceDiagnostic(violation, {
      severity,
      source: 'codepol',
    });
    if (violation.fix || (violation.suggestions && violation.suggestions.length > 0)) {
      fixableTreeViolationsByDiagnosticId.set(diagnostic.id, violation);
    }
  }

  return {
    analyzerInventory: snapshot.analyzerInventory ?? [],
    analyzerScorecard: snapshot.analyzerScorecard ?? [],
    policy,
    files: [...snapshot.files],
    violations: [...snapshot.treeViolations],
    treeViolations: [...snapshot.treeViolations],
    diagnostics: [...snapshot.diagnostics],
    featureStatus: snapshot.featureStatus,
    fixableTreeViolationsByDiagnosticId,
    eslintOutput: '',
    eslintHasErrors: false,
  };
}

/**
 * Result of a warm-cache restore. The shape is identical to the previous
 * all-or-nothing return when `dirtyFiles` is empty (i.e. workspace is
 * pristine vs the snapshot). When `dirtyFiles` is non-empty, the caller is
 * responsible for handing them off to the next analysis run; the restored
 * `lastAnalysis` already excludes any contribution from those files (so the
 * partial output is internally consistent), and the restored `analyzerCache`
 * carries the still-valid slices for unchanged files.
 */
export type WorkspaceWarmCacheRestoreResult = {
  analysisGeneration: number;
  workspaceIndexRequired: boolean;
  lastAnalysis: WorkspaceAnalysis;
  analyzerCache?: WorkspaceAnalyzerCache;
  baseIndexState?: WorkspaceBaseIndexState;
  toolFingerprints: WorkspaceWarmCacheFileFingerprint[];
  indexState?: WorkspaceIndexState;
  dirtyFiles?: Set<string>;
  /**
   * Files in the snapshot that no longer exist in the workspace. Surfaced
   * for observability; the index state has already been delta-applied to
   * exclude them by the time the caller sees this.
   */
  removedFiles?: string[];
};

async function workspaceWarmCacheSnapshotRestore(input: {
  warmCache?: WorkspaceWarmCacheStore;
  workspace: WorkspaceState;
  workspaceIndexRequired?: boolean;
}): Promise<WorkspaceWarmCacheRestoreResult | undefined> {
  if (!input.warmCache) {
    return undefined;
  }

  const cacheKey = workspaceWarmCacheKeyCreate(input.workspace);
  const snapshot = await input.warmCache.read(cacheKey);
  if (!snapshot) {
    return undefined;
  }

  if (
    snapshot.workspaceId !== input.workspace.workspaceId ||
    path.resolve(snapshot.rootPath) !== input.workspace.rootPath ||
    path.resolve(snapshot.configPath) !== input.workspace.configPath
  ) {
    await input.warmCache.delete(cacheKey);
    return undefined;
  }

  try {
    const policy = input.workspace.config as PolicyFile;
    const currentWorkspacePackages = workspacePackageMapDiscover(input.workspace.rootPath);
    const pluginRulesResult = await policyPluginsGet(policy, input.workspace.rootPath, {
      configPath: input.workspace.configPath,
    });
    if (isErr(pluginRulesResult)) {
      await input.warmCache.delete(cacheKey);
      return undefined;
    }
    const currentPluginCompatibility = workspacePluginCompatibilityRead(
      input.workspace,
      policy,
      pluginRulesResult.Ok,
    );
    const currentToolFingerprints = workspaceToolFingerprintsRead(
      input.workspace,
      lintProviderEntriesCollect(policy, pluginRulesResult.Ok),
    );
    const matches = await ruleMatchesGet(policy, input.workspace.rootPath);
    const currentFiles = workspaceFilesNormalize(matches.flatMap((match) => match.files));

    const currentFingerprints = workspaceWarmCacheFingerprintsRead({
      files: currentFiles,
      configPath: input.workspace.configPath,
      externalToolConfigs: input.workspace.externalToolConfigs,
    });
    if (!currentFingerprints) {
      await input.warmCache.delete(cacheKey);
      return undefined;
    }

    // Workspace-wide invariants: any divergence forces a full invalidation
    // because there is no safe per-file reuse for these.
    if (
      !workspaceWarmCacheFingerprintEquals(
        currentFingerprints.configFingerprint,
        snapshot.configFingerprint,
      ) ||
      !workspaceWarmCacheExternalToolConfigEntriesEqual(
        currentFingerprints.externalToolConfigFingerprints,
        snapshot.externalToolConfigs,
      )
    ) {
      await input.warmCache.delete(cacheKey);
      return undefined;
    }
    if (
      !workspaceWarmCacheFingerprintListEquals(
        currentToolFingerprints,
        snapshot.toolFingerprints ?? [],
      )
    ) {
      await input.warmCache.delete(cacheKey);
      return undefined;
    }
    if (
      snapshot.pluginSignature !== currentPluginCompatibility.pluginSignature ||
      !workspaceWarmCacheFingerprintListEquals(
        currentPluginCompatibility.pluginFingerprints,
        snapshot.pluginFingerprints ?? [],
      )
    ) {
      await input.warmCache.delete(cacheKey);
      return undefined;
    }

    if (
      input.workspaceIndexRequired !== undefined &&
      snapshot.workspaceIndexRequired !== input.workspaceIndexRequired
    ) {
      await input.warmCache.delete(cacheKey);
      return undefined;
    }
    if (
      snapshot.baseIndexState &&
      !workspacePackageMapEquals(
        currentWorkspacePackages,
        new Map(snapshot.baseIndexState.workspacePackages),
      )
    ) {
      await input.warmCache.delete(cacheKey);
      return undefined;
    }

    // Per-file delta. Files whose (size, mtime) match the snapshot are
    // candidates for cache reuse; everything else feeds into `dirtyFiles`
    // for the next incremental run.
    const fileDelta = workspaceWarmCacheFileDeltaCompute({
      snapshotFiles: snapshot.files,
      snapshotFileFingerprints: snapshot.fileFingerprints,
      currentFiles,
      currentFileFingerprints: currentFingerprints.fileFingerprints,
    });
    const unchangedSet = new Set(fileDelta.unchangedFiles);
    const dirtyFiles = new Set<string>([...fileDelta.addedFiles, ...fileDelta.changedFiles]);

    // Apply the index delta first (if we have a restorable index store) so
    // that `treeIndexFingerprint` is computed against the post-delta
    // `fileKey`, matching what the next analysis run will see.
    let indexState: WorkspaceIndexState | undefined;
    if (snapshot.projectIndexStoreSnapshot && snapshot.baseIndexState) {
      const restored = projectIndexStoreRestore(snapshot.projectIndexStoreSnapshot);
      indexState = {
        store: restored.store,
        index: restored.index,
        capabilities: restored.index.capabilities,
        files: [...snapshot.baseIndexState.files],
        fileKey: snapshot.baseIndexState.fileKey,
        workspacePackages: currentWorkspacePackages,
      };

      // Drop index facts for files whose disk fingerprint diverged from the
      // snapshot. Persist now writes whenever lastAnalysis exists (no
      // documents-open gate), so a snapshot may carry index entries derived
      // from overlay text. `workspaceIndexGetOrBuild` only re-indexes
      // documents and added/removed files; it does not re-index a file just
      // because it appears in `dirtyFiles`. Dropping the entries here means
      // subsequent index queries return nothing for those files rather than
      // overlay-derived facts. The next analysis run will repopulate them
      // from disk content via the analyzer's normal index-update path.
      if (dirtyFiles.size > 0) {
        for (const dirtyFilePath of dirtyFiles) {
          indexState.store.fileRemove(dirtyFilePath);
        }
        indexState.index = projectIndexCreate(indexState.store, indexState.capabilities);
      }
      const baseIndexStateNext = workspaceBaseIndexStateGetOrBuild(input.workspace, currentFiles);
      if (
        indexState.fileKey !== baseIndexStateNext.fileKey &&
        workspaceIndexDeltaIsAffordable({
          currentFiles: baseIndexStateNext.files,
          previousFiles: indexState.files,
        })
      ) {
        workspaceIndexStateApplyFileDelta({
          workspace: input.workspace,
          indexState,
          baseIndexState: baseIndexStateNext,
        });
      } else if (indexState.fileKey !== baseIndexStateNext.fileKey) {
        // Delta too large: drop the restored index, the analysis path will
        // do a full rebuild via `workspaceIndexGetOrBuild` on demand.
        indexState = undefined;
      }
    }

    // Now compute the live `treeIndexFingerprint` so the analyzer cache
    // restore sees the same value the next analysis run will compute.
    const documentsState: WorkspaceDocumentsState & WorkspaceAnalysisCacheState = {
      documents: new Map(),
      analysisGeneration: snapshot.analysisGeneration,
      indexState,
      workspaceIndexRequired: snapshot.workspaceIndexRequired,
    };
    const currentTreeIndexFingerprint = workspaceTreeIndexFingerprintCompute(
      documentsState,
      snapshot.workspaceIndexRequired,
    );

    const currentConfigFingerprint = workspaceConfigFingerprintCompute({
      workspace: input.workspace,
      policy,
    });
    const currentPluginFingerprint = workspacePluginFingerprintCompute(currentPluginCompatibility);
    const currentToolFingerprintKey = workspaceToolFingerprintKeyCompute(currentToolFingerprints);

    const restoredAnalyzerCache = workspaceAnalyzerCacheRestoreFromSnapshot({
      snapshotEntries: snapshot.analyzerCache,
      unchangedFiles: unchangedSet,
      currentConfigFingerprint,
      currentPluginFingerprint,
      currentToolFingerprintKey,
      currentTreeIndexFingerprint,
    });

    // Recompose `lastAnalysis` from just the slices that survived. Files in
    // `dirtyFiles` contribute nothing yet — the next incremental run fills
    // them in and merges with the restored cache.
    let restoredLastAnalysis: WorkspaceAnalysis;
    if (Object.keys(restoredAnalyzerCache).length > 0) {
      restoredLastAnalysis = workspaceAnalysisRebuildFromCache({
        policy,
        files: currentFiles,
        cache: restoredAnalyzerCache,
        scorecardTemplates: workspaceAnalyzerCacheScorecardTemplatesGet(restoredAnalyzerCache),
        analyzerInventory: snapshot.analyzerInventory ?? [],
        featureStatus: snapshot.featureStatus,
      });
    } else {
      // No reusable per-file cache (e.g. v1 snapshot upgraded in place,
      // every file dirty). Fall back to the persisted `lastAnalysis` shape
      // restricted to unchanged files for self-consistency.
      const allowedUris = new Set(unchangedSet.values());
      const baseAnalysis = workspaceWarmCacheAnalysisRestore(input.workspace, snapshot);
      restoredLastAnalysis = {
        ...baseAnalysis,
        files: currentFiles,
        violations: baseAnalysis.violations.filter((violation) =>
          allowedUris.has(path.resolve(violation.filePath)),
        ),
        treeViolations: baseAnalysis.treeViolations.filter((violation) =>
          allowedUris.has(path.resolve(violation.filePath)),
        ),
        diagnostics: baseAnalysis.diagnostics.filter((diagnostic) =>
          allowedUris.has(path.resolve(workspaceUriToPath(diagnostic.uri))),
        ),
      };
    }

    // Build the base-index state from the live file list so the consumer
    // (`attachWorkspace`) seeds `workspace.baseIndexState` with the
    // post-delta `fileKey`. Reaching back to `snapshot.baseIndexState`
    // would re-publish the stale key and force `workspaceIndexGetOrBuild`
    // to do a redundant rebuild on the next call.
    const liveBaseIndexState: WorkspaceBaseIndexState | undefined = snapshot.baseIndexState
      ? {
          files: [...currentFiles],
          fileKey: currentFiles.join('\0'),
          workspacePackages: currentWorkspacePackages,
        }
      : undefined;

    return {
      analysisGeneration: snapshot.analysisGeneration,
      workspaceIndexRequired: snapshot.workspaceIndexRequired,
      lastAnalysis: restoredLastAnalysis,
      analyzerCache:
        Object.keys(restoredAnalyzerCache).length > 0 ? restoredAnalyzerCache : undefined,
      baseIndexState: liveBaseIndexState,
      toolFingerprints: currentToolFingerprints,
      indexState,
      dirtyFiles: dirtyFiles.size > 0 ? dirtyFiles : undefined,
      removedFiles: fileDelta.removedFiles.length > 0 ? fileDelta.removedFiles : undefined,
    };
  } catch {
    return undefined;
  }
}

async function workspaceWarmCacheSnapshotPersist(input: {
  warmCache?: WorkspaceWarmCacheStore;
  workspace: WorkspaceState;
  workspaceSession: WorkspaceSessionState;
}): Promise<void> {
  if (!input.warmCache || input.workspaceSession.status !== 'ready') {
    return;
  }
  if (!input.workspaceSession.lastAnalysis) {
    return;
  }

  const fingerprints = workspaceWarmCacheFingerprintsRead({
    files: input.workspaceSession.lastAnalysis.files,
    configPath: input.workspace.configPath,
    externalToolConfigs: input.workspace.externalToolConfigs,
  });
  if (!fingerprints) {
    return;
  }

  const policy = input.workspace.config as PolicyFile;
  const pluginRulesResult = await policyPluginsGet(policy, input.workspace.rootPath, {
    configPath: input.workspace.configPath,
  });
  if (isErr(pluginRulesResult)) {
    return;
  }
  const pluginCompatibility = workspacePluginCompatibilityRead(
    input.workspace,
    policy,
    pluginRulesResult.Ok,
  );

  // Project the analyzer cache before writing. Per-(analyzer, file) entries
  // analysed against overlay text carry a `key.contentFingerprint` of the
  // form `overlay:<version>` (see `workspaceContentFingerprintForFile`).
  // Persisting those would let next session's restore return diagnostics
  // keyed on a fingerprint no disk file can produce, so they'd remain stuck
  // as cache hits forever. Drop them here; the file is in
  // `lastAnalysis.files` so `fileFingerprints` still records a valid disk
  // fingerprint, which the next session uses to mark the file dirty and
  // re-analyze.
  //
  // `lastAnalysis.diagnostics` and `lastAnalysis.treeViolations` are NOT
  // filtered. They are advisory ("here's what we showed users last") rather
  // than authoritative; restore overlays them with the next analysis run's
  // output before publishing. Filtering them adds complexity (recomputing
  // scorecard counts, featureStatus) for no observable user-visible benefit.
  //
  // `projectIndexStoreSnapshot` is also persisted as-is. The restore path
  // runs `workspaceWarmCacheFileDeltaCompute` and feeds files whose
  // (size, mtime) diverged into `dirtyFiles`, then drops their entries from
  // the restored index store, so overlay-tainted index slices get cleaned
  // up on first use after restore.
  const persistableAnalyzerCache = workspaceAnalyzerCacheFilterEntries(
    input.workspaceSession.analyzerCache,
    (entry) => !entry.key.contentFingerprint.startsWith('overlay:'),
  );

  await input.warmCache.write(workspaceWarmCacheKeyCreate(input.workspace), {
    compatVersion: WORKSPACE_WARM_CACHE_COMPAT_VERSION,
    workspaceId: input.workspace.workspaceId,
    rootPath: input.workspace.rootPath,
    configPath: input.workspace.configPath,
    externalToolConfigs: fingerprints.externalToolConfigFingerprints,
    analysisGeneration: input.workspaceSession.analysisGeneration,
    workspaceIndexRequired: input.workspaceSession.workspaceIndexRequired ?? false,
    files: [...input.workspaceSession.lastAnalysis.files],
    diagnostics: [...input.workspaceSession.lastAnalysis.diagnostics],
    treeViolations: [...input.workspaceSession.lastAnalysis.treeViolations],
    analyzerInventory: [...input.workspaceSession.lastAnalysis.analyzerInventory],
    analyzerScorecard: [...input.workspaceSession.lastAnalysis.analyzerScorecard],
    featureStatus: input.workspaceSession.lastAnalysis.featureStatus,
    baseIndexState: workspaceWarmCacheBaseIndexSnapshotCreate(input.workspace.baseIndexState),
    projectIndexStoreSnapshot: input.workspaceSession.indexState
      ? projectIndexStoreSnapshotCreate(
          input.workspaceSession.indexState.store,
          input.workspaceSession.indexState.capabilities,
        )
      : undefined,
    configFingerprint: fingerprints.configFingerprint,
    fileFingerprints: fingerprints.fileFingerprints,
    toolFingerprints: input.workspaceSession.toolFingerprints ?? [],
    pluginSignature: pluginCompatibility.pluginSignature,
    pluginFingerprints: pluginCompatibility.pluginFingerprints,
    analyzerCache: workspaceAnalyzerCacheSerialize(persistableAnalyzerCache),
    createdAtUnixMs: Date.now(),
  });
}

async function workspaceIndexRequirementResolve(
  workspace: WorkspaceContextState,
): Promise<boolean | undefined> {
  try {
    await ensureWorkspaceRuntimeReady();
    builtinPluginsRefresh();
    const policy = workspace.config as PolicyFile;
    const pluginRulesResult = await policyPluginsGet(policy, workspace.rootPath, {
      configPath: workspace.configPath,
    });
    if (isErr(pluginRulesResult)) {
      return undefined;
    }
    if (!configuredRulesRequireProjectIndex(policy.rules, pluginRulesResult.Ok)) {
      return false;
    }
    const matches = await ruleMatchesGet(policy, workspace.rootPath);
    return matchedRulesRequireProjectIndex(matches, pluginRulesResult.Ok);
  } catch {
    return undefined;
  }
}

function providerViolationsToDiagnostics(
  violations: PolicyViolation[],
  source: string,
): WorkspaceDiagnostic[] {
  return violations.map((violation) =>
    policyViolationToWorkspaceDiagnostic(violation, {
      source,
    }),
  );
}

function workspaceTreeAnalyzerRun(
  input: {
    configPath: string;
    matches: RuleMatch[];
    pluginRulesMap: Awaited<ReturnType<typeof policyPluginsGet>> extends Result<infer T, string>
      ? T
      : never;
    policy: PolicyFile;
    projectIndex?: ProjectIndex;
    rootPath: string;
    sourceByFilePath: Map<string, string>;
    strictErrors: boolean;
    // When provided, only run tree checks against files in this set (intersected
    // with each rule's matched files). Used by the incremental orchestrator to
    // re-run cache-miss files only.
    targetFiles?: ReadonlySet<string>;
  },
): WorkspaceAnalyzerRunResult {
  const treeMatches = input.matches.filter((match) => {
    if (match.rule.providers && match.rule.providers.length > 0) {
      return match.rule.providers.includes('tree-sitter');
    }
    const lookup = pluginGetForRule(input.pluginRulesMap, match.rule.ruleId);
    return Boolean(lookup?.plugin.pluginRule.capabilities.treeCheckProvider);
  });
  const ownedRuleIds = workspaceAnalyzerRuleIdsNormalize(
    treeMatches.map((match) => {
      const lookup = pluginGetForRule(input.pluginRulesMap, match.rule.ruleId);
      return lookup?.resolvedId ?? match.rule.ruleId;
    }),
  );

  if (ownedRuleIds.length === 0) {
    return workspaceAnalyzerRunResultCreate(
      workspaceAnalyzerScorecardCreate({
        analyzerId: 'codepol/tree',
        platform: 'codepol_tree',
        languages: [...WORKSPACE_NATIVE_OWNERSHIP_LANGUAGES, 'python'],
        ownedRuleIds,
        fixMode: 'inline',
        status: 'skipped',
        skippedReason: 'no_matching_rules',
      }),
    );
  }

  const files = new Set<string>();
  for (const match of treeMatches) {
    for (const filePath of match.files) {
      if (input.targetFiles && !input.targetFiles.has(filePath)) {
        continue;
      }
      files.add(filePath);
    }
  }
  if (files.size === 0) {
    return workspaceAnalyzerRunResultCreate(
      workspaceAnalyzerScorecardCreate({
        analyzerId: 'codepol/tree',
        platform: 'codepol_tree',
        languages: [...WORKSPACE_NATIVE_OWNERSHIP_LANGUAGES, 'python'],
        ownedRuleIds,
        fixMode: 'inline',
        status: 'skipped',
        skippedReason: 'no_matching_files',
      }),
    );
  }

  const violations: PolicyViolation[] = [];
  const issues: string[] = [];
  const startedAt = Date.now();
  const diag = diagnosticsRuntimeGet().getDiagnostics('workspace.analyzer');
  let firstTreeCheckFailure: { ruleId: string; filePath: string; error: string } | undefined;

  for (const match of treeMatches) {
    for (const filePath of match.files) {
      if (input.targetFiles && !input.targetFiles.has(filePath)) {
        continue;
      }
      const result = policyViolationsGetForFile(
        filePath,
        match.rule,
        match.target,
        input.policy,
        input.pluginRulesMap,
        input.rootPath,
        input.configPath,
        input.projectIndex,
        input.sourceByFilePath.get(filePath),
      );
      if (isErr(result)) {
        if (input.strictErrors) {
          throw new Error(result.Err);
        }
        const relativePath = workspaceRelativePathCreate(input.rootPath, filePath);
        if (!firstTreeCheckFailure) {
          firstTreeCheckFailure = {
            ruleId: match.rule.ruleId,
            filePath: relativePath,
            error: result.Err,
          };
          diag.warn('tree_check.first_failure', firstTreeCheckFailure);
        } else {
          diag.debug('tree_check.subsequent_failure', () => ({
            ruleId: match.rule.ruleId,
            filePath: relativePath,
            error: result.Err,
            firstFailure: firstTreeCheckFailure,
          }));
        }
        const issue =
          `Tree check failed for ${match.rule.ruleId} in ` +
          `${relativePath}: ${result.Err}`;
        console.warn(issue);
        issues.push(issue);
        continue;
      }
      violations.push(...result.Ok);
    }
  }

  const diagnostics: WorkspaceDiagnostic[] = [];
  const fixableTreeViolationsByDiagnosticId = new Map<string, PolicyViolation>();
  for (const violation of violations) {
    const severity = severityFromLintSeverity(policyRuleGet(input.policy, violation.ruleId)?.severity);
    const diagnostic = policyViolationToWorkspaceDiagnostic(violation, {
      severity,
      source: 'codepol',
    });
    diagnostics.push(diagnostic);
    if (violation.fix || (violation.suggestions && violation.suggestions.length > 0)) {
      fixableTreeViolationsByDiagnosticId.set(diagnostic.id, violation);
    }
  }

  return workspaceAnalyzerRunResultCreate(
    workspaceAnalyzerScorecardCreate({
      analyzerId: 'codepol/tree',
      platform: 'codepol_tree',
      languages: [...WORKSPACE_NATIVE_OWNERSHIP_LANGUAGES, 'python'],
      ownedRuleIds,
      diagnosticCount: diagnostics.length,
      violationCount: violations.length,
      fileCount: files.size,
      fixMode: 'inline',
      status: issues.length > 0 ? 'failed' : 'ran',
      latencyMs: Date.now() - startedAt,
      issues,
    }),
    {
      diagnostics,
      fixableTreeViolationsByDiagnosticId,
      treeViolations: violations,
      violations,
    },
  );
}

/**
 * Diagnostic source emitted by architecture rules (cycles, dead
 * modules, layer violations). Kept as a published constant so other
 * packages — VS Code extension settings, future mute-source UI — can
 * gate on a single string.
 */
export const WORKSPACE_ARCHITECTURE_DIAGNOSTIC_SOURCE = 'codepol/architecture';

/**
 * Map architecture-rule violations to workspace diagnostics tagged with
 * the dedicated architecture source.
 *
 * Severity rules:
 *
 * - explicit policy `severity` (`warn` / `error`) maps through
 *   {@link severityFromLintSeverity}
 * - missing severity defaults to `info` so cycles / dead modules
 *   participate in the Problems panel without dominating it; this
 *   matches the Phase 8 / Q6 default decision in
 *   `TODO_CODEPOL_LSP_ARCHITECTURE_GRAPH_MODEL.md`
 */
function workspaceArchitectureDiagnosticSeverityResolve(
  policy: PolicyFile,
  ruleId: string,
): WorkspaceDiagnosticSeverity {
  const rule = policyRuleGet(policy, ruleId);
  if (rule?.severity) {
    return severityFromLintSeverity(rule.severity);
  }
  return 'info';
}

/**
 * Run the architecture-check pipeline against the already-built
 * project index and return the resulting diagnostics under the
 * dedicated `codepol/architecture` source.
 *
 * Returns an empty array when:
 *
 * - no plugin in the policy declares an `architectureCheckProvider`
 * - the project index is unavailable (e.g. workspace index not required)
 *
 * Errors from individual architecture rules are reported as analyzer
 * issues rather than propagated, so a single mis-configured rule does
 * not blank out the entire diagnostic stream.
 */
/**
 * Synchronous predicate that decides whether to invoke the async
 * architecture analyzer. Kept separate from
 * {@link workspaceArchitectureDiagnosticsRun} so callers can avoid the
 * extra microtask transition entirely on the (very common) hot path
 * where no policy rule declares an architecture provider. The hot path
 * stays synchronous, which preserves the diagnostic-publish ordering
 * the manual-timer LSP tests assume.
 *
 * The check is scoped to **matched** rules (i.e. rules listed in
 * `policy.rules` whose target globs hit at least one file). This is
 * stricter than `pluginsMapHasArchitectureProvider`, which returns true
 * whenever any plugin in the loaded plugin pack ships an architecture
 * rule — even when the policy never references that rule.
 */
function workspaceArchitectureDiagnosticsShouldRun(input: {
  matches: RuleMatch[];
  pluginRulesMap: Awaited<ReturnType<typeof policyPluginsGet>> extends Result<infer T, string>
    ? T
    : never;
  projectIndex: ProjectIndex | undefined;
}): boolean {
  if (!input.projectIndex) return false;
  for (const match of input.matches) {
    const lookup = pluginGetForRule(input.pluginRulesMap, match.rule.ruleId);
    if (lookup?.plugin.pluginRule.capabilities.architectureCheckProvider) {
      return true;
    }
  }
  return false;
}

async function workspaceArchitectureDiagnosticsRun(input: {
  policy: PolicyFile;
  rootPath: string;
  configPath: string;
  pluginRulesMap: Awaited<ReturnType<typeof policyPluginsGet>> extends Result<infer T, string>
    ? T
    : never;
  projectIndex: ProjectIndex | undefined;
  signal?: AbortSignal;
}): Promise<{
  diagnostics: WorkspaceDiagnostic[];
  violations: PolicyViolation[];
  issues: string[];
}> {
  if (!input.projectIndex) {
    return { diagnostics: [], violations: [], issues: [] };
  }
  if (!pluginsMapHasArchitectureProvider(input.pluginRulesMap)) {
    return { diagnostics: [], violations: [], issues: [] };
  }
  workspaceAbortSignalThrowIfAborted(input.signal);

  const result = await policyArchitectureViolationsGetFromDir(
    input.policy,
    input.rootPath,
    {
      configPath: input.configPath,
      projectIndex: input.projectIndex,
      pluginsMap: input.pluginRulesMap,
    },
  );
  if (isErr(result)) {
    return {
      diagnostics: [],
      violations: [],
      issues: [`Architecture check failed: ${result.Err}`],
    };
  }

  const violations = result.Ok;
  const diagnostics: WorkspaceDiagnostic[] = violations.map((violation) =>
    policyViolationToWorkspaceDiagnostic(violation, {
      severity: workspaceArchitectureDiagnosticSeverityResolve(
        input.policy,
        violation.ruleId,
      ),
      source: WORKSPACE_ARCHITECTURE_DIAGNOSTIC_SOURCE,
    }),
  );
  return { diagnostics, violations, issues: [] };
}

async function eslintAnalyzerRun(
  input: {
    files: string[];
    matches: RuleMatch[];
    sourceByFilePath: Map<string, string>;
    policy: PolicyFile;
    configPath: string;
    cwd: string;
    lintProviderEntries: LintProviderEntry[];
    nativeOwnedWrappedRuleIds: ReadonlySet<string>;
    ruleTargets: PolicyRuleTargetContext[];
    pluginRules: Awaited<ReturnType<typeof policyPluginsGet>> extends Result<infer T, string>
      ? T
      : never;
    fix: boolean;
    collectOutput: boolean;
    // When provided, only lint files in this set. Used by the incremental
    // orchestrator to lint cache-miss files only.
    targetFiles?: ReadonlySet<string>;
    // Exposed so the orchestrator can recover per-file errorCount for the
    // merged `eslintHasErrors` calculation.
    onPerFileResult?: (result: { filePath: string; errorCount: number }) => void;
  },
): Promise<WorkspaceAnalyzerRunResult> {
  const eligibleEntries = input.lintProviderEntries.filter(
    (entry) => entry.provider.platform === 'eslint',
  );
  if (eligibleEntries.length === 0) {
    return workspaceAnalyzerRunResultCreate(
      workspaceAnalyzerScorecardCreate({
        analyzerId: 'eslint',
        platform: 'eslint',
        languages: [...WORKSPACE_NATIVE_OWNERSHIP_LANGUAGES],
        ownedRuleIds: [],
        fixMode: 'external',
        status: 'skipped',
        skippedReason: 'no_matching_rules',
      }),
    );
  }

  const hasBridgeEntry = eligibleEntries.some(
    (entry) => entry.ruleId === ESLINT_BRIDGE_RULE_ID,
  );
  if (!hasBridgeEntry) {
    throw new Error(
      'ESLint-backed policy rule found without the ESLint bridge rule. ' +
      ESLINT_BRIDGE_MIGRATION_HINT,
    );
  }

  const executableEntries = eligibleEntries.filter(
    (entry) => !workspaceLintProviderEntryIsNativePreferred(entry, input.nativeOwnedWrappedRuleIds),
  );
  const skippedRuleIds = eligibleEntries
    .filter((entry) => workspaceLintProviderEntryIsNativePreferred(entry, input.nativeOwnedWrappedRuleIds))
    .map((entry) => entry.ruleId);
  const ownedRuleIds = executableEntries.map((entry) => entry.ruleId);

  if (ownedRuleIds.length === 0) {
    return workspaceAnalyzerRunResultCreate(
      workspaceAnalyzerScorecardCreate({
        analyzerId: 'eslint',
        platform: 'eslint',
        languages: [...WORKSPACE_NATIVE_OWNERSHIP_LANGUAGES],
        ownedRuleIds: [],
        skippedRuleIds,
        skippedReason: 'native_preferred',
        fixMode: 'external',
        status: 'skipped',
      }),
    );
  }

  const groups = eslintGroupsBuild(executableEntries, input.configPath);
  if (groups.size === 0) {
    throw new Error(
      '`@codepol/plugin/eslint` requires `args.configPath` (e.g. "./eslint.config.mjs"). ' +
      ESLINT_BRIDGE_MIGRATION_HINT,
    );
  }

  type EslintLintResult = {
    filePath: string;
    messages: Array<{
      ruleId?: string | null;
      message: string;
      line: number;
      column: number;
      endLine?: number;
      endColumn?: number;
      severity?: number;
    }>;
    errorCount: number;
  };

  const groupFiles = new Map<
    string,
    { overlay: string[]; closed: string[] }
  >();
  const allFiles = new Set<string>();
  for (const [key, group] of groups) {
    const raw = analyzerGroupFilesCollect(
      group.rules,
      input.matches,
      BIOME_FILE_EXTENSIONS,
    );
    const filtered = input.targetFiles
      ? new Set([...raw].filter((filePath) => input.targetFiles!.has(filePath)))
      : raw;
    const overlay = input.fix
      ? []
      : [...filtered].filter((filePath) =>
          input.sourceByFilePath.has(filePath),
        );
    const closed = [...filtered].filter(
      (filePath) => !input.sourceByFilePath.has(filePath),
    );
    groupFiles.set(key, { overlay, closed });
    for (const filePath of filtered) {
      allFiles.add(filePath);
    }
  }

  if (allFiles.size === 0) {
    return workspaceAnalyzerRunResultCreate(
      workspaceAnalyzerScorecardCreate({
        analyzerId: 'eslint',
        platform: 'eslint',
        languages: [...WORKSPACE_NATIVE_OWNERSHIP_LANGUAGES],
        ownedRuleIds,
        skippedRuleIds,
        skippedReason: 'no_matching_files',
        fixMode: 'external',
        status: 'skipped',
      }),
    );
  }

  let ESLintClass: typeof import('eslint').ESLint | undefined;
  try {
    const eslintModule = await import('eslint');
    ESLintClass = eslintModule.ESLint;
  } catch {
    const issue =
      'ESLint is not installed. Skipping ESLint-based rules.\n' +
      'Install eslint to enable: npm install -D eslint';
    console.warn(issue);
    return workspaceAnalyzerRunResultCreate(
      workspaceAnalyzerScorecardCreate({
        analyzerId: 'eslint',
        platform: 'eslint',
        languages: [...WORKSPACE_NATIVE_OWNERSHIP_LANGUAGES],
        ownedRuleIds,
        skippedRuleIds,
        diagnosticCount: 0,
        violationCount: 0,
        fileCount: allFiles.size,
        fixMode: 'external',
        status: 'failed',
        issues: [issue.replace('\n', ' ')],
      }),
    );
  }

  const startedAt = Date.now();
  const lintResults: EslintLintResult[] = [];
  const formatterOutputs: string[] = [];
  const codepolEslintPlugin = eslintPluginCreate(
    Array.from(input.pluginRules.values()).map((entry) => entry.pluginRule),
  ) as unknown as import('eslint').ESLint.Plugin;
  for (const [key, group] of groups) {
    const filesForGroup = groupFiles.get(key);
    if (!filesForGroup) {
      continue;
    }
    if (filesForGroup.overlay.length === 0 && filesForGroup.closed.length === 0) {
      continue;
    }
    const overrideConfig = eslintConfigGet(group.entries, {
      policy: input.policy,
      configPath: input.configPath,
      cwd: input.cwd,
      ruleTargets: input.ruleTargets,
    });
    const eslintGroupRun = async (
      injectCodepolPlugin: boolean,
    ): Promise<{ results: EslintLintResult[]; formattedOutput: string }> => {
      const eslint = new ESLintClass({
        overrideConfigFile: group.configPath,
        ...(injectCodepolPlugin
          ? {
              plugins: {
                codepol: codepolEslintPlugin,
              },
            }
          : {}),
        overrideConfig,
        fix: input.fix,
        cwd: input.cwd,
      });

      const groupRunResults: EslintLintResult[] = [];
      for (const filePath of filesForGroup.overlay) {
        const source = input.sourceByFilePath.get(filePath)!;
        const overlayRunResults = (await eslint.lintText(source, {
          filePath,
        })) as EslintLintResult[];
        groupRunResults.push(...overlayRunResults);
      }

      if (filesForGroup.closed.length > 0) {
        const closedRunResults = (await eslint.lintFiles(
          filesForGroup.closed,
        )) as EslintLintResult[];
        groupRunResults.push(...closedRunResults);
      }

      let formattedOutput = '';
      if (input.collectOutput && groupRunResults.length > 0) {
        const formatter = await eslint.loadFormatter('stylish');
        formattedOutput = (
          await formatter.format(
            groupRunResults as unknown as Awaited<ReturnType<typeof eslint.lintFiles>>,
          )
        ).trim();
      }

      return { results: groupRunResults, formattedOutput };
    };

    let groupRun;
    try {
      groupRun = await eslintGroupRun(true);
    } catch (error) {
      if (!eslintPluginRedefinitionErrorIs(error, ESLINT_PLUGIN_NAME_DEFAULT)) {
        throw error;
      }
      groupRun = await eslintGroupRun(false);
    }

    lintResults.push(...groupRun.results);

    if (groupRun.formattedOutput.length > 0) {
      formatterOutputs.push(groupRun.formattedOutput);
    }
  }

  if (input.fix) {
    type EslintFilesLintResults = Awaited<
      ReturnType<InstanceType<typeof import('eslint').ESLint>['lintFiles']>
    >;
    await ESLintClass.outputFixes(
      lintResults as unknown as EslintFilesLintResults,
    );
  }

  const output = input.collectOutput ? formatterOutputs.join('\n').trim() : '';

  const violations: PolicyViolation[] = [];
  const diagnostics: WorkspaceDiagnostic[] = [];
  for (const result of lintResults) {
    if (input.onPerFileResult) {
      input.onPerFileResult({
        filePath: result.filePath,
        errorCount: result.errorCount,
      });
    }
    for (const msg of result.messages) {
      const violation: PolicyViolation = {
        ruleId: msg.ruleId ?? 'unknown',
        filePath: result.filePath,
        message: msg.message,
        line: msg.line,
        column: msg.column,
        endLine: msg.endLine,
        endColumn: msg.endColumn,
      };
      violations.push(violation);

      const diagnostic: LintDiagnostic = {
        ruleId: msg.ruleId ?? 'unknown',
        message: msg.message,
        line: msg.line,
        column: msg.column,
        endLine: msg.endLine,
        endColumn: msg.endColumn,
        severity: msg.severity === 1 ? 'warning' : 'error',
      };
      diagnostics.push(
        lintDiagnosticToWorkspaceDiagnostic(diagnostic, result.filePath, {
          source: 'eslint',
        }),
      );
    }
  }

  return workspaceAnalyzerRunResultCreate(
    workspaceAnalyzerScorecardCreate({
      analyzerId: 'eslint',
      platform: 'eslint',
      languages: [...WORKSPACE_NATIVE_OWNERSHIP_LANGUAGES],
      ownedRuleIds,
      skippedRuleIds,
      skippedReason: skippedRuleIds.length > 0 ? 'native_preferred' : undefined,
      diagnosticCount: diagnostics.length,
      violationCount: violations.length,
      fileCount: allFiles.size,
      fixMode: 'external',
      status: 'ran',
      latencyMs: Date.now() - startedAt,
    }),
    {
      diagnostics,
      hasErrors: lintResults.some((result) => result.errorCount > 0),
      output,
      violations,
    },
  );
}

async function biomeAnalyzerRun(
  input: {
    matches: RuleMatch[];
    lintProviderEntries: LintProviderEntry[];
    nativeOwnedWrappedRuleIds: ReadonlySet<string>;
    fix: boolean;
    signal?: AbortSignal;
    // When provided, only check files in this set. Used by the incremental
    // orchestrator to lint cache-miss files only.
    targetFiles?: ReadonlySet<string>;
  },
): Promise<WorkspaceAnalyzerRunResult> {
  workspaceAbortSignalThrowIfAborted(input.signal);
  const eligibleEntries = input.lintProviderEntries.filter(
    (entry) => entry.provider.platform === 'biome',
  );
  if (eligibleEntries.length === 0) {
    return workspaceAnalyzerRunResultCreate(
      workspaceAnalyzerScorecardCreate({
        analyzerId: 'biome',
        platform: 'biome',
        languages: [...WORKSPACE_NATIVE_OWNERSHIP_LANGUAGES],
        ownedRuleIds: [],
        fixMode: 'external',
        status: 'skipped',
        skippedReason: 'no_matching_rules',
      }),
    );
  }

  const executableEntries = eligibleEntries.filter(
    (entry) => !workspaceLintProviderEntryIsNativePreferred(entry, input.nativeOwnedWrappedRuleIds),
  );
  const skippedRuleIds = eligibleEntries
    .filter((entry) => workspaceLintProviderEntryIsNativePreferred(entry, input.nativeOwnedWrappedRuleIds))
    .map((entry) => entry.ruleId);
  const ownedRuleIds = executableEntries.map((entry) => entry.ruleId);

  if (ownedRuleIds.length === 0) {
    return workspaceAnalyzerRunResultCreate(
      workspaceAnalyzerScorecardCreate({
        analyzerId: 'biome',
        platform: 'biome',
        languages: [...WORKSPACE_NATIVE_OWNERSHIP_LANGUAGES],
        ownedRuleIds: [],
        skippedRuleIds,
        skippedReason: 'native_preferred',
        fixMode: 'external',
        status: 'skipped',
      }),
    );
  }

  const groups = biomeGroupsBuild(executableEntries);
  const groupFiles = new Map<string, Set<string>>();
  for (const [key, group] of groups) {
    const raw = analyzerGroupFilesCollect(
      group.rules,
      input.matches,
      BIOME_FILE_EXTENSIONS,
    );
    const filtered = input.targetFiles
      ? new Set([...raw].filter((filePath) => input.targetFiles!.has(filePath)))
      : raw;
    groupFiles.set(key, filtered);
  }
  const fileCount = new Set(
    [...groupFiles.values()].flatMap((filesSet) => [...filesSet]),
  ).size;
  if (fileCount === 0) {
    return workspaceAnalyzerRunResultCreate(
      workspaceAnalyzerScorecardCreate({
        analyzerId: 'biome',
        platform: 'biome',
        languages: [...WORKSPACE_NATIVE_OWNERSHIP_LANGUAGES],
        ownedRuleIds,
        skippedRuleIds,
        skippedReason: 'no_matching_files',
        fixMode: 'external',
        status: 'skipped',
      }),
    );
  }

  const startedAt = Date.now();
  const violations: PolicyViolation[] = [];
  const issues: string[] = [];
  for (const [key, group] of groups) {
    workspaceAbortSignalThrowIfAborted(input.signal);
    const files = [...(groupFiles.get(key) ?? new Set<string>())];
    if (files.length === 0) {
      continue;
    }
    const config = group.config;

    if (input.fix) {
      const biomeFixResult = await biomeFixAsync(files, config, {
        signal: input.signal,
      });
      if (isErr(biomeFixResult)) {
        const issue = `Biome fix failed: ${biomeFixResult.Err}`;
        console.warn(issue);
        issues.push(issue);
      }
    }

    const biomeResult = await biomeCheckAsync(files, config, {
      signal: input.signal,
    });
    if (isErr(biomeResult)) {
      const issue = `Biome lint failed: ${biomeResult.Err}`;
      console.warn(issue);
      issues.push(issue);
      continue;
    }
    violations.push(...biomeResult.Ok);
  }

  const diagnostics = providerViolationsToDiagnostics(violations, 'biome');
  return workspaceAnalyzerRunResultCreate(
    workspaceAnalyzerScorecardCreate({
      analyzerId: 'biome',
      platform: 'biome',
      languages: [...WORKSPACE_NATIVE_OWNERSHIP_LANGUAGES],
      ownedRuleIds,
      skippedRuleIds,
      skippedReason: skippedRuleIds.length > 0 ? 'native_preferred' : undefined,
      diagnosticCount: diagnostics.length,
      violationCount: violations.length,
      fileCount,
      fixMode: 'external',
      status: issues.length > 0 ? 'failed' : 'ran',
      latencyMs: Date.now() - startedAt,
      issues,
    }),
    {
      diagnostics,
      violations,
    },
  );
}

async function ruffAnalyzerRun(
  input: {
    files: string[];
    matches: RuleMatch[];
    lintProviderEntries: LintProviderEntry[];
    nativeOwnedWrappedRuleIds: ReadonlySet<string>;
    fix: boolean;
    signal?: AbortSignal;
    // When provided, only check files in this set. Used by the incremental
    // orchestrator to lint cache-miss files only.
    targetFiles?: ReadonlySet<string>;
  },
): Promise<WorkspaceAnalyzerRunResult> {
  workspaceAbortSignalThrowIfAborted(input.signal);
  const eligibleEntries = input.lintProviderEntries.filter(
    (entry) => entry.provider.platform === 'ruff',
  );
  if (eligibleEntries.length === 0) {
    return workspaceAnalyzerRunResultCreate(
      workspaceAnalyzerScorecardCreate({
        analyzerId: 'ruff',
        platform: 'ruff',
        languages: ['python'],
        ownedRuleIds: [],
        fixMode: 'external',
        status: 'skipped',
        skippedReason: 'no_matching_rules',
      }),
    );
  }

  const executableEntries = eligibleEntries.filter(
    (entry) => !workspaceLintProviderEntryIsNativePreferred(entry, input.nativeOwnedWrappedRuleIds),
  );
  const skippedRuleIds = eligibleEntries
    .filter((entry) => workspaceLintProviderEntryIsNativePreferred(entry, input.nativeOwnedWrappedRuleIds))
    .map((entry) => entry.ruleId);
  const ownedRuleIds = executableEntries.map((entry) => entry.ruleId);

  if (ownedRuleIds.length === 0) {
    return workspaceAnalyzerRunResultCreate(
      workspaceAnalyzerScorecardCreate({
        analyzerId: 'ruff',
        platform: 'ruff',
        languages: ['python'],
        ownedRuleIds: [],
        skippedRuleIds,
        skippedReason: 'native_preferred',
        fixMode: 'external',
        status: 'skipped',
      }),
    );
  }

  const groups = ruffGroupsBuild(executableEntries);
  const groupFiles = new Map<string, Set<string>>();
  for (const [key, group] of groups) {
    const raw = analyzerGroupFilesCollect(
      group.rules,
      input.matches,
      PYTHON_FILE_EXTENSIONS,
    );
    const filtered = input.targetFiles
      ? new Set([...raw].filter((filePath) => input.targetFiles!.has(filePath)))
      : raw;
    groupFiles.set(key, filtered);
  }
  const allFiles = new Set(
    [...groupFiles.values()].flatMap((filesSet) => [...filesSet]),
  );
  if (allFiles.size === 0) {
    return workspaceAnalyzerRunResultCreate(
      workspaceAnalyzerScorecardCreate({
        analyzerId: 'ruff',
        platform: 'ruff',
        languages: ['python'],
        ownedRuleIds,
        skippedRuleIds,
        skippedReason: 'no_matching_files',
        fixMode: 'external',
        status: 'skipped',
      }),
    );
  }

  const startedAt = Date.now();
  const issues: string[] = [];
  const violations: PolicyViolation[] = [];
  let anyCheckRan = false;
  for (const [key, group] of groups) {
    workspaceAbortSignalThrowIfAborted(input.signal);
    const files = [...(groupFiles.get(key) ?? new Set<string>())];
    if (files.length === 0) {
      continue;
    }
    const config = group.config;

    if (input.fix) {
      const ruffFixResult = await ruffFixAsync(files, config, {
        signal: input.signal,
      });
      if (isErr(ruffFixResult)) {
        const issue = `Ruff fix failed: ${ruffFixResult.Err}`;
        console.warn(issue);
        issues.push(issue);
      }
    }

    workspaceAbortSignalThrowIfAborted(input.signal);
    const ruffResult = await ruffCheckAsync(files, config, {
      signal: input.signal,
    });
    if (isErr(ruffResult)) {
      const issue = `Ruff check failed: ${ruffResult.Err}`;
      console.warn(issue);
      issues.push(issue);
      continue;
    }
    anyCheckRan = true;
    violations.push(...ruffResult.Ok);
  }

  const diagnostics = providerViolationsToDiagnostics(violations, 'ruff');
  const fileCount = allFiles.size;
  const status: WorkspaceAnalyzerStatus = anyCheckRan
    ? issues.length > 0
      ? 'failed'
      : 'ran'
    : 'failed';
  return workspaceAnalyzerRunResultCreate(
    workspaceAnalyzerScorecardCreate({
      analyzerId: 'ruff',
      platform: 'ruff',
      languages: ['python'],
      ownedRuleIds,
      skippedRuleIds,
      skippedReason: skippedRuleIds.length > 0 ? 'native_preferred' : undefined,
      diagnosticCount: diagnostics.length,
      violationCount: violations.length,
      fileCount,
      fixMode: 'external',
      status,
      latencyMs: Date.now() - startedAt,
      issues,
    }),
    {
      diagnostics,
      violations,
    },
  );
}

function workspaceAnalysisCompose(input: {
  treeResult: WorkspaceAnalyzerRunResult;
  eslintResult: WorkspaceAnalyzerRunResult;
  biomeResult: WorkspaceAnalyzerRunResult;
  ruffResult: WorkspaceAnalyzerRunResult;
  policy: PolicyFile;
  files: string[];
  pluginRulesMap: Awaited<ReturnType<typeof policyPluginsGet>> extends Result<infer T, string>
    ? T
    : never;
  lintProviderEntries: LintProviderEntry[];
  ruleTargets: PolicyRuleTargetContext[];
  projectIndex: ProjectIndex | undefined;
  workspaceIndexRequired: boolean;
  /**
   * Optional architecture-rule output. When present, its diagnostics
   * are appended to `analysis.diagnostics` and its violations to
   * `analysis.violations`. Architecture rules are project-wide; they
   * never produce per-file fixable violations, so they do not flow
   * into `treeViolations` or `fixableTreeViolationsByDiagnosticId`.
   */
  architectureResult?: {
    diagnostics: WorkspaceDiagnostic[];
    violations: PolicyViolation[];
    issues: string[];
  };
}): WorkspaceAnalysis {
  const { treeResult, eslintResult, biomeResult, ruffResult } = input;
  const analyzerResults = [treeResult, eslintResult, biomeResult, ruffResult];
  const analyzerIssues = analyzerResults.flatMap((result) => result.issues);
  if (input.architectureResult) {
    analyzerIssues.push(...input.architectureResult.issues);
  }
  return {
    analyzerInventory: workspaceAnalyzerInventoryBuild({
      analyzerResults,
      lintProviderEntries: input.lintProviderEntries,
      pluginRulesMap: input.pluginRulesMap,
      policy: input.policy,
      ruleTargets: input.ruleTargets,
    }),
    analyzerScorecard: analyzerResults.map((result) => result.scorecard),
    policy: input.policy,
    files: input.files,
    violations: [
      ...analyzerResults.flatMap((result) => result.violations),
      ...(input.architectureResult?.violations ?? []),
    ],
    treeViolations: [...treeResult.treeViolations],
    diagnostics: [
      ...analyzerResults.flatMap((result) => result.diagnostics),
      ...(input.architectureResult?.diagnostics ?? []),
    ],
    featureStatus: {
      diagnostics: workspaceFeatureStatusReadyOrDegraded(analyzerIssues),
      codeActions: workspaceFeatureStatusCreate({
        readiness: 'ready',
      }),
      editPlans: workspaceFeatureStatusCreate({
        readiness: 'ready',
      }),
      workspaceIndex: input.workspaceIndexRequired
        ? workspaceFeatureStatusCreate({
            readiness: input.projectIndex ? 'ready' : 'degraded',
            detail: input.projectIndex
              ? 'Session-derived index ready'
              : 'Project index required but unavailable',
          })
        : workspaceFeatureStatusCreate({
            readiness: 'ready',
            detail: 'Not required by current policy',
          }),
      workspaceSymbols: workspaceIndexBackedFeatureStatusCreate({
        indexReady: input.projectIndex !== undefined,
        indexRequired: input.workspaceIndexRequired,
      }),
      semanticSearch: workspaceIndexBackedFeatureStatusCreate({
        indexReady: input.projectIndex !== undefined,
        indexRequired: input.workspaceIndexRequired,
      }),
      dependencyGraph: workspaceIndexBackedFeatureStatusCreate({
        indexReady: input.projectIndex !== undefined,
        indexRequired: input.workspaceIndexRequired,
      }),
      architectureSummary: workspaceIndexBackedFeatureStatusCreate({
        indexReady: input.projectIndex !== undefined,
        indexRequired: input.workspaceIndexRequired,
      }),
    },
    fixableTreeViolationsByDiagnosticId: treeResult.fixableTreeViolationsByDiagnosticId,
    eslintOutput: eslintResult.output,
    eslintHasErrors: eslintResult.hasErrors,
  };
}

function workspaceTreeAnalyzerFilesInScopeCollect(
  matches: RuleMatch[],
  pluginRulesMap: Awaited<ReturnType<typeof policyPluginsGet>> extends Result<infer T, string>
    ? T
    : never,
): string[] {
  const treeMatches = matches.filter((match) => {
    if (match.rule.providers && match.rule.providers.length > 0) {
      return match.rule.providers.includes('tree-sitter');
    }
    const lookup = pluginGetForRule(pluginRulesMap, match.rule.ruleId);
    return Boolean(lookup?.plugin.pluginRule.capabilities.treeCheckProvider);
  });
  const set = new Set<string>();
  for (const match of treeMatches) {
    for (const filePath of match.files) {
      set.add(filePath);
    }
  }
  return [...set];
}

function workspaceBiomeFilesInScopeCollect(matches: RuleMatch[]): string[] {
  const set = new Set<string>();
  for (const match of matches) {
    for (const filePath of match.files) {
      if (fileHasExtension(filePath, BIOME_FILE_EXTENSIONS)) {
        set.add(filePath);
      }
    }
  }
  return [...set];
}

type WorkspaceAnalyzerPartition = {
  hits: Map<string, WorkspaceAnalyzerFileCacheEntry>;
  misses: string[];
  keysByFile: Map<string, WorkspaceAnalyzerCacheKeyTuple>;
};

function workspaceAnalyzerPartitionCompute(input: {
  cache: WorkspaceAnalyzerCache;
  analyzer: WorkspaceAnalyzerCacheKey;
  filesInScope: string[];
  keyForFile: (filePath: string) => WorkspaceAnalyzerCacheKeyTuple;
}): WorkspaceAnalyzerPartition {
  const cacheEntry = input.cache[input.analyzer];
  const hits = new Map<string, WorkspaceAnalyzerFileCacheEntry>();
  const misses: string[] = [];
  const keysByFile = new Map<string, WorkspaceAnalyzerCacheKeyTuple>();
  for (const filePath of input.filesInScope) {
    const wantedKey = input.keyForFile(filePath);
    keysByFile.set(filePath, wantedKey);
    const cached = cacheEntry?.fileResults.get(filePath);
    if (cached && workspaceAnalyzerCacheKeyTupleEquals(cached.key, wantedKey)) {
      hits.set(filePath, cached);
    } else {
      misses.push(filePath);
    }
  }
  return { hits, misses, keysByFile };
}

function workspaceAnalyzerScorecardTemplateForEmpty(
  analyzer: WorkspaceAnalyzerCacheKey,
): WorkspaceAnalyzerScorecardEntry {
  switch (analyzer) {
    case 'tree':
      return workspaceAnalyzerScorecardCreate({
        analyzerId: 'codepol/tree',
        platform: 'codepol_tree',
        languages: [...WORKSPACE_NATIVE_OWNERSHIP_LANGUAGES, 'python'],
        ownedRuleIds: [],
        fixMode: 'inline',
        status: 'skipped',
        skippedReason: 'no_matching_rules',
      });
    case 'eslint':
      return workspaceAnalyzerScorecardCreate({
        analyzerId: 'eslint',
        platform: 'eslint',
        languages: [...WORKSPACE_NATIVE_OWNERSHIP_LANGUAGES],
        ownedRuleIds: [],
        fixMode: 'external',
        status: 'skipped',
        skippedReason: 'no_matching_rules',
      });
    case 'biome':
      return workspaceAnalyzerScorecardCreate({
        analyzerId: 'biome',
        platform: 'biome',
        languages: [...WORKSPACE_NATIVE_OWNERSHIP_LANGUAGES],
        ownedRuleIds: [],
        fixMode: 'external',
        status: 'skipped',
        skippedReason: 'no_matching_rules',
      });
    case 'ruff':
      return workspaceAnalyzerScorecardCreate({
        analyzerId: 'ruff',
        platform: 'ruff',
        languages: ['python'],
        ownedRuleIds: [],
        fixMode: 'external',
        status: 'skipped',
        skippedReason: 'no_matching_rules',
      });
  }
}

/**
 * Take the per-analyzer partition (hits + misses), an optional fresh run on
 * the misses, and produce both the merged `WorkspaceAnalyzerRunResult` and the
 * cache entry to write back. Files that were a miss but absent from the fresh
 * run get a (key, empty) entry so subsequent runs see them as analyzed-clean.
 */
function workspaceAnalyzerSliceMerge(input: {
  analyzer: WorkspaceAnalyzerCacheKey;
  partition: WorkspaceAnalyzerPartition;
  freshResult?: WorkspaceAnalyzerRunResult;
  freshLatencyMs: number;
  scorecardTemplateFromCache?: WorkspaceAnalyzerScorecardEntry;
  errorCountByFilePath?: Map<string, number>;
}): {
  result: WorkspaceAnalyzerRunResult;
  cacheEntry: WorkspaceAnalyzerCacheEntry;
} {
  const merged = new Map<string, WorkspaceAnalyzerFileCacheEntry>();
  for (const [filePath, hit] of input.partition.hits) {
    merged.set(filePath, hit);
  }

  let scorecardTemplate: WorkspaceAnalyzerScorecardEntry;
  let issues: string[] = [];
  let status: WorkspaceAnalyzerStatus | undefined;
  if (input.freshResult) {
    scorecardTemplate = input.freshResult.scorecard;
    issues = input.freshResult.issues;
    const freshGrouped = workspaceAnalyzerFileResultsGroup({
      filesInScope: input.partition.misses,
      keyForFile: (filePath) => input.partition.keysByFile.get(filePath)!,
      violations: input.freshResult.violations,
      diagnostics: input.freshResult.diagnostics,
      treeViolations: input.freshResult.treeViolations,
      fixableTreeViolationsByDiagnosticId: input.freshResult.fixableTreeViolationsByDiagnosticId,
      errorCountByFilePath: input.errorCountByFilePath,
    });
    for (const [filePath, entry] of freshGrouped) {
      merged.set(filePath, entry);
    }
  } else {
    scorecardTemplate =
      input.scorecardTemplateFromCache ??
      workspaceAnalyzerScorecardTemplateForEmpty(input.analyzer);
    status = merged.size > 0 ? 'ran' : scorecardTemplate.status;
  }

  const result = workspaceAnalyzerRunResultFromCache({
    fileResults: merged,
    scorecardTemplate,
    issues,
    latencyMs: input.freshLatencyMs,
    status,
  });
  return {
    result,
    cacheEntry: {
      scorecardTemplate,
      fileResults: merged,
    },
  };
}

async function workspaceAnalysisRun(
  workspace: WorkspaceContextState,
  state: WorkspaceDocumentsState & WorkspaceAnalysisCacheState,
  options: {
    fix: boolean;
    collectEslintOutput: boolean;
    signal?: AbortSignal;
  },
): Promise<WorkspaceAnalysis> {
  workspaceAbortSignalThrowIfAborted(options.signal);
  await ensureWorkspaceRuntimeReady();
  builtinPluginsRefresh();

  const policy = workspace.config as PolicyFile;
  const pluginRulesResult = await policyPluginsGet(policy, workspace.rootPath, {
    configPath: workspace.configPath,
  });
  if (isErr(pluginRulesResult)) {
    throw new Error(pluginRulesResult.Err);
  }
  const pluginRulesMap = pluginRulesResult.Ok;
  const ruleTargets = policyRuleTargetsGet(policy);
  const lintProviderEntries = lintProviderEntriesCollect(policy, pluginRulesMap);
  const fixProviders = fixProvidersCollect(pluginRulesMap);
  const matches = await ruleMatchesGet(policy, workspace.rootPath);
  const files = Array.from(new Set(matches.flatMap((match) => match.files)));
  const sourceByFilePath = workspaceSourceOverridesGet(state);
  const policyWorkspaceIndexRequired = matchedRulesRequireProjectIndex(
    matches,
    pluginRulesMap,
  );
  const workspaceIndexRequired =
    (state.workspaceIndexRequired ?? false) || policyWorkspaceIndexRequired;
  state.workspaceIndexRequired = workspaceIndexRequired;
  const nativeOwnedWrappedRuleIds = workspaceNativeOwnedWrappedRuleIdsResolve({
    policy,
    ruleTargets,
    pluginRulesMap,
  });

  // Refresh tool fingerprints (used as input to gate keys and persisted to
  // warm cache).
  const toolFingerprintsList = workspaceToolFingerprintsRead(workspace, lintProviderEntries);
  state.toolFingerprints = toolFingerprintsList;

  if (options.fix || options.collectEslintOutput) {
    return workspaceAnalysisRunFullPath({
      workspace,
      state,
      options,
      policy,
      pluginRulesMap,
      ruleTargets,
      lintProviderEntries,
      fixProviders,
      matches,
      files,
      sourceByFilePath,
      workspaceIndexRequired,
      nativeOwnedWrappedRuleIds,
      toolFingerprintsList,
    });
  }

  return workspaceAnalysisRunIncremental({
    workspace,
    state,
    options,
    policy,
    pluginRulesMap,
    ruleTargets,
    lintProviderEntries,
    matches,
    files,
    sourceByFilePath,
    workspaceIndexRequired,
    nativeOwnedWrappedRuleIds,
    toolFingerprintsList,
  });
}

type WorkspaceAnalysisRunSharedInput = {
  workspace: WorkspaceContextState;
  state: WorkspaceDocumentsState & WorkspaceAnalysisCacheState;
  options: {
    fix: boolean;
    collectEslintOutput: boolean;
    signal?: AbortSignal;
  };
  policy: PolicyFile;
  pluginRulesMap: Awaited<ReturnType<typeof policyPluginsGet>> extends Result<infer T, string>
    ? T
    : never;
  ruleTargets: PolicyRuleTargetContext[];
  lintProviderEntries: LintProviderEntry[];
  matches: RuleMatch[];
  files: string[];
  sourceByFilePath: Map<string, string>;
  workspaceIndexRequired: boolean;
  nativeOwnedWrappedRuleIds: ReadonlySet<string>;
  toolFingerprintsList: WorkspaceWarmCacheFileFingerprint[];
};

/**
 * Full-path analysis: used for `options.fix`, `options.collectEslintOutput`,
 * or whenever we cannot use the incremental tuple cache. Refreshes the per-
 * (analyzer, file) cache so subsequent non-fix runs can incrementalise.
 */
async function workspaceAnalysisRunFullPath(
  input: WorkspaceAnalysisRunSharedInput & {
    fixProviders: FixProvider[];
  },
): Promise<WorkspaceAnalysis> {
  const {
    workspace,
    state,
    options,
    policy,
    pluginRulesMap,
    ruleTargets,
    lintProviderEntries,
    fixProviders,
    matches,
    files,
    sourceByFilePath,
    workspaceIndexRequired,
    nativeOwnedWrappedRuleIds,
  } = input;

  workspaceAbortSignalThrowIfAborted(options.signal);
  let projectIndex: ProjectIndex | undefined;

  if (options.fix && fixProviders.length > 0) {
    if (workspaceIndexRequired) {
      projectIndex = workspaceIndexGetOrBuild(workspace, state, files);
    }
    await fixProvidersApply(fixProviders, {
      policy,
      configPath: workspace.configPath,
      cwd: workspace.rootPath,
      files,
      ruleTargets,
      projectIndex,
    });
    state.indexState = undefined;
    projectIndex = undefined;
  }

  if (workspaceIndexRequired) {
    workspaceAbortSignalThrowIfAborted(options.signal);
    projectIndex = workspaceIndexGetOrBuild(workspace, state, files);
  }

  if (options.fix) {
    workspaceAbortSignalThrowIfAborted(options.signal);
    const treeFixViolationsResult = await policyViolationsGetFromDir(policy, workspace.rootPath, {
      configPath: workspace.configPath,
      sourceByFilePath,
      projectIndex,
    });
    if (isErr(treeFixViolationsResult)) {
      throw new Error(treeFixViolationsResult.Err);
    }
    treeCheckFixesApply(treeFixViolationsResult.Ok);
    state.indexState = undefined;
    projectIndex = undefined;
  }

  workspaceAbortSignalThrowIfAborted(options.signal);
  const treeResult = workspaceTreeAnalyzerRun({
    configPath: workspace.configPath,
    matches,
    pluginRulesMap,
    policy,
    projectIndex,
    rootPath: workspace.rootPath,
    sourceByFilePath,
    strictErrors: options.fix,
  });

  const eslintErrorCountByFilePath = new Map<string, number>();
  const eslintResult = await eslintAnalyzerRun({
    files,
    matches,
    sourceByFilePath,
    policy,
    configPath: workspace.configPath,
    cwd: workspace.rootPath,
    lintProviderEntries,
    nativeOwnedWrappedRuleIds,
    ruleTargets,
    pluginRules: pluginRulesMap,
    fix: options.fix,
    collectOutput: options.collectEslintOutput,
    onPerFileResult: ({ filePath, errorCount }) => {
      eslintErrorCountByFilePath.set(filePath, errorCount);
    },
  });

  workspaceAbortSignalThrowIfAborted(options.signal);
  const biomeResult = await biomeAnalyzerRun({
    matches,
    lintProviderEntries,
    nativeOwnedWrappedRuleIds,
    fix: options.fix,
    signal: options.signal,
  });
  workspaceAbortSignalThrowIfAborted(options.signal);
  const ruffResult = await ruffAnalyzerRun({
    files,
    matches,
    lintProviderEntries,
    nativeOwnedWrappedRuleIds,
    fix: options.fix,
    signal: options.signal,
  });

  if (workspaceIndexRequired) {
    workspaceAbortSignalThrowIfAborted(options.signal);
    projectIndex = workspaceIndexGetOrBuild(workspace, state, files);
  }

  const architectureResult = workspaceArchitectureDiagnosticsShouldRun({
    matches,
    pluginRulesMap,
    projectIndex,
  })
    ? await workspaceArchitectureDiagnosticsRun({
        policy,
        rootPath: workspace.rootPath,
        configPath: workspace.configPath,
        pluginRulesMap,
        projectIndex,
        signal: options.signal,
      })
    : undefined;

  const analysis = workspaceAnalysisCompose({
    treeResult,
    eslintResult,
    biomeResult,
    ruffResult,
    policy,
    files,
    pluginRulesMap,
    lintProviderEntries,
    ruleTargets,
    projectIndex,
    workspaceIndexRequired,
    architectureResult,
  });

  // Refresh per-(analyzer, file) cache so the next non-fix run can hit. Use
  // the now-current invariants (config / plugin / tool / treeIndex) so the
  // entries are immediately reusable.
  workspaceAnalyzerCacheRefresh({
    state,
    workspace,
    policy,
    pluginRulesMap,
    matches,
    files,
    treeResult,
    eslintResult,
    biomeResult,
    ruffResult,
    eslintErrorCountByFilePath,
    toolFingerprintsList: input.toolFingerprintsList,
  });

  state.dirtyFiles = undefined;
  state.analysisGeneration += 1;
  state.lastAnalysis = analysis;
  return analysis;
}

/**
 * Incremental analysis: looks up per-(analyzer, file) cache entries by tuple
 * key. Only files whose tuple does not match get re-run. Global invariant
 * changes (config/plugin/tool fingerprints) miss naturally because they are
 * part of the tuple — no explicit invalidation wiring required.
 */
async function workspaceAnalysisRunIncremental(
  input: WorkspaceAnalysisRunSharedInput,
): Promise<WorkspaceAnalysis> {
  const {
    workspace,
    state,
    options,
    policy,
    pluginRulesMap,
    ruleTargets,
    lintProviderEntries,
    matches,
    files,
    sourceByFilePath,
    workspaceIndexRequired,
    nativeOwnedWrappedRuleIds,
    toolFingerprintsList,
  } = input;

  // Build the project index FIRST so the tree analyzer's slice of the cache
  // tuple (treeIndexFingerprint) is finalised before we partition.
  let projectIndex: ProjectIndex | undefined;
  if (workspaceIndexRequired) {
    workspaceAbortSignalThrowIfAborted(options.signal);
    projectIndex = workspaceIndexGetOrBuild(workspace, state, files);
  }

  const configFingerprint = workspaceConfigFingerprintCompute({ workspace, policy });
  const pluginCompatibility = workspacePluginCompatibilityRead(workspace, policy, pluginRulesMap);
  const pluginFingerprint = workspacePluginFingerprintCompute(pluginCompatibility);
  const toolFingerprintKey = workspaceToolFingerprintKeyCompute(toolFingerprintsList);
  const treeIndexFingerprint = workspaceTreeIndexFingerprintCompute(state, workspaceIndexRequired);

  const treeFilesInScope = workspaceTreeAnalyzerFilesInScopeCollect(matches, pluginRulesMap);
  const biomeFilesInScope = workspaceBiomeFilesInScopeCollect(matches);
  const ruffFilesInScope = files.filter((filePath) =>
    fileHasExtension(filePath, PYTHON_FILE_EXTENSIONS),
  );

  const currentCache: WorkspaceAnalyzerCache = state.analyzerCache ?? {};
  const baseTuple = (treeIndexFp: string) => (filePath: string): WorkspaceAnalyzerCacheKeyTuple => ({
    contentFingerprint:
      workspaceContentFingerprintForFile(state, filePath) ?? `missing:${filePath}`,
    configFingerprint,
    pluginFingerprint,
    toolFingerprintKey,
    treeIndexFingerprint: treeIndexFp,
  });
  const treeKeyFor = baseTuple(treeIndexFingerprint);
  const otherKeyFor = baseTuple('');

  const treePart = workspaceAnalyzerPartitionCompute({
    cache: currentCache,
    analyzer: 'tree',
    filesInScope: treeFilesInScope,
    keyForFile: treeKeyFor,
  });
  const eslintPart = workspaceAnalyzerPartitionCompute({
    cache: currentCache,
    analyzer: 'eslint',
    filesInScope: files,
    keyForFile: otherKeyFor,
  });
  const biomePart = workspaceAnalyzerPartitionCompute({
    cache: currentCache,
    analyzer: 'biome',
    filesInScope: biomeFilesInScope,
    keyForFile: otherKeyFor,
  });
  const ruffPart = workspaceAnalyzerPartitionCompute({
    cache: currentCache,
    analyzer: 'ruff',
    filesInScope: ruffFilesInScope,
    keyForFile: otherKeyFor,
  });

  // Drop dirty bookkeeping; it has been folded into the contentFingerprints.
  state.dirtyFiles = undefined;

  const totalMisses =
    treePart.misses.length + eslintPart.misses.length + biomePart.misses.length + ruffPart.misses.length;
  const allHitsCovered =
    state.lastAnalysis !== undefined && totalMisses === 0 &&
    currentCache.tree !== undefined &&
    currentCache.eslint !== undefined &&
    currentCache.biome !== undefined &&
    currentCache.ruff !== undefined;
  if (allHitsCovered) {
    return state.lastAnalysis!;
  }

  const cacheNext: WorkspaceAnalyzerCache = {};

  // -- Tree --
  let treeFreshResult: WorkspaceAnalyzerRunResult | undefined;
  let treeFreshLatencyMs = 0;
  if (treePart.misses.length > 0) {
    workspaceAbortSignalThrowIfAborted(options.signal);
    const startedAt = Date.now();
    treeFreshResult = workspaceTreeAnalyzerRun({
      configPath: workspace.configPath,
      matches,
      pluginRulesMap,
      policy,
      projectIndex,
      rootPath: workspace.rootPath,
      sourceByFilePath,
      strictErrors: false,
      targetFiles: new Set(treePart.misses),
    });
    treeFreshLatencyMs = Date.now() - startedAt;
  }
  const treeMerged = workspaceAnalyzerSliceMerge({
    analyzer: 'tree',
    partition: treePart,
    freshResult: treeFreshResult,
    freshLatencyMs: treeFreshLatencyMs,
    scorecardTemplateFromCache: currentCache.tree?.scorecardTemplate,
  });
  cacheNext.tree = treeMerged.cacheEntry;
  const treeResult = treeMerged.result;

  // -- ESLint --
  let eslintFreshResult: WorkspaceAnalyzerRunResult | undefined;
  let eslintFreshLatencyMs = 0;
  const eslintErrorCountByFilePath = new Map<string, number>();
  if (eslintPart.misses.length > 0) {
    workspaceAbortSignalThrowIfAborted(options.signal);
    const startedAt = Date.now();
    eslintFreshResult = await eslintAnalyzerRun({
      files,
      matches,
      sourceByFilePath,
      policy,
      configPath: workspace.configPath,
      cwd: workspace.rootPath,
      lintProviderEntries,
      nativeOwnedWrappedRuleIds,
      ruleTargets,
      pluginRules: pluginRulesMap,
      fix: false,
      collectOutput: false,
      targetFiles: new Set(eslintPart.misses),
      onPerFileResult: ({ filePath, errorCount }) => {
        eslintErrorCountByFilePath.set(filePath, errorCount);
      },
    });
    eslintFreshLatencyMs = Date.now() - startedAt;
  }
  const eslintMerged = workspaceAnalyzerSliceMerge({
    analyzer: 'eslint',
    partition: eslintPart,
    freshResult: eslintFreshResult,
    freshLatencyMs: eslintFreshLatencyMs,
    scorecardTemplateFromCache: currentCache.eslint?.scorecardTemplate,
    errorCountByFilePath: eslintErrorCountByFilePath,
  });
  cacheNext.eslint = eslintMerged.cacheEntry;
  const eslintResult = eslintMerged.result;

  // -- Biome --
  let biomeFreshResult: WorkspaceAnalyzerRunResult | undefined;
  let biomeFreshLatencyMs = 0;
  if (biomePart.misses.length > 0) {
    workspaceAbortSignalThrowIfAborted(options.signal);
    const startedAt = Date.now();
    biomeFreshResult = await biomeAnalyzerRun({
      matches,
      lintProviderEntries,
      nativeOwnedWrappedRuleIds,
      fix: false,
      signal: options.signal,
      targetFiles: new Set(biomePart.misses),
    });
    biomeFreshLatencyMs = Date.now() - startedAt;
  }
  const biomeMerged = workspaceAnalyzerSliceMerge({
    analyzer: 'biome',
    partition: biomePart,
    freshResult: biomeFreshResult,
    freshLatencyMs: biomeFreshLatencyMs,
    scorecardTemplateFromCache: currentCache.biome?.scorecardTemplate,
  });
  cacheNext.biome = biomeMerged.cacheEntry;
  const biomeResult = biomeMerged.result;

  // -- Ruff --
  let ruffFreshResult: WorkspaceAnalyzerRunResult | undefined;
  let ruffFreshLatencyMs = 0;
  if (ruffPart.misses.length > 0) {
    workspaceAbortSignalThrowIfAborted(options.signal);
    const startedAt = Date.now();
    ruffFreshResult = await ruffAnalyzerRun({
      files,
      matches,
      lintProviderEntries,
      nativeOwnedWrappedRuleIds,
      fix: false,
      signal: options.signal,
      targetFiles: new Set(ruffPart.misses),
    });
    ruffFreshLatencyMs = Date.now() - startedAt;
  }
  const ruffMerged = workspaceAnalyzerSliceMerge({
    analyzer: 'ruff',
    partition: ruffPart,
    freshResult: ruffFreshResult,
    freshLatencyMs: ruffFreshLatencyMs,
    scorecardTemplateFromCache: currentCache.ruff?.scorecardTemplate,
  });
  cacheNext.ruff = ruffMerged.cacheEntry;
  const ruffResult = ruffMerged.result;

  state.analyzerCache = cacheNext;

  const architectureResult = workspaceArchitectureDiagnosticsShouldRun({
    matches,
    pluginRulesMap,
    projectIndex,
  })
    ? await workspaceArchitectureDiagnosticsRun({
        policy,
        rootPath: workspace.rootPath,
        configPath: workspace.configPath,
        pluginRulesMap,
        projectIndex,
        signal: options.signal,
      })
    : undefined;

  const analysis = workspaceAnalysisCompose({
    treeResult,
    eslintResult,
    biomeResult,
    ruffResult,
    policy,
    files,
    pluginRulesMap,
    lintProviderEntries,
    ruleTargets,
    projectIndex,
    workspaceIndexRequired,
    architectureResult,
  });
  state.analysisGeneration += 1;
  state.lastAnalysis = analysis;
  return analysis;
}

/**
 * Refresh the per-(analyzer, file) cache from a freshly-completed full run.
 * Computes the same tuple inputs the incremental path would, so the next
 * incremental run finds tuple matches.
 */
function workspaceAnalyzerCacheRefresh(input: {
  state: WorkspaceDocumentsState & WorkspaceAnalysisCacheState;
  workspace: WorkspaceContextState;
  policy: PolicyFile;
  pluginRulesMap: Awaited<ReturnType<typeof policyPluginsGet>> extends Result<infer T, string>
    ? T
    : never;
  matches: RuleMatch[];
  files: string[];
  treeResult: WorkspaceAnalyzerRunResult;
  eslintResult: WorkspaceAnalyzerRunResult;
  biomeResult: WorkspaceAnalyzerRunResult;
  ruffResult: WorkspaceAnalyzerRunResult;
  eslintErrorCountByFilePath: Map<string, number>;
  toolFingerprintsList: WorkspaceWarmCacheFileFingerprint[];
}): void {
  const configFingerprint = workspaceConfigFingerprintCompute({
    workspace: input.workspace,
    policy: input.policy,
  });
  const pluginCompatibility = workspacePluginCompatibilityRead(
    input.workspace,
    input.policy,
    input.pluginRulesMap,
  );
  const pluginFingerprint = workspacePluginFingerprintCompute(pluginCompatibility);
  const toolFingerprintKey = workspaceToolFingerprintKeyCompute(input.toolFingerprintsList);
  const treeIndexFingerprint = workspaceTreeIndexFingerprintCompute(
    input.state,
    input.state.workspaceIndexRequired ?? false,
  );

  const baseTuple = (treeIndexFp: string) => (filePath: string): WorkspaceAnalyzerCacheKeyTuple => ({
    contentFingerprint:
      workspaceContentFingerprintForFile(input.state, filePath) ?? `missing:${filePath}`,
    configFingerprint,
    pluginFingerprint,
    toolFingerprintKey,
    treeIndexFingerprint: treeIndexFp,
  });
  const treeKeyFor = baseTuple(treeIndexFingerprint);
  const otherKeyFor = baseTuple('');

  const treeFilesInScope = workspaceTreeAnalyzerFilesInScopeCollect(input.matches, input.pluginRulesMap);
  const biomeFilesInScope = workspaceBiomeFilesInScopeCollect(input.matches);
  const ruffFilesInScope = input.files.filter((filePath) =>
    fileHasExtension(filePath, PYTHON_FILE_EXTENSIONS),
  );

  const cache: WorkspaceAnalyzerCache = {
    tree: workspaceAnalyzerCacheEntryCreate({
      result: input.treeResult,
      filesInScope: treeFilesInScope,
      keyForFile: treeKeyFor,
    }),
    eslint: workspaceAnalyzerCacheEntryCreate({
      result: input.eslintResult,
      filesInScope: input.files,
      keyForFile: otherKeyFor,
      errorCountByFilePath: input.eslintErrorCountByFilePath,
    }),
    biome: workspaceAnalyzerCacheEntryCreate({
      result: input.biomeResult,
      filesInScope: biomeFilesInScope,
      keyForFile: otherKeyFor,
    }),
    ruff: workspaceAnalyzerCacheEntryCreate({
      result: input.ruffResult,
      filesInScope: ruffFilesInScope,
      keyForFile: otherKeyFor,
    }),
  };
  input.state.analyzerCache = cache;
}

async function workspaceLintRulesResultCreate(input: {
  workspace: WorkspaceState;
  workspaceSession: WorkspaceSessionState;
  analysis?: WorkspaceAnalysis;
  signal?: AbortSignal;
}): Promise<WorkspaceLintRulesResult> {
  workspaceAbortSignalThrowIfAborted(input.signal);
  await workspaceContextRefreshFromDisk(input.workspace);

  const policy = input.workspace.config as PolicyFile;
  const pluginRulesResult = await policyPluginsGet(policy, input.workspace.rootPath, {
    configPath: input.workspace.configPath,
  });
  if (isErr(pluginRulesResult)) {
    throw new Error(pluginRulesResult.Err);
  }

  const analysisAvailable =
    input.analysis !== undefined && input.workspaceSession.status !== 'error';
  const summaries = workspaceLintRuleSummariesStaticBuild({
    policy,
    pluginRulesMap: pluginRulesResult.Ok,
    ruleTargets: policyRuleTargetsGet(policy),
    analysisState:
      input.workspaceSession.status === 'error'
        ? 'error'
        : analysisAvailable
          ? 'ready'
          : 'pending',
    analyzerIssues:
      input.workspaceSession.status === 'error' && input.workspaceSession.lastError
        ? [input.workspaceSession.lastError]
        : [],
  });

  return {
    analysisGeneration: input.workspaceSession.analysisGeneration,
    workspaceReady:
      input.workspaceSession.replayState === 'applied' &&
      input.workspaceSession.status === 'ready',
    rules:
      analysisAvailable && input.analysis
        ? workspaceLintRuleSummariesMergeAnalysis(summaries, input.analysis)
        : summaries,
  };
}

function workspaceLintRuleDetailsGroupsCreate(input: {
  rootPath: string;
  diagnostics: WorkspaceDiagnostic[];
}): WorkspaceLintRuleDiagnosticGroup[] {
  const groupsByUri = new Map<string, WorkspaceLintRuleDiagnosticGroup>();

  for (const diagnostic of input.diagnostics) {
    const filePath = workspaceUriToPath(diagnostic.uri);
    const workspaceRelativePath =
      path.relative(input.rootPath, filePath) || path.basename(filePath);
    const group = groupsByUri.get(diagnostic.uri) ?? {
      uri: diagnostic.uri,
      workspaceRelativePath,
      diagnostics: [],
    };
    group.diagnostics.push({
      severity: diagnostic.severity,
      message: diagnostic.message,
      range: diagnostic.range,
    });
    groupsByUri.set(diagnostic.uri, group);
  }

  return [...groupsByUri.values()]
    .map((group) => ({
      ...group,
      diagnostics: group.diagnostics.sort((left, right) =>
        left.range.start.line !== right.range.start.line
          ? left.range.start.line - right.range.start.line
          : left.range.start.character - right.range.start.character,
      ),
    }))
    .sort((left, right) =>
      left.workspaceRelativePath.localeCompare(right.workspaceRelativePath),
    );
}

async function workspaceSessionAnalysisGet(
  workspace: WorkspaceState,
  state: WorkspaceSessionState,
  options: {
    signal?: AbortSignal;
  } = {},
): Promise<WorkspaceAnalysis> {
  if (!state.lastAnalysis) {
    state.status = 'warming';
  }

  try {
    await workspaceContextRefreshFromDisk(workspace);
    const analysis = await workspaceAnalysisRun(workspace, state, {
      fix: false,
      collectEslintOutput: false,
      signal: options.signal,
    });
    state.status = 'ready';
    state.lastError = undefined;
    return analysis;
  } catch (error) {
    state.status = 'error';
    state.lastError = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

/**
 * Reusable workspace/session engine shared by in-process and future daemon adapters.
 */
/**
 * Trailing-edge debounce window for warm-cache persist. Hardcoded:
 *
 * - Long enough that a burst of typing-triggered analyses coalesces into a
 *   single ~tens-of-KB JSON write, keeping disk I/O negligible.
 * - Short enough that a daemon crash loses at most one debounce window's
 *   worth of analysis (vs. losing all overlay-period analyses pre-rewrite).
 *
 * Not a config knob: there's no actionable use case for tuning this per
 * deployment, and exposing it adds drift between environments.
 */
const WORKSPACE_WARM_CACHE_PERSIST_DEBOUNCE_MS = 2000;

const workspaceServiceEngineTimersDefault: WorkspaceServiceEngineTimers = {
  setTimeout: (handler, ms) => {
    const timer = setTimeout(handler, ms);
    // Don't keep the daemon alive solely for a pending persist.
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
    return timer;
  },
  clearTimeout: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

type PersistTimerEntry = {
  handle: unknown;
  workspace: WorkspaceState;
  workspaceSession: WorkspaceSessionState;
};

export class WorkspaceServiceEngine implements WorkspaceService {
  private readonly daemonSessionId: DaemonSessionId = opaqueIdCreate('daemon');
  private readonly workspaces = new Map<string, WorkspaceState>();
  private readonly clientSessions = new Map<ClientSessionId, ClientSessionState>();
  private readonly watcherCreate?: WorkspaceWatcherCreate;
  private readonly backgroundWarmup: boolean;
  private readonly backgroundTaskSchedule: (task: () => Promise<void>) => void;
  private readonly warmCache?: WorkspaceWarmCacheStore;
  private readonly timers: WorkspaceServiceEngineTimers;
  /**
   * Type-aware call-graph source registry (Phase 9.2 / Gap 1).
   *
   * Constructed once per engine instance — there is no module-level
   * singleton. The registry is consulted from
   * `workspaceCallGraphResultCreate` to upgrade structural call-graph
   * answers when a host has registered a binding around a language
   * server. When no binding is registered for a language, the merge is
   * a no-op and the result is byte-identical to the structural-only
   * Phase 7 baseline.
   */
  private readonly typeAwareCallGraphSourceRegistry: TypeAwareCallGraphSourceRegistry;
  /**
   * Type-aware type-hierarchy source registry (Phase 9.5 / Gap 3).
   *
   * Constructed once per engine instance. The registry is consulted
   * from `workspaceTypeHierarchyResultCreate` to upgrade structural
   * type-hierarchy answers when a host has registered a binding around
   * a language server. When no binding is registered for a language,
   * the merge is a no-op and the result equals the structural-only
   * answer (with optional shape match when `includeStructural: true`).
   *
   * Independent of `typeAwareCallGraphSourceRegistry`; registering
   * one does not require or affect the other.
   */
  private readonly typeAwareTypeHierarchySourceRegistry: TypeAwareTypeHierarchySourceRegistry;
  private readonly typeAwareBridgeLanguageIdsByExtension =
    workspaceTypeAwareBridgeLanguageIdsByExtensionCreate(
      WORKSPACE_TYPE_AWARE_BRIDGE_DEFINITIONS_DEFAULT,
    );
  private readonly typeAwareBridgeContext =
    new AsyncLocalStorage<WorkspaceTypeAwareBridgeActiveContext>();
  private typeAwareBridgeLifecycle: WorkspaceTypeAwareBridgeLifecycle | undefined;
  // Per-workspace pending debounced persist. Keyed by `workspaceId` because
  // every attached client session sees the same in-memory workspace state.
  private readonly persistTimers = new Map<string, PersistTimerEntry>();

  constructor(options: WorkspaceServiceEngineOptions = {}) {
    this.watcherCreate = options.watcherCreate;
    this.backgroundWarmup = options.backgroundWarmup ?? false;
    this.warmCache = options.warmCache;
    this.timers = options.timers ?? workspaceServiceEngineTimersDefault;
    this.typeAwareCallGraphSourceRegistry =
      options.typeAwareCallGraphSourceRegistry
        ?? typeAwareCallGraphSourceRegistryCreate();
    this.typeAwareTypeHierarchySourceRegistry =
      options.typeAwareTypeHierarchySourceRegistry
        ?? typeAwareTypeHierarchySourceRegistryCreate();
    this.backgroundTaskSchedule =
      options.backgroundTaskSchedule ??
      ((task) => {
        queueMicrotask(() => {
          void task();
        });
      });
  }

  /**
   * Register a {@link TypeAwareCallGraphSource} for a language. Hosts
   * (the LSP server, an editor extension's process bridge, a CLI
   * binding) call this once during startup to upgrade subsequent
   * `queryCallGraph` answers. Independent of the type-hierarchy
   * registry; see Phase 9.2 / Step 2.
   */
  typeAwareCallGraphSourceRegister(
    languageId: string,
    source: TypeAwareCallGraphSource,
  ): void {
    this.typeAwareCallGraphSourceRegistry.typeAwareCallGraphSourceRegister(
      languageId,
      source,
    );
  }

  /**
   * Register a {@link TypeAwareTypeHierarchySource} for a language
   * (Phase 9.5 / Gap 3). Hosts call this once during startup to
   * upgrade subsequent `queryTypeHierarchy` answers. Independent of
   * the call-graph registry.
   */
  typeAwareTypeHierarchySourceRegister(
    languageId: string,
    source: TypeAwareTypeHierarchySource,
  ): void {
    this.typeAwareTypeHierarchySourceRegistry.typeAwareTypeHierarchySourceRegister(
      languageId,
      source,
    );
  }

  typeAwareBridgeExecutionContextGet():
    | WorkspaceTypeAwareBridgeExecutionContext
    | undefined {
    return this.typeAwareBridgeContext.getStore()?.execution;
  }

  typeAwareBridgeLifecycleSet(
    lifecycle: WorkspaceTypeAwareBridgeLifecycle | undefined,
  ): void {
    this.typeAwareBridgeLifecycle = lifecycle;
  }

  typeAwareBridgeDefinitionsRegister(
    definitions: readonly WorkspaceTypeAwareBridgeDefinition[],
  ): void {
    for (const registration of workspaceTypeAwareBridgeRegistrationsCollect(definitions)) {
      for (const fileExtension of registration.fileExtensions) {
        this.typeAwareBridgeLanguageIdsByExtension.set(
          fileExtension.toLowerCase(),
          registration.languageId,
        );
      }
    }
  }

  /**
   * Resolve the symbol-table callbacks the language-bridge wrappers use
   * to translate between workspace `symbolId`s and LSP
   * `(uri, line, character)` tuples.
   *
   * When called during `queryCallGraph` / `queryTypeHierarchy`, the
   * method returns the exact active workspace/session table for that
   * query via an async-local context. Outside that path it falls back to
   * the first attached workspace session whose cached index currently
   * contains the symbol.
   */
  typeAwareBridgeSymbolTableGet(
    symbolId: SymbolId,
  ): WorkspaceTypeAwareBridgeSymbolTable | undefined {
    const active = this.typeAwareBridgeContext.getStore()?.symbolTable;
    if (active) {
      return active;
    }
    for (const clientSession of this.clientSessions.values()) {
      for (const [workspaceId, workspaceSession] of clientSession.workspaces) {
        if (!this.workspaces.has(workspaceId)) {
          continue;
        }
        const indexState = workspaceSession.indexState;
        if (!indexState?.index.symbolGet(symbolId)) {
          continue;
        }
        return workspaceTypeAwareBridgeSymbolTableCreate(
          workspaceSession,
          indexState.index,
        );
      }
    }
    return undefined;
  }

  private workspacePersistSchedule(
    workspace: WorkspaceState,
    workspaceSession: WorkspaceSessionState,
  ): void {
    if (!this.warmCache) {
      return;
    }
    const existing = this.persistTimers.get(workspace.workspaceId);
    if (existing) {
      this.timers.clearTimeout(existing.handle);
    }
    const handle = this.timers.setTimeout(() => {
      const pending = this.persistTimers.get(workspace.workspaceId);
      if (!pending || pending.handle !== handle) {
        return;
      }
      this.persistTimers.delete(workspace.workspaceId);
      void workspaceWarmCacheSnapshotPersist({
        warmCache: this.warmCache,
        workspace: pending.workspace,
        workspaceSession: pending.workspaceSession,
      });
    }, WORKSPACE_WARM_CACHE_PERSIST_DEBOUNCE_MS);
    this.persistTimers.set(workspace.workspaceId, {
      handle,
      workspace,
      workspaceSession,
    });
  }

  private async workspacePersistFlush(workspaceId: string): Promise<void> {
    const pending = this.persistTimers.get(workspaceId);
    if (!pending) {
      return;
    }
    this.timers.clearTimeout(pending.handle);
    this.persistTimers.delete(workspaceId);
    if (!this.warmCache) {
      return;
    }
    await workspaceWarmCacheSnapshotPersist({
      warmCache: this.warmCache,
      workspace: pending.workspace,
      workspaceSession: pending.workspaceSession,
    });
  }

  private async workspaceSessionAnalysisEnsure(
    workspace: WorkspaceState,
    workspaceSession: WorkspaceSessionState,
    options: {
      signal?: AbortSignal;
    } = {},
  ): Promise<WorkspaceAnalysis> {
    const analysis = await workspaceSessionAnalysisGet(workspace, workspaceSession, options);
    this.workspacePersistSchedule(workspace, workspaceSession);
    return analysis;
  }

  private async workspaceSessionIndexEnsure(
    workspace: WorkspaceState,
    workspaceSession: WorkspaceSessionState,
    options: {
      signal?: AbortSignal;
    } = {},
  ): Promise<ProjectIndex> {
    if (!workspaceSession.indexState || workspaceSession.workspaceIndexRequired !== true) {
      workspaceSessionIndexEnable(workspaceSession);
    }
    await this.workspaceSessionAnalysisEnsure(workspace, workspaceSession, options);
    if (!workspaceSession.indexState) {
      throw new Error('Workspace index unavailable');
    }
    return workspaceSession.indexState.index;
  }

  private workspaceBackgroundWarmupSchedule(
    workspace: WorkspaceState,
    workspaceSession: WorkspaceSessionState,
  ): void {
    if (!this.backgroundWarmup || workspaceSession.replayState !== 'applied') {
      return;
    }
    if (workspaceSession.lastAnalysis && workspaceSession.status === 'ready') {
      return;
    }
    if (workspaceSession.backgroundWarmupRunning) {
      workspaceSession.backgroundWarmupQueued = true;
      return;
    }

    const startRevision = workspaceSession.analysisRevision;
    workspaceSession.backgroundWarmupRunning = true;
    workspaceSession.backgroundWarmupQueued = false;
    const hasPendingWork =
      workspaceSession.dirtyFiles !== undefined && workspaceSession.dirtyFiles.size > 0;
    if (!workspaceSession.lastAnalysis || hasPendingWork) {
      workspaceSession.status = 'warming';
    }

    this.backgroundTaskSchedule(async () => {
      try {
        await this.workspaceSessionAnalysisEnsure(workspace, workspaceSession);
      } catch {}
      finally {
        workspaceSession.backgroundWarmupRunning = false;
        const staleRun = workspaceSession.analysisRevision !== startRevision;
        if (staleRun) {
          workspaceSessionInvalidate(workspaceSession, {
            clearIndexState: true,
            bumpAnalysisRevision: false,
          });
        }
        const shouldRerun = workspaceSession.backgroundWarmupQueued || staleRun;
        workspaceSession.backgroundWarmupQueued = false;
        if (shouldRerun && workspaceSession.replayState === 'applied') {
          this.workspaceBackgroundWarmupSchedule(workspace, workspaceSession);
        }
      }
    });
  }

  private workspaceBackgroundWarmupScheduleAll(workspace: WorkspaceState): void {
    if (!this.backgroundWarmup) {
      return;
    }
    for (const attachedClientSessionId of workspace.attachedClientSessionIds) {
      const attachedClientSession = this.clientSessions.get(attachedClientSessionId);
      const attachedWorkspaceSession = attachedClientSession?.workspaces.get(workspace.workspaceId);
      if (!attachedWorkspaceSession) {
        continue;
      }
      this.workspaceBackgroundWarmupSchedule(workspace, attachedWorkspaceSession);
    }
  }

  private workspaceInvalidateFromDisk(
    workspace: WorkspaceState,
    options: {
      configDirty?: boolean;
      changedFilePath?: string;
      // When provided, drop only the listed analyzers' buckets across every
      // attached session. Used by the file watcher when an external tool
      // config (eslint / biome / ruff) changes on disk.
      invalidateAnalyzers?: ReadonlyArray<WorkspaceAnalyzerCacheKey>;
    } = {},
  ): void {
    workspace.baseIndexState = undefined;
    if (options.configDirty) {
      workspace.configDirty = true;
    }
    for (const attachedClientSessionId of workspace.attachedClientSessionIds) {
      const attachedClientSession = this.clientSessions.get(attachedClientSessionId);
      const attachedWorkspaceSession = attachedClientSession?.workspaces.get(workspace.workspaceId);
      if (!attachedWorkspaceSession) {
        continue;
      }
      if (options.configDirty) {
        // Policy config / plugin manifest change: drop session analyzer
        // caches so status flips back to 'cold'. Tuple-keyed entries would
        // also miss naturally, but flushing reflects the new readiness state
        // to consumers immediately.
        workspaceSessionInvalidate(attachedWorkspaceSession, {
          clearIndexState: true,
          clearWorkspaceIndexRequirement: true,
          flushAnalyzerCache: true,
        });
      } else if (options.invalidateAnalyzers && options.invalidateAnalyzers.length > 0) {
        // External tool config change: drop only the matching analyzer's
        // bucket. Other analyzers' per-file entries stay valid.
        workspaceSessionInvalidate(attachedWorkspaceSession, {
          invalidateAnalyzers: options.invalidateAnalyzers,
        });
      } else if (options.changedFilePath) {
        // Single-file disk change: mark just that file dirty so the next run
        // recomputes its content fingerprint. Per-(analyzer, file) entries
        // for unchanged files stay valid via the tuple match.
        workspaceSessionInvalidate(attachedWorkspaceSession, {
          clearIndexState: true,
          dirtyFiles: [options.changedFilePath],
        });
      } else {
        // No specific file path known (e.g. directory event): conservative
        // full flush.
        workspaceSessionInvalidate(attachedWorkspaceSession, {
          clearIndexState: true,
          flushAnalyzerCache: true,
        });
      }
    }
    this.workspaceBackgroundWarmupScheduleAll(workspace);
  }

  async registerClientSession(input: {
    clientKind: WorkspaceClientKind;
    clientInstanceId: string;
    clientSessionId?: ClientSessionId;
  }): Promise<{ clientSessionId: ClientSessionId; daemonSessionId: DaemonSessionId }> {
    await ensureWorkspaceRuntimeReady();
    const clientSessionId =
      input.clientSessionId ?? (opaqueIdCreate('client') as ClientSessionId);
    const existing = this.clientSessions.get(clientSessionId);
    if (existing) {
      if (
        existing.clientKind !== input.clientKind ||
        existing.clientInstanceId !== input.clientInstanceId
      ) {
        throw new Error(
          `Client session ${clientSessionId} is already registered with a different identity`,
        );
      }
      return {
        clientSessionId,
        daemonSessionId: this.daemonSessionId,
      };
    }
    this.clientSessions.set(clientSessionId, {
      clientSessionId,
      clientKind: input.clientKind,
      clientInstanceId: input.clientInstanceId,
      workspaces: new Map(),
    });
    return {
      clientSessionId,
      daemonSessionId: this.daemonSessionId,
    };
  }

  async closeClientSession(input: {
    clientSessionId: ClientSessionId;
  }): Promise<void> {
    const clientSession = clientSessionGet(this.clientSessions, input.clientSessionId);
    for (const workspaceId of clientSession.workspaces.keys()) {
      const workspace = this.workspaces.get(workspaceId);
      if (!workspace) {
        continue;
      }
      workspace.attachedClientSessionIds.delete(input.clientSessionId);
      if (workspace.attachedClientSessionIds.size === 0) {
        await workspaceTypeAwareBridgeLifecycleCall(
          this.typeAwareBridgeLifecycle?.workspaceDetached?.(
            workspaceTypeAwareBridgeExecutionContextCreate({
              clientSessionId: input.clientSessionId,
              workspace,
            }),
          ),
        );
        // Flush any pending debounced persist before tearing down the
        // watcher so the latest analysis lands on disk even if the user
        // disconnects within the debounce window.
        await this.workspacePersistFlush(workspaceId);
        await workspaceWatcherClose(workspace);
      }
    }
    this.clientSessions.delete(input.clientSessionId);
    const hasAttachedClients = [...this.workspaces.values()].some(
      (workspace) => workspace.attachedClientSessionIds.size > 0,
    );
    if (!hasAttachedClients) {
      await workspaceTypeAwareBridgeLifecycleCall(
        this.typeAwareBridgeLifecycle?.dispose?.(),
      );
    }
  }

  async attachWorkspace(input: {
    clientSessionId: ClientSessionId;
    rootPath: string;
    configPath: string;
  }): Promise<{ workspaceId: string; workspaceInstanceId: WorkspaceInstanceId }> {
    await ensureWorkspaceRuntimeReady();

    const rootPath = path.resolve(input.rootPath);
    const configPath = path.resolve(rootPath, input.configPath);
    configCacheClear();
    const { config, configPath: resolvedConfigPath } = await configGetFromPath(configPath);
    const clientSession = clientSessionGet(this.clientSessions, input.clientSessionId);
    const workspaceId = workspaceIdCreate(rootPath, resolvedConfigPath);

    let workspace = this.workspaces.get(workspaceId);
    const externalToolConfigs = externalToolConfigsResolve(resolvedConfigPath, config);
    const policyWorkspaceIndexRequired = await workspaceIndexRequirementResolve({
      rootPath,
      configPath: resolvedConfigPath,
      externalToolConfigs,
      config,
    });
    const workspaceIndexRequired =
      clientSession.clientKind === 'lsp' || policyWorkspaceIndexRequired === true;
    if (!workspace) {
      workspace = {
        workspaceId,
        workspaceInstanceId: opaqueIdCreate('workspace') as WorkspaceInstanceId,
        rootPath,
        configPath: resolvedConfigPath,
        externalToolConfigs,
        config,
        attachedClientSessionIds: new Set(),
        configDirty: false,
      };
      this.workspaces.set(workspaceId, workspace);
    } else {
      workspace.config = config;
      workspace.configPath = resolvedConfigPath;
      workspace.externalToolConfigs = externalToolConfigs;
      workspace.baseIndexState = undefined;
      workspace.configDirty = false;
      this.workspaceInvalidateFromDisk(workspace);
    }

    workspace.attachedClientSessionIds.add(input.clientSessionId);
    const existingWorkspaceSession = clientSession.workspaces.get(workspaceId);
    if (!existingWorkspaceSession) {
      const restoredWarmCache = await workspaceWarmCacheSnapshotRestore({
        warmCache: this.warmCache,
        workspace,
        workspaceIndexRequired,
      });
      if (restoredWarmCache?.baseIndexState) {
        workspace.baseIndexState = restoredWarmCache.baseIndexState;
      }
      // Status semantics on warm restore:
      //   - no snapshot at all: 'cold' (first analysis fills everything)
      //   - snapshot restored AND no per-file delta: 'ready' (the persisted
      //     `lastAnalysis` is wholly accurate)
      //   - snapshot restored WITH a per-file delta: 'ready' as well, with
      //     `dirtyFiles` stashed on the session. The recomposed
      //     `lastAnalysis` excludes dirty-file contributions, so it is
      //     internally consistent. The next `queryDiagnostics` triggers
      //     `workspaceAnalysisRunIncremental`, which sees the dirty set and
      //     re-runs only those files; cached files still hit via tuple
      //     match. Surfacing 'ready' (rather than 'warming') matches the
      //     observable: query callers can read the snapshot's diagnostics
      //     for unchanged files immediately and pay the analyzer cost only
      //     for the delta.
      const restoredDirtyFiles = restoredWarmCache?.dirtyFiles;
      clientSession.workspaces.set(workspaceId, {
        workspaceId,
        workspaceInstanceId: workspace.workspaceInstanceId,
        replayEpoch: 0,
        replayState: 'pending',
        documents: new Map(),
        editPlans: new Map(),
        status: restoredWarmCache ? 'ready' : 'cold',
        analysisGeneration: restoredWarmCache?.analysisGeneration ?? 0,
        analysisRevision: 0,
        workspaceIndexRequired:
          restoredWarmCache?.workspaceIndexRequired === true || workspaceIndexRequired,
        lastAnalysis: restoredWarmCache?.lastAnalysis,
        toolFingerprints: restoredWarmCache?.toolFingerprints,
        indexState: restoredWarmCache?.indexState,
        analyzerCache: restoredWarmCache?.analyzerCache,
        dirtyFiles: restoredDirtyFiles && restoredDirtyFiles.size > 0
          ? new Set(restoredDirtyFiles)
          : undefined,
      });
    } else {
      existingWorkspaceSession.workspaceIndexRequired =
        existingWorkspaceSession.workspaceIndexRequired === true || workspaceIndexRequired;
    }
    if (this.watcherCreate) {
      await workspaceWatcherEnsure({
        workspace,
        watcherCreate: this.watcherCreate,
        onInvalidate: (filePath) => {
          const resolvedFilePath = path.resolve(filePath);
          // Policy config: drop everything; this is the only "global
          // invariant" tracked by the watcher.
          if (resolvedFilePath === path.resolve(workspace.configPath)) {
            this.workspaceInvalidateFromDisk(workspace, { configDirty: true });
            return;
          }
          // External tool config (eslint / biome / ruff): drop only that
          // analyzer's bucket. Other analyzers' per-file results stay valid.
          const matchedTools = workspace.externalToolConfigs
            .filter((entry) => path.resolve(entry.configPath) === resolvedFilePath)
            .map((entry) => entry.analyzerId);
          if (matchedTools.length > 0) {
            this.workspaceInvalidateFromDisk(workspace, {
              invalidateAnalyzers: matchedTools,
            });
            return;
          }
          // Source file or unknown event: mark just that path dirty so the
          // next run recomputes its content fingerprint.
          this.workspaceInvalidateFromDisk(workspace, {
            changedFilePath: resolvedFilePath,
          });
        },
      });
    }

    await workspaceTypeAwareBridgeLifecycleCall(
      this.typeAwareBridgeLifecycle?.workspaceAttached?.(
        workspaceTypeAwareBridgeExecutionContextCreate({
          clientSessionId: input.clientSessionId,
          workspace,
        }),
      ),
    );

    return {
      workspaceId,
      workspaceInstanceId: workspace.workspaceInstanceId,
    };
  }

  async completeReplay(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    workspaceInstanceId: WorkspaceInstanceId;
  }): Promise<WorkspaceReplayResult> {
    const { workspace, workspaceSession } = workspaceSessionGet(
      this.workspaces,
      this.clientSessions,
      input.clientSessionId,
      input.workspaceId,
    );
    if (workspaceSession.workspaceInstanceId !== input.workspaceInstanceId) {
      throw new Error(
        `Workspace instance mismatch for ${input.workspaceId}: expected ${workspaceSession.workspaceInstanceId}, received ${input.workspaceInstanceId}`,
      );
    }
    workspaceSession.replayEpoch += 1;
    workspaceSession.replayState = 'applied';
    this.workspaceBackgroundWarmupSchedule(workspace, workspaceSession);
    return {
      workspaceId: workspace.workspaceId,
      workspaceInstanceId: workspace.workspaceInstanceId,
      replayEpoch: workspaceSession.replayEpoch,
      replayState: 'applied',
    };
  }

  async subscribeDiagnostics(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    workspaceInstanceId: WorkspaceInstanceId;
    scope: WorkspaceDiagnosticsSubscriptionScope;
  }): Promise<WorkspaceDiagnosticsSubscriptionResult> {
    const { workspace, workspaceSession } = workspaceSessionGet(
      this.workspaces,
      this.clientSessions,
      input.clientSessionId,
      input.workspaceId,
    );
    if (workspaceSession.workspaceInstanceId !== input.workspaceInstanceId) {
      throw new Error(
        `Workspace instance mismatch for ${input.workspaceId}: expected ${workspaceSession.workspaceInstanceId}, received ${input.workspaceInstanceId}`,
      );
    }
    return {
      workspaceId: workspace.workspaceId,
      workspaceInstanceId: workspace.workspaceInstanceId,
      scope: input.scope,
      subscriptionState: 'active',
    };
  }

  async openOverlay(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
    version: number;
    text: string;
  }): Promise<void> {
    const { workspace, workspaceSession } = workspaceSessionGet(
      this.workspaces,
      this.clientSessions,
      input.clientSessionId,
      input.workspaceId,
    );
    const filePath = workspaceUriToPath(input.uri);
    workspaceSession.documents.set(input.uri, {
      uri: input.uri,
      filePath,
      version: input.version,
      text: input.text,
    });
    workspaceSessionInvalidate(workspaceSession, { dirtyFiles: [filePath] });

    if (workspaceSession.indexState && workspaceSession.indexState.files.includes(filePath)) {
      const didUpdate = projectIndexUpdateFileFromSource(
        workspaceSession.indexState.store,
        filePath,
        input.text,
      );
      if (didUpdate) {
        crossFileResolveForFile(workspaceSession.indexState.store, filePath, {
          baseDir: workspace.rootPath,
          extensions: DEFAULT_EXTENSIONS,
          workspacePackages: workspaceSession.indexState.workspacePackages,
        });
        workspaceSession.indexState.index = projectIndexCreate(
          workspaceSession.indexState.store,
          workspaceSession.indexState.capabilities,
        );
      }
    }
    await workspaceTypeAwareBridgeLifecycleCall(
      this.typeAwareBridgeLifecycle?.overlayOpened?.({
        ...workspaceTypeAwareBridgeExecutionContextCreate({
          clientSessionId: input.clientSessionId,
          workspace,
        }),
        uri: input.uri,
        version: input.version,
        text: input.text,
      }),
    );
  }

  async updateOverlay(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
    version: number;
    text: string;
  }): Promise<void> {
    const { workspace, workspaceSession } = workspaceSessionGet(
      this.workspaces,
      this.clientSessions,
      input.clientSessionId,
      input.workspaceId,
    );
    const filePath = workspaceUriToPath(input.uri);
    workspaceSession.documents.set(input.uri, {
      uri: input.uri,
      filePath,
      version: input.version,
      text: input.text,
    });
    workspaceSessionInvalidate(workspaceSession, { dirtyFiles: [filePath] });

    if (workspaceSession.indexState && workspaceSession.indexState.files.includes(filePath)) {
      const didUpdate = projectIndexUpdateFileFromSource(
        workspaceSession.indexState.store,
        filePath,
        input.text,
      );
      if (didUpdate) {
        crossFileResolveForFile(workspaceSession.indexState.store, filePath, {
          baseDir: workspace.rootPath,
          extensions: DEFAULT_EXTENSIONS,
          workspacePackages: workspaceSession.indexState.workspacePackages,
        });
        workspaceSession.indexState.index = projectIndexCreate(
          workspaceSession.indexState.store,
          workspaceSession.indexState.capabilities,
        );
      }
    }
    await workspaceTypeAwareBridgeLifecycleCall(
      this.typeAwareBridgeLifecycle?.overlayUpdated?.({
        ...workspaceTypeAwareBridgeExecutionContextCreate({
          clientSessionId: input.clientSessionId,
          workspace,
        }),
        uri: input.uri,
        version: input.version,
        text: input.text,
      }),
    );
  }

  async closeOverlay(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
  }): Promise<void> {
    const { workspace, workspaceSession } = workspaceSessionGet(
      this.workspaces,
      this.clientSessions,
      input.clientSessionId,
      input.workspaceId,
    );
    const filePath = workspaceSession.documents.get(input.uri)?.filePath;
    workspaceSession.documents.delete(input.uri);
    workspaceSessionInvalidate(workspaceSession, {
      dirtyFiles: filePath ? [filePath] : undefined,
    });
    if (filePath) {
      workspaceIndexRefreshFromDisk(workspace, workspaceSession, filePath);
    }
    await workspaceTypeAwareBridgeLifecycleCall(
      this.typeAwareBridgeLifecycle?.overlayClosed?.({
        ...workspaceTypeAwareBridgeExecutionContextCreate({
          clientSessionId: input.clientSessionId,
          workspace,
        }),
        uri: input.uri,
      }),
    );
  }

  async queryDiagnostics(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri?: string;
    requestId?: string;
    documentVersion?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceDiagnostic[]> {
    const { workspace, workspaceSession } = workspaceSessionGet(
      this.workspaces,
      this.clientSessions,
      input.clientSessionId,
      input.workspaceId,
    );
    if (input.uri) {
      workspaceDocumentVersionValidate(workspaceSession, {
        uri: input.uri,
        documentVersion: input.documentVersion,
      });
    }
    const analysis = await this.workspaceSessionAnalysisEnsure(workspace, workspaceSession, {
      signal: input.signal,
    });
    if (!input.uri) {
      return analysis.diagnostics;
    }
    return analysis.diagnostics.filter((diagnostic) => diagnostic.uri === input.uri);
  }

  async queryCodeActions(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
    version: number;
    diagnosticIds?: string[];
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<WorkspaceCodeAction[]> {
    const { workspace, workspaceSession } = workspaceSessionGet(
      this.workspaces,
      this.clientSessions,
      input.clientSessionId,
      input.workspaceId,
    );
    workspaceDocumentVersionValidate(workspaceSession, {
      uri: input.uri,
      documentVersion: input.version,
    });
    const analysis = await workspaceSessionAnalysisGet(workspace, workspaceSession, {
      signal: input.signal,
    });

    const pluginRulesResult = await policyPluginsGet(
      analysis.policy,
      workspace.rootPath,
      { configPath: workspace.configPath },
    );
    const fixModeResolver = isErr(pluginRulesResult)
      ? undefined
      : ruleFixModeResolverCreate(analysis.policy, pluginRulesResult.Ok);

    const selectedDiagnosticIds = new Set(
      input.diagnosticIds ??
        analysis.diagnostics
          .filter((diagnostic) => diagnostic.uri === input.uri)
          .map((diagnostic) => diagnostic.id),
    );

    const actions: WorkspaceCodeAction[] = [];
    for (const diagnostic of analysis.diagnostics) {
      if (diagnostic.uri !== input.uri || !selectedDiagnosticIds.has(diagnostic.id)) {
        continue;
      }
      const violation = analysis.fixableTreeViolationsByDiagnosticId.get(diagnostic.id);
      if (!violation) {
        continue;
      }
      if (fixModeResolver && fixModeResolver.ruleFixModeGet(violation.ruleId) === 'never') {
        continue;
      }

      const fixes = [];
      if (violation.fix) {
        fixes.push({
          title: `Fix ${violation.ruleId}`,
          fix: violation.fix,
          isPreferred: true,
        });
      }
      for (const suggestion of violation.suggestions ?? []) {
        fixes.push({
          title: suggestion.message,
          fix: suggestion.fix,
          isPreferred: false,
        });
      }

      for (const fixEntry of fixes) {
        const planResult = workspaceEditPlanCreateFromFix({
          filePath: violation.filePath,
          fix: fixEntry.fix,
          title: fixEntry.title,
          diagnostic,
          sourceGet: (filePath) => workspaceSourceGet(workspaceSession, filePath),
          idSalt: input.clientSessionId,
          isPreferred: fixEntry.isPreferred,
        });
        if (isErr(planResult)) {
          continue;
        }
        workspaceSessionEditPlanStore(workspaceSession, planResult.Ok);
        actions.push({
          id: planResult.Ok.id,
          title: planResult.Ok.title,
          kind: 'quickfix',
          diagnosticIds: planResult.Ok.diagnosticIds,
          plan: planResult.Ok,
          isPreferred: planResult.Ok.isPreferred,
        });
      }
    }

    return actions;
  }

  async planSourceFixAll(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
    version: number;
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<WorkspaceCodeAction | null> {
    return this.fixAllPlanCompute({
      ...input,
      kind: 'source.fixAll',
      ruleMode: 'on-save',
    });
  }

  async planFileFixAll(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
    version: number;
    includeRuleIds?: string[];
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<WorkspaceCodeAction | null> {
    return this.fixAllPlanCompute({
      ...input,
      kind:
        input.includeRuleIds && input.includeRuleIds.length === 1
          ? 'source.fixAll.rule'
          : 'source.fixAll',
      ruleMode: 'include',
      includeRuleIds: input.includeRuleIds,
    });
  }

  private async fixAllPlanCompute(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
    version: number;
    kind: 'source.fixAll' | 'source.fixAll.rule';
    ruleMode: 'on-save' | 'include';
    includeRuleIds?: string[];
    signal?: AbortSignal;
  }): Promise<WorkspaceCodeAction | null> {
    const { workspace, workspaceSession } = workspaceSessionGet(
      this.workspaces,
      this.clientSessions,
      input.clientSessionId,
      input.workspaceId,
    );
    workspaceDocumentVersionValidate(workspaceSession, {
      uri: input.uri,
      documentVersion: input.version,
    });
    const analysis = await workspaceSessionAnalysisGet(workspace, workspaceSession, {
      signal: input.signal,
    });

    const pluginRulesResult = await policyPluginsGet(
      analysis.policy,
      workspace.rootPath,
      { configPath: workspace.configPath },
    );
    if (isErr(pluginRulesResult)) {
      return null;
    }
    const fixModeResolver = ruleFixModeResolverCreate(
      analysis.policy,
      pluginRulesResult.Ok,
    );

    let ruleAllowList: Set<string>;
    if (input.ruleMode === 'on-save') {
      ruleAllowList = new Set(fixModeResolver.onSaveRuleIdsList());
    } else if (input.includeRuleIds && input.includeRuleIds.length > 0) {
      const allowed = new Set<string>();
      for (const ruleId of input.includeRuleIds) {
        if (fixModeResolver.ruleFixModeGet(ruleId) !== 'never') {
          allowed.add(ruleId);
        }
      }
      ruleAllowList = allowed;
    } else {
      ruleAllowList = new Set(fixModeResolver.fixEligibleRuleIdsList());
    }

    if (ruleAllowList.size === 0) {
      return null;
    }

    const diagnosticsByFileUri = analysis.diagnostics.filter(
      (diagnostic) => diagnostic.uri === input.uri,
    );

    const contributions = [];
    for (const diagnostic of diagnosticsByFileUri) {
      const violation = analysis.fixableTreeViolationsByDiagnosticId.get(diagnostic.id);
      if (!violation) {
        continue;
      }
      if (!ruleAllowList.has(violation.ruleId)) {
        continue;
      }
      const contribution = fixAllContributionFromViolation(violation, diagnostic.id);
      if (contribution) {
        contributions.push(contribution);
      }
    }

    if (contributions.length === 0) {
      return null;
    }

    const title =
      input.kind === 'source.fixAll.rule' && input.includeRuleIds?.[0]
        ? `Fix all ${input.includeRuleIds[0]}`
        : 'Fix all Codepol auto-fixable problems';

    const actionResult = workspaceFixAllActionCreate({
      title,
      kind: input.kind,
      ruleId:
        input.kind === 'source.fixAll.rule'
          ? input.includeRuleIds?.[0]
          : undefined,
      contributions,
      sourceGet: (filePath) => workspaceSourceGet(workspaceSession, filePath),
      idSalt: input.clientSessionId,
    });
    if (isErr(actionResult)) {
      return null;
    }
    const action = actionResult.Ok;
    if (!action) {
      return null;
    }
    workspaceSessionEditPlanStore(workspaceSession, action.plan);
    return action;
  }

  async applyEditPlan(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    planId: string;
    documentVersions: Record<string, number>;
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<WorkspaceApplyResult> {
    const { workspaceSession } = workspaceSessionGet(
      this.workspaces,
      this.clientSessions,
      input.clientSessionId,
      input.workspaceId,
    );
    const storedPlan = workspaceSession.editPlans.get(input.planId);
    if (!storedPlan) {
      return {
        applied: false,
        failureReason: 'plan_not_found',
      };
    }
    if (storedPlan.analysisRevisionAtCreation !== workspaceSession.analysisRevision) {
      return {
        applied: false,
        failureReason: 'stale_document_version',
      };
    }
    const { plan } = storedPlan;

    for (const edit of plan.edits) {
      let filePath: string;
      try {
        filePath = workspaceUriToPath(edit.uri);
      } catch {
        return {
          applied: false,
          failureReason: 'unsupported_uri',
        };
      }

      for (const document of workspaceSession.documents.values()) {
        if (document.filePath !== filePath) {
          continue;
        }
        const requestedVersion = input.documentVersions[edit.uri];
        if (requestedVersion === undefined || requestedVersion !== document.version) {
          return {
            applied: false,
            failureReason: 'stale_document_version',
          };
        }
      }
    }

    return {
      applied: true,
      plan,
    };
  }

  async queryIndexStatus(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<IndexStatusResult> {
    const { workspace, workspaceSession } = workspaceSessionGet(
      this.workspaces,
      this.clientSessions,
      input.clientSessionId,
      input.workspaceId,
    );
    workspaceAnalysisGenerationValidate(workspaceSession, input);
    return {
      daemonSessionId: this.daemonSessionId,
      workspaceId: workspace.workspaceId,
      workspaceInstanceId: workspace.workspaceInstanceId,
      status: workspaceSession.status,
      replayState: workspaceSession.replayState,
      replayEpoch: workspaceSession.replayEpoch,
      workspaceReady:
        workspaceSession.replayState === 'applied' &&
        workspaceSession.status === 'ready',
      featureStatus: workspaceFeatureStatusesCreate(workspaceSession),
      indexedFileCount:
        workspaceSession.indexState?.files.length ??
        workspace.baseIndexState?.files.length ??
        0,
      openDocumentCount: workspaceSession.documents.size,
      overlayCount: workspaceSession.documents.size,
      analysisGeneration: workspaceSession.analysisGeneration,
      lastError: workspaceSession.lastError,
    };
  }

  async queryLintRules(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceLintRulesResult> {
    const { workspace, workspaceSession } = workspaceSessionGet(
      this.workspaces,
      this.clientSessions,
      input.clientSessionId,
      input.workspaceId,
    );
    workspaceAnalysisGenerationValidate(workspaceSession, input);
    return workspaceLintRulesResultCreate({
      workspace,
      workspaceSession,
      analysis:
        workspaceSession.status === 'error'
          ? undefined
          : workspaceSession.lastAnalysis,
      signal: input.signal,
    });
  }

  async queryLintRuleDetails(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    ruleId: string;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceLintRuleDetailsResult | null> {
    const { workspace, workspaceSession } = workspaceSessionGet(
      this.workspaces,
      this.clientSessions,
      input.clientSessionId,
      input.workspaceId,
    );
    workspaceAnalysisGenerationValidate(workspaceSession, input);
    const analysis = await this.workspaceSessionAnalysisEnsure(workspace, workspaceSession, {
      signal: input.signal,
    });
    const rulesResult = await workspaceLintRulesResultCreate({
      workspace,
      workspaceSession,
      analysis,
      signal: input.signal,
    });
    const rule = rulesResult.rules.find((candidate) =>
      policyRuleMatches(candidate.ruleId, input.ruleId),
    );
    if (!rule) {
      return null;
    }

    const diagnostics = analysis.diagnostics.filter((diagnostic) =>
      policyRuleMatches(diagnostic.code, rule.ruleId),
    );
    return {
      rule,
      groups: workspaceLintRuleDetailsGroupsCreate({
        rootPath: workspace.rootPath,
        diagnostics,
      }),
      totalDiagnosticCount: diagnostics.length,
    };
  }

  async queryWorkspaceSymbols(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    query: string;
    limit?: number;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceSymbolResult[]> {
    const { workspace, workspaceSession } = workspaceSessionGet(
      this.workspaces,
      this.clientSessions,
      input.clientSessionId,
      input.workspaceId,
    );
    const index = await this.workspaceSessionIndexEnsure(workspace, workspaceSession, {
      signal: input.signal,
    });
    workspaceAnalysisGenerationValidate(workspaceSession, input);
    return workspaceModuleSymbolResultsGet(workspace, index, input);
  }

  async queryDependencyGraph(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceDependencyGraphResult> {
    const { workspace, workspaceSession } = workspaceSessionGet(
      this.workspaces,
      this.clientSessions,
      input.clientSessionId,
      input.workspaceId,
    );
    const index = await this.workspaceSessionIndexEnsure(workspace, workspaceSession, {
      signal: input.signal,
    });
    workspaceAnalysisGenerationValidate(workspaceSession, input);
    return workspaceDependencyGraphResultCreate(workspace, index, workspaceSession);
  }

  async queryImpactRadius(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
    direction: WorkspaceImpactRadiusDirection;
    depth?: number;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceDependencyGraphResult> {
    const { workspace, workspaceSession } = workspaceSessionGet(
      this.workspaces,
      this.clientSessions,
      input.clientSessionId,
      input.workspaceId,
    );
    const index = await this.workspaceSessionIndexEnsure(workspace, workspaceSession, {
      signal: input.signal,
    });
    workspaceAnalysisGenerationValidate(workspaceSession, input);
    return workspaceImpactRadiusResultCreate(workspace, index, {
      uri: input.uri,
      direction: input.direction,
      depth: input.depth,
    });
  }

  async queryDependencyPath(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    fromUri: string;
    toUri: string;
    maxPaths?: number;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceDependencyPathResult> {
    const { workspace, workspaceSession } = workspaceSessionGet(
      this.workspaces,
      this.clientSessions,
      input.clientSessionId,
      input.workspaceId,
    );
    const index = await this.workspaceSessionIndexEnsure(workspace, workspaceSession, {
      signal: input.signal,
    });
    workspaceAnalysisGenerationValidate(workspaceSession, input);
    return workspaceDependencyPathResultCreate(index, {
      fromUri: input.fromUri,
      toUri: input.toUri,
      maxPaths: input.maxPaths,
    });
  }

  async queryDeadModules(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    entryPointUris?: string[];
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceDeadModulesResult> {
    const { workspace, workspaceSession } = workspaceSessionGet(
      this.workspaces,
      this.clientSessions,
      input.clientSessionId,
      input.workspaceId,
    );
    const index = await this.workspaceSessionIndexEnsure(workspace, workspaceSession, {
      signal: input.signal,
    });
    workspaceAnalysisGenerationValidate(workspaceSession, input);
    return workspaceDeadModulesResultCreate(index, {
      entryPointUris: input.entryPointUris,
    });
  }

  async queryCallGraph(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    symbolId: string;
    direction: WorkspaceCallGraphDirection;
    depth?: number;
    requireTypeAware?: boolean;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceDependencyGraphResult> {
    const { workspace, workspaceSession } = workspaceSessionGet(
      this.workspaces,
      this.clientSessions,
      input.clientSessionId,
      input.workspaceId,
    );
    const index = await this.workspaceSessionIndexEnsure(workspace, workspaceSession, {
      signal: input.signal,
    });
    workspaceAnalysisGenerationValidate(workspaceSession, input);
    const symbolTable = workspaceTypeAwareBridgeSymbolTableCreate(
      workspaceSession,
      index,
    );
    const execution = workspaceTypeAwareBridgeExecutionContextCreate({
      clientSessionId: input.clientSessionId,
      workspace,
    });
    return await this.typeAwareBridgeContext.run({ execution, symbolTable }, async () =>
      workspaceCallGraphResultCreate(
        workspace,
        index,
        this.typeAwareCallGraphSourceRegistry,
        {
          symbolId: input.symbolId,
          direction: input.direction,
          depth: input.depth,
          requireTypeAware: input.requireTypeAware,
          signal: input.signal,
          languageIdResolve: (symbolId) =>
            workspaceSymbolLanguageIdGet(
              index,
              symbolId,
              this.typeAwareBridgeLanguageIdsByExtension,
            ),
        },
      ));
  }

  async querySymbolFlow(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    symbolId: string;
    direction: WorkspaceSymbolFlowDirection;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceSymbolFlowResult> {
    const { workspace, workspaceSession } = workspaceSessionGet(
      this.workspaces,
      this.clientSessions,
      input.clientSessionId,
      input.workspaceId,
    );
    const index = await this.workspaceSessionIndexEnsure(workspace, workspaceSession, {
      signal: input.signal,
    });
    workspaceAnalysisGenerationValidate(workspaceSession, input);
    return workspaceSymbolFlowResultCreate({
      workspace,
      state: workspaceSession,
      index,
      symbolId: input.symbolId,
      direction: input.direction,
    });
  }

  async queryTypeHierarchy(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    symbolId: string;
    direction: WorkspaceTypeHierarchyDirection;
    depth?: number;
    includeStructural?: boolean;
    minConfidence?: WorkspaceTypeHierarchyEdgeConfidence;
    requireTypeAware?: boolean;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceDependencyGraphResult> {
    const { workspace, workspaceSession } = workspaceSessionGet(
      this.workspaces,
      this.clientSessions,
      input.clientSessionId,
      input.workspaceId,
    );
    const index = await this.workspaceSessionIndexEnsure(workspace, workspaceSession, {
      signal: input.signal,
    });
    workspaceAnalysisGenerationValidate(workspaceSession, input);
    const symbolTable = workspaceTypeAwareBridgeSymbolTableCreate(
      workspaceSession,
      index,
    );
    const execution = workspaceTypeAwareBridgeExecutionContextCreate({
      clientSessionId: input.clientSessionId,
      workspace,
    });
    return await this.typeAwareBridgeContext.run({ execution, symbolTable }, async () =>
      workspaceTypeHierarchyResultCreate(
        workspace,
        index,
        this.typeAwareTypeHierarchySourceRegistry,
        {
          symbolId: input.symbolId,
          direction: input.direction,
          depth: input.depth,
          includeStructural: input.includeStructural,
          minConfidence: input.minConfidence,
          requireTypeAware: input.requireTypeAware,
          signal: input.signal,
          languageIdResolve: (symbolId) =>
            workspaceSymbolLanguageIdGet(
              index,
              symbolId,
              this.typeAwareBridgeLanguageIdsByExtension,
            ),
        },
      ));
  }

  async queryDependencyDiff(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    baselineLabel?: string;
    baselineGraph?: WorkspaceDependencyGraphResult;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceDependencyDiffResult> {
    if (
      (input.baselineLabel === undefined && input.baselineGraph === undefined) ||
      (input.baselineLabel !== undefined && input.baselineGraph !== undefined)
    ) {
      throw new Error(
        'queryDependencyDiff requires exactly one of baselineLabel or baselineGraph',
      );
    }

    const { workspace, workspaceSession } = workspaceSessionGet(
      this.workspaces,
      this.clientSessions,
      input.clientSessionId,
      input.workspaceId,
    );
    const index = await this.workspaceSessionIndexEnsure(workspace, workspaceSession, {
      signal: input.signal,
    });
    workspaceAnalysisGenerationValidate(workspaceSession, input);

    const current = workspaceDependencyGraphResultCreate(workspace, index, workspaceSession);

    let baseline: WorkspaceDependencyGraphResult;
    let baselineAnalysisGeneration: number | undefined;
    if (input.baselineGraph !== undefined) {
      baseline = input.baselineGraph;
    } else {
      const store = graphSnapshotStoreCreateInternal({ rootPath: workspace.rootPath });
      const snapshot = await store.graphSnapshotRead({ label: input.baselineLabel! });
      if (!snapshot) {
        throw new Error(
          `No graph snapshot found for label "${input.baselineLabel}". ` +
            `Capture one with \`codepol graph snapshot --label ${input.baselineLabel}\`.`,
        );
      }
      const expectedRootId = graphSnapshotWorkspaceRootIdComputeInternal(workspace.rootPath);
      if (snapshot.workspaceRootId !== expectedRootId) {
        throw new Error(
          `Graph snapshot for label "${input.baselineLabel}" was captured in a different workspace ` +
            `(snapshot rootId ${snapshot.workspaceRootId}, current rootId ${expectedRootId}).`,
        );
      }
      baselineAnalysisGeneration = snapshot.analysisGeneration;
      baseline = workspaceDependencyGraphResultFromSnapshot(snapshot);
    }

    return workspaceDependencyDiffResultCreate({
      workspace,
      workspaceId: input.workspaceId,
      baseline,
      current,
      baselineLabel: input.baselineLabel,
      currentAnalysisGeneration: workspaceSession.analysisGeneration,
      baselineAnalysisGeneration,
    });
  }

  async querySemanticSearch(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    query: string;
    limit?: number;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceSearchResult[]> {
    const { workspace, workspaceSession } = workspaceSessionGet(
      this.workspaces,
      this.clientSessions,
      input.clientSessionId,
      input.workspaceId,
    );
    const index = await this.workspaceSessionIndexEnsure(workspace, workspaceSession, {
      signal: input.signal,
    });
    workspaceAnalysisGenerationValidate(workspaceSession, input);
    return workspaceSemanticSearchResultsGet(workspace, workspaceSession, index, input);
  }

  async querySemanticDefinition(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceSemanticDefinitionResult | null> {
    const { workspace, workspaceSession } = workspaceSessionGet(
      this.workspaces,
      this.clientSessions,
      input.clientSessionId,
      input.workspaceId,
    );
    const index = await this.workspaceSessionIndexEnsure(workspace, workspaceSession, {
      signal: input.signal,
    });
    workspaceAnalysisGenerationValidate(workspaceSession, input);
    const resolvedTarget = workspaceSemanticTargetResolve(index, input.uri);
    if (!resolvedTarget) {
      return null;
    }
    return workspaceSemanticDefinitionResultCreate(resolvedTarget.target);
  }

  async querySemanticReferences(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceSemanticReferencesResult | null> {
    const { workspace, workspaceSession } = workspaceSessionGet(
      this.workspaces,
      this.clientSessions,
      input.clientSessionId,
      input.workspaceId,
    );
    const index = await this.workspaceSessionIndexEnsure(workspace, workspaceSession, {
      signal: input.signal,
    });
    workspaceAnalysisGenerationValidate(workspaceSession, input);
    const resolvedTarget = workspaceSemanticTargetResolve(index, input.uri);
    if (!resolvedTarget) {
      return null;
    }
    return workspaceSemanticReferencesResultCreate(workspace, workspaceSession, index, {
      target: resolvedTarget.target,
      filePath: resolvedTarget.filePath,
    });
  }

  async querySemanticHover(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceSemanticHoverResult | null> {
    const { workspace, workspaceSession } = workspaceSessionGet(
      this.workspaces,
      this.clientSessions,
      input.clientSessionId,
      input.workspaceId,
    );
    const index = await this.workspaceSessionIndexEnsure(workspace, workspaceSession, {
      signal: input.signal,
    });
    workspaceAnalysisGenerationValidate(workspaceSession, input);
    const resolvedTarget = workspaceSemanticTargetResolve(index, input.uri);
    if (!resolvedTarget) {
      return null;
    }
    return workspaceSemanticHoverResultCreate(workspace, index, {
      target: resolvedTarget.target,
      filePath: resolvedTarget.filePath,
    });
  }

  async prepareRename(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    target: WorkspaceRenameTarget;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspacePrepareRenameResult> {
    const { workspace, workspaceSession } = workspaceSessionGet(
      this.workspaces,
      this.clientSessions,
      input.clientSessionId,
      input.workspaceId,
    );
    workspaceAnalysisGenerationValidate(workspaceSession, input);
    if (input.target.semanticClass === 'config_component') {
      return workspaceConfigComponentPrepareResultResolve(
        workspace,
        workspaceSession,
        input.target.targetId,
      );
    }
    if (input.target.semanticClass === 'domain_entity') {
      const index = await this.workspaceSessionIndexEnsure(workspace, workspaceSession, {
        signal: input.signal,
      });
      return workspaceDomainEntityPrepareResultResolve(
        workspace,
        workspaceSession,
        index,
        input.target.targetId,
      );
    }
    const index = await this.workspaceSessionIndexEnsure(workspace, workspaceSession, {
      signal: input.signal,
    });
    return workspaceRenameTargetPrepareFailureResolve(index, input.target);
  }

  async previewRename(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    target: WorkspaceRenameTarget;
    newName: string;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceRenamePreviewResult> {
    const { workspace, workspaceSession } = workspaceSessionGet(
      this.workspaces,
      this.clientSessions,
      input.clientSessionId,
      input.workspaceId,
    );
    workspaceAnalysisGenerationValidate(workspaceSession, input);
    if (input.target.semanticClass === 'config_component') {
      const preview = workspaceConfigComponentPreviewResultResolve(workspace, workspaceSession, {
        targetId: input.target.targetId,
        newName: input.newName,
      });
      if (!preview.ok || !preview.canApply) {
        return preview;
      }
      const plan = workspaceRenamePreviewPlanCreate({
        preview,
        idSalt: input.clientSessionId,
      });
      workspaceSessionEditPlanStore(workspaceSession, plan);
      return {
        ...preview,
        plan,
      };
    }
    if (input.target.semanticClass === 'domain_entity') {
      const index = await this.workspaceSessionIndexEnsure(workspace, workspaceSession, {
        signal: input.signal,
      });
      const preview = workspaceDomainEntityPreviewResultResolve(
        workspace,
        workspaceSession,
        index,
        {
          targetId: input.target.targetId,
          newName: input.newName,
        },
      );
      if (!preview.ok || !preview.canApply) {
        return preview;
      }
      const plan = workspaceRenamePreviewPlanCreate({
        preview,
        idSalt: input.clientSessionId,
      });
      workspaceSessionEditPlanStore(workspaceSession, plan);
      return {
        ...preview,
        plan,
      };
    }
    const index = await this.workspaceSessionIndexEnsure(workspace, workspaceSession, {
      signal: input.signal,
    });
    return workspaceRenameTargetPreviewFailureResolve(index, input.target);
  }

  async queryArchitectureSummary(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceArchitectureSummaryResult> {
    const { workspace, workspaceSession } = workspaceSessionGet(
      this.workspaces,
      this.clientSessions,
      input.clientSessionId,
      input.workspaceId,
    );
    const index = await this.workspaceSessionIndexEnsure(workspace, workspaceSession, {
      signal: input.signal,
    });
    workspaceAnalysisGenerationValidate(workspaceSession, input);
    return workspaceArchitectureSummaryResultCreate(workspace, index);
  }

  async querySymbolLookup(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    name: string;
    kind?: WorkspaceSymbolDescriptorKind;
    scopeUri?: string;
    limit?: number;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceSymbolLookupResult> {
    const { workspace, workspaceSession } = workspaceSessionGet(
      this.workspaces,
      this.clientSessions,
      input.clientSessionId,
      input.workspaceId,
    );
    const index = await this.workspaceSessionIndexEnsure(workspace, workspaceSession, {
      signal: input.signal,
    });
    workspaceAnalysisGenerationValidate(workspaceSession, input);
    return workspaceSymbolLookupResultCreate(workspaceSession, index, {
      name: input.name,
      kind: input.kind,
      scopeUri: input.scopeUri,
      limit: input.limit,
    });
  }

  async querySymbolAtPosition(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
    position: WorkspacePosition;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceSymbolAtPositionResult> {
    const { workspace, workspaceSession } = workspaceSessionGet(
      this.workspaces,
      this.clientSessions,
      input.clientSessionId,
      input.workspaceId,
    );
    const index = await this.workspaceSessionIndexEnsure(workspace, workspaceSession, {
      signal: input.signal,
    });
    workspaceAnalysisGenerationValidate(workspaceSession, input);
    return workspaceSymbolAtPositionResultCreate(workspaceSession, index, {
      uri: input.uri,
      position: input.position,
    });
  }

  async querySymbolsInFileWithCallCounts(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceSymbolsInFileWithCallCountsResult> {
    const { workspace, workspaceSession } = workspaceSessionGet(
      this.workspaces,
      this.clientSessions,
      input.clientSessionId,
      input.workspaceId,
    );
    const index = await this.workspaceSessionIndexEnsure(workspace, workspaceSession, {
      signal: input.signal,
    });
    workspaceAnalysisGenerationValidate(workspaceSession, input);
    return workspaceSymbolsInFileWithCallCountsResultCreate(workspaceSession, index, {
      uri: input.uri,
    });
  }

  async querySymbolImporterCount(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    symbolId: string;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceSymbolImporterCountResult> {
    const { workspace, workspaceSession } = workspaceSessionGet(
      this.workspaces,
      this.clientSessions,
      input.clientSessionId,
      input.workspaceId,
    );
    const index = await this.workspaceSessionIndexEnsure(workspace, workspaceSession, {
      signal: input.signal,
    });
    workspaceAnalysisGenerationValidate(workspaceSession, input);
    return workspaceSymbolImporterCountResultCreate(index, {
      symbolId: input.symbolId,
    });
  }

  async queryImportSpecifiersInFile(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceImportSpecifiersInFileResult> {
    const { workspace, workspaceSession } = workspaceSessionGet(
      this.workspaces,
      this.clientSessions,
      input.clientSessionId,
      input.workspaceId,
    );
    const index = await this.workspaceSessionIndexEnsure(workspace, workspaceSession, {
      signal: input.signal,
    });
    workspaceAnalysisGenerationValidate(workspaceSession, input);
    return workspaceImportSpecifiersInFileResultCreate(
      workspace,
      workspaceSession,
      index,
      { uri: input.uri },
    );
  }
}

class InProcessWorkspaceService implements WorkspaceService {
  constructor(private readonly engine: WorkspaceServiceEngine) {}

  registerClientSession(input: {
    clientKind: WorkspaceClientKind;
    clientInstanceId: string;
    clientSessionId?: ClientSessionId;
  }): Promise<{ clientSessionId: ClientSessionId; daemonSessionId: DaemonSessionId }> {
    return this.engine.registerClientSession(input);
  }

  closeClientSession(input: {
    clientSessionId: ClientSessionId;
  }): Promise<void> {
    return this.engine.closeClientSession(input);
  }

  attachWorkspace(input: {
    clientSessionId: ClientSessionId;
    rootPath: string;
    configPath: string;
  }): Promise<{ workspaceId: string; workspaceInstanceId: WorkspaceInstanceId }> {
    return this.engine.attachWorkspace(input);
  }

  subscribeDiagnostics(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    workspaceInstanceId: WorkspaceInstanceId;
    scope: WorkspaceDiagnosticsSubscriptionScope;
  }): Promise<WorkspaceDiagnosticsSubscriptionResult> {
    return this.engine.subscribeDiagnostics(input);
  }

  completeReplay(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    workspaceInstanceId: WorkspaceInstanceId;
  }): Promise<WorkspaceReplayResult> {
    return this.engine.completeReplay(input);
  }

  openOverlay(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
    version: number;
    text: string;
  }): Promise<void> {
    return this.engine.openOverlay(input);
  }

  updateOverlay(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
    version: number;
    text: string;
  }): Promise<void> {
    return this.engine.updateOverlay(input);
  }

  closeOverlay(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
  }): Promise<void> {
    return this.engine.closeOverlay(input);
  }

  queryDiagnostics(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri?: string;
    requestId?: string;
    documentVersion?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceDiagnostic[]> {
    return this.engine.queryDiagnostics(input);
  }

  queryCodeActions(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
    version: number;
    diagnosticIds?: string[];
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<WorkspaceCodeAction[]> {
    return this.engine.queryCodeActions(input);
  }

  planSourceFixAll(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
    version: number;
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<WorkspaceCodeAction | null> {
    return this.engine.planSourceFixAll(input);
  }

  planFileFixAll(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
    version: number;
    includeRuleIds?: string[];
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<WorkspaceCodeAction | null> {
    return this.engine.planFileFixAll(input);
  }

  applyEditPlan(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    planId: string;
    documentVersions: Record<string, number>;
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<WorkspaceApplyResult> {
    return this.engine.applyEditPlan(input);
  }

  queryIndexStatus(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<IndexStatusResult> {
    return this.engine.queryIndexStatus(input);
  }

  queryLintRules(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceLintRulesResult> {
    return this.engine.queryLintRules(input);
  }

  queryLintRuleDetails(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    ruleId: string;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceLintRuleDetailsResult | null> {
    return this.engine.queryLintRuleDetails(input);
  }

  queryWorkspaceSymbols(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    query: string;
    limit?: number;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceSymbolResult[]> {
    return this.engine.queryWorkspaceSymbols(input);
  }

  queryDependencyGraph(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceDependencyGraphResult> {
    return this.engine.queryDependencyGraph(input);
  }

  queryImpactRadius(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
    direction: WorkspaceImpactRadiusDirection;
    depth?: number;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceDependencyGraphResult> {
    return this.engine.queryImpactRadius(input);
  }

  queryDependencyPath(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    fromUri: string;
    toUri: string;
    maxPaths?: number;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceDependencyPathResult> {
    return this.engine.queryDependencyPath(input);
  }

  queryDeadModules(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    entryPointUris?: string[];
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceDeadModulesResult> {
    return this.engine.queryDeadModules(input);
  }

  queryDependencyDiff(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    baselineLabel?: string;
    baselineGraph?: WorkspaceDependencyGraphResult;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceDependencyDiffResult> {
    return this.engine.queryDependencyDiff(input);
  }

  queryCallGraph(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    symbolId: string;
    direction: WorkspaceCallGraphDirection;
    depth?: number;
    requireTypeAware?: boolean;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceDependencyGraphResult> {
    return this.engine.queryCallGraph(input);
  }

  querySymbolFlow(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    symbolId: string;
    direction: WorkspaceSymbolFlowDirection;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceSymbolFlowResult> {
    return this.engine.querySymbolFlow(input);
  }

  queryTypeHierarchy(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    symbolId: string;
    direction: WorkspaceTypeHierarchyDirection;
    depth?: number;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceDependencyGraphResult> {
    return this.engine.queryTypeHierarchy(input);
  }

  querySemanticSearch(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    query: string;
    limit?: number;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceSearchResult[]> {
    return this.engine.querySemanticSearch(input);
  }

  querySemanticDefinition(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceSemanticDefinitionResult | null> {
    return this.engine.querySemanticDefinition(input);
  }

  querySemanticReferences(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceSemanticReferencesResult | null> {
    return this.engine.querySemanticReferences(input);
  }

  querySemanticHover(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceSemanticHoverResult | null> {
    return this.engine.querySemanticHover(input);
  }

  prepareRename(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    target: WorkspaceRenameTarget;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspacePrepareRenameResult> {
    return this.engine.prepareRename(input);
  }

  previewRename(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    target: WorkspaceRenameTarget;
    newName: string;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceRenamePreviewResult> {
    return this.engine.previewRename(input);
  }

  queryArchitectureSummary(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceArchitectureSummaryResult> {
    return this.engine.queryArchitectureSummary(input);
  }

  querySymbolLookup(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    name: string;
    kind?: WorkspaceSymbolDescriptorKind;
    scopeUri?: string;
    limit?: number;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceSymbolLookupResult> {
    return this.engine.querySymbolLookup(input);
  }

  querySymbolAtPosition(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
    position: WorkspacePosition;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceSymbolAtPositionResult> {
    return this.engine.querySymbolAtPosition(input);
  }

  querySymbolsInFileWithCallCounts(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceSymbolsInFileWithCallCountsResult> {
    return this.engine.querySymbolsInFileWithCallCounts(input);
  }

  querySymbolImporterCount(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    symbolId: string;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceSymbolImporterCountResult> {
    return this.engine.querySymbolImporterCount(input);
  }

  queryImportSpecifiersInFile(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceImportSpecifiersInFileResult> {
    return this.engine.queryImportSpecifiersInFile(input);
  }
}

export function workspaceServiceCreate(
  options: WorkspaceServiceCreateOptions = {},
): WorkspaceService {
  return new InProcessWorkspaceService(options.engine ?? new WorkspaceServiceEngine());
}

function workspaceStateCreateForPolicyCheck(
  options: {
    cwd: string;
    config: CodepolConfig;
    configPath: string;
    externalToolConfigs: WorkspaceExternalToolConfigEntry[];
  },
): PolicyCheckWorkspaceState {
  const rootPath = path.resolve(options.cwd);
  const configPath = path.resolve(rootPath, options.configPath);
  return {
    rootPath,
    configPath,
    externalToolConfigs: options.externalToolConfigs,
    config: options.config,
    documents: new Map(),
    analysisGeneration: 0,
  };
}

async function configResolve(
  options: WorkspacePolicyCheckOptions,
): Promise<{ config: CodepolConfig; configPath: string }> {
  if (options.config) {
    return {
      config: options.config,
      configPath: path.resolve(options.cwd, options.configPath),
    };
  }
  const resolvedConfigPath = path.resolve(options.cwd, options.configPath);
  const result = await configGetFromPath(resolvedConfigPath);
  return {
    config: result.config,
    configPath: result.configPath,
  };
}

export async function policyCheck(
  options: WorkspacePolicyCheckOptions,
): Promise<WorkspacePolicyCheckResult> {
  await ensureWorkspaceRuntimeReady();
  const { config, configPath } = await configResolve(options);
  const externalToolConfigs = externalToolConfigsResolve(configPath, config);
  const state = workspaceStateCreateForPolicyCheck({
    cwd: options.cwd,
    config,
    configPath,
    externalToolConfigs,
  });
  const analysis = await workspaceAnalysisRun(state, state, {
    fix: options.fix,
    collectEslintOutput: true,
  });
  return {
    policy: analysis.policy,
    files: analysis.files,
    violations: analysis.violations,
    treeViolations: analysis.treeViolations,
    workspaceDiagnostics: analysis.diagnostics,
    eslintOutput: analysis.eslintOutput,
    eslintHasErrors: analysis.eslintHasErrors,
  };
}

export async function configDiscover(
  cwd: string,
): Promise<{ config: CodepolConfig; configPath: string }> {
  await ensureWorkspaceRuntimeReady();
  return configGet(cwd);
}
