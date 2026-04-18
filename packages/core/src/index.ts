/**
 * @packageDocumentation
 * @codepol/core - Core policy loading, checking, and enforcement for codepol.
 *
 * This package provides the foundation for policy-driven code enforcement:
 * - Load and parse codepol config files (`codepol.toml`)
 * - Check TypeScript files using web-tree-sitter (WASM) for structural analysis
 * - Detect missing logger instrumentation
 * - Format and report violations
 *
 * @example
 * ```typescript
 * import {
 *   parserInit,
 *   configGet,
 *   policyViolationsGetFromDir,
 *   policyViolationsGetOutputPretty
 * } from '@codepol/core';
 *
 * // Initialize the WASM parser before checking
 * await parserInit();
 *
 * const { config } = await configGet();
 * const violations = await policyViolationsGetFromDir(config, process.cwd());
 *
 * if (violations.length > 0) {
 *   console.log(policyViolationsGetOutputPretty(violations, process.cwd()));
 *   process.exit(1);
 * }
 * ```
 */

// Types
export type {
  LoggerImportConfig,
  LoggerConfig,
  LintSeverity,
  PolicyRuleFixMode,
  PolicyRule,
  PolicyRuleTarget,
  PolicyTargetMap,
  PolicyRuleTargetContext,
  PolicyFile,
  TreeCheckProvider,
  LintProviderContext,
  LintProvider,
  EslintProviderConfig,
  BiomeProviderConfig,
  RuffProviderConfig,
  FixProviderContext,
  FixProvider,
  PolicyPluginCapabilities,
  ArchitectureCheckContext,
  ArchitectureCheckFn,
  ArchitectureCheckProvider,
  PluginRuleConfig,
  CodepolPluginRule,
  PluginRule,
  PolicyPluginDeclaration,
  PolicyCheckContext,
  PolicyViolation,
  PolicyViolationFix,
  PolicyWorkspaceEdit,
  PolicyFixSuggestion,
  PolicyDiagnosticLocation,
  RuleMatch,
  // Adapter types
  LintDiagnostic,
  TreeCheckAdapterOptions,
  TreeCheckLintAdapter,
  WorkspacePosition,
  WorkspaceRange,
  WorkspaceLocation,
  DaemonSessionId,
  ClientSessionId,
  WorkspaceInstanceId,
  WorkspaceDiagnosticSeverity,
  WorkspaceDiagnosticRelatedLocation,
  WorkspaceEdit,
  WorkspaceEditPlan,
  WorkspaceEditPlanKind,
  WorkspaceEditPlanIntent,
  WorkspaceEditExecutionMode,
  WorkspaceEditStalePlanPolicy,
  WorkspaceEditApplyAtomicity,
  WorkspaceEditSemanticRole,
  WorkspaceEditPlanExecutionDetails,
  WorkspaceEditPlanExecution,
  WorkspaceEditPlanPreviewCountByRole,
  WorkspaceEditPlanPreviewSummary,
  WorkspaceCodeAction,
  WorkspaceCodeActionKind,
  WorkspaceCodeActionConflict,
  WorkspaceDiagnostic,
  WorkspaceLintRuleOwnership,
  WorkspaceLintRuleAnalysisState,
  WorkspaceLintRuleProviderSummary,
  WorkspaceLintRuleSummary,
  WorkspaceLintRulesResult,
  WorkspaceLintRuleDiagnosticItem,
  WorkspaceLintRuleDiagnosticGroup,
  WorkspaceLintRuleDetailsResult,
  WorkspaceSymbolKind,
  WorkspaceSymbolResult,
  WorkspaceSearchResult,
  WorkspaceSemanticTarget,
  WorkspaceSemanticDefinitionResult,
  WorkspaceSemanticReferenceGroup,
  WorkspaceSemanticReferenceItem,
  WorkspaceSemanticReferencesGroup,
  WorkspaceSemanticReferencesResult,
  WorkspaceSemanticHoverField,
  WorkspaceSemanticHoverAction,
  WorkspaceSemanticHoverResult,
  WorkspaceRenameableSemanticClass,
  WorkspaceRenameSemanticClass,
  WorkspaceSupportedRenameTarget,
  WorkspaceRenameTarget,
  WorkspacePrepareRenameNamingRules,
  WorkspacePrepareRenameFailureCode,
  WorkspacePrepareRenameSuccess,
  WorkspacePrepareRenameFailure,
  WorkspacePrepareRenameResult,
  WorkspaceRenamePreviewEditKind,
  WorkspaceRenamePreviewEdit,
  WorkspaceRenamePreviewGroup,
  WorkspaceRenameWarningCode,
  WorkspaceRenameWarning,
  WorkspaceRenameBlockingIssueCode,
  WorkspaceRenameBlockingIssue,
  WorkspaceRenamePreviewFailureCode,
  WorkspaceRenamePreviewSuccess,
  WorkspaceRenamePreviewFailure,
  WorkspaceRenamePreviewResult,
  WorkspaceDependencyGraphNode,
  WorkspaceDependencyGraphNodeMetrics,
  WorkspaceDependencyGraphEdge,
  WorkspaceDependencyGraphEdgeKind,
  WorkspaceDependencyGraphResult,
  WorkspaceImpactRadiusDirection,
  WorkspaceDependencyPathResult,
  WorkspaceDeadModulesResult,
  WorkspaceArchitectureSummaryHotspot,
  WorkspaceArchitectureSummaryResult,
  WorkspaceApplyFailureReason,
  WorkspaceApplyResult,
  WorkspaceFeatureReadiness,
  WorkspaceFeatureStatus,
  IndexStatusFeatureStatus,
  IndexStatusResult,
} from './types';

export {
  pluginRuleNew,
  treeCheckProviderSupportsLanguage,
  architectureCheckProviderSupportsLanguage,
  pluginCapabilitiesRequireProjectIndex,
} from './types';
export {
  workspacePathToUri,
  workspaceUriToPath,
  workspaceIdCreate,
  workspaceRangeFromLineColumns,
  workspaceRangeFromByteRange,
  policyViolationToWorkspaceDiagnostic,
  lintDiagnosticToWorkspaceDiagnostic,
} from './types';

/** Default ESLint plugin name for codepol rules */
export const ESLINT_PLUGIN_NAME_DEFAULT = 'codepol';

import { parserInit } from './parser/parserInit';
import { langAdd } from './parser/parserLangs';
import type {
  CodepolPluginRule,
  LintProvider,
  LintProviderContext,
  EslintProviderConfig,
  TreeCheckProvider,
  PolicyRule,
  PolicyCheckContext,
  PolicyViolation,
  PolicyRuleTargetContext,
  LintSeverity,
} from './types';

import { resultFrom, isErr } from './result/result';
import { policyRuleTargetsResolve } from './policy/policyGet';
import { policyPluginsGet, pluginGetForRule } from './policy/policyPluginsGet';
import { configGet, configGetFromPath } from './config/configDiscover';

/**
 * Consumer-facing check function type.
 * Returns plain violations array; errors are thrown as exceptions.
 */
export type TreeCheckFn = (
  rule: PolicyRule,
  context: PolicyCheckContext
) => PolicyViolation[];

/**
 * Factory for creating ESLint lint providers.
 */
export function eslintProviderCreate(config: {
  languages: string[];
  pluginName?: string;
  rules: Record<string, unknown>;
  configs?: Record<string, unknown>;
  ruleOptions?: (ctx: LintProviderContext) => unknown;
}): LintProvider {
  const eslintConfig: EslintProviderConfig = {
    pluginName: config.pluginName ?? ESLINT_PLUGIN_NAME_DEFAULT,
    rules: config.rules,
    configs: config.configs,
    ruleOptions: config.ruleOptions,
  };
  return {
    platform: 'eslint',
    languages: config.languages,
    config: eslintConfig,
  };
}

/**
 * Factory for creating TreeCheckProvider from a plain check function.
 * Wraps the check function with resultFrom to convert exceptions to Result.Err.
 *
 * @example
 * ```typescript
 * function myCheck(rule: PolicyRule, context: PolicyCheckContext): PolicyViolation[] {
 *   const violations: PolicyViolation[] = [];
 *   // ... check logic ...
 *   return violations;
 * }
 *
 * export const myProvider = treeCheckProviderNew({
 *   check: myCheck,
 * });
 * ```
 */
export function treeCheckProviderNew(config: {
  languages?: string[];
  check: TreeCheckFn;
}): TreeCheckProvider {
  return {
    languages: config.languages,
    check: (rule, ctx) => resultFrom(() => config.check(rule, ctx)),
  };
}

/**
 * Derive supported languages from all providers in a rule plugin.
 */
export function rulePluginLanguagesGet(plugin: CodepolPluginRule): string[] {
  const languages = new Set<string>();
  const lintProviders = plugin.capabilities.lintProviders ?? [];
  for (const provider of lintProviders) {
    for (const lang of provider.languages) {
      languages.add(lang);
    }
  }
  const treeCheckProvider = plugin.capabilities.treeCheckProvider;
  if (treeCheckProvider?.languages === undefined) {
    languages.add('*');
  } else if (treeCheckProvider) {
    for (const lang of treeCheckProvider.languages) {
      languages.add(lang);
    }
  }
  return Array.from(languages);
}

/**
 * Generates lint provider rules config from codepol config.
 * Users spread this into their lint config (e.g., eslint.config.mts).
 *
 * @param provider - The lint provider platform (e.g., 'eslint')
 * @param configPath - Path to config file (auto-discovered if not specified)
 * @returns Rules config for the lint provider
 *
 * @example
 * ```javascript
 * // eslint.config.mts
 * import { providerRulesConfigGet, defineConfig } from '@codepol/core';
 *
 * export default defineConfig([{
 *   plugins: { codepol: eslintPluginCreate(codepolPlugin) },
 *   rules: {
 *     ...await providerRulesConfigGet('eslint'),
 *   },
 * }]);,
 * ```
 */
export async function providerRulesConfigGet(
  provider: string,
  configPath?: string
): Promise<Record<string, unknown>> {
  // Register languages and initialize tree-sitter parser for rules that need cross-file analysis
  langAdd({ langId: 'typescript', fileExtensions: ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs'] });
  langAdd({ langId: 'tsx', fileExtensions: ['.tsx', '.jsx'] });
  await parserInit();
  
  const cwd = process.cwd();
  
  // Load config: explicit path or auto-discover
  const { config, configPath: resolvedConfigPath } = configPath
    ? await configGetFromPath(configPath)
    : await configGet(cwd);
  const policy = config;
  
  const pluginsResult = await policyPluginsGet(policy, cwd, {
    configPath: resolvedConfigPath,
  });
  if (isErr(pluginsResult)) {
    throw new Error(pluginsResult.Err);
  }
  const pluginsMap = pluginsResult.Ok;

  // Build rule targets context
  const ruleTargets: PolicyRuleTargetContext[] = [];
  for (const rule of policy.rules) {
    const resolvedTargets = policyRuleTargetsResolve(rule, policy);
    for (const target of resolvedTargets) {
      ruleTargets.push({
        ruleId: rule.ruleId,
        description: rule.description,
        args: rule.args,
        target,
      });
    }
  }

  const rules: Record<string, unknown> = {};

  for (const rule of policy.rules) {
    // Skip if rule specifies providers and this provider is not included
    if (rule.providers && rule.providers.length > 0 && !rule.providers.includes(provider)) {
      continue;
    }

    const lookup = pluginGetForRule(pluginsMap, rule.ruleId);
    if (!lookup) {
      throw new Error(`No plugin registered for rule ${rule.ruleId}`);
    }
    const { plugin, resolvedId } = lookup;

    // Find ESLint lint provider
    const lintProviders = plugin.pluginRule.capabilities.lintProviders ?? [];
    const eslintProvider = lintProviders.find(p => p.platform === provider);
    
    // Check if rule can be adapted from treeCheckProvider
    const treeCheckProvider = plugin.pluginRule.capabilities.treeCheckProvider;
    const canAdaptFromTreeCheck = !eslintProvider && treeCheckProvider && provider === 'eslint';
    
    if (!eslintProvider && !canAdaptFromTreeCheck) {
      continue; // Rule doesn't have this provider and can't be adapted, skip
    }

    // Extract short rule name (used as the rule ID for adapted rules)
    const lastSlashIndex = resolvedId.lastIndexOf('/');
    const ruleNameShort = lastSlashIndex !== -1 ? resolvedId.slice(lastSlashIndex + 1) : resolvedId;
    
    // For adapted rules, use the plugin rule ID directly
    // For explicit lint providers, use the config from the provider
    const pluginName = eslintProvider 
      ? (eslintProvider.config as EslintProviderConfig).pluginName ?? ESLINT_PLUGIN_NAME_DEFAULT
      : ESLINT_PLUGIN_NAME_DEFAULT;
    const configKey = `${pluginName}/${ruleNameShort}`;

    if (rules[configKey]) {
      throw new Error(`Duplicate rule configuration: ${configKey}`);
    }

    // Get options from provider or use default adapted options
    let options: Record<string, unknown>;
    if (eslintProvider) {
      const eslintConfig = eslintProvider.config as EslintProviderConfig;
      const providerOptions = eslintConfig.ruleOptions?.({
        cwd,
        policy,
        configPath: resolvedConfigPath,
        ruleId: resolvedId,
        ruleArgs: rule.args,
        ruleTargets,
      });
      options = (providerOptions ?? Object.create(null)) as Record<string, unknown>;
    } else {
      // For adapted tree-check rules, pass config path and targets
      options = {
        configPath: resolvedConfigPath,
        ruleTargets,
        policyExclude: policy.exclude,
      } as Record<string, unknown>;
    }

    // Use severity from config, default to 'error'
    const severity: LintSeverity = rule.severity ?? 'error';
    rules[configKey] = [severity, options];
  }

  return rules;
}

/**
 * Loads and resolves all plugin rules referenced by the active config.
 * This is useful for hosts such as ESLint that need concrete rule objects
 * after built-in and process plugin resolution.
 */
export async function policyPluginRulesGet(configPath?: string): Promise<CodepolPluginRule[]> {
  const cwd = process.cwd();
  const { config, configPath: resolvedConfigPath } = configPath
    ? await configGetFromPath(configPath)
    : await configGet(cwd);

  const pluginsResult = await policyPluginsGet(config, cwd, {
    configPath: resolvedConfigPath,
  });
  if (isErr(pluginsResult)) {
    throw new Error(pluginsResult.Err);
  }

  return Array.from(pluginsResult.Ok.values()).map((entry) => entry.pluginRule);
}

// Policy loading
export {
  policyFileGet,
  policyCacheClear,
  policyRuleTargetsResolve,
  globPatternsGetMatchAny,
  policyFileGetChecked,
  ruleTargetMatchesLanguage,
  ruleMatchesGet,
} from './policy/policyGet';

// Tree-sitter checking
export { parserInit, parserGetForFile, parserGetForLanguage } from './parser/parserInit';
export {
  parserParseTrace,
  parserParseAbortHandlerSet,
  treeDisposeNow,
  type ParserParseAbortHandler,
  type ParserParseAbortInfo,
} from './parser/parserParseTrace';

// Diagnostics / observability runtime
export type {
  BuildProfile,
  ChecksPolicy,
  Clock,
  DebugChecks,
  Diagnostics,
  DiagnosticSinkKind,
  DiagnosticsConfig,
  DiagnosticsConfigPatch,
  DiagnosticsFieldProvider,
  DiagnosticsOverridePatch,
  DiagnosticsRecord,
  DiagnosticsRuntime,
  DiagnosticsSink,
  EffectiveDiagnosticsPolicy,
  EnvironmentName,
  EnvironmentPreset,
  EscalationHandle,
  EscalationRule,
  EscalationRuleInput,
  EscalationScope,
  EscalationStore,
  ExecutionContext,
  ExecutionContextScopeOpts,
  InvariantCheckDepth,
  LogLevel,
  MemorySink,
  MetricsPolicy,
  PolicyResolveOpts,
  RedactionExecutor,
  RedactionMode,
  RedactionPolicy,
  RuntimeDiagnosticsPolicy,
  ShippedDebugCapabilities,
  SinkFactories,
  SinkPipelineArgs,
  SnapshotsPolicy,
  Span,
  TracingPolicy,
} from './diagnostics';
export {
  ENV_PRESETS,
  LOG_LEVEL_ORDER,
  compositeSinkCreate,
  consoleSinkCreate,
  diagnosticsCreate,
  diagnosticsGet,
  diagnosticsNoopCreate,
  diagnosticsRuntimeCreate,
  diagnosticsRuntimeEscalate,
  diagnosticsRuntimeGet,
  diagnosticsRuntimeGetConfig,
  diagnosticsRuntimeGetEffectivePolicy,
  diagnosticsRuntimeListEscalations,
  diagnosticsRuntimeRevokeEscalation,
  diagnosticsRuntimeSetConfig,
  diagnosticsRuntimeSetEnvironment,
  diagnosticsRuntimeSetOverrides,
  effectivePolicyResolve,
  environmentNameParse,
  environmentNamesList,
  environmentPresetGet,
  environmentPresetPolicyClone,
  escalationStoreCreate,
  executionContextCreate,
  executionContextNoopCreate,
  fileSinkCreate,
  logLevelIsEnabled,
  logLevelMax,
  logLevelMin,
  memorySinkCreate,
  noopSinkCreate,
  otelSinkCreate,
  redactionPolicyCreate,
  scopeEffectiveLevelResolve,
  shippedDebugCapabilitiesGet,
  sinkPipelineCreate,
  stdoutSinkCreate,
  systemClock,
} from './diagnostics';
export {
  policyViolationsGetForFile,
  policyViolationsGetFromDir,
} from './policy/policyTreeCheck';
export {
  policyArchitectureViolationsGetFromDir,
  policyArchitectureViolationsGetForRule,
  pluginsMapHasArchitectureProvider,
  moduleGraphFromProjectIndex,
} from './policy/policyArchitectureCheck';

// Languages
export type { Lang } from './parser/parserLangs';
export { langAdd, langsGet, wasmPathGet, langIdGetForFile } from './parser/parserLangs';

// Plugins
export type { PolicyPluginsMap } from './policy/policyPluginsGet';
export {
  policyPluginsGet,
  pluginGetForRule,
  pluginBuiltinRegister,
  pluginModuleRegister,
} from './policy/policyPluginsGet';

// Runner
export type {
  PolicyCheckOptions,
  PolicyCheckResult,
} from './policy/policyCheck';

export {
  policyCheck,
  policyViolationsGetOutputPretty,
} from './policy/policyCheck';

// Tree-check to lint provider adapters
export {
  violationToLintDiagnostic,
  violationsToLintDiagnostics,
} from './adapter/treeCheckAdapter';

// Workspace edit helpers (shared with workspace-service and policy plugins)
export {
  fileWorkspaceEditsNormalize,
  fileWorkspaceEditsApply,
} from './policy/policyWorkspaceEdits';

// Result
export {
  Result,
  Ok,
  Err,
  isOk,
  isErr,
  resultFrom,
  resFrom,
  resFromAsync,
} from './result/result';

// Config (unified config file support)
export type {
  CodepolConfig,
  ConfigFileResult,
} from './config/configTypes';
export { defineConfig } from './config/defineConfig';
export {
  configGet,
  configGetSync,
  configGetFromPath,
  configGetFromPathSync,
  configFileDiscover,
  configCacheClear,
  configParseFromSource,
} from './config/configDiscover';

// ============================================================================
// Semantic Index (Cross-File Analysis)
// ============================================================================

// Core index types
export type {
  SymbolId,
  ScopeId,
  SymbolKind,
  SymbolBindingInfo,
  SymbolBindingKind,
  SymbolPatternKind,
  ScopeKind,
  ByteRange,
  SymbolRecord,
  ScopeRecord,
  RelationRecord,
  DefinesRelation,
  ContainsRelation,
  ReferencesRelation,
  ReferenceUsageType,
  ImportsRelation,
  ImportStyle,
  CallsRelation,
  ImportBindingRelation,
  ExportsRelation,
  TypeRelation,
  SymbolFilter,
  IndexCapabilities,
  FlowNodeId,
  FlowNode,
  FlowEdge,
  FlowGraph,
  FlowNodeKind,
} from './index/indexTypes';

export { ReferenceUsage, SymbolFlags } from './index/indexTypes';
// Module resolution
export type { ModuleResolveOptions } from './index/moduleResolver';
export {
  moduleResolve,
  isRelativeImport,
  isExternalPackage,
  DEFAULT_EXTENSIONS,
} from './index/moduleResolver';

// Query API
export type { ProjectIndex } from './index/indexQuery';
export { projectIndexCreate } from './index/indexQuery';
export type { ProjectIndexSnapshot, ProjectIndexStoreSnapshot } from './index/indexSnapshot';
export {
  projectIndexSnapshotCreate,
  projectIndexStoreSnapshotCreate,
  projectIndexStoreRestore,
} from './index/indexSnapshot';

// Module Graph
export type {
  ModuleGraph,
  ModuleGraphEdgeInfo,
  ModuleEdgeInfo,
  ModuleEdgeKind,
} from './index/moduleGraph';
export {
  moduleGraphBuild,
  moduleGraphEdgeInfoBuild,
} from './index/moduleGraph';

// Module Graph Queries
export type {
  ModuleImpactRadiusDirection,
  ModuleImpactRadiusInput,
  ModuleImpactRadiusResult,
  ModuleDependencyPathInput,
  ModuleDependencyPathResult,
  ModuleDeadModulesInput,
  ModuleDeadModulesResult,
} from './index/moduleGraphQueries';
export {
  moduleImpactRadiusCompute,
  moduleDependencyPathCompute,
  moduleDeadModulesCompute,
} from './index/moduleGraphQueries';

// Index builder
export type { IndexBuildOptions, IndexBuildResult } from './index/indexBuilder';
export {
  projectIndexBuild,
  projectIndexBuildSync,
  projectIndexUpdate,
  projectIndexUpdateFileSync,
  projectIndexUpdateFileFromSource,
  projectIndexRemoveFiles,
  crossFileResolveForFile,
  adapterRegister,
} from './index/indexBuilder';

// Index store (advanced use)
export type { FileIndexDelta } from './index/indexStore';
export { IndexStore, indexStoreNew } from './index/indexStore';

// Workspace package discovery
export type { WorkspacePackageRecord } from './index/workspacePackages';
export {
  workspacePackageMapCreate,
  workspacePackageMapDiscover,
  workspacePackageRecordFromManifestSource,
  workspacePackageRecordsDiscover,
} from './index/workspacePackages';

// Process plugin protocol
export type {
  ProcessPluginRuntimeContext,
  ProcessPluginRuleDescriptor,
  ProcessPluginDescribeResult,
  ProcessPluginCheckContext,
  ProcessPluginFixContext,
  ProcessPluginRequest,
  ProcessPluginResponse,
} from './policy/policyPluginProcess';
export {
  PROCESS_PLUGIN_PROTOCOL_VERSION,
  processPluginCacheClear,
  processPluginDescribeResultParse,
} from './policy/policyPluginProcess';
