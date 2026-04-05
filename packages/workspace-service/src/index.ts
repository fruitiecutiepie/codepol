import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import chokidar from 'chokidar';
import {
  DEFAULT_EXTENSIONS,
  ESLINT_PLUGIN_NAME_DEFAULT,
  configCacheClear,
  configGet,
  configGetFromPath,
  crossFileResolveForFile,
  indexStoreNew,
  isErr,
  lintDiagnosticToWorkspaceDiagnostic,
  pluginGetForRule,
  policyPluginsGet,
  policyViolationsGetForFile,
  policyRuleTargetsResolve,
  policyViolationToWorkspaceDiagnostic,
  policyViolationsGetFromDir,
  projectIndexBuildSync,
  projectIndexCreate,
  projectIndexStoreRestore,
  projectIndexStoreSnapshotCreate,
  projectIndexUpdateFileFromSource,
  projectIndexUpdateFileSync,
  ruleMatchesGet,
  treeCheckProviderSupportsLanguage,
  workspaceIdCreate,
  workspacePathToUri,
  workspaceRangeFromByteRange,
  workspacePackageMapDiscover,
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
  type WorkspaceApplyResult,
  type WorkspaceArchitectureSummaryResult,
  type WorkspaceCodeAction,
  type WorkspaceDependencyGraphResult,
  type WorkspaceDiagnostic,
  type WorkspaceDiagnosticSeverity,
  type WorkspaceFeatureStatus,
  type WorkspaceEditPlan,
  type WorkspaceInstanceId,
  type WorkspaceSearchResult,
  type WorkspaceSymbolResult,
  type BiomeProviderConfig,
} from '@codepol/core';
import { biomeCheckAsync, biomeFixAsync } from '@codepol/plugin-biome';
import { eslintPluginCreate } from '@codepol/plugin-eslint';
import { ruffCheckAsync, ruffFixAsync } from '@codepol/plugin-ruff';
import {
  treeCheckFixesApply,
  workspaceEditPlanCreateFromFix,
} from './edits';
import {
  builtinPluginArtifactPathsResolve,
  builtinPluginsRefresh,
  ensureWorkspaceRuntimeReady,
} from './runtime';
import {
  WORKSPACE_WARM_CACHE_COMPAT_VERSION,
  type WorkspaceWarmCacheFileFingerprint,
  type WorkspaceWarmCacheSnapshot,
  type WorkspaceWarmCacheStore,
} from './warmCache';

export * from './daemon';
export { builtinPluginsRefresh, ensureWorkspaceRuntimeReady } from './runtime';
export * from './warmCache';

const ESLINT_CONFIG_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts'];
const BIOME_FILE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx'];
const PYTHON_FILE_EXTENSIONS = ['.py', '.pyw'];
const WORKSPACE_WATCH_IGNORED = ['**/node_modules/**', '**/.git/**'];
const WORKSPACE_SYMBOL_LIMIT_DEFAULT = 50;
const WORKSPACE_SEARCH_LIMIT_DEFAULT = 20;
const WORKSPACE_NATIVE_OWNERSHIP_LANGUAGES = ['javascript', 'jsx', 'typescript', 'tsx'];

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

type WorkspaceContextState = {
  rootPath: string;
  configPath: string;
  eslintConfigPath: string;
  config: CodepolConfig;
  baseIndexState?: WorkspaceBaseIndexState;
};

type WorkspaceDocumentsState = {
  documents: Map<string, WorkspaceDocument>;
};

type WorkspaceAnalysisCacheState = {
  analysisGeneration: number;
  lastAnalysis?: WorkspaceAnalysis;
  indexState?: WorkspaceIndexState;
  workspaceIndexRequired?: boolean;
  toolFingerprints?: WorkspaceWarmCacheFileFingerprint[];
};

export type WorkspaceClientKind = 'lsp' | 'cli' | 'test';

export type WorkspaceWatcher = {
  on: (
    event: 'all',
    listener: (eventName: string, filePath: string) => void,
  ) => WorkspaceWatcher;
  close: () => Promise<void> | void;
};

export type WorkspaceWatcherCreate = (input: {
  rootPath: string;
  configPath: string;
}) => WorkspaceWatcher;

export type WorkspaceServiceEngineOptions = {
  watcherCreate?: WorkspaceWatcherCreate;
  backgroundWarmup?: boolean;
  backgroundTaskSchedule?: (task: () => Promise<void>) => void;
  warmCache?: WorkspaceWarmCacheStore;
};

type WorkspaceSessionState = WorkspaceDocumentsState &
  WorkspaceAnalysisCacheState & {
    workspaceId: string;
    workspaceInstanceId: WorkspaceInstanceId;
    replayEpoch: number;
    replayState: 'pending' | 'applied';
    codeActionPlans: Map<string, WorkspaceEditPlan>;
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
  queryArchitectureSummary: (input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }) => Promise<WorkspaceArchitectureSummaryResult>;
};

export type WorkspaceServiceCreateOptions = {
  engine?: WorkspaceServiceEngine;
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

export type WorkspaceDiagnosticsSubscriptionScope = 'workspace';

export type WorkspaceDiagnosticsSubscriptionResult = {
  workspaceId: string;
  workspaceInstanceId: WorkspaceInstanceId;
  scope: WorkspaceDiagnosticsSubscriptionScope;
  subscriptionState: 'active';
};

function fileHasExtension(filePath: string, extensions: string[]): boolean {
  return extensions.some((extension) => filePath.endsWith(extension));
}

function severityFromLintSeverity(
  severity?: LintSeverity,
): WorkspaceDiagnosticSeverity {
  if (severity === 'warn') {
    return 'warning';
  }
  return 'error';
}

function workspaceStateAnalysisInvalidate(state: WorkspaceAnalysisCacheState): void {
  state.lastAnalysis = undefined;
  state.toolFingerprints = undefined;
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

function workspaceFeatureStatusReadyOrDegraded(
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

function workspaceIndexBackedFeatureStatusCreate(input: {
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

function workspaceFeatureStatusesCreate(
  state: WorkspaceSessionState,
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
  workspaceStateAnalysisInvalidate(state);
  state.status = 'cold';
  state.lastError = undefined;
}

function workspaceWatchItemsResolve(input: {
  rootPath: string;
  configPath: string;
}): string[] {
  return [...new Set([path.resolve(input.rootPath), path.resolve(input.configPath)])];
}

function workspaceWatchItemsKeyCreate(input: {
  rootPath: string;
  configPath: string;
}): string {
  return workspaceWatchItemsResolve(input).join('\0');
}

export function workspaceWatcherCreate(input: {
  rootPath: string;
  configPath: string;
}): WorkspaceWatcher {
  return chokidar.watch(workspaceWatchItemsResolve(input), {
    ignoreInitial: true,
    ignored: WORKSPACE_WATCH_IGNORED,
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
  workspace.eslintConfigPath = eslintConfigPathResolve(
    workspace.rootPath,
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
  });
  watcher.on('all', (_eventName, filePath) => {
    input.onInvalidate(filePath);
  });
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

function biomeProviderConfigFromKey(key: string): BiomeProviderConfig {
  const parsed = JSON.parse(key) as {
    biomeBin: string;
    configPath: string | null;
    extraArgs: string[];
  };
  const out: BiomeProviderConfig = { biomeBin: parsed.biomeBin };
  if (parsed.configPath != null) {
    out.configPath = parsed.configPath;
  }
  if (parsed.extraArgs.length > 0) {
    out.extraArgs = parsed.extraArgs;
  }
  return out;
}

function biomeRuleIdToConfigMapBuild(entries: LintProviderEntry[]): Map<string, BiomeProviderConfig> {
  const map = new Map<string, BiomeProviderConfig>();
  for (const entry of entries) {
    if (entry.provider.platform !== 'biome') {
      continue;
    }
    const cfg = entry.provider.config as BiomeProviderConfig;
    const prev = map.get(entry.ruleId);
    if (prev !== undefined && biomeProviderConfigKey(prev) !== biomeProviderConfigKey(cfg)) {
      throw new Error(
        `Conflicting Biome lint provider configs for rule "${entry.ruleId}". ` +
          'Use a single Biome provider configuration per rule, or split into separate policy rules.',
      );
    }
    map.set(entry.ruleId, cfg);
  }
  return map;
}

function biomeFilesByConfigKeyCollect(
  matches: RuleMatch[],
  ruleIdToBiomeConfig: Map<string, BiomeProviderConfig>,
): Map<string, Set<string>> {
  const byKey = new Map<string, Set<string>>();
  for (const match of matches) {
    const cfg = ruleIdToBiomeConfig.get(match.rule.ruleId);
    if (!cfg) {
      continue;
    }
    const key = biomeProviderConfigKey(cfg);
    let set = byKey.get(key);
    if (!set) {
      set = new Set<string>();
      byKey.set(key, set);
    }
    for (const filePath of match.files) {
      if (fileHasExtension(filePath, BIOME_FILE_EXTENSIONS)) {
        set.add(filePath);
      }
    }
  }
  return byKey;
}

export function eslintConfigPathDetect(cwd: string): string {
  for (const ext of ESLINT_CONFIG_EXTENSIONS) {
    const configPath = path.join(cwd, `eslint.config${ext}`);
    if (fs.existsSync(configPath)) {
      return configPath;
    }
  }
  return path.join(cwd, 'eslint.config.js');
}

function eslintConfigPathResolve(
  cwd: string,
  configPath: string,
  config: CodepolConfig,
  explicit?: string,
): string {
  if (explicit) {
    return path.resolve(cwd, explicit);
  }
  if (config.eslintConfigPath) {
    return path.resolve(path.dirname(configPath), config.eslintConfigPath);
  }
  return eslintConfigPathDetect(cwd);
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
    if (lookup?.plugin.pluginRule.capabilities.requiresProjectIndex) {
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

function workspaceSourceGet(
  state: WorkspaceDocumentsState,
  filePath: string,
): string {
  for (const document of state.documents.values()) {
    if (document.filePath === filePath) {
      return document.text;
    }
  }
  return fs.readFileSync(filePath, 'utf8');
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

function workspaceDependencyGraphResultCreate(
  workspace: WorkspaceContextState,
  index: ProjectIndex,
): WorkspaceDependencyGraphResult {
  const files = [...index.filesGet()].sort();
  return {
    nodes: files.map((filePath) => ({
      uri: workspacePathToUri(filePath),
      workspaceRelativePath: workspaceRelativePathCreate(workspace.rootPath, filePath),
    })),
    edges: files.flatMap((filePath) =>
      index
        .moduleImporteesGet(filePath)
        .sort()
        .map((importeePath) => ({
          fromUri: workspacePathToUri(filePath),
          toUri: workspacePathToUri(importeePath),
        })),
    ),
    entryPoints: index
      .moduleEntryPointsGet()
      .map((filePath) => workspacePathToUri(filePath)),
    cycles: index
      .moduleCyclesGet()
      .map((cycle) => cycle.map((filePath) => workspacePathToUri(filePath))),
  };
}

function workspaceArchitectureSummaryResultCreate(
  workspace: WorkspaceContextState,
  index: ProjectIndex,
): WorkspaceArchitectureSummaryResult {
  const stats = index.statsGet();
  const hotspots = index
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
    })
    .slice(0, 5);
  const cycleCount = index.moduleCyclesGet().length;
  const entryPointCount = index.moduleEntryPointsGet().length;
  const hottestModule = hotspots[0];
  const hottestModuleSummary = hottestModule
    ? ` Hotspot: ${hottestModule.workspaceRelativePath} (${hottestModule.importerCount} importers, ${hottestModule.importeeCount} importees).`
    : '';

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
  };
}

function workspaceDocumentVersionValidate(
  state: WorkspaceDocumentsState,
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

function workspaceAnalysisGenerationValidate(
  state: WorkspaceAnalysisCacheState,
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
    baseIndexState = {
      files: normalizedFiles,
      fileKey,
      workspacePackages: workspacePackageMapDiscover(state.rootPath),
    };
    state.baseIndexState = baseIndexState;
  }

  return baseIndexState;
}

function workspaceIndexGetOrBuild(
  workspace: WorkspaceContextState,
  state: WorkspaceDocumentsState & WorkspaceAnalysisCacheState,
  files: string[],
): ProjectIndex {
  const baseIndexState = workspaceBaseIndexStateGetOrBuild(workspace, files);
  let indexState = state.indexState;

  if (!indexState || indexState.fileKey !== baseIndexState.fileKey) {
    const store = indexStoreNew();
    const { index } = projectIndexBuildSync({
      files: baseIndexState.files,
      dir: workspace.rootPath,
      store,
      workspacePackages: baseIndexState.workspacePackages,
    });

    indexState = {
      store,
      index,
      capabilities: index.capabilities,
      files: baseIndexState.files,
      fileKey: baseIndexState.fileKey,
      workspacePackages: baseIndexState.workspacePackages,
    };
    state.indexState = indexState;
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
  eslintConfigPath: string;
}): {
  configFingerprint: WorkspaceWarmCacheFileFingerprint;
  eslintConfigFingerprint?: WorkspaceWarmCacheFileFingerprint;
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

  return {
    configFingerprint,
    eslintConfigFingerprint: workspaceWarmCacheFileFingerprintRead(input.eslintConfigPath),
    fileFingerprints,
  };
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

function workspaceToolFingerprintsRead(
  workspace: WorkspaceContextState,
  lintProviderEntries: LintProviderEntry[],
): WorkspaceWarmCacheFileFingerprint[] {
  const resolvedPaths = new Set<string>();
  for (const entry of lintProviderEntries) {
    if (entry.provider.platform === 'biome') {
      const config = entry.provider.config as BiomeProviderConfig | undefined;
      for (const candidate of [config?.biomeBin, config?.configPath]) {
        const resolved = workspaceExternalToolPathResolve(workspace, candidate);
        if (resolved) {
          resolvedPaths.add(resolved);
        }
      }
      continue;
    }
    if (entry.provider.platform === 'ruff') {
      const config = entry.provider.config as RuffProviderConfig | undefined;
      for (const candidate of [config?.ruffBin, config?.configPath]) {
        const resolved = workspaceExternalToolPathResolve(workspace, candidate);
        if (resolved) {
          resolvedPaths.add(resolved);
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

async function workspaceWarmCacheSnapshotRestore(input: {
  warmCache?: WorkspaceWarmCacheStore;
  workspace: WorkspaceState;
  workspaceIndexRequired?: boolean;
}): Promise<
  | {
      analysisGeneration: number;
      workspaceIndexRequired: boolean;
      lastAnalysis: WorkspaceAnalysis;
      baseIndexState?: WorkspaceBaseIndexState;
      toolFingerprints: WorkspaceWarmCacheFileFingerprint[];
      indexState?: WorkspaceIndexState;
    }
  | undefined
> {
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
    const snapshotFiles = workspaceFilesNormalize(snapshot.files);
    if (
      currentFiles.length !== snapshotFiles.length ||
      currentFiles.some((filePath, index) => filePath !== snapshotFiles[index])
    ) {
      await input.warmCache.delete(cacheKey);
      return undefined;
    }

    const currentFingerprints = workspaceWarmCacheFingerprintsRead({
      files: currentFiles,
      configPath: input.workspace.configPath,
      eslintConfigPath: input.workspace.eslintConfigPath,
    });
    if (!currentFingerprints) {
      await input.warmCache.delete(cacheKey);
      return undefined;
    }

    const snapshotFingerprints = workspaceWarmCacheFingerprintsRead({
      files: snapshot.files,
      configPath: snapshot.configPath,
      eslintConfigPath: snapshot.eslintConfigPath,
    });
    if (!snapshotFingerprints) {
      await input.warmCache.delete(cacheKey);
      return undefined;
    }

    if (
      !workspaceWarmCacheFingerprintEquals(
        currentFingerprints.configFingerprint,
        snapshot.configFingerprint,
      ) ||
      !workspaceWarmCacheFingerprintEquals(
        currentFingerprints.eslintConfigFingerprint,
        snapshot.eslintConfigFingerprint,
      ) ||
      currentFingerprints.fileFingerprints.length !== snapshot.fileFingerprints.length ||
      currentFingerprints.fileFingerprints.some((fingerprint, index) => {
        return !workspaceWarmCacheFingerprintEquals(
          fingerprint,
          snapshot.fileFingerprints[index],
        );
      })
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

    return {
      analysisGeneration: snapshot.analysisGeneration,
      workspaceIndexRequired: snapshot.workspaceIndexRequired,
      lastAnalysis: workspaceWarmCacheAnalysisRestore(input.workspace, snapshot),
      baseIndexState: snapshot.baseIndexState
        ? {
            ...workspaceWarmCacheBaseIndexRestore(snapshot.baseIndexState)!,
            workspacePackages: currentWorkspacePackages,
          }
        : undefined,
      toolFingerprints: currentToolFingerprints,
      indexState:
        snapshot.projectIndexStoreSnapshot && snapshot.baseIndexState
          ? (() => {
              const restored = projectIndexStoreRestore(snapshot.projectIndexStoreSnapshot);
              return {
                store: restored.store,
                index: restored.index,
                capabilities: restored.index.capabilities,
                files: [...snapshot.baseIndexState.files],
                fileKey: snapshot.baseIndexState.fileKey,
                workspacePackages: currentWorkspacePackages,
              };
            })()
          : undefined,
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
  if (input.workspaceSession.documents.size > 0 || !input.workspaceSession.lastAnalysis) {
    return;
  }

  const fingerprints = workspaceWarmCacheFingerprintsRead({
    files: input.workspaceSession.lastAnalysis.files,
    configPath: input.workspace.configPath,
    eslintConfigPath: input.workspace.eslintConfigPath,
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

  await input.warmCache.write(workspaceWarmCacheKeyCreate(input.workspace), {
    compatVersion: WORKSPACE_WARM_CACHE_COMPAT_VERSION,
    workspaceId: input.workspace.workspaceId,
    rootPath: input.workspace.rootPath,
    configPath: input.workspace.configPath,
    eslintConfigPath: input.workspace.eslintConfigPath,
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
    eslintConfigFingerprint: fingerprints.eslintConfigFingerprint,
    fileFingerprints: fingerprints.fileFingerprints,
    toolFingerprints: input.workspaceSession.toolFingerprints ?? [],
    pluginSignature: pluginCompatibility.pluginSignature,
    pluginFingerprints: pluginCompatibility.pluginFingerprints,
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

  for (const match of treeMatches) {
    for (const filePath of match.files) {
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
        const issue =
          `Tree check failed for ${match.rule.ruleId} in ` +
          `${workspaceRelativePathCreate(input.rootPath, filePath)}: ${result.Err}`;
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

async function eslintAnalyzerRun(
  input: {
    files: string[];
    sourceByFilePath: Map<string, string>;
    policy: PolicyFile;
    configPath: string;
    eslintConfigPath: string;
    cwd: string;
    lintProviderEntries: LintProviderEntry[];
    nativeOwnedWrappedRuleIds: ReadonlySet<string>;
    ruleTargets: PolicyRuleTargetContext[];
    pluginRules: Awaited<ReturnType<typeof policyPluginsGet>> extends Result<infer T, string>
      ? T
      : never;
    fix: boolean;
    collectOutput: boolean;
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
  if (input.files.length === 0) {
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
        fileCount: input.files.length,
        fixMode: 'external',
        status: 'failed',
        issues: [issue.replace('\n', ' ')],
      }),
    );
  }

  const startedAt = Date.now();
  const eslint = new ESLintClass({
    overrideConfigFile: input.eslintConfigPath,
    plugins: {
      codepol: eslintPluginCreate(
        Array.from(input.pluginRules.values()).map((entry) => entry.pluginRule),
      ) as unknown as import('eslint').ESLint.Plugin,
    },
    overrideConfig: eslintConfigGet(executableEntries, {
      policy: input.policy,
      configPath: input.configPath,
      cwd: input.cwd,
      ruleTargets: input.ruleTargets,
    }),
    fix: input.fix,
    cwd: input.cwd,
  });

  const overlayFiles =
    input.fix
      ? []
      : input.files.filter((filePath) => input.sourceByFilePath.has(filePath));
  const closedFiles = input.files.filter((filePath) => !input.sourceByFilePath.has(filePath));

  const overlayResults: Array<{
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
  }> = [];
  for (const filePath of overlayFiles) {
    const source = input.sourceByFilePath.get(filePath)!;
    const lintTextResults = await eslint.lintText(source, { filePath });
    overlayResults.push(...(lintTextResults as typeof overlayResults));
  }

  const fileResults =
    closedFiles.length > 0
      ? ((await eslint.lintFiles(closedFiles)) as typeof overlayResults)
      : [];
  const lintResults = [...overlayResults, ...fileResults];

  if (input.fix) {
    await ESLintClass.outputFixes(lintResults as unknown as Awaited<
      ReturnType<typeof eslint.lintFiles>
    >);
  }

  let output = '';
  if (input.collectOutput) {
    const formatter = await eslint.loadFormatter('stylish');
    output =
      lintResults.length > 0
        ? (
            await formatter.format(
              lintResults as unknown as Awaited<ReturnType<typeof eslint.lintFiles>>,
            )
          ).trim()
        : '';
  }

  const violations: PolicyViolation[] = [];
  const diagnostics: WorkspaceDiagnostic[] = [];
  for (const result of lintResults) {
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
      fileCount: input.files.length,
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

  const biomeRuleIdToConfig = biomeRuleIdToConfigMapBuild(executableEntries);
  const biomeFilesByConfigKey = biomeFilesByConfigKeyCollect(
    input.matches,
    biomeRuleIdToConfig,
  );
  const fileCount = new Set(
    [...biomeFilesByConfigKey.values()].flatMap((filesSet) => [...filesSet]),
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
  for (const [configKey, filesSet] of biomeFilesByConfigKey) {
    workspaceAbortSignalThrowIfAborted(input.signal);
    const files = [...filesSet];
    if (files.length === 0) {
      continue;
    }
    const config = biomeProviderConfigFromKey(configKey);

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
    lintProviderEntries: LintProviderEntry[];
    nativeOwnedWrappedRuleIds: ReadonlySet<string>;
    fix: boolean;
    signal?: AbortSignal;
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

  const pythonFiles = input.files.filter((filePath) =>
    fileHasExtension(filePath, PYTHON_FILE_EXTENSIONS),
  );
  if (pythonFiles.length === 0) {
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

  const config = executableEntries[0]?.provider.config as RuffProviderConfig | undefined;
  const startedAt = Date.now();
  const issues: string[] = [];

  if (input.fix) {
    const ruffFixResult = await ruffFixAsync(pythonFiles, config, {
      signal: input.signal,
    });
    if (isErr(ruffFixResult)) {
      const issue = `Ruff fix failed: ${ruffFixResult.Err}`;
      console.warn(issue);
      issues.push(issue);
    }
  }

  workspaceAbortSignalThrowIfAborted(input.signal);
  const ruffResult = await ruffCheckAsync(pythonFiles, config, {
    signal: input.signal,
  });
  if (isErr(ruffResult)) {
    const issue = `Ruff check failed: ${ruffResult.Err}`;
    console.warn(issue);
    issues.push(issue);
    return workspaceAnalyzerRunResultCreate(
      workspaceAnalyzerScorecardCreate({
        analyzerId: 'ruff',
        platform: 'ruff',
        languages: ['python'],
        ownedRuleIds,
        skippedRuleIds,
        skippedReason: skippedRuleIds.length > 0 ? 'native_preferred' : undefined,
        fileCount: pythonFiles.length,
        fixMode: 'external',
        status: 'failed',
        latencyMs: Date.now() - startedAt,
        issues,
      }),
    );
  }

  const diagnostics = providerViolationsToDiagnostics(ruffResult.Ok, 'ruff');
  return workspaceAnalyzerRunResultCreate(
    workspaceAnalyzerScorecardCreate({
      analyzerId: 'ruff',
      platform: 'ruff',
      languages: ['python'],
      ownedRuleIds,
      skippedRuleIds,
      skippedReason: skippedRuleIds.length > 0 ? 'native_preferred' : undefined,
      diagnosticCount: diagnostics.length,
      violationCount: ruffResult.Ok.length,
      fileCount: pythonFiles.length,
      fixMode: 'external',
      status: issues.length > 0 ? 'failed' : 'ran',
      latencyMs: Date.now() - startedAt,
      issues,
    }),
    {
      diagnostics,
      violations: ruffResult.Ok,
    },
  );
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
  if (!options.fix && !options.collectEslintOutput && state.lastAnalysis) {
    return state.lastAnalysis;
  }

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
  state.toolFingerprints = workspaceToolFingerprintsRead(workspace, lintProviderEntries);
  const nativeOwnedWrappedRuleIds = workspaceNativeOwnedWrappedRuleIdsResolve({
    policy,
    ruleTargets,
    pluginRulesMap,
  });

  workspaceAbortSignalThrowIfAborted(options.signal);
  if (options.fix && fixProviders.length > 0) {
    await fixProvidersApply(fixProviders, {
      policy,
      configPath: workspace.configPath,
      cwd: workspace.rootPath,
      files,
      ruleTargets,
    });
  }

  let projectIndex: ProjectIndex | undefined;
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

  const eslintResult = await eslintAnalyzerRun({
    files,
    sourceByFilePath,
    policy,
    configPath: workspace.configPath,
    eslintConfigPath: workspace.eslintConfigPath,
    cwd: workspace.rootPath,
    lintProviderEntries,
    nativeOwnedWrappedRuleIds,
    ruleTargets,
    pluginRules: pluginRulesMap,
    fix: options.fix,
    collectOutput: options.collectEslintOutput,
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
    lintProviderEntries,
    nativeOwnedWrappedRuleIds,
    fix: options.fix,
    signal: options.signal,
  });

  if (workspaceIndexRequired) {
    workspaceAbortSignalThrowIfAborted(options.signal);
    projectIndex = workspaceIndexGetOrBuild(workspace, state, files);
  }
  const analyzerResults = [treeResult, eslintResult, biomeResult, ruffResult];
  const analyzerIssues = analyzerResults.flatMap((result) => result.issues);

  const analysis: WorkspaceAnalysis = {
    analyzerInventory: workspaceAnalyzerInventoryBuild({
      analyzerResults,
      lintProviderEntries,
      pluginRulesMap,
      policy,
      ruleTargets,
    }),
    analyzerScorecard: analyzerResults.map((result) => result.scorecard),
    policy,
    files,
    violations: analyzerResults.flatMap((result) => result.violations),
    treeViolations: [...treeResult.treeViolations],
    diagnostics: analyzerResults.flatMap((result) => result.diagnostics),
    featureStatus: {
      diagnostics: workspaceFeatureStatusReadyOrDegraded(analyzerIssues),
      codeActions: workspaceFeatureStatusCreate({
        readiness: 'ready',
      }),
      editPlans: workspaceFeatureStatusCreate({
        readiness: 'ready',
      }),
      workspaceIndex: workspaceIndexRequired
        ? workspaceFeatureStatusCreate({
            readiness: projectIndex ? 'ready' : 'degraded',
            detail: projectIndex
              ? 'Session-derived index ready'
              : 'Project index required but unavailable',
          })
        : workspaceFeatureStatusCreate({
            readiness: 'ready',
            detail: 'Not required by current policy',
          }),
      workspaceSymbols: workspaceIndexBackedFeatureStatusCreate({
        indexReady: projectIndex !== undefined,
        indexRequired: workspaceIndexRequired,
      }),
      semanticSearch: workspaceIndexBackedFeatureStatusCreate({
        indexReady: projectIndex !== undefined,
        indexRequired: workspaceIndexRequired,
      }),
      dependencyGraph: workspaceIndexBackedFeatureStatusCreate({
        indexReady: projectIndex !== undefined,
        indexRequired: workspaceIndexRequired,
      }),
      architectureSummary: workspaceIndexBackedFeatureStatusCreate({
        indexReady: projectIndex !== undefined,
        indexRequired: workspaceIndexRequired,
      }),
    },
    fixableTreeViolationsByDiagnosticId: treeResult.fixableTreeViolationsByDiagnosticId,
    eslintOutput: eslintResult.output,
    eslintHasErrors: eslintResult.hasErrors,
  };

  state.analysisGeneration += 1;
  state.lastAnalysis = analysis;
  return analysis;
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
export class WorkspaceServiceEngine implements WorkspaceService {
  private readonly daemonSessionId: DaemonSessionId = opaqueIdCreate('daemon');
  private readonly workspaces = new Map<string, WorkspaceState>();
  private readonly clientSessions = new Map<ClientSessionId, ClientSessionState>();
  private readonly watcherCreate?: WorkspaceWatcherCreate;
  private readonly backgroundWarmup: boolean;
  private readonly backgroundTaskSchedule: (task: () => Promise<void>) => void;
  private readonly warmCache?: WorkspaceWarmCacheStore;

  constructor(options: WorkspaceServiceEngineOptions = {}) {
    this.watcherCreate = options.watcherCreate;
    this.backgroundWarmup = options.backgroundWarmup ?? false;
    this.warmCache = options.warmCache;
    this.backgroundTaskSchedule =
      options.backgroundTaskSchedule ??
      ((task) => {
        queueMicrotask(() => {
          void task();
        });
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
    await workspaceWarmCacheSnapshotPersist({
      warmCache: this.warmCache,
      workspace,
      workspaceSession,
    });
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
    if (!workspaceSession.lastAnalysis) {
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
      workspaceSessionInvalidate(attachedWorkspaceSession, {
        clearIndexState: true,
        clearWorkspaceIndexRequirement: options.configDirty,
      });
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
        await workspaceWatcherClose(workspace);
      }
    }
    this.clientSessions.delete(input.clientSessionId);
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
    const policyWorkspaceIndexRequired = await workspaceIndexRequirementResolve({
      rootPath,
      configPath: resolvedConfigPath,
      eslintConfigPath: eslintConfigPathResolve(
        rootPath,
        resolvedConfigPath,
        config,
      ),
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
        eslintConfigPath: eslintConfigPathResolve(
          rootPath,
          resolvedConfigPath,
          config,
        ),
        config,
        attachedClientSessionIds: new Set(),
        configDirty: false,
      };
      this.workspaces.set(workspaceId, workspace);
    } else {
      workspace.config = config;
      workspace.configPath = resolvedConfigPath;
      workspace.eslintConfigPath = eslintConfigPathResolve(
        rootPath,
        resolvedConfigPath,
        config,
      );
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
      clientSession.workspaces.set(workspaceId, {
        workspaceId,
        workspaceInstanceId: workspace.workspaceInstanceId,
        replayEpoch: 0,
        replayState: 'pending',
        documents: new Map(),
        codeActionPlans: new Map(),
        status: restoredWarmCache ? 'ready' : 'cold',
        analysisGeneration: restoredWarmCache?.analysisGeneration ?? 0,
        analysisRevision: 0,
        workspaceIndexRequired:
          restoredWarmCache?.workspaceIndexRequired === true || workspaceIndexRequired,
        lastAnalysis: restoredWarmCache?.lastAnalysis,
        toolFingerprints: restoredWarmCache?.toolFingerprints,
        indexState: restoredWarmCache?.indexState,
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
          this.workspaceInvalidateFromDisk(workspace, {
            configDirty: path.resolve(filePath) === path.resolve(workspace.configPath),
          });
        },
      });
    }

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
    workspaceSessionInvalidate(workspaceSession);

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
  }

  async updateOverlay(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
    version: number;
    text: string;
  }): Promise<void> {
    await this.openOverlay(input);
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
    workspaceSessionInvalidate(workspaceSession);
    if (filePath) {
      workspaceIndexRefreshFromDisk(workspace, workspaceSession, filePath);
    }
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
    workspaceSession.codeActionPlans.clear();
    const analysis = await workspaceSessionAnalysisGet(workspace, workspaceSession, {
      signal: input.signal,
    });

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
        workspaceSession.codeActionPlans.set(planResult.Ok.id, planResult.Ok);
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
    const plan = workspaceSession.codeActionPlans.get(input.planId);
    if (!plan) {
      return {
        applied: false,
        failureReason: 'plan_not_found',
      };
    }

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
    return workspaceDependencyGraphResultCreate(workspace, index);
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

  queryArchitectureSummary(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    requestId?: string;
    analysisGeneration?: number;
    signal?: AbortSignal;
  }): Promise<WorkspaceArchitectureSummaryResult> {
    return this.engine.queryArchitectureSummary(input);
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
    eslintConfigPath: string;
  },
): PolicyCheckWorkspaceState {
  const rootPath = path.resolve(options.cwd);
  const configPath = path.resolve(rootPath, options.configPath);
  return {
    rootPath,
    configPath,
    eslintConfigPath: options.eslintConfigPath,
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
  const eslintConfigPath = eslintConfigPathResolve(
    options.cwd,
    configPath,
    config,
    options.eslintConfigPath,
  );
  const state = workspaceStateCreateForPolicyCheck({
    cwd: options.cwd,
    config,
    configPath,
    eslintConfigPath,
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
