export const CODEPOL_EXTENSION_VIEW_CONTAINER_ID = 'codepol';
export const CODEPOL_EXTENSION_VIEW_CURRENT_CONTEXT_ID = 'codepol.currentContext';
export const CODEPOL_EXTENSION_VIEW_LINT_RULES_ID = 'codepol.lintRules';
export const CODEPOL_EXTENSION_VIEW_RENAME_TARGETS_ID = 'codepol.renameTargets';
export const CODEPOL_EXTENSION_CONTEXT_INDEX_BACKED_COMMANDS_ENABLED =
  'codepol.indexBackedCommandsEnabled';
export const CODEPOL_EXTENSION_CONTEXT_WORKSPACE_PACKAGE_RENAME_ENABLED =
  'codepol.workspacePackageRenameEnabled';

export const CODEPOL_EXTENSION_COMMAND_SHOW_SEMANTIC_DEFINITION =
  'codepol.extension.showSemanticDefinition';
export const CODEPOL_EXTENSION_COMMAND_SHOW_SEMANTIC_SEARCH =
  'codepol.extension.showSemanticSearch';
export const CODEPOL_EXTENSION_COMMAND_SHOW_ARCHITECTURE_SUMMARY =
  'codepol.extension.showArchitectureSummary';
export const CODEPOL_EXTENSION_COMMAND_SHOW_DEPENDENCY_GRAPH =
  'codepol.extension.showDependencyGraph';
export const CODEPOL_EXTENSION_COMMAND_SHOW_ARCHITECTURE_LINKS =
  'codepol.extension.showArchitectureLinks';
export const CODEPOL_EXTENSION_COMMAND_PEEK_ARCHITECTURE =
  'codepol.architecture.peek';
export const CODEPOL_EXTENSION_COMMAND_SHOW_ARCHITECTURE_CYCLE =
  'codepol.architecture.showCycle';
export const CODEPOL_EXTENSION_COMMAND_SHOW_CALL_GRAPH =
  'codepol.extension.showCallGraph';
export const CODEPOL_EXTENSION_COMMAND_SHOW_TYPE_HIERARCHY =
  'codepol.extension.showTypeHierarchy';
export const CODEPOL_EXTENSION_COMMAND_SHOW_DEPENDENCY_PATH =
  'codepol.extension.showDependencyPath';
export const CODEPOL_EXTENSION_COMMAND_SHOW_DEAD_MODULES =
  'codepol.extension.showDeadModules';
export const CODEPOL_EXTENSION_COMMAND_SHOW_DEPENDENCY_DIFF =
  'codepol.extension.showDependencyDiff';
export const CODEPOL_EXTENSION_COMMAND_FIND_CALLBACKS =
  'codepol.extension.findCallbacks';
export const CODEPOL_EXTENSION_COMMAND_PEEK_SIGNATURE_IMPACT =
  'codepol.extension.peekSignatureImpact';
export const CODEPOL_EXTENSION_COMMAND_RENAME_CODEPOL_ENTITY =
  'codepol.extension.renameCodepolEntity';
export const CODEPOL_EXTENSION_COMMAND_REFRESH_RENAME_TARGETS =
  'codepol.extension.refreshRenameTargets';
export const CODEPOL_EXTENSION_COMMAND_SHOW_LINT_RULE_DETAILS =
  'codepol.extension.showLintRuleDetails';
export const CODEPOL_EXTENSION_COMMAND_SHOW_LINT_RULE_DIAGNOSTIC_FIXES =
  'codepol.extension.showLintRuleDiagnosticFixes';
export const CODEPOL_EXTENSION_COMMAND_OPEN_LINT_RULE_LOCATION =
  'codepol.extension.openLintRuleLocation';
export const CODEPOL_EXTENSION_COMMAND_REFRESH_LINT_RULES =
  'codepol.extension.refreshLintRules';
export const CODEPOL_EXTENSION_COMMAND_SET_DIAGNOSTICS_ENVIRONMENT =
  'codepol.extension.setDiagnosticsEnvironment';
export const CODEPOL_EXTENSION_COMMAND_ADD_DIAGNOSTICS_ESCALATION =
  'codepol.extension.addDiagnosticsEscalation';
export const CODEPOL_EXTENSION_COMMAND_CLEAR_DIAGNOSTICS_ESCALATIONS =
  'codepol.extension.clearDiagnosticsEscalations';
export const CODEPOL_EXTENSION_COMMAND_SHOW_DIAGNOSTICS_CONFIG =
  'codepol.extension.showDiagnosticsConfig';
export const CODEPOL_EXTENSION_COMMAND_RESTART_DAEMON =
  'codepol.extension.restartDaemon';

export const CODEPOL_EXTENSION_PANEL_SEMANTIC_DEFINITION =
  'codepol.semanticDefinitionPanel';
export const CODEPOL_EXTENSION_PANEL_ARCHITECTURE_SUMMARY =
  'codepol.architectureSummaryPanel';
export const CODEPOL_EXTENSION_PANEL_DEPENDENCY_GRAPH =
  'codepol.dependencyGraphPanel';
export const CODEPOL_EXTENSION_PANEL_ARCHITECTURE_LINKS =
  'codepol.architectureLinksPanel';
export const CODEPOL_EXTENSION_PANEL_RENAME_PREVIEW =
  'codepol.renamePreviewPanel';
export const CODEPOL_EXTENSION_PANEL_LINT_RULE_DETAILS =
  'codepol.lintRuleDetailsPanel';
export const CODEPOL_EXTENSION_PANEL_CALL_GRAPH =
  'codepol.callGraphPanel';
export const CODEPOL_EXTENSION_PANEL_TYPE_HIERARCHY =
  'codepol.typeHierarchyPanel';
export const CODEPOL_EXTENSION_PANEL_DEPENDENCY_PATH =
  'codepol.dependencyPathPanel';
export const CODEPOL_EXTENSION_PANEL_DEAD_MODULES =
  'codepol.deadModulesPanel';
export const CODEPOL_EXTENSION_PANEL_DEPENDENCY_DIFF =
  'codepol.dependencyDiffPanel';

/**
 * Diagnostic source the Phase 6 PR-aware overlay publishes under.
 * Distinct from the upstream `codepol/architecture` source so users
 * can mute it independently in the editor's source filter, and so the
 * overlay never collides with the info-level cycle/dead-module
 * diagnostic the workspace service emits for the same files.
 */
export const CODEPOL_ARCHITECTURE_NEW_SINCE_BASELINE_DIAGNOSTIC_SOURCE =
  'codepol/architecture/new-since-baseline';

/**
 * Configuration key the Phase 6 PR-aware overlay reads to pick the
 * baseline snapshot label. Empty string disables the overlay.
 * Mirrors the `--baseline-label` flag on `codepol graph diff` so a
 * developer can preview the same diff locally that CI gates on.
 */
export const CODEPOL_CONFIG_ARCHITECTURE_BASELINE_LABEL =
  'codepol.architecture.baselineLabel';
