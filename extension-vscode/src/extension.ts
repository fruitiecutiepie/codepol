import * as path from 'node:path';
import * as vscode from 'vscode';
import type { WorkspaceSearchResult } from '@codepol/core';
import { configFileDiscover } from '@codepol/core';
import {
  CodepolCommandController,
  type RenameCommandOptions,
  type SemanticSearchCommandOptions,
} from './commands';
import {
  CODEPOL_EXTENSION_COMMAND_REFRESH_RENAME_TARGETS,
  CODEPOL_EXTENSION_COMMAND_RENAME_CODEPOL_ENTITY,
  CODEPOL_EXTENSION_COMMAND_SHOW_ARCHITECTURE_SUMMARY,
  CODEPOL_EXTENSION_COMMAND_SHOW_ARCHITECTURE_LINKS,
  CODEPOL_EXTENSION_COMMAND_SHOW_DEPENDENCY_GRAPH,
  CODEPOL_EXTENSION_COMMAND_SHOW_SEMANTIC_DEFINITION,
  CODEPOL_EXTENSION_COMMAND_SHOW_SEMANTIC_SEARCH,
  CODEPOL_EXTENSION_VIEW_CURRENT_CONTEXT_ID,
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
import { RenameTargetsTreeProvider } from './treeProviders';

let protocolClient: CodepolProtocolClient | undefined;
let sidebarProvider: CodepolSidebarViewProvider | undefined;

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
  await protocol.start();
  protocolClient = protocol;

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
    {
      openLocation: locationOpen,
      executeCommand: async (command: string, uri: string) => {
        await vscode.commands.executeCommand(command, uri);
      },
    },
    activeEditorLocationGet,
    semanticSearchQueryResolve,
  );
  const renameTargetsProvider = new RenameTargetsTreeProvider(renameTargetsLoad);

  controller = new CodepolCommandController(protocol, panels, {
    activeUriGet: activeEditorUriGet,
    semanticSearchInitialQueryResolve: semanticSearchQueryResolve,
    semanticSearchPick,
    renameTargetsLoad,
    renameTargetPick,
    renamePrompt,
    infoShow: async (message: string) => {
      await vscode.window.showInformationMessage(message);
    },
    errorShow: async (message: string) => {
      await vscode.window.showErrorMessage(message);
    },
    openLocation: locationOpen,
  });

  context.subscriptions.push(
    panels,
    sidebarProvider,
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
      CODEPOL_EXTENSION_COMMAND_RENAME_CODEPOL_ENTITY,
      async (options?: RenameCommandOptions) =>
        controller?.renameCodepolEntity(options),
    ),
    vscode.commands.registerCommand(
      CODEPOL_EXTENSION_COMMAND_REFRESH_RENAME_TARGETS,
      () => {
        renameTargetsProvider.refresh();
        void sidebarProvider?.refresh();
      },
    ),
    vscode.window.onDidChangeActiveTextEditor(() => {
      void sidebarProvider?.refresh();
    }),
  );

  const packageWatcher = vscode.workspace.createFileSystemWatcher('**/package.json');
  const configWatcher = vscode.workspace.createFileSystemWatcher('**/codepol.toml');
  const refreshTargets = () => {
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
