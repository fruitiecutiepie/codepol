import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_EXTENSIONS,
  ESLINT_PLUGIN_NAME_DEFAULT,
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
  type CodepolConfig,
  type EslintProviderConfig,
  type FixProvider,
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
  type WorkspaceEditPlan,
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

export { builtinPluginsRefresh, ensureWorkspaceRuntimeReady } from './runtime';

const ESLINT_CONFIG_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts'];
const BIOME_FILE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx'];
const PYTHON_FILE_EXTENSIONS = ['.py', '.pyw'];

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
  fixableTreeViolationsByDiagnosticId: Map<string, PolicyViolation>;
  eslintOutput: string;
  eslintHasErrors: boolean;
};

type WorkspaceState = {
  workspaceId: string;
  rootPath: string;
  configPath: string;
  eslintConfigPath: string;
  config: CodepolConfig;
  documents: Map<string, WorkspaceDocument>;
  codeActionPlans: Map<string, WorkspaceEditPlan>;
  analysisGeneration: number;
  lastAnalysis?: WorkspaceAnalysis;
  indexState?: WorkspaceIndexState;
};

type EslintRunResult = {
  violations: PolicyViolation[];
  diagnostics: WorkspaceDiagnostic[];
  output: string;
  hasErrors: boolean;
};

type ProviderRunResult = {
  violations: PolicyViolation[];
  diagnostics: WorkspaceDiagnostic[];
};

export type WorkspaceService = {
  openWorkspace: (input: { rootPath: string; configPath: string }) => Promise<{ workspaceId: string }>;
  openDocument: (input: { workspaceId: string; uri: string; version: number; text: string }) => Promise<void>;
  updateDocument: (input: { workspaceId: string; uri: string; version: number; text: string }) => Promise<void>;
  closeDocument: (input: { workspaceId: string; uri: string }) => Promise<void>;
  queryDiagnostics: (input: { workspaceId: string; uri?: string }) => Promise<WorkspaceDiagnostic[]>;
  queryCodeActions: (input: {
    workspaceId: string;
    uri: string;
    version: number;
    diagnosticIds?: string[];
  }) => Promise<WorkspaceCodeAction[]>;
  applyEditPlan: (input: {
    workspaceId: string;
    planId: string;
    documentVersions: Record<string, number>;
  }) => Promise<WorkspaceApplyResult>;
  queryIndexStatus: (input: { workspaceId: string }) => Promise<IndexStatusResult>;
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

function workspaceStateAnalysisInvalidate(state: WorkspaceState): void {
  state.lastAnalysis = undefined;
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

function pluginsRequireProjectIndex(
  pluginRulesMap: Awaited<ReturnType<typeof policyPluginsGet>> extends Result<infer T, string>
    ? T
    : never,
): boolean {
  for (const [, plugin] of pluginRulesMap) {
    if (plugin.pluginRule.capabilities.requiresProjectIndex) {
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

function workspaceSourceOverridesGet(state: WorkspaceState): Map<string, string> {
  const overrides = new Map<string, string>();
  for (const document of state.documents.values()) {
    overrides.set(document.filePath, document.text);
  }
  return overrides;
}

function workspaceSourceGet(state: WorkspaceState, filePath: string): string {
  for (const document of state.documents.values()) {
    if (document.filePath === filePath) {
      return document.text;
    }
  }
  return fs.readFileSync(filePath, 'utf8');
}

function workspaceIndexGetOrBuild(
  state: WorkspaceState,
  files: string[],
): ProjectIndex {
  const normalizedFiles = [...new Set(files)].sort();
  const fileKey = normalizedFiles.join('\0');
  let indexState = state.indexState;

  if (!indexState || indexState.fileKey !== fileKey) {
    const store = indexStoreNew();
    const workspacePackages = workspacePackageMapDiscover(state.rootPath);
    const { index } = projectIndexBuildSync({
      files: normalizedFiles,
      dir: state.rootPath,
      store,
      workspacePackages,
    });

    indexState = {
      store,
      index,
      capabilities: index.capabilities,
      files: normalizedFiles,
      fileKey,
      workspacePackages,
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
      baseDir: state.rootPath,
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
  state: WorkspaceState,
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
    baseDir: state.rootPath,
    extensions: DEFAULT_EXTENSIONS,
    workspacePackages: indexState.workspacePackages,
  });
  indexState.index = projectIndexCreate(indexState.store, indexState.capabilities);
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
    return { violations: [], diagnostics: [], output: '', hasErrors: false };
  }

  let ESLintClass: typeof import('eslint').ESLint | undefined;
  try {
    const eslintModule = await import('eslint');
    ESLintClass = eslintModule.ESLint;
  } catch {
    console.warn(
      'ESLint is not installed. Skipping ESLint-based rules.\n' +
        'Install eslint to enable: npm install -D eslint',
    );
    return { violations: [], diagnostics: [], output: '', hasErrors: false };
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
  for (const [configKey, filesSet] of biomeFilesByConfigKey) {
    const files = [...filesSet];
    if (files.length === 0) {
      continue;
    }
    const config = biomeProviderConfigFromKey(configKey);

    if (input.fix) {
      const biomeFixResult = biomeFix(files, config);
      if (isErr(biomeFixResult)) {
        console.warn(`biome fix failed: ${biomeFixResult.Err}`);
      }
    }

    const biomeResult = biomeCheck(files, config);
    if (isErr(biomeResult)) {
      console.warn(`biome lint failed: ${biomeResult.Err}`);
      continue;
    }
    violations.push(...biomeResult.Ok);
  }

  return {
    violations,
    diagnostics: providerViolationsToDiagnostics(violations, 'biome'),
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
    return { violations: [], diagnostics: [] };
  }

  const pythonFiles = input.files.filter((filePath) =>
    fileHasExtension(filePath, PYTHON_FILE_EXTENSIONS),
  );
  if (pythonFiles.length === 0) {
    return { violations: [], diagnostics: [] };
  }

  const config = ruffProviders[0]?.provider.config as RuffProviderConfig | undefined;

  if (input.fix) {
    const ruffFixResult = ruffFix(pythonFiles, config);
    if (isErr(ruffFixResult)) {
      console.warn(`ruff fix failed: ${ruffFixResult.Err}`);
    }
  }

  const ruffResult = ruffCheck(pythonFiles, config);
  if (isErr(ruffResult)) {
    console.warn(`ruff check failed: ${ruffResult.Err}`);
    return { violations: [], diagnostics: [] };
  }

  return {
    violations: ruffResult.Ok,
    diagnostics: providerViolationsToDiagnostics(ruffResult.Ok, 'ruff'),
  };
}

async function workspaceAnalysisRun(
  state: WorkspaceState,
  options: {
    fix: boolean;
    collectEslintOutput: boolean;
  },
): Promise<WorkspaceAnalysis> {
  await ensureWorkspaceRuntimeReady();
  workspaceStateAnalysisInvalidate(state);
  builtinPluginsRefresh();

  const policy = state.config as PolicyFile;
  const pluginRulesResult = await policyPluginsGet(policy, state.rootPath, {
    configPath: state.configPath,
  });
  if (isErr(pluginRulesResult)) {
    throw new Error(pluginRulesResult.Err);
  }
  const pluginRulesMap = pluginRulesResult.Ok;
  const ruleTargets = policyRuleTargetsGet(policy);
  const lintProviderEntries = lintProviderEntriesCollect(policy, pluginRulesMap);
  const fixProviders = fixProvidersCollect(pluginRulesMap);
  const matches = await ruleMatchesGet(policy, state.rootPath);
  const files = Array.from(new Set(matches.flatMap((match) => match.files)));
  const sourceByFilePath = workspaceSourceOverridesGet(state);

  if (options.fix && fixProviders.length > 0) {
    await fixProvidersApply(fixProviders, {
      policy,
      configPath: state.configPath,
      cwd: state.rootPath,
      files,
      ruleTargets,
    });
  }

  let projectIndex: ProjectIndex | undefined;
  if (pluginsRequireProjectIndex(pluginRulesMap) && files.length > 0) {
    projectIndex = workspaceIndexGetOrBuild(state, files);
  }

  if (options.fix) {
    const treeFixViolationsResult = await policyViolationsGetFromDir(policy, state.rootPath, {
      configPath: state.configPath,
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
    configPath: state.configPath,
    eslintConfigPath: state.eslintConfigPath,
    cwd: state.rootPath,
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

  if (pluginsRequireProjectIndex(pluginRulesMap) && files.length > 0) {
    projectIndex = workspaceIndexGetOrBuild(state, files);
  }

  const treeViolationsResult = await policyViolationsGetFromDir(policy, state.rootPath, {
    configPath: state.configPath,
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
    fixableTreeViolationsByDiagnosticId,
    eslintOutput: eslintResult.output,
    eslintHasErrors: eslintResult.hasErrors,
  };

  state.analysisGeneration += 1;
  state.lastAnalysis = analysis;
  return analysis;
}

class InProcessWorkspaceService implements WorkspaceService {
  private readonly workspaces = new Map<string, WorkspaceState>();

  async openWorkspace(input: {
    rootPath: string;
    configPath: string;
  }): Promise<{ workspaceId: string }> {
    await ensureWorkspaceRuntimeReady();

    const rootPath = path.resolve(input.rootPath);
    const configPath = path.resolve(rootPath, input.configPath);
    const { config, configPath: resolvedConfigPath } = await configGetFromPath(configPath);
    const workspaceId = workspaceIdCreate(rootPath, resolvedConfigPath);
    const existing = this.workspaces.get(workspaceId);
    if (existing) {
      return { workspaceId };
    }

    const eslintConfigPath = eslintConfigPathResolve(
      rootPath,
      resolvedConfigPath,
      config,
    );

    this.workspaces.set(workspaceId, {
      workspaceId,
      rootPath,
      configPath: resolvedConfigPath,
      eslintConfigPath,
      config,
      documents: new Map(),
      codeActionPlans: new Map(),
      analysisGeneration: 0,
    });

    return { workspaceId };
  }

  async openDocument(input: {
    workspaceId: string;
    uri: string;
    version: number;
    text: string;
  }): Promise<void> {
    const workspace = workspaceGet(this.workspaces, input.workspaceId);
    const filePath = workspaceUriToPath(input.uri);
    workspace.documents.set(input.uri, {
      uri: input.uri,
      filePath,
      version: input.version,
      text: input.text,
    });
    workspaceStateAnalysisInvalidate(workspace);
    if (workspace.indexState && workspace.indexState.files.includes(filePath)) {
      const didUpdate = projectIndexUpdateFileFromSource(
        workspace.indexState.store,
        filePath,
        input.text,
      );
      if (didUpdate) {
        crossFileResolveForFile(workspace.indexState.store, filePath, {
          baseDir: workspace.rootPath,
          extensions: DEFAULT_EXTENSIONS,
          workspacePackages: workspace.indexState.workspacePackages,
        });
        workspace.indexState.index = projectIndexCreate(
          workspace.indexState.store,
          workspace.indexState.capabilities,
        );
      }
    }
  }

  async updateDocument(input: {
    workspaceId: string;
    uri: string;
    version: number;
    text: string;
  }): Promise<void> {
    await this.openDocument(input);
  }

  async closeDocument(input: {
    workspaceId: string;
    uri: string;
  }): Promise<void> {
    const workspace = workspaceGet(this.workspaces, input.workspaceId);
    const filePath = workspace.documents.get(input.uri)?.filePath;
    workspace.documents.delete(input.uri);
    workspaceStateAnalysisInvalidate(workspace);
    if (filePath) {
      workspaceIndexRefreshFromDisk(workspace, filePath);
    }
  }

  async queryDiagnostics(input: {
    workspaceId: string;
    uri?: string;
  }): Promise<WorkspaceDiagnostic[]> {
    const workspace = workspaceGet(this.workspaces, input.workspaceId);
    const analysis = await workspaceAnalysisRun(workspace, {
      fix: false,
      collectEslintOutput: false,
    });
    if (!input.uri) {
      return analysis.diagnostics;
    }
    return analysis.diagnostics.filter((diagnostic) => diagnostic.uri === input.uri);
  }

  async queryCodeActions(input: {
    workspaceId: string;
    uri: string;
    version: number;
    diagnosticIds?: string[];
  }): Promise<WorkspaceCodeAction[]> {
    const workspace = workspaceGet(this.workspaces, input.workspaceId);
    workspace.codeActionPlans.clear();
    const analysis = await workspaceAnalysisRun(workspace, {
      fix: false,
      collectEslintOutput: false,
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
          sourceGet: (filePath) => workspaceSourceGet(workspace, filePath),
          isPreferred: fixEntry.isPreferred,
        });
        if (isErr(planResult)) {
          continue;
        }
        workspace.codeActionPlans.set(planResult.Ok.id, planResult.Ok);
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
    workspaceId: string;
    planId: string;
    documentVersions: Record<string, number>;
  }): Promise<WorkspaceApplyResult> {
    const workspace = workspaceGet(this.workspaces, input.workspaceId);
    const plan = workspace.codeActionPlans.get(input.planId);
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

      for (const document of workspace.documents.values()) {
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
    workspaceId: string;
  }): Promise<IndexStatusResult> {
    const workspace = workspaceGet(this.workspaces, input.workspaceId);
    return {
      workspaceId: workspace.workspaceId,
      status: 'ready',
      indexedFileCount: workspace.indexState?.files.length ?? 0,
      openDocumentCount: workspace.documents.size,
      overlayCount: workspace.documents.size,
      analysisGeneration: workspace.analysisGeneration,
    };
  }
}

export function workspaceServiceCreate(): WorkspaceService {
  return new InProcessWorkspaceService();
}

function workspaceStateCreateForPolicyCheck(
  options: {
    cwd: string;
    config: CodepolConfig;
    configPath: string;
    eslintConfigPath: string;
  },
): WorkspaceState {
  const rootPath = path.resolve(options.cwd);
  const configPath = path.resolve(rootPath, options.configPath);
  return {
    workspaceId: workspaceIdCreate(rootPath, configPath),
    rootPath,
    configPath,
    eslintConfigPath: options.eslintConfigPath,
    config: options.config,
    documents: new Map(),
    codeActionPlans: new Map(),
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
  const analysis = await workspaceAnalysisRun(state, {
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
