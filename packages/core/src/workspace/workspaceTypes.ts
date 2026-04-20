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

/**
 * Language-agnostic symbol kind exposed by the symbol-id discovery
 * surface. Mirrors the core `SymbolKind` one-for-one so the workspace
 * surface does not have to translate between them.
 *
 * Kept as a string-literal union (rather than re-exporting `SymbolKind`
 * directly) so the workspace contract has no compile-time dependency on
 * the core index types.
 */
export type WorkspaceSymbolDescriptorKind =
  | 'module'
  | 'namespace'
  | 'class'
  | 'interface'
  | 'type'
  | 'function'
  | 'method'
  | 'variable'
  | 'const'
  | 'field'
  | 'parameter'
  | 'enum'
  | 'enumMember';

/**
 * Stable, language-agnostic descriptor for a single symbol declaration.
 *
 * The shape matches the additive symbol fields on
 * {@link WorkspaceDependencyGraphNode} so a descriptor flows straight
 * into `queryCallGraph` / `queryTypeHierarchy` (via {@link symbolId})
 * without translation, and so editor surfaces can render the
 * declaration location without re-resolving the symbol.
 */
export type WorkspaceSymbolDescriptor = {
  /** Stable opaque symbol id from the underlying index. */
  symbolId: string;
  /** Declared name (local, not qualified). Empty for anonymous symbols. */
  name: string;
  /** Language-agnostic kind. */
  kind: WorkspaceSymbolDescriptorKind;
  /** `file://` URI of the file that declares the symbol. */
  declarationUri: string;
  /** Range of the symbol declaration in {@link declarationUri}. */
  declarationRange: WorkspaceRange;
};

/**
 * Result type for `querySymbolLookup`. Always returns an array (never
 * `undefined`); empty when no symbols matched the filter.
 */
export type WorkspaceSymbolLookupResult = {
  symbols: WorkspaceSymbolDescriptor[];
};

/**
 * Result type for `querySymbolAtPosition`. The descriptor is
 * `undefined` when the position does not fall inside any indexed
 * symbol declaration in the requested file (e.g. cursor on whitespace,
 * on a comment, on an unindexed file, or outside any declaration).
 */
export type WorkspaceSymbolAtPositionResult = {
  symbol?: WorkspaceSymbolDescriptor;
};

/**
 * Per-symbol structural caller/callee counts for one function or
 * method. Used by `querySymbolsInFileWithCallCounts` to power the
 * editor's per-symbol CodeLens with one batched round-trip per file
 * instead of one round-trip per symbol.
 *
 * Counts come from the structural call graph
 * (`ProjectIndex.callersGet` / `calleesGet`) — they upgrade silently
 * when a `TypeAwareCallGraphSource` binding is wired, but this
 * surface does NOT take a `requireTypeAware` flag. Editor CodeLenses
 * never want to fail on missing type-aware data; they want the best
 * available count.
 */
export type WorkspaceSymbolWithCallCounts = {
  /** Stable descriptor for the function / method declaration. */
  symbol: WorkspaceSymbolDescriptor;
  /** Number of distinct caller symbols (structural). */
  callerCount: number;
  /** Number of distinct callee symbols (structural). */
  calleeCount: number;
};

/**
 * Result type for `querySymbolsInFileWithCallCounts`. Always returns
 * an array (never `undefined`); empty when the file has no indexed
 * function/method declarations.
 *
 * Sort order is `(symbol.declarationRange.start.line,
 * symbol.declarationRange.start.character, symbol.symbolId)` so two
 * runs over byte-identical input produce byte-identical output. The
 * editor consumes the order directly when laying out CodeLenses.
 */
export type WorkspaceSymbolsInFileWithCallCountsResult = {
  items: WorkspaceSymbolWithCallCounts[];
};

/**
 * Per-symbol importer enumeration. Powers the per-export CodeLens
 * (Phase 5 follow-up) — anchored above each top-level `export`
 * declaration to show "N importers" of THAT symbol specifically, as
 * opposed to file-level importer count.
 *
 * The input symbol id is normalized through the index's
 * `symbolCanonicalIdGet`, so callers may pass either the canonical
 * declaration id or a local re-export proxy id without affecting the
 * answer; the response always echoes the canonical id back so callers
 * can cache by stable key.
 *
 * Importer URIs are sorted lexicographically and deduplicated per file.
 */
export type WorkspaceSymbolImporterCountResult = {
  /**
   * Canonical declaration id corresponding to the input. Echoed so
   * callers that fed in a proxy id can rebuild their cache against
   * the canonical id.
   */
  symbolId: string;
  /** Number of distinct files that import this symbol. */
  importerCount: number;
  /**
   * Distinct importer file URIs (`file://` scheme), sorted
   * lexicographically.
   */
  importerUris: string[];
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
   * Newline-terminated line count of the file as it appears in the active
   * overlay (or on disk if no overlay). Omitted when source cannot be
   * read.
   */
  loc?: number;
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
  /**
   * Stable identifier of the symbol this node represents, when the node
   * comes from a symbol-level graph (`queryCallGraph`,
   * `queryTypeHierarchy`). Absent for file-level graph nodes.
   *
   * When `symbolId` is set, `uri` carries a synthetic identifier of the
   * form `codepol-symbol://<symbolId>` so the panel can use `uri` as a
   * unique key the same way it does for file-level nodes.
   */
  symbolId?: string;
  /**
   * Display name of the symbol when {@link symbolId} is set. Empty
   * string when the symbol has no name (anonymous functions).
   */
  symbolName?: string;
  /**
   * Language-agnostic kind of the symbol when {@link symbolId} is set
   * (e.g. `function`, `method`, `class`, `interface`). Mirrors
   * `SymbolKind` from `@codepol/core`.
   */
  symbolKind?: string;
  /**
   * `file://` URI of the file that declares the symbol. Lets clients
   * jump to the declaration without re-resolving the symbol id.
   */
  declarationUri?: string;
  /**
   * Range of the symbol declaration in the declaration file. Optional;
   * populated only when computing the range is cheap (the workspace
   * service has the source text on hand).
   */
  declarationRange?: WorkspaceRange;
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

/**
 * Confidence tier of a call-graph edge produced by `queryCallGraph`.
 *
 * - `'structural'`: derived from the tree-sitter index (direct,
 *   name-resolved invocation). The default — absent ⇒ `'structural'`.
 * - `'type-aware'`: confirmed (or contributed) by a registered
 *   {@link TypeAwareCallGraphSource}, typically a host-supplied
 *   binding around a language server. Authoritative when present.
 *
 * The tier never demotes a structural edge: when a structural edge
 * exists but the type-aware source did not return it, the edge stays
 * `'structural'` rather than being silently dropped.
 *
 * The field name is intentionally distinct from
 * {@link WorkspaceCallGraphEdgeKind} — it sits next to it on
 * `WorkspaceDependencyGraphEdge` so the two axes (confidence / kind)
 * stay orthogonal.
 */
export type WorkspaceCallGraphEdgeConfidence = 'structural' | 'type-aware';

/**
 * Kind of call expressed by a call-graph edge produced by
 * `queryCallGraph`.
 *
 * - `'direct'`: a named callee resolved at the call site. The default —
 *   absent ⇒ `'direct'`. All structural edges always carry `'direct'`
 *   because the structural index can only see direct invocations.
 * - `'dynamic-dispatch'`: a method call where the receiver type admits
 *   multiple implementations (interface- or union-typed receiver).
 *   Reported only by type-aware sources.
 * - `'higher-order'`: a call site where the callee is an argument or
 *   computed value rather than a named symbol. Reported only by
 *   type-aware sources.
 */
export type WorkspaceCallGraphEdgeKind =
  | 'direct'
  | 'dynamic-dispatch'
  | 'higher-order';

/**
 * Confidence tier of a type-hierarchy edge produced by
 * `queryTypeHierarchy` (Phase 9.4 / 9.5 / Gap 3).
 *
 * - `'declared'`: derived from a source-level `extends` / `implements`
 *   clause. The default — absent ⇒ `'declared'`.
 * - `'structural-shape'`: produced by the cross-file member-shape
 *   comparison pass. Opt-in via `includeStructural: true` —
 *   never emitted when the caller leaves `includeStructural` at its
 *   default `false`. Always represents an `implements` edge.
 * - `'type-aware'`: produced (or confirmed) by a registered
 *   {@link TypeAwareTypeHierarchySource} — typically a host-supplied
 *   binding around a language server. Authoritative when present and
 *   overrides shape matches on overlap.
 *
 * The field name is intentionally distinct from
 * {@link WorkspaceCallGraphEdgeConfidence} so type-hierarchy edges
 * and call-graph edges never collide on the same property of
 * {@link WorkspaceDependencyGraphEdge}.
 */
export type WorkspaceTypeHierarchyEdgeConfidence =
  | 'declared'
  | 'structural-shape'
  | 'type-aware';

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
  /**
   * For symbol-level call-graph edges (from `queryCallGraph`):
   * confidence tier. Absent ⇒ `'structural'`. Set only when a
   * type-aware source contributed to or confirmed the edge.
   */
  callGraphConfidence?: WorkspaceCallGraphEdgeConfidence;
  /**
   * For symbol-level call-graph edges (from `queryCallGraph`): the
   * kind of call. Absent ⇒ `'direct'`. Set when a type-aware source
   * classified the call as `'dynamic-dispatch'` or `'higher-order'`.
   */
  callGraphKind?: WorkspaceCallGraphEdgeKind;
  /**
   * For symbol-level type-hierarchy edges (from `queryTypeHierarchy`):
   * confidence tier. Absent ⇒ `'declared'`. Set to `'structural-shape'`
   * when the edge came from the Phase 9.4 cross-file member-shape
   * comparison, or to `'type-aware'` when a
   * {@link TypeAwareTypeHierarchySource} contributed to or confirmed
   * the edge (Phase 9.5).
   *
   * Distinct from {@link callGraphConfidence} — type-hierarchy and
   * call-graph confidence never collide on the same edge.
   */
  typeRelationConfidence?: WorkspaceTypeHierarchyEdgeConfidence;
};

export type WorkspaceDependencyGraphResult = {
  nodes: WorkspaceDependencyGraphNode[];
  edges: WorkspaceDependencyGraphEdge[];
  entryPoints: string[];
  cycles: string[][];
};

/**
 * One in-file import specifier, narrowed to the data the editor needs
 * to anchor a Codepol-owned hover marker on the import range.
 *
 * Only emitted for imports whose target resolves to an indexed file in
 * the same workspace — external / unresolved specifiers are dropped at
 * the workspace-service layer because the per-file metric (importer /
 * importee counts, cross-layer / cross-package boundary) is meaningful
 * only for in-workspace targets.
 *
 * Multiple `ImportBindingRelation` entries that share the same import
 * statement byte range collapse to one descriptor; the count is
 * exposed as {@link bindingCount}. Pure side-effect imports
 * (`import "./polyfill"`) have `bindingCount: 0` and `edgeKind:
 * 'side_effect'`.
 */
export type WorkspaceImportSpecifierDescriptor = {
  /** Range of the import statement in the importer file. */
  range: WorkspaceRange;
  /** `file://` URI of the resolved imported module. */
  resolvedModuleUri: string;
  /**
   * Workspace-relative path of the resolved module. Provided so the
   * hover card can render a friendly label without re-resolving.
   */
  resolvedModuleWorkspaceRelativePath: string;
  /**
   * Dominant syntactic style of the import. Mirrors
   * {@link WorkspaceDependencyGraphEdgeKind} one-for-one so the hover
   * card can reuse the same kind labels as the dependency-graph view.
   */
  edgeKind: WorkspaceDependencyGraphEdgeKind;
  /**
   * Number of distinct `ImportBindingRelation` entries that contributed
   * to this descriptor. Zero for pure side-effect imports.
   */
  bindingCount: number;
  /**
   * True when the importer and importee belong to different monorepo
   * packages. Absent when package membership cannot be determined for
   * either endpoint.
   */
  crossesPackageBoundary?: boolean;
  /**
   * True when the importer and importee belong to different
   * architectural layers. Absent until layer configuration is wired up,
   * or when layer membership cannot be determined for either endpoint.
   */
  crossesLayerBoundary?: boolean;
};

/**
 * Result type for `queryImportSpecifiersInFile`. Always returns an
 * array (never `undefined`); empty when the file has no
 * workspace-resolved imports.
 *
 * Sort order is `(range.start.line, range.start.character)` so two
 * runs over byte-identical input produce byte-identical output. The
 * marker layer consumes the order directly when laying out
 * decorations.
 */
export type WorkspaceImportSpecifiersInFileResult = {
  specifiers: WorkspaceImportSpecifierDescriptor[];
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

/**
 * Direction of a call-graph traversal. Mirrors
 * `SymbolCallGraphDirection` from `@codepol/core` one-for-one so clients
 * that speak the workspace contract can pass the string straight
 * through.
 *
 * - `callers`: walk reverse edges (who calls the focus symbol,
 *   transitively) — "what triggers this code path?"
 * - `callees`: walk forward edges (what the focus symbol calls,
 *   transitively) — "what does this function do, structurally?"
 * - `both`: union of callers and callees starting at the focus.
 */
export type WorkspaceCallGraphDirection = 'callers' | 'callees' | 'both';

/**
 * Direction of a type-hierarchy traversal. Mirrors
 * `SymbolTypeHierarchyDirection` from `@codepol/core` one-for-one.
 *
 * - `supertypes`: walk forward edges (what the focus symbol extends /
 *   implements, transitively) — "what contracts does this satisfy?"
 * - `subtypes`: walk reverse edges (what extends / implements the focus
 *   symbol, transitively) — "who must change if I change this contract?"
 * - `both`: union of supertypes and subtypes starting at the focus.
 */
export type WorkspaceTypeHierarchyDirection =
  | 'supertypes'
  | 'subtypes'
  | 'both';

// ============================================================================
// Symbol-flow surface (Phase 9.1 / Gap 1)
// ============================================================================

/**
 * Direction of a {@link WorkspaceSymbolFlowResult} query.
 *
 * - `outgoing`: list flow sites where the focus symbol *flows out* —
 *   appears as an argument value somewhere in the codebase. Answers
 *   "where is this function passed as a callback?".
 * - `incoming`: list flow sites that flow *into* the focus symbol —
 *   functions passed as arguments to a call whose receiver resolves to
 *   the focus symbol. Answers "what callbacks does this function
 *   accept?".
 */
export type WorkspaceSymbolFlowDirection = 'outgoing' | 'incoming';

/**
 * One "function-as-argument" flow edge surfaced to the workspace API.
 *
 * Distinct from {@link WorkspaceDependencyGraphEdge}: a flow is *not* a
 * call-graph edge. The two are intentionally separate to keep the
 * structural call graph honest about what the source code actually
 * expresses (see Phase 9.1 design notes).
 *
 * MVP only emits `flowKind: 'argument'`. Future extensions
 * (`return`, `assignment`, `storage`) will appear here as additional
 * literals once the extractor supports them.
 */
export type WorkspaceSymbolFlowEdge = {
  /** Stable id of the function/method symbol flowing through the source. */
  flowingSymbolId: string;
  /** Declaration URI of the flowing symbol. */
  flowingSymbolUri: string;
  /**
   * Stable id of the function whose body contains the flow site, when
   * the owning scope can be resolved to a function/method symbol.
   * Absent for top-level flow sites (e.g., a callback registered at
   * module scope).
   */
  ownerSymbolId?: string;
  /** Declaration URI of {@link ownerSymbolId}, when present. */
  ownerSymbolUri?: string;
  /** Workspace-relative path of the flow site. */
  file: string;
  /** Range of the flow site in the file. */
  range: WorkspaceRange;
  /** How the symbol flows. MVP emits only `'argument'`. */
  flowKind: 'argument';
  /**
   * When the receiving call resolved to a known symbol, the function
   * the value is passed to. Absent when the receiver is unresolved.
   */
  receivingCallSymbolId?: string;
  /** 0-based argument index. */
  argumentIndex?: number;
};

/**
 * Result type for `querySymbolFlow`. Always returns an array (never
 * `undefined`); empty when the symbol does not appear in any flow site
 * for the requested direction.
 *
 * Sorted by `(file, range.start, argumentIndex)` for byte-identical
 * output across runs.
 */
export type WorkspaceSymbolFlowResult = {
  edges: WorkspaceSymbolFlowEdge[];
};

export type WorkspaceArchitectureSummaryHotspot = {
  uri: string;
  workspaceRelativePath: string;
  importerCount: number;
  importeeCount: number;
};

/**
 * Robert Martin's instability metric (`I = Ce / (Ca + Ce)`) projected
 * onto a single file. `value` is in `[0, 1]` and is rounded to 6
 * fractional digits so JSON output stays byte-stable across runtimes.
 *
 * Files with `Ca + Ce === 0` (no incoming and no outgoing import edges)
 * are omitted from {@link WorkspaceArchitectureSummaryInstability.values}
 * because instability is undefined for an isolated node.
 */
export type WorkspaceArchitectureSummaryInstability = {
  uri: string;
  workspaceRelativePath: string;
  value: number;
  importerCount: number;
  importeeCount: number;
};

/**
 * Files that combine high fan-in with high internal cyclomatic
 * complexity — "the most dangerous things to change". `score` is
 * `aggregateCyclomaticComplexity * importerCount` and is the field used
 * for ranking; both contributing values are echoed back so callers can
 * label hotspots without recomputing.
 */
export type WorkspaceArchitectureSummaryComplexityHotspot = {
  uri: string;
  workspaceRelativePath: string;
  aggregateCyclomaticComplexity: number;
  importerCount: number;
  score: number;
};

/**
 * Longest acyclic dependency chain in the workspace, computed over the
 * SCC condensation of the module graph (each cycle collapses to one
 * representative file). `length` is the number of import hops
 * (`uriPath.length - 1`); both `uriPath` and `workspaceRelativePathPath`
 * are non-empty when the graph is non-empty.
 */
export type WorkspaceArchitectureSummaryLongestChain = {
  length: number;
  uriPath: string[];
  workspaceRelativePathPath: string[];
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
  /**
   * Top-N (default 10) most unstable files, sorted by
   * `(value desc, workspaceRelativePath asc)`. Omitted when no file in
   * the workspace participates in any import edge.
   */
  instability?: WorkspaceArchitectureSummaryInstability[];
  /**
   * Longest dependency chain over the SCC-condensed module graph.
   * Omitted when the workspace has no indexed files.
   */
  longestChain?: WorkspaceArchitectureSummaryLongestChain;
  /**
   * Histogram of cycle sizes. Keys are SCC sizes (number of files in the
   * cycle, always >= 2), values are the number of cycles of that size.
   * Omitted when the workspace has no cycles.
   */
  sccSizeDistribution?: Record<number, number>;
  /**
   * Top-N (default 5) files that combine fan-in with internal
   * cyclomatic complexity. Sorted by
   * `(score desc, importerCount desc, aggregateCyclomaticComplexity desc, workspaceRelativePath asc)`.
   * Omitted when no file in the workspace exposes a cyclomatic
   * complexity number (typical for non-TS/JS-only workspaces or
   * workspaces with no fan-in).
   */
  complexityHotspots?: WorkspaceArchitectureSummaryComplexityHotspot[];
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

/**
 * Convert a {@link WorkspacePosition} (UTF-16 line/character, LSP
 * convention) to a UTF-8 byte offset into {@link source}.
 *
 * Symbols emitted by the index carry byte offsets ({@link ByteRange}),
 * but editor positions arrive in LSP coordinates. This helper bridges
 * the two so range-containment checks (`querySymbolAtPosition`) can
 * compare like with like.
 *
 * Out-of-range inputs clamp to the nearest valid offset (line beyond
 * EOF returns the source byte length; character beyond EOL returns the
 * line's terminating offset). Returning a clamped offset rather than
 * throwing keeps the call site (a containment check) simple — a
 * clamped offset never lies inside any byte range, so the predicate
 * naturally returns "no match".
 */
export function workspacePositionToByteOffset(
  source: string,
  position: WorkspacePosition,
): number {
  const buffer = Buffer.from(source, 'utf8');
  if (position.line <= 0 && position.character <= 0) {
    return 0;
  }
  let lineIndex = 0;
  let byteOffset = 0;
  while (lineIndex < position.line && byteOffset < buffer.length) {
    const newlineIndex = buffer.indexOf(0x0a, byteOffset);
    if (newlineIndex === -1) {
      return buffer.length;
    }
    byteOffset = newlineIndex + 1;
    lineIndex += 1;
  }
  if (position.character <= 0) {
    return byteOffset;
  }
  const lineEndIndex = buffer.indexOf(0x0a, byteOffset);
  const lineEnd = lineEndIndex === -1 ? buffer.length : lineEndIndex;
  const lineSlice = buffer.subarray(byteOffset, lineEnd).toString('utf8');
  if (position.character >= lineSlice.length) {
    return lineEnd;
  }
  const characterPrefix = lineSlice.slice(0, position.character);
  return byteOffset + Buffer.byteLength(characterPrefix, 'utf8');
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
