import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ByteRange } from '../index/indexTypes';
import type {
  LintDiagnostic,
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

export type WorkspaceEditPlan = {
  id: string;
  title: string;
  kind: 'quickfix';
  edits: WorkspaceEdit[];
  diagnosticIds: string[];
  isPreferred?: boolean;
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
