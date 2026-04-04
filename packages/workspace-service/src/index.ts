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
  policyRuleTargetsResolve,
  policyViolationToWorkspaceDiagnostic,
  policyViolationsGetFromDir,
  projectIndexBuildSync,
  projectIndexCreate,
  projectIndexUpdateFileFromSource,
  projectIndexUpdateFileSync,
  ruleMatchesGet,
  workspaceIdCreate,
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
  type PolicyRule,
  type PolicyRuleTargetContext,
  type PolicyViolation,
  type ProjectIndex,
  type Result,
  type RuffProviderConfig,
  type RuleMatch,
  type WorkspaceApplyResult,
  type WorkspaceCodeAction,
  type WorkspaceDiagnostic,
  type WorkspaceDiagnosticSeverity,
  type WorkspaceFeatureStatus,
  type WorkspaceEditPlan,
  type WorkspaceInstanceId,
  type BiomeProviderConfig,
} from '@codepol/core';
import { biomeCheck, biomeFix } from '@codepol/plugin-biome';
import { eslintPluginCreate } from '@codepol/plugin-eslint';
import { ruffCheck, ruffFix } from '@codepol/plugin-ruff';
import {
  treeCheckFixesApply,
  workspaceEditPlanCreateFromFix,
} from './edits';
import { builtinPluginsRefresh, ensureWorkspaceRuntimeReady } from './runtime';

export * from './daemon';
export { builtinPluginsRefresh, ensureWorkspaceRuntimeReady } from './runtime';

const ESLINT_CONFIG_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts'];
const BIOME_FILE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx'];
const PYTHON_FILE_EXTENSIONS = ['.py', '.pyw'];
const WORKSPACE_WATCH_IGNORED = ['**/node_modules/**', '**/.git/**'];

type LintProviderEntry = {
  provider: LintProvider;
  ruleId: string;
  ruleArgs?: unknown;
  severity?: LintSeverity;
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

type EslintRunResult = {
  violations: PolicyViolation[];
  diagnostics: WorkspaceDiagnostic[];
  output: string;
  hasErrors: boolean;
  issues: string[];
};

type ProviderRunResult = {
  violations: PolicyViolation[];
  diagnostics: WorkspaceDiagnostic[];
  issues: string[];
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
    };
  }
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

async function eslintRun(
  input: {
    files: string[];
    sourceByFilePath: Map<string, string>;
    policy: PolicyFile;
    configPath: string;
    eslintConfigPath: string;
    cwd: string;
    lintProviderEntries: LintProviderEntry[];
    ruleTargets: PolicyRuleTargetContext[];
    pluginRules: Awaited<ReturnType<typeof policyPluginsGet>> extends Result<infer T, string>
      ? T
      : never;
    fix: boolean;
    collectOutput: boolean;
  },
): Promise<EslintRunResult> {
  const eslintProviders = input.lintProviderEntries.filter(
    (entry) => entry.provider.platform === 'eslint',
  );
  if (eslintProviders.length === 0) {
    return { violations: [], diagnostics: [], output: '', hasErrors: false, issues: [] };
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
    return {
      violations: [],
      diagnostics: [],
      output: '',
      hasErrors: false,
      issues: [issue.replace('\n', ' ')],
    };
  }

  const eslint = new ESLintClass({
    overrideConfigFile: input.eslintConfigPath,
    plugins: {
      codepol: eslintPluginCreate(
        Array.from(input.pluginRules.values()).map((entry) => entry.pluginRule),
      ) as unknown as import('eslint').ESLint.Plugin,
    },
    overrideConfig: eslintConfigGet(eslintProviders, {
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

  if (overlayFiles.length > 0) {
    for (const filePath of overlayFiles) {
      const source = input.sourceByFilePath.get(filePath)!;
      await eslint.lintText(source, { filePath });
    }
  }

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

  return {
    violations,
    diagnostics,
    output,
    hasErrors: lintResults.some((result) => result.errorCount > 0),
    issues: [],
  };
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

function biomeRun(
  input: {
    matches: RuleMatch[];
    lintProviderEntries: LintProviderEntry[];
    fix: boolean;
  },
): ProviderRunResult {
  const biomeRuleIdToConfig = biomeRuleIdToConfigMapBuild(input.lintProviderEntries);
  const biomeFilesByConfigKey = biomeFilesByConfigKeyCollect(
    input.matches,
    biomeRuleIdToConfig,
  );

  const violations: PolicyViolation[] = [];
  const issues: string[] = [];
  for (const [configKey, filesSet] of biomeFilesByConfigKey) {
    const files = [...filesSet];
    if (files.length === 0) {
      continue;
    }
    const config = biomeProviderConfigFromKey(configKey);

    if (input.fix) {
      const biomeFixResult = biomeFix(files, config);
      if (isErr(biomeFixResult)) {
        const issue = `Biome fix failed: ${biomeFixResult.Err}`;
        console.warn(issue);
        issues.push(issue);
      }
    }

    const biomeResult = biomeCheck(files, config);
    if (isErr(biomeResult)) {
      const issue = `Biome lint failed: ${biomeResult.Err}`;
      console.warn(issue);
      issues.push(issue);
      continue;
    }
    violations.push(...biomeResult.Ok);
  }

  return {
    violations,
    diagnostics: providerViolationsToDiagnostics(violations, 'biome'),
    issues,
  };
}

function ruffRun(
  input: {
    files: string[];
    lintProviderEntries: LintProviderEntry[];
    fix: boolean;
  },
): ProviderRunResult {
  const ruffProviders = input.lintProviderEntries.filter(
    (entry) => entry.provider.platform === 'ruff',
  );
  if (ruffProviders.length === 0) {
    return { violations: [], diagnostics: [], issues: [] };
  }

  const pythonFiles = input.files.filter((filePath) =>
    fileHasExtension(filePath, PYTHON_FILE_EXTENSIONS),
  );
  if (pythonFiles.length === 0) {
    return { violations: [], diagnostics: [], issues: [] };
  }

  const config = ruffProviders[0]?.provider.config as RuffProviderConfig | undefined;

  if (input.fix) {
    const ruffFixResult = ruffFix(pythonFiles, config);
    if (isErr(ruffFixResult)) {
      console.warn(`Ruff fix failed: ${ruffFixResult.Err}`);
    }
  }

  const ruffResult = ruffCheck(pythonFiles, config);
  if (isErr(ruffResult)) {
    const issue = `Ruff check failed: ${ruffResult.Err}`;
    console.warn(issue);
    return { violations: [], diagnostics: [], issues: [issue] };
  }

  return {
    violations: ruffResult.Ok,
    diagnostics: providerViolationsToDiagnostics(ruffResult.Ok, 'ruff'),
    issues: [],
  };
}

async function workspaceAnalysisRun(
  workspace: WorkspaceContextState,
  state: WorkspaceDocumentsState & WorkspaceAnalysisCacheState,
  options: {
    fix: boolean;
    collectEslintOutput: boolean;
  },
): Promise<WorkspaceAnalysis> {
  if (!options.fix && !options.collectEslintOutput && state.lastAnalysis) {
    return state.lastAnalysis;
  }

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
  const workspaceIndexRequired = matchedRulesRequireProjectIndex(matches, pluginRulesMap);
  state.workspaceIndexRequired = workspaceIndexRequired;

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
    projectIndex = workspaceIndexGetOrBuild(workspace, state, files);
  }

  if (options.fix) {
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

  const eslintResult = await eslintRun({
    files,
    sourceByFilePath,
    policy,
    configPath: workspace.configPath,
    eslintConfigPath: workspace.eslintConfigPath,
    cwd: workspace.rootPath,
    lintProviderEntries,
    ruleTargets,
    pluginRules: pluginRulesMap,
    fix: options.fix,
    collectOutput: options.collectEslintOutput,
  });

  const biomeResult = biomeRun({
    matches,
    lintProviderEntries,
    fix: options.fix,
  });
  const ruffResult = ruffRun({
    files,
    lintProviderEntries,
    fix: options.fix,
  });

  if (workspaceIndexRequired) {
    projectIndex = workspaceIndexGetOrBuild(workspace, state, files);
  }

  const treeViolationsResult = await policyViolationsGetFromDir(policy, workspace.rootPath, {
    configPath: workspace.configPath,
    sourceByFilePath,
    projectIndex,
  });
  if (isErr(treeViolationsResult)) {
    throw new Error(treeViolationsResult.Err);
  }

  const treeDiagnostics: WorkspaceDiagnostic[] = [];
  const fixableTreeViolationsByDiagnosticId = new Map<string, PolicyViolation>();
  for (const violation of treeViolationsResult.Ok) {
    const severity = severityFromLintSeverity(policyRuleGet(policy, violation.ruleId)?.severity);
    const diagnostic = policyViolationToWorkspaceDiagnostic(violation, {
      severity,
      source: 'codepol',
    });
    treeDiagnostics.push(diagnostic);
    if (violation.fix || (violation.suggestions && violation.suggestions.length > 0)) {
      fixableTreeViolationsByDiagnosticId.set(diagnostic.id, violation);
    }
  }

  const analysis: WorkspaceAnalysis = {
    policy,
    files,
    violations: [
      ...eslintResult.violations,
      ...biomeResult.violations,
      ...ruffResult.violations,
      ...treeViolationsResult.Ok,
    ],
    treeViolations: treeViolationsResult.Ok,
    diagnostics: [
      ...eslintResult.diagnostics,
      ...biomeResult.diagnostics,
      ...ruffResult.diagnostics,
      ...treeDiagnostics,
    ],
    featureStatus: {
      diagnostics: workspaceFeatureStatusReadyOrDegraded([
        ...eslintResult.issues,
        ...biomeResult.issues,
        ...ruffResult.issues,
      ]),
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
    },
    fixableTreeViolationsByDiagnosticId,
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
): Promise<WorkspaceAnalysis> {
  if (!state.lastAnalysis) {
    state.status = 'warming';
  }

  try {
    await workspaceContextRefreshFromDisk(workspace);
    const analysis = await workspaceAnalysisRun(workspace, state, {
      fix: false,
      collectEslintOutput: false,
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

  constructor(options: WorkspaceServiceEngineOptions = {}) {
    this.watcherCreate = options.watcherCreate;
    this.backgroundWarmup = options.backgroundWarmup ?? false;
    this.backgroundTaskSchedule =
      options.backgroundTaskSchedule ??
      ((task) => {
        queueMicrotask(() => {
          void task();
        });
      });
  }

  private workspaceBackgroundWarmupSchedule(
    workspace: WorkspaceState,
    workspaceSession: WorkspaceSessionState,
  ): void {
    if (!this.backgroundWarmup || workspaceSession.replayState !== 'applied') {
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
        await workspaceSessionAnalysisGet(workspace, workspaceSession);
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
    const workspaceIndexRequired = await workspaceIndexRequirementResolve({
      rootPath,
      configPath: resolvedConfigPath,
      eslintConfigPath: eslintConfigPathResolve(
        rootPath,
        resolvedConfigPath,
        config,
      ),
      config,
    });
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
      clientSession.workspaces.set(workspaceId, {
        workspaceId,
        workspaceInstanceId: workspace.workspaceInstanceId,
        replayEpoch: 0,
        replayState: 'pending',
        documents: new Map(),
        codeActionPlans: new Map(),
        status: 'cold',
        analysisGeneration: 0,
        analysisRevision: 0,
        workspaceIndexRequired,
      });
    } else {
      existingWorkspaceSession.workspaceIndexRequired = workspaceIndexRequired;
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
    const analysis = await workspaceSessionAnalysisGet(workspace, workspaceSession);
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
    const analysis = await workspaceSessionAnalysisGet(workspace, workspaceSession);

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
