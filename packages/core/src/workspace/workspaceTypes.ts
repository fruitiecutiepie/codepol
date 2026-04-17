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

export type WorkspaceEditPlanKind = 'quickfix' | 'rename';

export type WorkspaceEditPlanIntent = 'quickfix' | 'rename';

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

export type WorkspaceCodeAction = {
  id: string;
  title: string;
  kind: 'quickfix';
  diagnosticIds: string[];
  plan: WorkspaceEditPlan;
  isPreferred?: boolean;
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

export type WorkspaceDependencyGraphNode = {
  uri: string;
  workspaceRelativePath: string;
};

export type WorkspaceDependencyGraphEdge = {
  fromUri: string;
  toUri: string;
};

export type WorkspaceDependencyGraphResult = {
  nodes: WorkspaceDependencyGraphNode[];
  edges: WorkspaceDependencyGraphEdge[];
  entryPoints: string[];
  cycles: string[][];
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
