import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ByteRange } from '../index/indexTypes';
import type {
  LintDiagnostic,
  LintProvider,
  LintSeverity,
  PolicyDiagnosticLocation,
  PolicyViolation,
} from '../policy/policyTypes';

export type WorkspacePosition = {
  line: number;
  character: number;
};

export type WorkspaceRange = {
  start: WorkspacePosition;
  end: WorkspacePosition;
};

export type WorkspaceLocation = {
  uri: string;
  range: WorkspaceRange;
};

export type DaemonSessionId = string;

export type ClientSessionId = string;

export type WorkspaceInstanceId = string;

export type WorkspaceDiagnosticSeverity = 'error' | 'warning' | 'info';

export type WorkspaceDiagnosticRelatedLocation = {
  uri: string;
  range: WorkspaceRange;
  message?: string;
};

export type WorkspaceEdit = {
  uri: string;
  range: WorkspaceRange;
  newText: string;
};

export type WorkspaceEditPlanKind = 'quickfix' | 'rename' | 'source.fixAll';

export type WorkspaceEditPlanIntent = 'quickfix' | 'rename' | 'source.fixAll';

export type WorkspaceEditExecutionMode = 'apply_direct' | 'preview_then_apply';

export type WorkspaceEditStalePlanPolicy = 'reject' | 'recompute';

export type WorkspaceEditApplyAtomicity = 'all_or_nothing' | 'per_file' | 'best_effort';

export type WorkspaceEditSemanticRole =
  | 'rename.definition'
  | 'rename.reference'
  | 'rename.string_literal'
  | 'rename.comment'
  | 'refactor.extract'
  | 'refactor.inline'
  | 'refactor.move'
  | 'refactor.rewrite'
  | 'import.add'
  | 'import.remove'
  | 'format.cleanup'
  | 'other';

export type WorkspaceEditPlanExecutionDetails =
  | {
      kind: 'rename';
      targetId?: string;
      oldName: string;
      newName: string;
    }
  | {
      kind: 'refactor';
      refactorKind: string;
    };

export type WorkspaceEditPlanExecution = {
  intent: WorkspaceEditPlanIntent;
  mode: WorkspaceEditExecutionMode;
  stalePlanPolicy?: WorkspaceEditStalePlanPolicy;
  atomicity?: WorkspaceEditApplyAtomicity;
  details?: WorkspaceEditPlanExecutionDetails;
};

export type WorkspaceEditPlanPreviewCountByRole = {
  semanticRole: WorkspaceEditSemanticRole;
  count: number;
};

export type WorkspaceEditPlanPreviewSummary = {
  fileCount: number;
  operationCount: number;
  countsByRole?: WorkspaceEditPlanPreviewCountByRole[];
};

export type WorkspaceEditPlan = {
  id: string;
  title: string;
  kind: WorkspaceEditPlanKind;
  edits: WorkspaceEdit[];
  diagnosticIds: string[];
  isPreferred?: boolean;
  execution?: WorkspaceEditPlanExecution;
  previewSummary?: WorkspaceEditPlanPreviewSummary;
};

export type WorkspaceCodeActionKind =
  | 'quickfix'
  | 'source.fixAll'
  | 'source.fixAll.rule';

export type WorkspaceCodeActionConflict = {
  uri: string;
  firstByteRange: { start: number; end: number };
  secondByteRange: { start: number; end: number };
  droppedRuleId?: string;
};

export type WorkspaceCodeAction = {
  id: string;
  title: string;
  kind: WorkspaceCodeActionKind;
  diagnosticIds: string[];
  plan: WorkspaceEditPlan;
  isPreferred?: boolean;
  /** Present when kind === 'source.fixAll.rule'. Namespaced rule id this action scopes to. */
  ruleId?: string;
  /** Non-fatal conflicts encountered while assembling a fix-all plan. */
  conflicts?: WorkspaceCodeActionConflict[];
};

export type WorkspaceDiagnostic = {
  id: string;
  uri: string;
  source: string;
  code: string;
  severity: WorkspaceDiagnosticSeverity;
  message: string;
  range: WorkspaceRange;
  relatedLocations?: WorkspaceDiagnosticRelatedLocation[];
};

export type WorkspaceLintRuleOwnership =
  | 'pending_analysis'
  | 'native_preferred'
  | 'keep_wrapped';

export type WorkspaceLintRuleAnalysisState =
  | 'pending'
  | 'ready'
  | 'error';

export type WorkspaceLintRuleProviderSummary = {
  platform: LintProvider['platform'];
  languages: string[];
  configSummary?: string;
};

export type WorkspaceLintRuleSummary = {
  ruleId: string;
  severities: LintSeverity[];
  targetPatterns: string[];
  providers: WorkspaceLintRuleProviderSummary[];
  languages: string[];
  ownership: WorkspaceLintRuleOwnership;
  hasNativeOwner: boolean;
  recentNativeDiagnosticCount: number;
  recentWrappedDiagnosticCount: number;
  recentNativeLatencyMs: number;
  recentWrappedLatencyMs: number;
  fixSurfaceNotes: string[];
  analysisState: WorkspaceLintRuleAnalysisState;
  analyzerIssues: string[];
};

export type WorkspaceLintRulesResult = {
  analysisGeneration: number;
  workspaceReady: boolean;
  rules: WorkspaceLintRuleSummary[];
};

export type WorkspaceLintRuleDiagnosticItem = {
  severity: WorkspaceDiagnosticSeverity;
  message: string;
  range: WorkspaceRange;
};

export type WorkspaceLintRuleDiagnosticGroup = {
  uri: string;
  workspaceRelativePath: string;
  diagnostics: WorkspaceLintRuleDiagnosticItem[];
};

export type WorkspaceLintRuleDetailsResult = {
  rule: WorkspaceLintRuleSummary;
  groups: WorkspaceLintRuleDiagnosticGroup[];
  totalDiagnosticCount: number;
};

export type WorkspaceSymbolKind = 'file' | 'module';

export type WorkspaceSymbolResult = {
  name: string;
  kind: WorkspaceSymbolKind;
  location: WorkspaceLocation;
  containerName?: string;
  detail?: string;
  source: 'codepol';
  semanticClass: 'workspace_file' | 'workspace_module';
  score?: number;
};

export type WorkspaceSearchResult = {
  name: string;
  kind: 'module' | 'exported_symbol';
  location: WorkspaceLocation;
  detail?: string;
  source: 'codepol';
  semanticClass: 'workspace_module' | 'exported_symbol';
  score: number;
};

export type WorkspaceSemanticTarget = {
  uri: string;
  semanticClass: 'architecture_node';
};

export type WorkspaceSemanticDefinitionResult = {
  kind: 'single_location';
  target: WorkspaceSemanticTarget;
  location: WorkspaceLocation;
  source: 'codepol';
  semanticClass: 'architecture_node';
};

export type WorkspaceSemanticReferenceGroup =
  | 'declarations'
  | 'incoming'
  | 'outgoing';

export type WorkspaceSemanticReferenceItem = {
  location: WorkspaceLocation;
  label: string;
  detail?: string;
  relationKind: WorkspaceSemanticReferenceGroup;
  semanticClass: 'architecture_node';
};

export type WorkspaceSemanticReferencesGroup = {
  group: WorkspaceSemanticReferenceGroup;
  totalCount: number;
  truncated: boolean;
  items: WorkspaceSemanticReferenceItem[];
};

export type WorkspaceSemanticReferencesResult = {
  target: WorkspaceSemanticTarget;
  presentation: 'grouped_list';
  totalItems: number;
  totalAvailableItems: number;
  truncated: boolean;
  groups: WorkspaceSemanticReferencesGroup[];
  source: 'codepol';
  semanticClass: 'architecture_node';
};

export type WorkspaceSemanticHoverField = {
  label: string;
  value: string;
};

export type WorkspaceSemanticHoverAction =
  | 'go_to_definition'
  | 'find_references'
  | 'show_graph';

export type WorkspaceSemanticHoverResult = {
  target: WorkspaceSemanticTarget;
  title: string;
  subtitle?: string;
  summary?: string;
  statusText?: string;
  fields: WorkspaceSemanticHoverField[];
  tags?: string[];
  actions?: WorkspaceSemanticHoverAction[];
  source: 'codepol';
  semanticClass: 'architecture_node';
};

export type WorkspaceRenameableSemanticClass =
  | 'domain_entity'
  | 'config_component';

export type WorkspaceRenameSemanticClass =
  | WorkspaceRenameableSemanticClass
  | 'architecture_node'
  | 'generated_artifact'
  | 'relation_anchor';

export type WorkspaceSupportedRenameTarget = {
  semanticClass: WorkspaceRenameableSemanticClass;
  targetId: string;
};

export type WorkspaceRenameTarget =
  | {
      semanticClass: 'architecture_node';
      uri: string;
    }
  | WorkspaceSupportedRenameTarget
  | {
      semanticClass: 'generated_artifact' | 'relation_anchor';
      targetId: string;
    };

export type WorkspacePrepareRenameNamingRules = {
  minLength?: number;
  maxLength?: number;
  patternDescription?: string;
  casePolicy?: 'preserve' | 'kebab' | 'snake' | 'camel' | 'pascal';
  reservedNames?: string[];
};

export type WorkspacePrepareRenameFailureCode =
  | 'not_codepol_owned'
  | 'not_renameable_class'
  | 'ambiguous_target'
  | 'read_only_target'
  | 'generated_only_target'
  | 'namespace_unknown'
  | 'reference_set_incomplete'
  | 'cross_owner_edits_required'
  | 'declaration_missing'
  | 'unsupported_context';

export type WorkspacePrepareRenameSuccess = {
  ok: true;
  target: WorkspaceSupportedRenameTarget;
  displayName: string;
  currentName: string;
  normalizedCurrentName: string;
  namespaceId: string;
  declarationLocation?: WorkspaceLocation;
  placeholderRange?: WorkspaceRange;
  impactedSiteCount: number;
  requiresPreview: true;
  namingRules: WorkspacePrepareRenameNamingRules;
};

export type WorkspacePrepareRenameFailure = {
  ok: false;
  code: WorkspacePrepareRenameFailureCode;
  message: string;
};

export type WorkspacePrepareRenameResult =
  | WorkspacePrepareRenameSuccess
  | WorkspacePrepareRenameFailure;

export type WorkspaceRenamePreviewEditKind =
  | 'declaration'
  | 'reference'
  | 'derived_metadata'
  | 'config_key'
  | 'display_label';

export type WorkspaceRenamePreviewEdit = {
  uri: string;
  range: WorkspaceRange;
  oldText: string;
  newText: string;
  kind: WorkspaceRenamePreviewEditKind;
  semanticClass: WorkspaceRenameableSemanticClass;
  targetId: string;
};

export type WorkspaceRenamePreviewGroup = {
  group: 'declarations' | 'references' | 'config' | 'metadata' | 'labels';
  edits: WorkspaceRenamePreviewEdit[];
};

export type WorkspaceRenameWarningCode =
  | 'display_label_not_canonical'
  | 'case_only_change'
  | 'generated_outputs_will_update_on_regen'
  | 'partial_nonsemantic_mentions_not_updated'
  | 'external_docs_not_updated'
  | 'large_edit_set';

export type WorkspaceRenameWarning = {
  code: WorkspaceRenameWarningCode;
  message: string;
};

export type WorkspaceRenameBlockingIssueCode =
  | 'collision'
  | 'namespace_unresolved'
  | 'incomplete_reference_set'
  | 'cross_owner_edit_required'
  | 'stale_snapshot'
  | 'write_conflict'
  | 'read_only_path';

export type WorkspaceRenameBlockingIssue = {
  code: WorkspaceRenameBlockingIssueCode;
  message: string;
};

export type WorkspaceRenamePreviewFailureCode =
  | WorkspacePrepareRenameFailureCode
  | 'validation_failed';

export type WorkspaceRenamePreviewSuccess = {
  ok: true;
  target: WorkspaceSupportedRenameTarget;
  oldName: string;
  newName: string;
  normalizedNewName: string;
  namespaceId: string;
  groups: WorkspaceRenamePreviewGroup[];
  totalEdits: number;
  warnings: WorkspaceRenameWarning[];
  blockingIssues: WorkspaceRenameBlockingIssue[];
  canApply: boolean;
  plan?: WorkspaceEditPlan;
};

export type WorkspaceRenamePreviewFailure = {
  ok: false;
  code: WorkspaceRenamePreviewFailureCode;
  message: string;
};

export type WorkspaceRenamePreviewResult =
  | WorkspaceRenamePreviewSuccess
  | WorkspaceRenamePreviewFailure;

/**
 * Structural metrics for a dependency-graph node. All fields are optional
 * so older clients that only read `uri` / `workspaceRelativePath` keep
 * working unchanged; values are populated on a best-effort basis by the
 * workspace service.
 */
export type WorkspaceDependencyGraphNodeMetrics = {
  /** Number of files that import this file (within the indexed set). */
  importerCount: number;
  /** Number of files this file imports (within the indexed set). */
  importeeCount: number;
  /** Number of declared symbols in this file. */
  symbolCount: number;
  /**
   * Sum of cyclomatic complexity across all function/method symbols in the
   * file. Omitted when no CFGs are available for any symbol in the file.
   */
  aggregateCyclomaticComplexity?: number;
  /**
   * Whether this file is a module-graph entry point (no importers in the
   * indexed set). Duplicates `WorkspaceDependencyGraphResult.entryPoints`
   * for per-node convenience.
   */
  isEntryPoint: boolean;
  /** Whether this file participates in any strongly-connected cycle. */
  isInCycle: boolean;
};

export type WorkspaceDependencyGraphNode = {
  uri: string;
  workspaceRelativePath: string;
  /**
   * Structural metrics for this file. Populated by the workspace service
   * when the index is available. Absent when metrics could not be computed.
   */
  metrics?: WorkspaceDependencyGraphNodeMetrics;
  /**
   * Architectural layer name this file belongs to. Populated by the
   * workspace service from policy layer config. Absent in Phase 1 until
   * layer configuration is wired up.
   */
  layer?: string;
  /**
   * Monorepo package name that owns this file (from `package.json`).
   * Absent when the workspace is not a monorepo or the file is outside
   * any known package.
   */
  packageName?: string;
};

/**
 * Syntactic classification of a dependency-graph edge. See
 * `ModuleEdgeKind` in `@codepol/core` for the authoritative definition.
 */
export type WorkspaceDependencyGraphEdgeKind =
  | 'static'
  | 'dynamic'
  | 'side_effect'
  | 'cjs'
  | 'type_only';

export type WorkspaceDependencyGraphEdge = {
  fromUri: string;
  toUri: string;
  /**
   * Dominant syntactic style of the import(s) producing this edge.
   * Populated when the workspace service has access to edge info.
   */
  kind?: WorkspaceDependencyGraphEdgeKind;
  /**
   * Number of distinct `ImportBindingRelation` entries contributing to the
   * edge. Zero for pure side-effect imports.
   */
  bindingCount?: number;
  /**
   * True when the importer and importee belong to different monorepo
   * packages. Absent when package membership cannot be determined for
   * either endpoint.
   */
  crossesPackageBoundary?: boolean;
  /**
   * True when the importer and importee belong to different architectural
   * layers. Absent until layer configuration is wired up, or when layer
   * membership cannot be determined for either endpoint.
   */
  crossesLayerBoundary?: boolean;
};

export type WorkspaceDependencyGraphResult = {
  nodes: WorkspaceDependencyGraphNode[];
  edges: WorkspaceDependencyGraphEdge[];
  entryPoints: string[];
  cycles: string[][];
};

/**
 * Direction of an impact-radius neighborhood traversal. Mirrors
 * `ModuleImpactRadiusDirection` from `@codepol/core` one-for-one so
 * clients that speak the workspace contract can pass the string straight
 * through.
 *
 * - `upstream`: follow reverse edges (who imports the focus file,
 *   transitively) — "what breaks if I change this?"
 * - `downstream`: follow forward edges (what the focus file imports,
 *   transitively) — "what does this file pull in?"
 * - `both`: union of upstream and downstream starting at the focus.
 */
export type WorkspaceImpactRadiusDirection = 'upstream' | 'downstream' | 'both';

/**
 * Narrow neighborhood query result. Reuses
 * {@link WorkspaceDependencyGraphResult} so panels and CLI commands can
 * render the subgraph with the same code path as the full graph.
 *
 * `entryPoints` and `cycles` are filtered to files that appear in the
 * returned subgraph.
 */
export type WorkspaceDependencyPathResult = {
  /**
   * Simple paths (no repeated files) from the source to the destination,
   * sorted by `(length, lexicographic tuple)`. Each path is an array of
   * workspace URIs and starts with the `fromUri` input and ends with
   * `toUri`.
   */
  paths: string[][];
  /**
   * Length of the shortest path in edges (`paths[0].length - 1`). `0`
   * when the source equals the destination or no path exists.
   */
  shortestLength: number;
  /**
   * `true` when the enumeration stopped because the `maxPaths` cap was
   * reached and at least one additional simple path exists.
   */
  truncated: boolean;
};

/**
 * Files present in the workspace index that are not reachable from any
 * entry point. Entry points used for the computation are whichever were
 * passed to `queryDeadModules`; when none are passed, the module graph's
 * natural entry points are used.
 */
export type WorkspaceDeadModulesResult = {
  /** URIs of unreachable files, sorted lexicographically. */
  unreachable: string[];
};

/**
 * Diff between two captured workspace dependency graphs. Used by
 * `queryDependencyDiff` to power the panel's diff mode and the CI
 * `codepol graph diff` flow.
 *
 * All arrays are deterministically sorted so two consecutive runs with
 * identical inputs produce byte-identical JSON.
 *
 * - `addedNodes` / `removedNodes` sorted by `uri`
 * - `addedEdges` / `removedEdges` sorted by `(fromUri, toUri)`
 * - `newCycles` / `removedCycles` each cycle sorted by URI internally;
 *   the outer array sorted by first member
 */
export type WorkspaceDependencyDiffNode = {
  uri: string;
  workspaceRelativePath: string;
};

export type WorkspaceDependencyDiffEdge = {
  fromUri: string;
  toUri: string;
};

export type WorkspaceDependencyDiffResult = {
  /** Workspace identifier of the comparison source (the "current" graph). */
  workspaceId: string;
  /**
   * Optional baseline label echoed back from the snapshot store. Absent
   * when the baseline came from an inline payload rather than a labeled
   * snapshot.
   */
  baselineLabel?: string;
  /**
   * Generation of the live index when the current graph was sampled.
   * Mirrors `analysisGeneration` on `IndexStatusResult`.
   */
  currentAnalysisGeneration: number;
  /**
   * Generation captured into the baseline snapshot when it was written.
   * Absent when the baseline was produced by an external tool (e.g. a
   * raw `graph export` payload) and never carried a generation.
   */
  baselineAnalysisGeneration?: number;
  addedNodes: WorkspaceDependencyDiffNode[];
  removedNodes: WorkspaceDependencyDiffNode[];
  addedEdges: WorkspaceDependencyDiffEdge[];
  removedEdges: WorkspaceDependencyDiffEdge[];
  newCycles: string[][];
  removedCycles: string[][];
};

export type WorkspaceArchitectureSummaryHotspot = {
  uri: string;
  workspaceRelativePath: string;
  importerCount: number;
  importeeCount: number;
};

export type WorkspaceArchitectureSummaryResult = {
  summary: string;
  indexedFileCount: number;
  symbolCount: number;
  scopeCount: number;
  relationCount: number;
  entryPointCount: number;
  cycleCount: number;
  hotspots: WorkspaceArchitectureSummaryHotspot[];
};

export type WorkspaceApplyFailureReason =
  | 'plan_not_found'
  | 'stale_document_version'
  | 'unsupported_uri';

export type WorkspaceApplyResult = {
  applied: boolean;
  failureReason?: WorkspaceApplyFailureReason;
  plan?: WorkspaceEditPlan;
};

export type WorkspaceFeatureReadiness =
  | 'cold'
  | 'warming'
  | 'ready'
  | 'degraded'
  | 'error';

export type WorkspaceFeatureStatus = {
  readiness: WorkspaceFeatureReadiness;
  detail?: string;
};

export type IndexStatusFeatureStatus = {
  diagnostics: WorkspaceFeatureStatus;
  codeActions: WorkspaceFeatureStatus;
  editPlans: WorkspaceFeatureStatus;
  workspaceIndex: WorkspaceFeatureStatus;
  workspaceSymbols: WorkspaceFeatureStatus;
  semanticSearch: WorkspaceFeatureStatus;
  dependencyGraph: WorkspaceFeatureStatus;
  architectureSummary: WorkspaceFeatureStatus;
};

export type IndexStatusResult = {
  daemonSessionId?: DaemonSessionId;
  workspaceId: string;
  workspaceInstanceId: WorkspaceInstanceId;
  status: 'cold' | 'warming' | 'ready' | 'error';
  replayState?: 'pending' | 'applied';
  replayEpoch?: number;
  workspaceReady?: boolean;
  featureStatus?: IndexStatusFeatureStatus;
  indexedFileCount: number;
  openDocumentCount: number;
  overlayCount: number;
  analysisGeneration: number;
  lastError?: string;
};

function diagnosticSeverityFromLintSeverity(
  severity?: LintSeverity,
): WorkspaceDiagnosticSeverity {
  if (severity === 'warn') {
    return 'warning';
  }
  return 'error';
}

function positionFromByteOffset(source: string, byteOffset: number): WorkspacePosition {
  const prefix = Buffer.from(source, 'utf8').subarray(0, byteOffset).toString('utf8');
  const parts = prefix.split('\n');
  return {
    line: parts.length - 1,
    character: parts[parts.length - 1]?.length ?? 0,
  };
}

function relatedLocationMap(
  relatedLocations: PolicyDiagnosticLocation[] | undefined,
): WorkspaceDiagnosticRelatedLocation[] | undefined {
  if (!relatedLocations || relatedLocations.length === 0) {
    return undefined;
  }

  return relatedLocations.map((location) => ({
    uri: workspacePathToUri(location.filePath),
    range: workspaceRangeFromLineColumns(
      location.line,
      location.column,
      location.endLine,
      location.endColumn,
    ),
    message: location.message,
  }));
}

export function workspacePathToUri(filePath: string): string {
  return pathToFileURL(filePath).href;
}

export function workspaceUriToPath(uri: string): string {
  const parsed = new URL(uri);
  if (parsed.protocol !== 'file:') {
    throw new Error(`Unsupported workspace URI scheme: ${parsed.protocol}`);
  }
  return fileURLToPath(parsed);
}

export function workspaceIdCreate(rootPath: string, configPath: string): string {
  return createHash('sha256')
    .update(rootPath)
    .update('\0')
    .update(configPath)
    .digest('hex')
    .slice(0, 16);
}

export function workspaceRangeFromLineColumns(
  line: number,
  column: number,
  endLine?: number,
  endColumn?: number,
): WorkspaceRange {
  return {
    start: {
      line: Math.max(0, line - 1),
      character: Math.max(0, column - 1),
    },
    end: {
      line: Math.max(0, (endLine ?? line) - 1),
      character: Math.max(0, (endColumn ?? column) - 1),
    },
  };
}

export function workspaceRangeFromByteRange(
  source: string,
  byteRange: ByteRange,
): WorkspaceRange {
  return {
    start: positionFromByteOffset(source, byteRange.start),
    end: positionFromByteOffset(source, byteRange.end),
  };
}

export function policyViolationToWorkspaceDiagnostic(
  violation: PolicyViolation,
  options: {
    idSeed?: string;
    severity?: WorkspaceDiagnosticSeverity;
    source?: string;
  } = {},
): WorkspaceDiagnostic {
  const severity = options.severity ?? 'error';
  const source = options.source ?? 'codepol';
  const idSeed =
    options.idSeed ??
    `${violation.filePath}:${violation.ruleId}:${violation.line}:${violation.column}:${violation.message}`;

  return {
    id: createHash('sha256').update(idSeed).digest('hex').slice(0, 16),
    uri: workspacePathToUri(violation.filePath),
    source,
    code: violation.ruleId,
    severity,
    message: violation.message,
    range: workspaceRangeFromLineColumns(
      violation.line,
      violation.column,
      violation.endLine,
      violation.endColumn,
    ),
    relatedLocations: relatedLocationMap(violation.relatedLocations),
  };
}

export function lintDiagnosticToWorkspaceDiagnostic(
  diagnostic: LintDiagnostic,
  filePath: string,
  options: {
    idSeed?: string;
    source?: string;
    severity?: LintSeverity;
  } = {},
): WorkspaceDiagnostic {
  const severity = options.severity
    ? diagnosticSeverityFromLintSeverity(options.severity)
    : diagnostic.severity;
  const source = options.source ?? 'codepol';
  const idSeed =
    options.idSeed ??
    `${filePath}:${diagnostic.ruleId}:${diagnostic.line}:${diagnostic.column}:${diagnostic.message}`;

  return {
    id: createHash('sha256').update(idSeed).digest('hex').slice(0, 16),
    uri: workspacePathToUri(filePath),
    source,
    code: diagnostic.ruleId,
    severity,
    message: diagnostic.message,
    range: workspaceRangeFromLineColumns(
      diagnostic.line,
      diagnostic.column,
      diagnostic.endLine,
      diagnostic.endColumn,
    ),
    relatedLocations: relatedLocationMap(diagnostic.relatedLocations),
  };
}
