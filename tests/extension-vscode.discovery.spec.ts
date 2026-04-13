import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  configRenameTargetsDiscover,
  renameTargetCandidatesDiscover,
  workspacePackageRenameTargetsDiscover,
} from '../extension-vscode/src/discovery';

function tempWorkspaceCreate(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function writeFile(filePath: string, source: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, source, 'utf8');
}

describe('extension-vscode discovery', () => {
  it('discovers workspace package rename targets and keeps duplicate names path-disambiguated', () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-extension-vscode-discovery-');
    createdDirs.push(workspaceRoot);

    writeFile(
      path.join(workspaceRoot, 'package.json'),
      `${JSON.stringify({ workspaces: ['packages/*'] }, null, 2)}\n`,
    );
    writeFile(
      path.join(workspaceRoot, 'packages/lib-a/package.json'),
      `${JSON.stringify({ name: '@acme/lib', main: './dist/index.js' }, null, 2)}\n`,
    );
    writeFile(
      path.join(workspaceRoot, 'packages/lib-a/src/index.ts'),
      'export const libA = 1;\n',
    );
    writeFile(
      path.join(workspaceRoot, 'packages/lib-b/package.json'),
      `${JSON.stringify({ name: '@acme/lib', main: './dist/index.js' }, null, 2)}\n`,
    );
    writeFile(
      path.join(workspaceRoot, 'packages/lib-b/src/index.ts'),
      'export const libB = 1;\n',
    );

    expect(workspacePackageRenameTargetsDiscover(workspaceRoot)).toEqual([
      {
        kind: 'workspace_package',
        label: '@acme/lib',
        description: 'packages/lib-a',
        detail: 'Workspace package at packages/lib-a',
        target: {
          semanticClass: 'domain_entity',
          targetId: 'package:@acme/lib',
        },
      },
      {
        kind: 'workspace_package',
        label: '@acme/lib',
        description: 'packages/lib-b',
        detail: 'Workspace package at packages/lib-b',
        target: {
          semanticClass: 'domain_entity',
          targetId: 'package:@acme/lib',
        },
      },
    ]);
  });

  it('discovers config rename targets from codepol.toml and merges them with package targets', () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-extension-vscode-config-');
    createdDirs.push(workspaceRoot);

    writeFile(
      path.join(workspaceRoot, 'package.json'),
      `${JSON.stringify({ workspaces: ['packages/*'] }, null, 2)}\n`,
    );
    writeFile(
      path.join(workspaceRoot, 'packages/lib/package.json'),
      `${JSON.stringify({ name: '@acme/lib', main: './dist/index.js' }, null, 2)}\n`,
    );
    writeFile(
      path.join(workspaceRoot, 'packages/lib/src/index.ts'),
      'export const sharedValue = 1;\n',
    );
    writeFile(
      path.join(workspaceRoot, 'codepol.toml'),
      `[[plugins]]
id = "@codepol/plugin"
source = { kind = "builtin" }

[targets.app-src]
language = "typescript"
files = ["apps/**/*.ts"]

[targets.worker]
language = "typescript"
files = ["workers/**/*.ts"]

[[rules]]
ruleId = "@codepol/plugin/no-unused-exports"
targets = ["app-src", "worker"]
`,
    );

    expect(configRenameTargetsDiscover(workspaceRoot)).toEqual([
      {
        kind: 'config_target',
        label: 'app-src',
        description: 'codepol.toml',
        detail: 'Codepol config target',
        target: {
          semanticClass: 'config_component',
          targetId: 'target:app-src',
        },
      },
      {
        kind: 'config_target',
        label: 'worker',
        description: 'codepol.toml',
        detail: 'Codepol config target',
        target: {
          semanticClass: 'config_component',
          targetId: 'target:worker',
        },
      },
    ]);

    expect(renameTargetCandidatesDiscover(workspaceRoot)).toEqual([
      {
        kind: 'workspace_package',
        label: '@acme/lib',
        description: 'packages/lib',
        detail: 'Workspace package',
        target: {
          semanticClass: 'domain_entity',
          targetId: 'package:@acme/lib',
        },
      },
      {
        kind: 'config_target',
        label: 'app-src',
        description: 'codepol.toml',
        detail: 'Codepol config target',
        target: {
          semanticClass: 'config_component',
          targetId: 'target:app-src',
        },
      },
      {
        kind: 'config_target',
        label: 'worker',
        description: 'codepol.toml',
        detail: 'Codepol config target',
        target: {
          semanticClass: 'config_component',
          targetId: 'target:worker',
        },
      },
    ]);
  });
});
