import * as vscode from 'vscode';
import type { RenameTargetCandidate } from './discovery';
import { CODEPOL_EXTENSION_COMMAND_RENAME_CODEPOL_ENTITY } from './constants';

type RenameTargetGroupKind = RenameTargetCandidate['kind'];

class StaticTreeItem extends vscode.TreeItem {
  constructor(label: string, options: Partial<vscode.TreeItem> = {}) {
    super(label, options.collapsibleState ?? vscode.TreeItemCollapsibleState.None);
    Object.assign(this, options);
  }
}

type RenameTargetGroupItem = vscode.TreeItem & {
  kind: RenameTargetGroupKind;
};

export class RenameTargetsTreeProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>
{
  private readonly emitter = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private candidatesPromise: Promise<RenameTargetCandidate[]> | undefined;

  constructor(
    private readonly candidatesLoad: () => Promise<RenameTargetCandidate[]>,
  ) {}

  refresh(): void {
    this.candidatesPromise = undefined;
    this.emitter.fire(undefined);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    const candidates = await this.candidatesGet();
    if (!element) {
      if (candidates.length === 0) {
        return [
          new StaticTreeItem('No renameable targets discovered', {
            description: 'Refresh after editing package manifests or codepol.toml',
            iconPath: new vscode.ThemeIcon('circle-slash'),
          }),
        ];
      }

      const workspacePackageCount = candidates.filter(
        (candidate) => candidate.kind === 'workspace_package',
      ).length;
      const configTargetCount = candidates.filter(
        (candidate) => candidate.kind === 'config_target',
      ).length;
      const groups: RenameTargetGroupItem[] = [];

      if (workspacePackageCount > 0) {
        groups.push(
          this.groupItemCreate(
            'workspace_package',
            'Workspace Packages',
            workspacePackageCount,
          ),
        );
      }
      if (configTargetCount > 0) {
        groups.push(
          this.groupItemCreate('config_target', 'Config Targets', configTargetCount),
        );
      }
      return groups;
    }

    const group = element as RenameTargetGroupItem;
    return candidates
      .filter((candidate) => candidate.kind === group.kind)
      .map(
        (candidate) =>
          new StaticTreeItem(candidate.label, {
            description: candidate.description,
            tooltip: `${candidate.label}\n${candidate.detail}\n${candidate.description}`,
            iconPath: new vscode.ThemeIcon(
              candidate.kind === 'workspace_package' ? 'package' : 'settings-gear',
            ),
            command: {
              command: CODEPOL_EXTENSION_COMMAND_RENAME_CODEPOL_ENTITY,
              title: 'Rename Codepol Entity',
              arguments: [{ target: candidate.target }],
            },
          }),
      );
  }

  private groupItemCreate(
    kind: RenameTargetGroupKind,
    label: string,
    count: number,
  ): RenameTargetGroupItem {
    return Object.assign(
      new StaticTreeItem(label, {
        collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
        description: `${count}`,
        iconPath: new vscode.ThemeIcon(
          kind === 'workspace_package' ? 'package' : 'settings-gear',
        ),
      }),
      { kind },
    );
  }

  private async candidatesGet(): Promise<RenameTargetCandidate[]> {
    if (!this.candidatesPromise) {
      this.candidatesPromise = this.candidatesLoad();
    }
    return this.candidatesPromise;
  }
}
