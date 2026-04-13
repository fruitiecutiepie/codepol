import assert from 'node:assert/strict';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { smokeWorkspaceCreate, type SmokeWorkspace } from '../workspace';

let smokeWorkspace: SmokeWorkspace | undefined;

function smokeWorkspacePathGet(): string {
  if (!smokeWorkspace) {
    smokeWorkspace = smokeWorkspaceCreate();
    process.once('exit', () => {
      smokeWorkspace?.cleanup();
    });
  }

  return smokeWorkspace.workspacePath;
}

async function workspaceOpen(): Promise<void> {
  const existing = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const workspacePath = smokeWorkspacePathGet();
  if (existing === workspacePath) {
    return;
  }

  const change = new Promise<void>((resolve) => {
    const disposable = vscode.workspace.onDidChangeWorkspaceFolders(() => {
      disposable.dispose();
      resolve();
    });
  });

  const opened = vscode.workspace.updateWorkspaceFolders(0, null, {
    uri: vscode.Uri.file(workspacePath),
    name: 'codepol-extension-smoke',
  });
  assert.equal(opened, true, 'Expected the smoke-test workspace to open.');
  await change;
}

async function documentOpen(relativePath: string): Promise<vscode.TextEditor> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!workspaceRoot) {
    throw new Error('No workspace folder available for smoke tests.');
  }

  const document = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(workspaceRoot, relativePath),
  );
  return vscode.window.showTextDocument(document);
}

export async function run(): Promise<void> {
  await workspaceOpen();

  const extension = vscode.extensions.getExtension('codepol.extension-vscode');
  assert.ok(extension, 'Expected the Codepol VS Code extension to be installed.');
  await extension.activate();

  await documentOpen(path.join('apps', 'web', 'src', 'app.ts'));
  await vscode.commands.executeCommand('codepol.extension.showSemanticSearch', {
    query: 'sharedValue',
    autoOpenFirstResult: true,
  });
  await vscode.commands.executeCommand('codepol.extension.showArchitectureSummary');
  await vscode.commands.executeCommand('codepol.extension.showDependencyGraph');
  await vscode.commands.executeCommand('codepol.extension.showSemanticDefinition');
  await vscode.commands.executeCommand('codepol.extension.showArchitectureLinks');

  const activeEditor = vscode.window.activeTextEditor;
  assert.ok(activeEditor, 'Expected semantic search to open a result.');
  assert.equal(
    activeEditor.document.uri.fsPath,
    path.join(
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '',
      'packages',
      'lib',
      'src',
      'index.ts',
    ),
  );
  assert.equal(activeEditor.selection.active.line, 0);
  assert.equal(activeEditor.selection.active.character, 13);

  await vscode.commands.executeCommand('codepol.extension.renameCodepolEntity', {
    target: {
      semanticClass: 'domain_entity',
      targetId: 'package:@acme/lib',
    },
    newName: '@acme/lib-renamed',
    autoApply: true,
  });

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
  assert.ok(workspaceRoot, 'Expected a smoke-test workspace root.');
  const packageManifest = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(workspaceRoot, 'packages', 'lib', 'package.json'),
  );
  const appSource = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(workspaceRoot, 'apps', 'web', 'src', 'app.ts'),
  );
  assert.match(packageManifest.getText(), /@acme\/lib-renamed/);
  assert.match(appSource.getText(), /@acme\/lib-renamed/);
}
