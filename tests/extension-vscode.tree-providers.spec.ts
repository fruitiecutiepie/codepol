import { describe, expect, it, vi } from 'vitest';
import type { IndexStatusResult } from '@codepol/core';

vi.mock('vscode', () => {
  class TreeItem {
    label: string;
    collapsibleState: number;

    constructor(label: string, collapsibleState = 0) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  }

  class ThemeIcon {
    id: string;

    constructor(id: string) {
      this.id = id;
    }
  }

  class EventEmitter<T> {
    readonly event = vi.fn();
    fire(_value?: T): void {}
    dispose(): void {}
  }

  return {
    TreeItem,
    ThemeIcon,
    EventEmitter,
    TreeItemCollapsibleState: {
      None: 0,
      Collapsed: 1,
      Expanded: 2,
    },
  };
});

import type { RenameTargetCandidate } from '../extension-vscode/src/discovery';
import { RenameTargetsTreeProvider } from '../extension-vscode/src/treeProviders';

function readinessStatusCreate(
  overrides: Partial<IndexStatusResult> = {},
): IndexStatusResult {
  return {
    workspaceId: 'workspace-1',
    workspaceInstanceId: 'instance-1',
    status: 'ready',
    replayState: 'applied',
    workspaceReady: true,
    indexedFileCount: 12,
    openDocumentCount: 1,
    overlayCount: 1,
    analysisGeneration: 3,
    ...overrides,
  };
}

const workspacePackageCandidate: RenameTargetCandidate = {
  kind: 'workspace_package',
  label: '@acme/lib',
  description: 'packages/lib',
  detail: 'Workspace package',
  target: {
    semanticClass: 'domain_entity',
    targetId: 'package:@acme/lib',
  },
};

const configTargetCandidate: RenameTargetCandidate = {
  kind: 'config_target',
  label: 'web',
  description: 'codepol.toml',
  detail: 'Codepol config target',
  target: {
    semanticClass: 'config_component',
    targetId: 'target:web',
  },
};

describe('extension-vscode tree providers', () => {
  it('renders workspace package rename targets as blocked while the index warms', async () => {
    const provider = new RenameTargetsTreeProvider(
      async () => [workspacePackageCandidate, configTargetCandidate],
      {
        onDidChange: vi.fn(),
        refresh: async () => {},
        snapshotGet: () => ({
          status: readinessStatusCreate({
            status: 'warming',
            workspaceReady: false,
          }),
        }),
      },
    );

    const groups = await provider.getChildren();
    const workspaceGroup = groups.find((item) => (item as { kind?: string }).kind === 'workspace_package');
    const configGroup = groups.find((item) => (item as { kind?: string }).kind === 'config_target');
    expect(workspaceGroup).toBeDefined();
    expect(configGroup).toBeDefined();

    const workspaceItems = await provider.getChildren(workspaceGroup!);
    const configItems = await provider.getChildren(configGroup!);

    expect(workspaceItems[0]).toMatchObject({
      label: '@acme/lib',
      description: 'Blocked until ready',
      command: undefined,
      iconPath: {
        id: 'lock',
      },
    });
    expect(configItems[0]).toMatchObject({
      label: 'web',
      description: 'codepol.toml',
      command: {
        command: 'codepol.extension.renameCodepolEntity',
        arguments: [{ target: configTargetCandidate.target }],
      },
    });
  });
});
