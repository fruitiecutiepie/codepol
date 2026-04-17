import * as path from 'node:path';
import * as vscode from 'vscode';
import type {
  WorkspaceLintRuleDetailsResult,
  WorkspaceLintRuleSummary,
  WorkspaceSearchResult,
} from '@codepol/core';
import { configFileDiscover } from '@codepol/core';
import {
  CodepolCommandController,
  type RenameCommandOptions,
  type SemanticSearchCommandOptions,
} from './commands';
import {
  CODEPOL_EXTENSION_COMMAND_REFRESH_RENAME_TARGETS,
  CODEPOL_EXTENSION_COMMAND_REFRESH_LINT_RULES,
  CODEPOL_EXTENSION_COMMAND_OPEN_LINT_RULE_LOCATION,
  CODEPOL_EXTENSION_COMMAND_RENAME_CODEPOL_ENTITY,
  CODEPOL_EXTENSION_COMMAND_SHOW_LINT_RULE_DIAGNOSTIC_FIXES,
  CODEPOL_EXTENSION_COMMAND_SHOW_ARCHITECTURE_SUMMARY,
  CODEPOL_EXTENSION_COMMAND_SHOW_ARCHITECTURE_LINKS,
  CODEPOL_EXTENSION_COMMAND_SHOW_DEPENDENCY_GRAPH,
  CODEPOL_EXTENSION_COMMAND_SHOW_LINT_RULE_DETAILS,
  CODEPOL_EXTENSION_COMMAND_SHOW_SEMANTIC_DEFINITION,
  CODEPOL_EXTENSION_COMMAND_SHOW_SEMANTIC_SEARCH,
  CODEPOL_EXTENSION_VIEW_CONTAINER_ID,
  CODEPOL_EXTENSION_VIEW_CURRENT_CONTEXT_ID,
  CODEPOL_EXTENSION_VIEW_LINT_RULES_ID,
  CODEPOL_EXTENSION_VIEW_RENAME_TARGETS_ID,
} from './constants';
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
  });

  context.subscriptions.push(
    panels,
    readiness,
    sidebarProvider,
    statusBarItem,
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
    vscode.window.onDidChangeActiveTextEditor(() => {
      void readiness.refresh();
      void sidebarProvider?.refresh();
    }),
    readiness.onDidChange((snapshot) => {
      statusBarApply(statusBarItem, codepolStatusBarPresentationCreate(snapshot));
      lintRulesProvider.refresh();
      renameTargetsProvider.refresh();
    }),
  );

  void protocol.start().catch((error: unknown) => {
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
