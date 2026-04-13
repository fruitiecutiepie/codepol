import * as path from 'node:path';
import * as vscode from 'vscode';
import type { WorkspaceSupportedRenameTarget } from '@codepol/core';
import { configFileDiscover } from '@codepol/core';
import { CodepolCommandController, type RenameCommandOptions } from './commands';
import {
  CODEPOL_EXTENSION_COMMAND_REFRESH_RENAME_TARGETS,
  CODEPOL_EXTENSION_COMMAND_RENAME_CODEPOL_ENTITY,
  CODEPOL_EXTENSION_COMMAND_SHOW_ARCHITECTURE_LINKS,
  CODEPOL_EXTENSION_COMMAND_SHOW_SEMANTIC_DEFINITION,
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
import {
  CurrentContextTreeProvider,
  RenameTargetsTreeProvider,
} from './treeProviders';

let protocolClient: CodepolProtocolClient | undefined;

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
    executeCommand: async (command: string, uri: string) => {
      await vscode.commands.executeCommand(command, uri);
    },
  });

  const currentContextProvider = new CurrentContextTreeProvider(
    protocol,
    activeEditorUriGet,
  );
  const renameTargetsProvider = new RenameTargetsTreeProvider(renameTargetsLoad);

  controller = new CodepolCommandController(protocol, panels, {
    activeUriGet: activeEditorUriGet,
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
    vscode.window.registerTreeDataProvider(
      'codepol.currentContext',
      currentContextProvider,
    ),
    vscode.window.registerTreeDataProvider(
      'codepol.renameTargets',
      renameTargetsProvider,
    ),
    vscode.commands.registerCommand(
      CODEPOL_EXTENSION_COMMAND_SHOW_SEMANTIC_DEFINITION,
      async (uri?: string) => controller?.showSemanticDefinition(uri),
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
        currentContextProvider.refresh();
      },
    ),
    vscode.window.onDidChangeActiveTextEditor(() => {
      currentContextProvider.refresh();
    }),
  );

  const packageWatcher = vscode.workspace.createFileSystemWatcher('**/package.json');
  const configWatcher = vscode.workspace.createFileSystemWatcher('**/codepol.toml');
  const refreshTargets = () => {
    renameTargetsProvider.refresh();
    currentContextProvider.refresh();
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
  if (protocolClient) {
    await protocolClient.stop();
    protocolClient = undefined;
  }
}
