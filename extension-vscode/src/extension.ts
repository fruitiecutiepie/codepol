import * as path from 'node:path';
import * as vscode from 'vscode';
import type {
  DiagnosticsConfigPatch,
  EnvironmentName,
  EscalationRuleInput,
  LogLevel,
  RuntimeDiagnosticsPolicy,
  WorkspaceLintRuleDetailsResult,
  WorkspaceLintRuleSummary,
  WorkspaceSearchResult,
} from '@codepol/core';
import { configFileDiscover, environmentNamesList } from '@codepol/core';
import { workspaceDaemonTerminateExternal } from '@codepol/workspace-service';
import {
  CodepolCommandController,
  type RenameCommandOptions,
  type SemanticSearchCommandOptions,
} from './commands';
import {
  CODEPOL_EXTENSION_COMMAND_ADD_DIAGNOSTICS_ESCALATION,
  CODEPOL_EXTENSION_COMMAND_CLEAR_DIAGNOSTICS_ESCALATIONS,
  CODEPOL_EXTENSION_COMMAND_FIND_CALLBACKS,
  CODEPOL_EXTENSION_COMMAND_PEEK_ARCHITECTURE,
  CODEPOL_EXTENSION_COMMAND_REFRESH_RENAME_TARGETS,
  CODEPOL_EXTENSION_COMMAND_REFRESH_LINT_RULES,
  CODEPOL_EXTENSION_COMMAND_OPEN_LINT_RULE_LOCATION,
  CODEPOL_EXTENSION_COMMAND_RENAME_CODEPOL_ENTITY,
  CODEPOL_EXTENSION_COMMAND_SET_DIAGNOSTICS_ENVIRONMENT,
  CODEPOL_EXTENSION_COMMAND_SHOW_DIAGNOSTICS_CONFIG,
  CODEPOL_EXTENSION_COMMAND_RESTART_DAEMON,
  CODEPOL_EXTENSION_COMMAND_SHOW_LINT_RULE_DIAGNOSTIC_FIXES,
  CODEPOL_EXTENSION_COMMAND_SHOW_ARCHITECTURE_SUMMARY,
  CODEPOL_EXTENSION_COMMAND_SHOW_ARCHITECTURE_LINKS,
  CODEPOL_EXTENSION_COMMAND_SHOW_CALL_GRAPH,
  CODEPOL_EXTENSION_COMMAND_SHOW_TYPE_HIERARCHY,
  CODEPOL_EXTENSION_COMMAND_SHOW_DEAD_MODULES,
  CODEPOL_EXTENSION_COMMAND_SHOW_DEPENDENCY_GRAPH,
  CODEPOL_EXTENSION_COMMAND_SHOW_DEPENDENCY_PATH,
  CODEPOL_EXTENSION_COMMAND_SHOW_LINT_RULE_DETAILS,
  CODEPOL_EXTENSION_COMMAND_SHOW_SEMANTIC_DEFINITION,
  CODEPOL_EXTENSION_COMMAND_SHOW_SEMANTIC_SEARCH,
  CODEPOL_EXTENSION_VIEW_CONTAINER_ID,
  CODEPOL_EXTENSION_VIEW_CURRENT_CONTEXT_ID,
  CODEPOL_EXTENSION_VIEW_LINT_RULES_ID,
  CODEPOL_EXTENSION_VIEW_RENAME_TARGETS_ID,
} from './constants';
import { CodepolArchitectureCodeLensProvider } from './codeLensProvider';
import { CodepolArchitectureHoverProvider } from './architectureHoverProvider';
import { CodepolImportSpecifierHoverProvider } from './importSpecifierHoverProvider';
import { ImportSpecifierMarkerController } from './importSpecifierMarkerController';
import { CodepolSymbolCodeLensProvider } from './symbolCodeLensProvider';
import { CodepolTypeHierarchyCodeLensProvider } from './typeHierarchyCodeLensProvider';
import {
  renameTargetCandidatesDiscover,
  type RenameTargetCandidate,
} from './discovery';
import { CodepolPanelManager } from './panels/manager';
import {
  VscodeLanguageClientProtocol,
  type CodepolProtocolClient,
} from './protocolClient';
import { CodepolSidebarViewProvider } from './sidebarView';
import {
  semanticSearchInitialQueryResolve,
  semanticSearchQuickPickItemsCreate,
} from './semanticSearch';
import { codepolStatusBarPresentationCreate } from './readiness';
import { codepolRequestSupersededErrorIs } from './readiness';
import { CodepolReadinessController } from './readinessController';
import {
  LintRulesTreeProvider,
  RenameTargetsTreeProvider,
} from './treeProviders';

let protocolClient: CodepolProtocolClient | undefined;
let sidebarProvider: CodepolSidebarViewProvider | undefined;

function statusBarApply(
  item: vscode.StatusBarItem,
  presentation: ReturnType<typeof codepolStatusBarPresentationCreate>,
): void {
  item.text = presentation.text;
  item.tooltip = presentation.tooltip;
  item.backgroundColor =
    presentation.tone === 'warning'
      ? new vscode.ThemeColor('statusBarItem.warningBackground')
      : presentation.tone === 'error'
        ? new vscode.ThemeColor('statusBarItem.errorBackground')
        : undefined;
}

function workspaceRootPathGet(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function activeEditorUriGet(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== 'file') {
    return undefined;
  }
  return editor.document.uri.toString();
}

function activeEditorPositionGet():
  | { line: number; character: number }
  | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== 'file') {
    return undefined;
  }
  const position = editor.selection.active;
  return { line: position.line, character: position.character };
}

/**
 * Resolve a workspace-relative path produced by the workspace
 * service (`WorkspaceSymbolFlowEdge.file`) to an absolute `vscode.Uri`
 * by joining against the active workspace folder. Returns `undefined`
 * when no folder is open — the caller should fall back to a parse
 * attempt against the raw URI string.
 */
function workspaceRelativePathToUri(file: string): vscode.Uri | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return undefined;
  return vscode.Uri.joinPath(folder.uri, file);
}

async function flowSitePeekShow(input: {
  sourceUri: string;
  sourcePosition: { line: number; character: number };
  locations: Array<{ uri: string; line: number; character: number }>;
}): Promise<void> {
  const sourceVscodeUri = vscode.Uri.parse(input.sourceUri);
  const sourcePosition = new vscode.Position(
    input.sourcePosition.line,
    input.sourcePosition.character,
  );
  const targets: vscode.Location[] = input.locations.map((loc) => {
    let uri: vscode.Uri;
    try {
      uri = vscode.Uri.parse(loc.uri);
    } catch {
      const fromWorkspace = workspaceRelativePathToUri(loc.uri);
      uri = fromWorkspace ?? vscode.Uri.file(loc.uri);
    }
    if (uri.scheme === '' || uri.scheme === 'untitled') {
      const fromWorkspace = workspaceRelativePathToUri(loc.uri);
      if (fromWorkspace) uri = fromWorkspace;
    }
    return new vscode.Location(
      uri,
      new vscode.Position(loc.line, loc.character),
    );
  });
  await vscode.commands.executeCommand(
    'editor.action.peekLocations',
    sourceVscodeUri,
    sourcePosition,
    targets,
    'peek',
  );
}

const DIAGNOSTICS_LOG_LEVELS: readonly LogLevel[] = [
  'error',
  'warn',
  'info',
  'debug',
  'trace',
];

function diagnosticsLogLevelIsValid(value: string): value is LogLevel {
  return (DIAGNOSTICS_LOG_LEVELS as readonly string[]).includes(value);
}

type DiagnosticsEscalationSetting = {
  scope: string;
  level: string;
  ttlSec: number;
  reason?: string;
};

function diagnosticsEnvironmentFromSetting(raw: string | undefined): EnvironmentName {
  if (!raw) return 'user';
  const lowered = raw.trim().toLowerCase();
  if (lowered === 'user' || lowered === 'dev' || lowered === 'test' || lowered === 'verbose') {
    return lowered;
  }
  return 'user';
}

function diagnosticsPatchFromSettings(): DiagnosticsConfigPatch {
  const cfg = vscode.workspace.getConfiguration('codepol.diagnostics');
  const environment = diagnosticsEnvironmentFromSetting(cfg.get<string>('environment'));
  const overridesRaw = cfg.get<Partial<RuntimeDiagnosticsPolicy>>('overrides') ?? {};
  const patch: DiagnosticsConfigPatch = { environment };
  if (Object.keys(overridesRaw).length > 0) {
    patch.overrides = overridesRaw;
  }
  return patch;
}

function escalationInputsFromSettings(
  actor: string,
): EscalationRuleInput[] {
  const cfg = vscode.workspace.getConfiguration('codepol.diagnostics');
  const raw = cfg.get<DiagnosticsEscalationSetting[]>('escalations') ?? [];
  const out: EscalationRuleInput[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    if (typeof entry.scope !== 'string' || entry.scope.length === 0) continue;
    if (typeof entry.level !== 'string' || !diagnosticsLogLevelIsValid(entry.level)) continue;
    if (typeof entry.ttlSec !== 'number' || entry.ttlSec <= 0) continue;
    out.push({
      scope: escalationScopeParse(entry.scope),
      level: entry.level,
      ttlMs: Math.floor(entry.ttlSec * 1000),
      reason: typeof entry.reason === 'string' && entry.reason.length > 0
        ? entry.reason
        : 'vscode_setting_escalation',
      actor,
    });
  }
  return out;
}

function escalationScopeParse(raw: string): EscalationRuleInput['scope'] {
  if (raw === 'global') return { kind: 'global' };
  if (raw.startsWith('scope:')) return { kind: 'scope', scope: raw.slice('scope:'.length) };
  if (raw.startsWith('request:')) return { kind: 'request', requestId: raw.slice('request:'.length) };
  if (raw.startsWith('workspace:')) return { kind: 'workspace', workspaceId: raw.slice('workspace:'.length) };
  return { kind: 'scope', scope: raw };
}

async function diagnosticsConfigApply(
  protocol: CodepolProtocolClient,
  patch: DiagnosticsConfigPatch,
): Promise<void> {
  try {
    await protocol.configureDiagnostics(patch);
  } catch (err) {
    void vscode.window.showErrorMessage(
      `Codepol: failed to apply diagnostics config: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

async function diagnosticsEscalationsApply(
  protocol: CodepolProtocolClient,
  escalations: readonly EscalationRuleInput[],
): Promise<void> {
  for (const rule of escalations) {
    try {
      await protocol.escalateDiagnostics(rule);
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Codepol: failed to apply diagnostics escalation: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

function activeEditorLocationGet():
  | {
      uri: string;
      line: number;
      character: number;
    }
  | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== 'file') {
    return undefined;
  }

  return {
    uri: editor.document.uri.toString(),
    line: editor.selection.active.line,
    character: editor.selection.active.character,
  };
}

type SemanticSearchQuickPickItem = vscode.QuickPickItem & {
  result?: WorkspaceSearchResult;
};

async function locationOpen(input: {
  uri: string;
  line: number;
  character: number;
}): Promise<void> {
  const uri = vscode.Uri.parse(input.uri);
  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(document, {
    preview: false,
    viewColumn: vscode.ViewColumn.Active,
  });
  const position = new vscode.Position(input.line, input.character);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position));
  void sidebarProvider?.recordLocationVisit({
    uri: input.uri,
    line: input.line,
    character: input.character,
    sourceLabel: 'Opened',
  });
}

function renameTargetsLoad(): Promise<RenameTargetCandidate[]> {
  const rootPath = workspaceRootPathGet();
  if (!rootPath) {
    return Promise.resolve([]);
  }
  return Promise.resolve(renameTargetCandidatesDiscover(rootPath));
}

async function lintRulesLoad(
  protocol: CodepolProtocolClient,
): Promise<WorkspaceLintRuleSummary[]> {
  const result = await protocol.queryLintRules();
  return result?.rules ?? [];
}

async function lintRuleDetailsLoad(
  protocol: CodepolProtocolClient,
  ruleId: string,
): Promise<WorkspaceLintRuleDetailsResult | null> {
  return protocol.queryLintRuleDetails(ruleId);
}

async function renameTargetPick(
  candidates: RenameTargetCandidate[],
): Promise<RenameTargetCandidate | undefined> {
  const workspacePackages = candidates.filter(
    (candidate) => candidate.kind === 'workspace_package',
  );
  const configTargets = candidates.filter(
    (candidate) => candidate.kind === 'config_target',
  );
  const items: Array<vscode.QuickPickItem & { candidate?: RenameTargetCandidate }> = [];

  if (workspacePackages.length > 0) {
    items.push({
      kind: vscode.QuickPickItemKind.Separator,
      label: 'Workspace Packages',
    });
    for (const candidate of workspacePackages) {
      items.push({
        label: candidate.label,
        description: candidate.description,
        detail: candidate.detail,
        candidate,
      });
    }
  }
  if (configTargets.length > 0) {
    items.push({
      kind: vscode.QuickPickItemKind.Separator,
      label: 'Config Targets',
    });
    for (const candidate of configTargets) {
      items.push({
        label: candidate.label,
        description: candidate.description,
        detail: candidate.detail,
        candidate,
      });
    }
  }

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Rename Codepol Entity',
    matchOnDescription: true,
    matchOnDetail: true,
    ignoreFocusOut: true,
  });
  return picked?.candidate;
}

async function renamePrompt(input: {
  title: string;
  value: string;
  namingRules: string[];
}): Promise<string | undefined> {
  return vscode.window.showInputBox({
    title: input.title,
    value: input.value,
    prompt: input.namingRules.join(' • '),
    ignoreFocusOut: true,
    validateInput: (value) =>
      value.trim().length === 0 ? 'Rename must not be empty.' : undefined,
  });
}

function semanticSearchQueryResolve(): string | undefined {
  return semanticSearchInitialQueryResolve(vscode.window.activeTextEditor);
}

function semanticSearchItemsMap(
  results: WorkspaceSearchResult[],
  query: string,
): SemanticSearchQuickPickItem[] {
  return semanticSearchQuickPickItemsCreate(results, query).map((item) => ({
    label: item.label,
    description: item.description,
    detail: item.detail,
    alwaysShow: item.alwaysShow,
    result: item.result,
  }));
}

async function quickPick<T>(input: {
  title: string;
  placeholder?: string;
  items: Array<vscode.QuickPickItem & { value: T }>;
}): Promise<T | undefined> {
  const picked = await vscode.window.showQuickPick(input.items, {
    title: input.title,
    placeHolder: input.placeholder,
    matchOnDescription: true,
    matchOnDetail: true,
    ignoreFocusOut: true,
  });
  return picked?.value;
}

async function multiSelectPick<T>(input: {
  title: string;
  placeholder?: string;
  items: Array<vscode.QuickPickItem & { picked?: boolean; value: T }>;
}): Promise<T[] | undefined> {
  const picked = await vscode.window.showQuickPick(input.items, {
    title: input.title,
    placeHolder: input.placeholder,
    matchOnDescription: true,
    matchOnDetail: true,
    ignoreFocusOut: true,
    canPickMany: true,
  });
  if (!picked) return undefined;
  return picked.map((item) => item.value);
}

function lintRuleIdResolve(input: unknown): string | undefined {
  if (typeof input === 'string') {
    return input;
  }
  if (
    typeof input === 'object' &&
    input !== null &&
    'ruleId' in input &&
    typeof (input as { ruleId?: unknown }).ruleId === 'string'
  ) {
    return (input as { ruleId: string }).ruleId;
  }
  return undefined;
}

function lintRuleDiagnosticQuickFixInputResolve(input: unknown):
  | {
      ruleId: string;
      uri: string;
      message: string;
      range: {
        start: { line: number; character: number };
        end: { line: number; character: number };
      };
    }
  | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }

  const record = input as {
    ruleId?: unknown;
    uri?: unknown;
    message?: unknown;
    range?: {
      start?: { line?: unknown; character?: unknown };
      end?: { line?: unknown; character?: unknown };
    };
  };
  if (
    typeof record.ruleId !== 'string' ||
    typeof record.uri !== 'string' ||
    typeof record.message !== 'string' ||
    typeof record.range?.start?.line !== 'number' ||
    typeof record.range.start.character !== 'number' ||
    typeof record.range.end?.line !== 'number' ||
    typeof record.range.end.character !== 'number'
  ) {
    return undefined;
  }

  return {
    ruleId: record.ruleId,
    uri: record.uri,
    message: record.message,
    range: {
      start: {
        line: record.range.start.line,
        character: record.range.start.character,
      },
      end: {
        line: record.range.end.line,
        character: record.range.end.character,
      },
    },
  };
}

async function semanticSearchPick(input: {
  initialQuery: string;
  queryResults(query: string): Promise<WorkspaceSearchResult[] | null>;
}): Promise<WorkspaceSearchResult | null | undefined> {
  return new Promise((resolve) => {
    const quickPick = vscode.window.createQuickPick<SemanticSearchQuickPickItem>();
    let settled = false;
    let debounceHandle: ReturnType<typeof setTimeout> | undefined;
    let requestVersion = 0;

    const finish = (
      value: WorkspaceSearchResult | null | undefined,
    ): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (debounceHandle) {
        clearTimeout(debounceHandle);
      }
      quickPick.hide();
      quickPick.dispose();
      resolve(value);
    };

    const refresh = (query: string): void => {
      const currentRequestVersion = ++requestVersion;
      quickPick.busy = true;
      void input
        .queryResults(query)
        .then((results) => {
          if (settled || currentRequestVersion !== requestVersion) {
            return;
          }
          quickPick.busy = false;
          if (results === null) {
            finish(null);
            return;
          }
          quickPick.items = semanticSearchItemsMap(results, query);
        })
        .catch((error: unknown) => {
          if (settled || currentRequestVersion !== requestVersion) {
            return;
          }
          if (codepolRequestSupersededErrorIs(error)) {
            quickPick.busy = false;
            return;
          }
          quickPick.busy = false;
          quickPick.items = [
            {
              label: 'Semantic search failed',
              description: 'Codepol semantic search',
              detail: error instanceof Error ? error.message : String(error),
              alwaysShow: true,
            },
          ];
        });
    };

    const refreshSchedule = (): void => {
      if (debounceHandle) {
        clearTimeout(debounceHandle);
      }
      debounceHandle = setTimeout(() => {
        refresh(quickPick.value);
      }, 150);
    };

    quickPick.title = 'Codepol: Semantic Search';
    quickPick.placeholder = 'Search workspace modules and exported symbols';
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;
    quickPick.ignoreFocusOut = true;
    quickPick.items = [
      {
        label: 'Searching…',
        description: 'Codepol semantic search',
        alwaysShow: true,
      },
    ];
    quickPick.value = input.initialQuery;

    quickPick.onDidChangeValue(() => {
      refreshSchedule();
    });
    quickPick.onDidAccept(() => {
      finish(quickPick.selectedItems[0]?.result);
    });
    quickPick.onDidHide(() => {
      finish(undefined);
    });

    quickPick.show();
    refreshSchedule();
  });
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const protocol = new VscodeLanguageClientProtocol();
  protocolClient = protocol;
  const readiness = new CodepolReadinessController(protocol);
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  statusBarItem.name = 'Codepol Status';
  statusBarItem.command = `workbench.view.extension.${CODEPOL_EXTENSION_VIEW_CONTAINER_ID}`;
  statusBarApply(statusBarItem, codepolStatusBarPresentationCreate(readiness.snapshotGet()));
  statusBarItem.show();

  let controller: CodepolCommandController | undefined;
  const panels = new CodepolPanelManager({
    openLocation: locationOpen,
    applyEditPlan: async (planId: string) => {
      await protocol.applyEditPlan(planId);
      void vscode.window.showInformationMessage('Codepol rename applied.');
    },
    executeCommand: async (command: string, uri?: string) => {
      if (uri) {
        await vscode.commands.executeCommand(command, uri);
        return;
      }
      await vscode.commands.executeCommand(command);
    },
    deadModulesEntryPointsPick: async ({ currentEntryPointUris }) => {
      // The picker source is the workspace-indexed file set so the
      // multi-select only offers files Codepol actually knows about.
      const graph = await protocol.queryDependencyGraph();
      if (!graph) {
        void vscode.window.showErrorMessage(
          'Codepol does not have a workspace dependency graph yet.',
        );
        return undefined;
      }
      const current = new Set(currentEntryPointUris ?? []);
      const items = graph.nodes
        .map((node) => ({
          label: node.workspaceRelativePath,
          description: node.uri,
          picked: current.has(node.uri),
          value: node.uri,
        }))
        .sort((left, right) => left.label.localeCompare(right.label));
      return multiSelectPick({
        title: 'Configure dead-module entry points',
        placeholder: 'Pick one or more files to treat as entry points.',
        items,
      });
    },
  });

  sidebarProvider = new CodepolSidebarViewProvider(
    protocol,
    readiness,
    {
      openLocation: locationOpen,
      executeCommand: async (command: string, uri: string) => {
        await vscode.commands.executeCommand(command, uri);
      },
    },
    activeEditorLocationGet,
    semanticSearchQueryResolve,
  );
  const renameTargetsProvider = new RenameTargetsTreeProvider(
    renameTargetsLoad,
    readiness,
  );
  const lintRulesProvider = new LintRulesTreeProvider(
    () => lintRulesLoad(protocol),
    (ruleId: string) => lintRuleDetailsLoad(protocol, ruleId),
  );

  controller = new CodepolCommandController(protocol, panels, {
    activeUriGet: activeEditorUriGet,
    activePositionGet: activeEditorPositionGet,
    readinessSnapshotGet: () => readiness.snapshotGet(),
    semanticSearchInitialQueryResolve: semanticSearchQueryResolve,
    semanticSearchPick,
    renameTargetsLoad,
    renameTargetPick,
    renamePrompt,
    quickPick,
    infoShow: (message: string) => {
      void vscode.window.showInformationMessage(message);
    },
    errorShow: (message: string) => {
      void vscode.window.showErrorMessage(message);
    },
    openLocation: locationOpen,
    peekLocations: flowSitePeekShow,
  });

  const codeLensProvider = new CodepolArchitectureCodeLensProvider({
    protocol,
    peekCommandId: CODEPOL_EXTENSION_COMMAND_PEEK_ARCHITECTURE,
  });
  const architectureHoverProvider = new CodepolArchitectureHoverProvider({
    protocol,
    peekCommandId: CODEPOL_EXTENSION_COMMAND_PEEK_ARCHITECTURE,
  });
  const importSpecifierMarkerController = new ImportSpecifierMarkerController({
    protocol,
  });
  const importSpecifierHoverProvider = new CodepolImportSpecifierHoverProvider({
    protocol,
    markers: importSpecifierMarkerController,
    peekCommandId: CODEPOL_EXTENSION_COMMAND_PEEK_ARCHITECTURE,
  });
  if (vscode.window.activeTextEditor) {
    importSpecifierMarkerController.attachToEditor(
      vscode.window.activeTextEditor,
    );
  }
  const symbolCodeLensProvider = new CodepolSymbolCodeLensProvider({
    protocol,
    showCallGraphCommandId: CODEPOL_EXTENSION_COMMAND_SHOW_CALL_GRAPH,
  });
  const typeHierarchyCodeLensProvider = new CodepolTypeHierarchyCodeLensProvider({
    protocol,
    showTypeHierarchyCommandId: CODEPOL_EXTENSION_COMMAND_SHOW_TYPE_HIERARCHY,
  });

  context.subscriptions.push(
    panels,
    readiness,
    sidebarProvider,
    statusBarItem,
    codeLensProvider,
    symbolCodeLensProvider,
    typeHierarchyCodeLensProvider,
    importSpecifierMarkerController,
    vscode.languages.registerCodeLensProvider(
      { scheme: 'file' },
      codeLensProvider,
    ),
    // Phase 8 hover provider — gated to line 0 of file: documents to
    // stay inside the hover-model marker rule (the architecture
    // CodeLens establishes the per-file Codepol identity at the same
    // line).
    vscode.languages.registerHoverProvider(
      { scheme: 'file' },
      architectureHoverProvider,
    ),
    // Phase 5 (deferred) hover provider — fires on import specifiers
    // that the ImportSpecifierMarkerController has decorated. The
    // marker is the extension-owned identity required by
    // TODO_CODEPOL_LSP_HOVER_MODEL.md.
    vscode.languages.registerHoverProvider(
      { scheme: 'file' },
      importSpecifierHoverProvider,
    ),
    vscode.languages.registerCodeLensProvider(
      { scheme: 'file' },
      symbolCodeLensProvider,
    ),
    // Phase 9.5 / Gap 3 — interface-only "implementers" lens.
    // Scoped to TypeScript / TSX languages because the regex scanner
    // and the index's member-shape extractor are TypeScript-only
    // today.
    vscode.languages.registerCodeLensProvider(
      [
        { scheme: 'file', language: 'typescript' },
        { scheme: 'file', language: 'typescriptreact' },
      ],
      typeHierarchyCodeLensProvider,
    ),
    vscode.window.registerWebviewViewProvider(
      CODEPOL_EXTENSION_VIEW_CURRENT_CONTEXT_ID,
      sidebarProvider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      },
    ),
    vscode.window.registerTreeDataProvider(
      CODEPOL_EXTENSION_VIEW_LINT_RULES_ID,
      lintRulesProvider,
    ),
    vscode.window.registerTreeDataProvider(
      CODEPOL_EXTENSION_VIEW_RENAME_TARGETS_ID,
      renameTargetsProvider,
    ),
    vscode.commands.registerCommand(
      CODEPOL_EXTENSION_COMMAND_SHOW_ARCHITECTURE_SUMMARY,
      async () => controller?.showArchitectureSummary(),
    ),
    vscode.commands.registerCommand(
      CODEPOL_EXTENSION_COMMAND_SHOW_DEPENDENCY_GRAPH,
      async (uri?: string) => controller?.showDependencyGraph(uri),
    ),
    vscode.commands.registerCommand(
      CODEPOL_EXTENSION_COMMAND_SHOW_SEMANTIC_DEFINITION,
      async (uri?: string) => controller?.showSemanticDefinition(uri),
    ),
    vscode.commands.registerCommand(
      CODEPOL_EXTENSION_COMMAND_SHOW_SEMANTIC_SEARCH,
      async (options?: SemanticSearchCommandOptions) =>
        controller?.showSemanticSearch(options),
    ),
    vscode.commands.registerCommand(
      CODEPOL_EXTENSION_COMMAND_SHOW_ARCHITECTURE_LINKS,
      async (uri?: string) => controller?.showArchitectureLinks(uri),
    ),
    vscode.commands.registerCommand(
      CODEPOL_EXTENSION_COMMAND_PEEK_ARCHITECTURE,
      async (uri?: string) => controller?.peekArchitecture(uri),
    ),
    vscode.commands.registerCommand(
      CODEPOL_EXTENSION_COMMAND_SHOW_CALL_GRAPH,
      async (args?: { symbolId?: string; focusSymbolName?: string }) =>
        controller?.showCallGraph(args),
    ),
    vscode.commands.registerCommand(
      CODEPOL_EXTENSION_COMMAND_SHOW_TYPE_HIERARCHY,
      async (args?: { symbolId?: string; focusSymbolName?: string }) =>
        controller?.showTypeHierarchy(args),
    ),
    vscode.commands.registerCommand(
      CODEPOL_EXTENSION_COMMAND_SHOW_DEPENDENCY_PATH,
      async (
        args?:
          | string
          | {
              fromUri?: string;
              toUri?: string;
              maxPaths?: 5 | 10 | 20;
            },
      ) => {
        // The sidebar synthetic action calls
        // `executeCommand(command, uri)` which surfaces the URI as a
        // bare string here. Normalize to the args-object shape the
        // controller expects.
        const normalized = typeof args === 'string' ? { fromUri: args } : args;
        return controller?.showDependencyPath(normalized);
      },
    ),
    vscode.commands.registerCommand(
      CODEPOL_EXTENSION_COMMAND_SHOW_DEAD_MODULES,
      async (args?: { entryPointUris?: string[] }) =>
        controller?.showDeadModules(args),
    ),
    vscode.commands.registerCommand(
      CODEPOL_EXTENSION_COMMAND_FIND_CALLBACKS,
      async (args?: { symbolId?: string; focusSymbolName?: string }) =>
        controller?.findCallbacks(args),
    ),
    vscode.commands.registerCommand(
      CODEPOL_EXTENSION_COMMAND_SHOW_LINT_RULE_DETAILS,
      async (input?: unknown) => {
        const ruleId = lintRuleIdResolve(input);
        return ruleId ? controller?.showLintRuleDetails(ruleId) : undefined;
      },
    ),
    vscode.commands.registerCommand(
      CODEPOL_EXTENSION_COMMAND_SHOW_LINT_RULE_DIAGNOSTIC_FIXES,
      async (input?: unknown) => {
        const quickFixInput = lintRuleDiagnosticQuickFixInputResolve(input);
        return quickFixInput
          ? controller?.showLintRuleDiagnosticFixes(quickFixInput)
          : undefined;
      },
    ),
    vscode.commands.registerCommand(
      CODEPOL_EXTENSION_COMMAND_OPEN_LINT_RULE_LOCATION,
      async (input?: {
        uri?: string;
        line?: number;
        character?: number;
      }) => {
        if (!input?.uri) {
          return;
        }
        await locationOpen({
          uri: input.uri,
          line: input.line ?? 0,
          character: input.character ?? 0,
        });
      },
    ),
    vscode.commands.registerCommand(
      CODEPOL_EXTENSION_COMMAND_RENAME_CODEPOL_ENTITY,
      async (options?: RenameCommandOptions) =>
        controller?.renameCodepolEntity(options),
    ),
    vscode.commands.registerCommand(
      CODEPOL_EXTENSION_COMMAND_REFRESH_LINT_RULES,
      () => {
        void readiness.refresh();
        lintRulesProvider.refresh();
      },
    ),
    vscode.commands.registerCommand(
      CODEPOL_EXTENSION_COMMAND_REFRESH_RENAME_TARGETS,
      () => {
        void readiness.refresh();
        lintRulesProvider.refresh();
        renameTargetsProvider.refresh();
        void sidebarProvider?.refresh();
      },
    ),
    vscode.commands.registerCommand(
      CODEPOL_EXTENSION_COMMAND_SET_DIAGNOSTICS_ENVIRONMENT,
      async () => {
        const choices = [...environmentNamesList()] as string[];
        const choice = await vscode.window.showQuickPick(choices, {
          placeHolder: 'Select Codepol diagnostics environment preset',
        });
        if (!choice) return;
        const environment = diagnosticsEnvironmentFromSetting(choice);
        const cfg = vscode.workspace.getConfiguration('codepol.diagnostics');
        await cfg.update('environment', environment, vscode.ConfigurationTarget.Workspace);
        await diagnosticsConfigApply(protocol, { environment });
      },
    ),
    vscode.commands.registerCommand(
      CODEPOL_EXTENSION_COMMAND_ADD_DIAGNOSTICS_ESCALATION,
      async () => {
        const scopeInput = await vscode.window.showInputBox({
          prompt: 'Codepol escalation scope (e.g. global, scope:parser, workspace:<id>)',
          value: 'scope:parser',
        });
        if (!scopeInput) return;
        const level = await vscode.window.showQuickPick(
          DIAGNOSTICS_LOG_LEVELS as readonly string[],
          { placeHolder: 'Escalation level' },
        );
        if (!level || !diagnosticsLogLevelIsValid(level)) return;
        const ttlInput = await vscode.window.showInputBox({
          prompt: 'TTL in seconds',
          value: '600',
        });
        if (!ttlInput) return;
        const ttlSec = Number(ttlInput.trim());
        if (!Number.isFinite(ttlSec) || ttlSec <= 0) return;
        const reason = await vscode.window.showInputBox({
          prompt: 'Reason (shown in the audit log)',
          value: 'vscode_user_escalation',
        });
        if (reason === undefined) return;
        const rule: EscalationRuleInput = {
          scope: escalationScopeParse(scopeInput.trim()),
          level,
          ttlMs: Math.floor(ttlSec * 1000),
          reason: reason || 'vscode_user_escalation',
          actor: `vscode-${process.pid}`,
        };
        try {
          await protocol.escalateDiagnostics(rule);
          void vscode.window.showInformationMessage(
            `Codepol: escalation added (scope=${scopeInput.trim()}, level=${level}, ttl=${ttlSec}s).`,
          );
        } catch (err) {
          void vscode.window.showErrorMessage(
            `Codepol: failed to add escalation: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      },
    ),
    vscode.commands.registerCommand(
      CODEPOL_EXTENSION_COMMAND_CLEAR_DIAGNOSTICS_ESCALATIONS,
      async () => {
        try {
          const escalations = await protocol.listDiagnosticsEscalations();
          if (!escalations || escalations.length === 0) {
            void vscode.window.showInformationMessage('Codepol: no active escalations.');
            return;
          }
          for (const rule of escalations) {
            try {
              await protocol.revokeDiagnosticsEscalation(rule.id);
            } catch {
              // continue revoking the remaining rules
            }
          }
          void vscode.window.showInformationMessage(
            `Codepol: revoked ${escalations.length} escalation(s).`,
          );
        } catch (err) {
          void vscode.window.showErrorMessage(
            `Codepol: failed to clear escalations: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      },
    ),
    vscode.commands.registerCommand(
      CODEPOL_EXTENSION_COMMAND_SHOW_DIAGNOSTICS_CONFIG,
      async () => {
        try {
          const config = await protocol.getDiagnosticsConfig();
          if (!config) {
            void vscode.window.showInformationMessage(
              'Codepol diagnostics config is not available (server not connected).',
            );
            return;
          }
          const doc = await vscode.workspace.openTextDocument({
            language: 'json',
            content: JSON.stringify(config, null, 2),
          });
          await vscode.window.showTextDocument(doc, { preview: true });
        } catch (err) {
          void vscode.window.showErrorMessage(
            `Codepol: failed to fetch diagnostics config: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      },
    ),
    vscode.commands.registerCommand(
      CODEPOL_EXTENSION_COMMAND_RESTART_DAEMON,
      async () => {
        const runtimeDir = process.env.CODEPOL_DAEMON_RUNTIME_DIR;
        try {
          const result = await workspaceDaemonTerminateExternal(runtimeDir);
          if (!result.descriptor) {
            void vscode.window.showInformationMessage(
              'Codepol: no running daemon was registered; the next request will spawn a fresh one.',
            );
          } else if (result.terminated) {
            void vscode.window.showInformationMessage(
              `Codepol: daemon pid=${result.descriptor.pid} terminated. The next request will spawn a fresh daemon.`,
            );
          } else {
            void vscode.window.showWarningMessage(
              `Codepol: could not terminate daemon pid=${result.descriptor.pid}. Descriptor was cleared; the next request will spawn a fresh daemon.`,
            );
          }
        } catch (err) {
          void vscode.window.showErrorMessage(
            `Codepol: restart daemon failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      },
    ),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('codepol.diagnostics')) {
        void diagnosticsConfigApply(protocol, diagnosticsPatchFromSettings());
        if (event.affectsConfiguration('codepol.diagnostics.escalations')) {
          void diagnosticsEscalationsApply(
            protocol,
            escalationInputsFromSettings(`vscode-${process.pid}`),
          );
        }
      }
    }),
    vscode.window.onDidChangeActiveTextEditor(() => {
      void readiness.refresh();
      void sidebarProvider?.refresh();
    }),
    readiness.onDidChange((snapshot) => {
      statusBarApply(statusBarItem, codepolStatusBarPresentationCreate(snapshot));
      lintRulesProvider.refresh();
      renameTargetsProvider.refresh();
      codeLensProvider.refresh();
      symbolCodeLensProvider.refresh();
      typeHierarchyCodeLensProvider.refresh();
    }),
  );

  void protocol
    .start()
    .then(async () => {
      await diagnosticsConfigApply(protocol, diagnosticsPatchFromSettings());
      await diagnosticsEscalationsApply(
        protocol,
        escalationInputsFromSettings(`vscode-${process.pid}`),
      );
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Codepol failed to start the language client: ${message}`);
    });
  readiness.start();

  const packageWatcher = vscode.workspace.createFileSystemWatcher('**/package.json');
  const configWatcher = vscode.workspace.createFileSystemWatcher('**/codepol.toml');
  const refreshTargets = () => {
    void readiness.refresh();
    lintRulesProvider.refresh();
    renameTargetsProvider.refresh();
    void sidebarProvider?.refresh();
  };
  context.subscriptions.push(
    packageWatcher,
    configWatcher,
    packageWatcher.onDidCreate(refreshTargets),
    packageWatcher.onDidChange(refreshTargets),
    packageWatcher.onDidDelete(refreshTargets),
    configWatcher.onDidCreate(refreshTargets),
    configWatcher.onDidChange(refreshTargets),
    configWatcher.onDidDelete(refreshTargets),
  );

  const rootPath = workspaceRootPathGet();
  if (rootPath) {
    const configPath = configFileDiscover(rootPath);
    if (!configPath) {
      void vscode.window.showWarningMessage(
        `No codepol.toml found under ${path.basename(rootPath)}. Codepol commands may stay idle until a config is added.`,
      );
    }
  }
}

export async function deactivate(): Promise<void> {
  sidebarProvider?.dispose();
  sidebarProvider = undefined;
  if (protocolClient) {
    await protocolClient.stop();
    protocolClient = undefined;
  }
}
