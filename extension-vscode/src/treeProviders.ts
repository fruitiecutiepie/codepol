import * as vscode from 'vscode';
import type {
  WorkspaceLintRuleDetailsResult,
  WorkspaceLintRuleDiagnosticGroup,
  WorkspaceLintRuleSummary,
} from '@codepol/core';
import type { RenameTargetCandidate } from './discovery';
import {
  CODEPOL_EXTENSION_COMMAND_OPEN_LINT_RULE_LOCATION,
  CODEPOL_EXTENSION_COMMAND_RENAME_CODEPOL_ENTITY,
} from './constants';
import type { CodepolReadinessSource } from './readinessController';
import {
  codepolFeatureGateResolve,
  codepolRequestSupersededErrorIs,
} from './readiness';
import type {
  WorkspacePackageAnalysis,
  WorkspacePackageAnalysisLoader,
  WorkspacePackageDependencySummary,
} from './workspacePackageAnalysis';

type RenameTargetGroupKind = RenameTargetCandidate['kind'];
type LintRulesGroupKind = WorkspaceLintRuleSummary['ownership'];

type LintRuleDetailsResolvedState =
  | {
      status: 'ready';
      details: WorkspaceLintRuleDetailsResult;
    }
  | {
      status: 'empty';
    }
  | {
      status: 'error';
      message: string;
    };

type LintRuleDetailsState =
  | {
      status: 'loading';
      generation: number;
      previous?: LintRuleDetailsResolvedState;
    }
  | LintRuleDetailsResolvedState;

type WorkspacePackageAnalysisResolvedState =
  | {
      status: 'ready';
      analysis: WorkspacePackageAnalysis;
    }
  | {
      status: 'empty';
    }
  | {
      status: 'error';
      message: string;
    };

type WorkspacePackageAnalysisState =
  | {
      status: 'loading';
      generation: number;
      previous?: WorkspacePackageAnalysisResolvedState;
    }
  | WorkspacePackageAnalysisResolvedState;

class StaticTreeItem extends vscode.TreeItem {
  constructor(label: string, options: Partial<vscode.TreeItem> = {}) {
    super(label, options.collapsibleState ?? vscode.TreeItemCollapsibleState.None);
    Object.assign(this, options);
  }
}

type RenameTargetGroupItem = vscode.TreeItem & {
  kind: RenameTargetGroupKind;
};

type WorkspacePackageItem = vscode.TreeItem & {
  kind: 'workspace_package_item';
  targetId: string;
  candidate: RenameTargetCandidate;
};

type WorkspacePackageDependencyGroupItem = vscode.TreeItem & {
  kind: 'workspace_package_dependency_group';
  groupId: 'dependsOn' | 'usedBy';
  dependencies: WorkspacePackageDependencySummary[];
};

type LintRulesGroupItem = vscode.TreeItem & {
  kind: 'lint_rule_group';
  groupKind: LintRulesGroupKind;
};

type LintRuleItem = vscode.TreeItem & {
  kind: 'lint_rule';
  ruleId: string;
};

type LintRuleAnalyzerIssuesItem = vscode.TreeItem & {
  kind: 'lint_rule_analyzer_issues';
  ruleId: string;
  analyzerIssues: string[];
};

type LintRuleDiagnosticFileItem = vscode.TreeItem & {
  kind: 'lint_rule_diagnostic_file';
  ruleId: string;
  diagnosticGroup: WorkspaceLintRuleDiagnosticGroup;
  fixSupported: boolean;
};

type LintRuleDiagnosticItem = vscode.TreeItem & {
  kind: 'lint_rule_diagnostic';
  ruleId: string;
  uri: string;
  message: string;
  range: WorkspaceLintRuleDiagnosticGroup['diagnostics'][number]['range'];
};

export class RenameTargetsTreeProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>
{
  private readonly emitter = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private candidatesPromise: Promise<RenameTargetCandidate[]> | undefined;
  private readonly packageItems = new Map<string, WorkspacePackageItem>();
  private readonly packageAnalysisStates = new Map<string, WorkspacePackageAnalysisState>();
  private refreshGeneration = 0;

  constructor(
    private readonly candidatesLoad: () => Promise<RenameTargetCandidate[]>,
    private readonly packageAnalysisLoad?: WorkspacePackageAnalysisLoader,
    private readonly readiness?: CodepolReadinessSource,
  ) {}

  refresh(): void {
    this.refreshGeneration += 1;
    this.candidatesPromise = undefined;
    this.packageItems.clear();
    this.packageAnalysisStates.clear();
    this.packageAnalysisLoad?.refresh?.();
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

    const item = element as
      | RenameTargetGroupItem
      | WorkspacePackageItem
      | WorkspacePackageDependencyGroupItem;
    if (item.kind === 'workspace_package_item') {
      return this.workspacePackageChildrenGet(item);
    }
    if (item.kind === 'workspace_package_dependency_group') {
      return item.dependencies.map((dependency) =>
        new StaticTreeItem(dependency.packageName, {
          id: [
            'codepol.packageTargets.dependency',
            item.groupId,
            dependency.packageName,
          ].join(':'),
          description:
            `${dependency.edgeCount} edge${dependency.edgeCount === 1 ? '' : 's'} • ` +
            `${dependency.fileCount} file${dependency.fileCount === 1 ? '' : 's'}`,
          tooltip: [
            dependency.packageName,
            `${dependency.edgeCount} dependency edge${dependency.edgeCount === 1 ? '' : 's'}`,
            `${dependency.fileCount} file${dependency.fileCount === 1 ? '' : 's'}`,
          ].join('\n'),
          iconPath: new vscode.ThemeIcon(
            item.groupId === 'dependsOn' ? 'arrow-right' : 'arrow-left',
          ),
        }),
      );
    }
    const group = item;
    const matchingCandidates = candidates.filter(
      (candidate) => candidate.kind === group.kind,
    );
    if (group.kind === 'workspace_package') {
      return matchingCandidates.map((candidate) => this.workspacePackageItemGet(candidate));
    }

    return matchingCandidates.map((candidate) =>
      new StaticTreeItem(candidate.label, {
        description: candidate.description,
        tooltip: [candidate.label, candidate.detail, candidate.description].join('\n'),
        iconPath: new vscode.ThemeIcon('settings-gear'),
        command: {
          command: CODEPOL_EXTENSION_COMMAND_RENAME_CODEPOL_ENTITY,
          title: 'Rename Codepol Entity',
          arguments: [{ target: candidate.target }],
        },
      }),
    );
  }

  private workspacePackageItemGet(
    candidate: RenameTargetCandidate,
  ): WorkspacePackageItem {
    const existing = this.packageItems.get(candidate.target.targetId);
    const item = existing ?? Object.assign(new StaticTreeItem(candidate.label), {
      kind: 'workspace_package_item' as const,
      targetId: candidate.target.targetId,
      candidate,
    });

    Object.assign(item, {
      id: `codepol.packageTargets.package:${candidate.target.targetId}`,
      label: candidate.label,
      description: candidate.description,
      tooltip: [candidate.label, candidate.detail, candidate.description].join('\n'),
      iconPath: new vscode.ThemeIcon('package'),
      collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
      command: undefined,
    } satisfies Partial<vscode.TreeItem>);
    item.candidate = candidate;
    this.packageItems.set(candidate.target.targetId, item);
    return item;
  }

  private workspacePackageRenameItemCreate(
    candidate: RenameTargetCandidate,
  ): vscode.TreeItem {
    const workspacePackageRenameGate = this.readiness
      ? codepolFeatureGateResolve(
          this.readiness.snapshotGet(),
          'workspacePackageRename',
        )
      : { blocked: false as const, message: undefined };
    const renameBlocked = workspacePackageRenameGate.blocked;
    return new StaticTreeItem(`Rename ${candidate.label}...`, {
      id: `codepol.packageTargets.rename:${candidate.target.targetId}`,
      description: renameBlocked ? 'Blocked until ready' : 'Open rename prompt',
      tooltip: renameBlocked
        ? (workspacePackageRenameGate.message ?? 'Workspace package rename is blocked.')
        : `Rename ${candidate.label}`,
      iconPath: new vscode.ThemeIcon(renameBlocked ? 'lock' : 'edit'),
      command: renameBlocked
        ? undefined
        : {
            command: CODEPOL_EXTENSION_COMMAND_RENAME_CODEPOL_ENTITY,
            title: 'Rename Codepol Entity',
            arguments: [{ target: candidate.target }],
          },
    });
  }

  private async workspacePackageChildrenGet(
    item: WorkspacePackageItem,
  ): Promise<vscode.TreeItem[]> {
    const renameItem = this.workspacePackageRenameItemCreate(item.candidate);
    const state = this.packageAnalysisStates.get(item.targetId);
    if (!state) {
      this.workspacePackageAnalysisLoadStart(item);
      return [
        renameItem,
        packagePassiveItemCreate({
          id: `codepol.packageTargets.loading:${item.targetId}`,
          label: 'Loading package analysis...',
          iconId: 'clock',
        }),
      ];
    }

    if (state.status === 'loading') {
      return [
        renameItem,
        packagePassiveItemCreate({
          id: `codepol.packageTargets.loading:${item.targetId}`,
          label: 'Loading package analysis...',
          iconId: 'clock',
        }),
      ];
    }

    if (state.status === 'empty') {
      return [
        renameItem,
        packagePassiveItemCreate({
          id: `codepol.packageTargets.unavailable:${item.targetId}`,
          label: 'Analysis unavailable',
        }),
      ];
    }

    if (state.status === 'error') {
      return [
        renameItem,
        packagePassiveItemCreate({
          id: `codepol.packageTargets.error:${item.targetId}`,
          label: 'Unable to load package analysis',
          tooltip: state.message,
          iconId: 'warning',
        }),
      ];
    }

    return [renameItem, ...workspacePackageAnalysisChildrenCreate(state.analysis)];
  }

  private workspacePackageAnalysisLoadStart(item: WorkspacePackageItem): void {
    const previousState = this.packageAnalysisStates.get(item.targetId);
    const resolvedPrevious =
      previousState && previousState.status !== 'loading' ? previousState : undefined;
    const generation = this.refreshGeneration;

    this.packageAnalysisStates.set(item.targetId, {
      status: 'loading',
      generation,
      previous: resolvedPrevious,
    });

    if (!this.packageAnalysisLoad) {
      this.packageAnalysisStates.set(item.targetId, {
        status: 'empty',
      });
      this.emitter.fire(this.packageItems.get(item.targetId));
      return;
    }

    void this.packageAnalysisLoad(item.candidate)
      .then((analysis) => {
        if (generation !== this.refreshGeneration) {
          return;
        }
        if (!analysis) {
          this.packageAnalysisStates.set(item.targetId, {
            status: 'empty',
          });
          return;
        }
        this.packageAnalysisStates.set(item.targetId, {
          status: 'ready',
          analysis,
        });
      })
      .catch((error: unknown) => {
        if (generation !== this.refreshGeneration) {
          return;
        }
        if (codepolRequestSupersededErrorIs(error)) {
          const currentState = this.packageAnalysisStates.get(item.targetId);
          const fallbackState =
            currentState?.status === 'loading' ? currentState.previous : undefined;
          this.packageAnalysisStates.set(
            item.targetId,
            fallbackState ?? { status: 'empty' },
          );
          return;
        }
        this.packageAnalysisStates.set(item.targetId, {
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        if (generation !== this.refreshGeneration) {
          return;
        }
        this.emitter.fire(this.packageItems.get(item.targetId));
      });
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

function packagePassiveItemCreate(input: {
  id: string;
  label: string;
  description?: string;
  tooltip?: string;
  iconId?: string;
}): vscode.TreeItem {
  return new StaticTreeItem(input.label, {
    id: input.id,
    description: input.description,
    tooltip: input.tooltip ?? [input.label, input.description].filter(Boolean).join('\n'),
    iconPath: new vscode.ThemeIcon(input.iconId ?? 'circle-slash'),
  });
}

function countLabelCreate(value: number, singular: string, plural: string): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

function workspacePackageAnalysisChildrenCreate(
  analysis: WorkspacePackageAnalysis,
): vscode.TreeItem[] {
  const items: vscode.TreeItem[] = [];

  items.push(
    packagePassiveItemCreate({
      id: `codepol.packageTargets.identity:${analysis.target.targetId}`,
      label: 'Identity',
      description: [
        analysis.identity.workspaceRelativePackageDir,
        analysis.identity.workspaceRelativeEntryPointPath,
      ].join(' • '),
      tooltip: [
        analysis.packageName,
        `Semantic class: ${analysis.identity.semanticClass}`,
        `Package dir: ${analysis.identity.workspaceRelativePackageDir}`,
        `package.json: ${analysis.identity.workspaceRelativePackageJsonPath}`,
        `Entry point: ${analysis.identity.workspaceRelativeEntryPointPath}`,
      ].join('\n'),
      iconId: 'tag',
    }),
  );

  if (analysis.renameImpact.status === 'ready') {
    items.push(
      packagePassiveItemCreate({
        id: `codepol.packageTargets.renameImpact:${analysis.target.targetId}`,
        label: 'Rename Impact',
        description: [
          analysis.renameImpact.namespaceId,
          countLabelCreate(analysis.renameImpact.impactedSiteCount, 'site', 'sites'),
        ].join(' • '),
        tooltip: [
          `Namespace: ${analysis.renameImpact.namespaceId}`,
          `Impacted sites: ${analysis.renameImpact.impactedSiteCount}`,
          analysis.renameImpact.declarationUri
            ? `Declaration: ${analysis.renameImpact.declarationUri}`
            : undefined,
        ].filter(Boolean).join('\n'),
        iconId: 'symbol-namespace',
      }),
    );
  } else {
    items.push(
      packagePassiveItemCreate({
        id: `codepol.packageTargets.renameImpact:${analysis.target.targetId}`,
        label: 'Rename Impact',
        description: 'unavailable',
        tooltip: analysis.renameImpact.message,
        iconId: 'warning',
      }),
    );
  }

  if (analysis.semanticSummary.status === 'ready') {
    items.push(
      packagePassiveItemCreate({
        id: `codepol.packageTargets.semantic:${analysis.target.targetId}`,
        label: 'Semantic Summary',
        description:
          analysis.semanticSummary.summary ??
          analysis.semanticSummary.statusText ??
          analysis.semanticSummary.title,
        tooltip: [
          analysis.semanticSummary.title,
          analysis.semanticSummary.subtitle,
          analysis.semanticSummary.summary,
          analysis.semanticSummary.statusText,
          ...analysis.semanticSummary.fields.map(
            (field) => `${field.label}: ${field.value}`,
          ),
        ].filter(Boolean).join('\n'),
        iconId: 'symbol-module',
      }),
    );
  } else {
    items.push(
      packagePassiveItemCreate({
        id: `codepol.packageTargets.semantic:${analysis.target.targetId}`,
        label: 'Semantic Summary',
        description: 'unavailable',
        tooltip: analysis.semanticSummary.message,
      }),
    );
  }

  if (analysis.hierarchy.status === 'ready') {
    const hierarchyDescription = [
      countLabelCreate(analysis.hierarchy.moduleCount, 'module', 'modules'),
      countLabelCreate(analysis.hierarchy.symbolCount, 'symbol', 'symbols'),
      countLabelCreate(analysis.hierarchy.entryPointCount, 'entry', 'entries'),
    ].join(' • ');
    items.push(
      packagePassiveItemCreate({
        id: `codepol.packageTargets.hierarchy:${analysis.target.targetId}`,
        label: 'Workspace Hierarchy',
        description: hierarchyDescription,
        tooltip: [
          `Boundary: ${analysis.identity.workspaceRelativePackageDir}`,
          `Modules: ${analysis.hierarchy.moduleCount}`,
          `Symbols: ${analysis.hierarchy.symbolCount}`,
          `Entry points: ${analysis.hierarchy.entryPointCount}`,
          `Cycle files: ${analysis.hierarchy.cycleFileCount}`,
          analysis.hierarchy.loc !== undefined ? `LOC: ${analysis.hierarchy.loc}` : undefined,
        ].filter(Boolean).join('\n'),
        iconId: 'type-hierarchy',
      }),
    );
  } else {
    items.push(
      packagePassiveItemCreate({
        id: `codepol.packageTargets.hierarchy:${analysis.target.targetId}`,
        label: 'Workspace Hierarchy',
        description: 'unavailable',
        tooltip: analysis.hierarchy.message,
      }),
    );
  }

  if (analysis.dependencies.status !== 'ready') {
    items.push(
      packagePassiveItemCreate({
        id: `codepol.packageTargets.dependencies:${analysis.target.targetId}`,
        label: 'Dependencies',
        description: 'unavailable',
        tooltip: analysis.dependencies.message,
      }),
    );
    return items;
  }

  items.push(
    workspacePackageDependencyGroupCreate({
      id: `codepol.packageTargets.dependsOn:${analysis.target.targetId}`,
      label: 'Depends On',
      dependencies: analysis.dependencies.dependsOn,
      groupId: 'dependsOn',
      emptyLabel: 'No package dependencies',
      iconId: 'arrow-right',
    }),
    workspacePackageDependencyGroupCreate({
      id: `codepol.packageTargets.usedBy:${analysis.target.targetId}`,
      label: 'Used By',
      dependencies: analysis.dependencies.usedBy,
      groupId: 'usedBy',
      emptyLabel: 'No package dependents',
      iconId: 'arrow-left',
    }),
  );

  return items;
}

function workspacePackageDependencyGroupCreate(input: {
  id: string;
  label: string;
  dependencies: WorkspacePackageDependencySummary[];
  groupId: 'dependsOn' | 'usedBy';
  emptyLabel: string;
  iconId: string;
}): vscode.TreeItem {
  if (input.dependencies.length === 0) {
    return packagePassiveItemCreate({
      id: input.id,
      label: input.label,
      description: input.emptyLabel,
      iconId: input.iconId,
    });
  }

  return Object.assign(
    new StaticTreeItem(input.label, {
      id: input.id,
      description: countLabelCreate(input.dependencies.length, 'package', 'packages'),
      collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
      tooltip: [
        input.label,
        ...input.dependencies.map(
          (dependency) =>
            `${dependency.packageName}: ${dependency.edgeCount} edge${dependency.edgeCount === 1 ? '' : 's'}`,
        ),
      ].join('\n'),
      iconPath: new vscode.ThemeIcon(input.iconId),
    }),
    {
      kind: 'workspace_package_dependency_group' as const,
      groupId: input.groupId,
      dependencies: input.dependencies,
    },
  );
}

function lintRuleGroupLabelResolve(kind: LintRulesGroupKind): string {
  switch (kind) {
    case 'native_preferred':
      return 'Native Preferred';
    case 'keep_wrapped':
      return 'Keep Wrapped';
    default:
      return 'Pending Analysis';
  }
}

function lintRuleAnalysisLabelResolve(
  state: WorkspaceLintRuleSummary['analysisState'],
): string {
  switch (state) {
    case 'ready':
      return 'Ready';
    case 'error':
      return 'Error';
    default:
      return 'Pending';
  }
}

function lintRuleGroupIconResolve(kind: LintRulesGroupKind): vscode.ThemeIcon {
  switch (kind) {
    case 'native_preferred':
      return new vscode.ThemeIcon('shield');
    case 'keep_wrapped':
      return new vscode.ThemeIcon('link-external');
    default:
      return new vscode.ThemeIcon('clock');
  }
}

function lintRuleDescriptionCreate(rule: WorkspaceLintRuleSummary): string {
  const severity =
    rule.severities.length === 1 ? rule.severities[0] : 'mixed';
  const providers =
    [...new Set(rule.providers.map((provider) => provider.platform))].join(',') || 'none';
  const diagnosticCount =
    rule.recentNativeDiagnosticCount + rule.recentWrappedDiagnosticCount;
  const analysisLabel =
    rule.analysisState === 'ready'
      ? `${diagnosticCount} diag`
      : rule.analysisState === 'error'
        ? 'analysis error'
        : 'pending';
  return `${severity} • ${providers} • ${analysisLabel}`;
}

function lintRuleTooltipCreate(rule: WorkspaceLintRuleSummary): string {
  const lines = [
    rule.ruleId,
    `Ownership: ${lintRuleGroupLabelResolve(rule.ownership)}`,
    `Analysis: ${rule.analysisState}`,
    `Severities: ${rule.severities.join(', ') || 'none'}`,
    `Providers: ${rule.providers.map((provider) => provider.platform).join(', ') || 'none'}`,
    `Languages: ${rule.languages.join(', ') || 'none'}`,
    `Targets: ${rule.targetPatterns.join(', ') || 'none'}`,
    `Fix surface: ${rule.fixSurfaceNotes.join(', ') || 'none'}`,
  ];
  if (rule.analyzerIssues.length > 0) {
    lines.push(`Issues: ${rule.analyzerIssues.join(' | ')}`);
  }
  return lines.join('\n');
}

function lintRuleIconResolve(rule: WorkspaceLintRuleSummary): vscode.ThemeIcon {
  if (rule.analysisState === 'error') {
    return new vscode.ThemeIcon('warning');
  }
  if (rule.analysisState === 'pending') {
    return new vscode.ThemeIcon('clock');
  }
  return new vscode.ThemeIcon('symbol-key');
}

function lintRuleDiagnosticCountLabelCreate(count: number): string {
  return `${count} diagnostic${count === 1 ? '' : 's'}`;
}

function lintRuleProviderLabelsCreate(
  details: WorkspaceLintRuleDetailsResult,
): string[] {
  return details.rule.providers.map(
    (provider) => `${provider.platform} (${provider.languages.join(', ') || 'all'})`,
  );
}

function lintRuleMetadataItemCreate(input: {
  id: string;
  label: string;
  description: string;
  tooltip?: string;
  iconId: string;
}): vscode.TreeItem {
  return new StaticTreeItem(input.label, {
    id: input.id,
    description: input.description,
    tooltip: input.tooltip ?? `${input.label}\n${input.description}`,
    iconPath: new vscode.ThemeIcon(input.iconId),
  });
}

function lintRulePassiveItemCreate(input: {
  id: string;
  label: string;
  tooltip?: string;
  iconId?: string;
}): vscode.TreeItem {
  return new StaticTreeItem(input.label, {
    id: input.id,
    tooltip: input.tooltip ?? input.label,
    iconPath: new vscode.ThemeIcon(input.iconId ?? 'circle-slash'),
  });
}

function lintRuleDiagnosticIconResolve(severity: string): vscode.ThemeIcon {
  switch (severity) {
    case 'error':
      return new vscode.ThemeIcon('error');
    case 'warning':
      return new vscode.ThemeIcon('warning');
    default:
      return new vscode.ThemeIcon('info');
  }
}

function lintRuleHasFixProvider(rule: WorkspaceLintRuleSummary): boolean {
  return rule.fixSurfaceNotes.includes('fix_provider');
}

export class LintRulesTreeProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>
{
  private readonly emitter = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private rulesPromise: Promise<WorkspaceLintRuleSummary[]> | undefined;
  private lastResolvedRules: WorkspaceLintRuleSummary[] = [];
  private readonly ruleItems = new Map<string, LintRuleItem>();
  private readonly ruleDetailStates = new Map<string, LintRuleDetailsState>();
  private refreshGeneration = 0;

  constructor(
    private readonly rulesLoad: () => Promise<WorkspaceLintRuleSummary[]>,
    private readonly ruleDetailsLoad: (
      ruleId: string,
    ) => Promise<WorkspaceLintRuleDetailsResult | null>,
  ) {}

  refresh(): void {
    this.refreshGeneration += 1;
    this.rulesPromise = undefined;
    this.ruleItems.clear();
    this.ruleDetailStates.clear();
    this.emitter.fire(undefined);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    const rules = await this.rulesGet();
    if (!element) {
      if (rules.length === 0) {
        return [
          new StaticTreeItem('No configured lint rules', {
            id: 'codepol.lintRule.empty',
            description: 'Refresh after editing codepol.toml',
            iconPath: new vscode.ThemeIcon('circle-slash'),
          }),
        ];
      }

      return ([
        'pending_analysis',
        'native_preferred',
        'keep_wrapped',
      ] as const)
        .map((kind) => ({
          kind,
          count: rules.filter((rule) => rule.ownership === kind).length,
        }))
        .filter((entry) => entry.count > 0)
        .map((entry) =>
          Object.assign(
            new StaticTreeItem(lintRuleGroupLabelResolve(entry.kind), {
              id: `codepol.lintRule.group:${entry.kind}`,
              collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
              description: String(entry.count),
              iconPath: lintRuleGroupIconResolve(entry.kind),
            }),
            {
              kind: 'lint_rule_group' as const,
              groupKind: entry.kind,
            },
          ),
        );
    }

    const item = element as
      | LintRulesGroupItem
      | LintRuleItem
      | LintRuleAnalyzerIssuesItem
      | LintRuleDiagnosticFileItem
      | LintRuleDiagnosticItem;
    if (item.kind === 'lint_rule_group') {
      return rules
        .filter((rule) => rule.ownership === item.groupKind)
        .sort((left, right) => left.ruleId.localeCompare(right.ruleId))
        .map((rule) => this.ruleItemGet(rule));
    }
    if (item.kind === 'lint_rule') {
      return this.ruleChildrenGet(item.ruleId);
    }
    if (item.kind === 'lint_rule_analyzer_issues') {
      return item.analyzerIssues.map((issue, index) =>
        new StaticTreeItem(issue, {
          id: `codepol.lintRule.issue:${item.ruleId}:${index}`,
          tooltip: issue,
          iconPath: new vscode.ThemeIcon('warning'),
        }),
      );
    }
    if (item.kind === 'lint_rule_diagnostic_file') {
      return item.diagnosticGroup.diagnostics.map((diagnostic, index) =>
        Object.assign(
          new StaticTreeItem(diagnostic.message, {
            id: [
              'codepol.lintRule.diagnostic',
              item.ruleId,
              item.diagnosticGroup.uri,
              diagnostic.range.start.line,
              diagnostic.range.start.character,
              index,
            ].join(':'),
            description:
              `${diagnostic.severity} • ` +
              `${diagnostic.range.start.line + 1}:${diagnostic.range.start.character + 1}`,
            tooltip: [
              diagnostic.message,
              item.diagnosticGroup.workspaceRelativePath,
              `${diagnostic.severity} • ${diagnostic.range.start.line + 1}:${diagnostic.range.start.character + 1}`,
            ].join('\n'),
            iconPath: lintRuleDiagnosticIconResolve(diagnostic.severity),
            contextValue: item.fixSupported
              ? 'codepol.lintRuleDiagnostic.fixable'
              : 'codepol.lintRuleDiagnostic',
            command: {
              command: CODEPOL_EXTENSION_COMMAND_OPEN_LINT_RULE_LOCATION,
              title: 'Open Lint Rule Location',
              arguments: [
                {
                  uri: item.diagnosticGroup.uri,
                  line: diagnostic.range.start.line,
                  character: diagnostic.range.start.character,
                },
              ],
            },
          }),
          {
            kind: 'lint_rule_diagnostic' as const,
            ruleId: item.ruleId,
            uri: item.diagnosticGroup.uri,
            message: diagnostic.message,
            range: diagnostic.range,
          },
        ),
      );
    }

    return [];
  }

  private async rulesGet(): Promise<WorkspaceLintRuleSummary[]> {
    if (!this.rulesPromise) {
      this.rulesPromise = this.rulesLoad()
        .then((rules) => {
          this.lastResolvedRules = rules;
          return rules;
        })
        .catch((error: unknown) => {
          if (codepolRequestSupersededErrorIs(error)) {
            return this.lastResolvedRules;
          }
          throw error;
        });
    }
    return this.rulesPromise;
  }

  private ruleItemGet(rule: WorkspaceLintRuleSummary): LintRuleItem {
    const existing = this.ruleItems.get(rule.ruleId);
    const item = existing ?? Object.assign(new StaticTreeItem(rule.ruleId), {
      kind: 'lint_rule' as const,
      ruleId: rule.ruleId,
    });

    Object.assign(item, {
      id: `codepol.lintRule.rule:${rule.ruleId}`,
      label: rule.ruleId,
      description: lintRuleDescriptionCreate(rule),
      tooltip: lintRuleTooltipCreate(rule),
      iconPath: lintRuleIconResolve(rule),
      collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
      contextValue: 'codepol.lintRule',
      command: undefined,
    } satisfies Partial<vscode.TreeItem>);

    this.ruleItems.set(rule.ruleId, item);
    return item;
  }

  private async ruleChildrenGet(ruleId: string): Promise<vscode.TreeItem[]> {
    const state = this.ruleDetailStates.get(ruleId);
    if (!state) {
      this.ruleDetailsLoadStart(ruleId);
      return [
        lintRulePassiveItemCreate({
          id: `codepol.lintRule.loading:${ruleId}`,
          label: 'Loading details...',
          iconId: 'clock',
        }),
      ];
    }

    if (state.status === 'loading') {
      return [
        lintRulePassiveItemCreate({
          id: `codepol.lintRule.loading:${ruleId}`,
          label: 'Loading details...',
          iconId: 'clock',
        }),
      ];
    }

    if (state.status === 'empty') {
      return [
        lintRulePassiveItemCreate({
          id: `codepol.lintRule.unavailable:${ruleId}`,
          label: 'Details unavailable right now',
        }),
      ];
    }

    if (state.status === 'error') {
      return [
        lintRulePassiveItemCreate({
          id: `codepol.lintRule.error:${ruleId}`,
          label: 'Unable to load details right now',
          tooltip: state.message,
          iconId: 'warning',
        }),
      ];
    }

    return this.ruleChildrenFromDetailsCreate(state.details);
  }

  private ruleDetailsLoadStart(ruleId: string): void {
    const previousState = this.ruleDetailStates.get(ruleId);
    const resolvedPrevious =
      previousState && previousState.status !== 'loading' ? previousState : undefined;
    const generation = this.refreshGeneration;

    this.ruleDetailStates.set(ruleId, {
      status: 'loading',
      generation,
      previous: resolvedPrevious,
    });

    void this.ruleDetailsLoad(ruleId)
      .then((details) => {
        if (generation !== this.refreshGeneration) {
          return;
        }
        if (!details) {
          this.ruleDetailStates.set(ruleId, {
            status: 'empty',
          });
          return;
        }
        this.ruleDetailStates.set(ruleId, {
          status: 'ready',
          details,
        });
      })
      .catch((error: unknown) => {
        if (generation !== this.refreshGeneration) {
          return;
        }
        if (codepolRequestSupersededErrorIs(error)) {
          const currentState = this.ruleDetailStates.get(ruleId);
          const fallbackState =
            currentState?.status === 'loading' ? currentState.previous : undefined;
          if (fallbackState) {
            this.ruleDetailStates.set(ruleId, fallbackState);
          } else {
            this.ruleDetailStates.set(ruleId, {
              status: 'empty',
            });
          }
          return;
        }
        this.ruleDetailStates.set(ruleId, {
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        if (generation !== this.refreshGeneration) {
          return;
        }
        this.emitter.fire(this.ruleItems.get(ruleId));
      });
  }

  private ruleChildrenFromDetailsCreate(
    details: WorkspaceLintRuleDetailsResult,
  ): vscode.TreeItem[] {
    const ruleId = details.rule.ruleId;
    const items: vscode.TreeItem[] = [];

    items.push(
      lintRuleMetadataItemCreate({
        id: `codepol.lintRule.overview:${ruleId}`,
        label: 'Overview',
        description: [
          lintRuleAnalysisLabelResolve(details.rule.analysisState),
          lintRuleGroupLabelResolve(details.rule.ownership),
          lintRuleDiagnosticCountLabelCreate(details.totalDiagnosticCount),
        ].join(' • '),
        tooltip: [
          details.rule.ruleId,
          `Analysis: ${lintRuleAnalysisLabelResolve(details.rule.analysisState)}`,
          `Ownership: ${lintRuleGroupLabelResolve(details.rule.ownership)}`,
          `Total diagnostics: ${details.totalDiagnosticCount}`,
          `Native diagnostics: ${details.rule.recentNativeDiagnosticCount}`,
          `Wrapped diagnostics: ${details.rule.recentWrappedDiagnosticCount}`,
        ].join('\n'),
        iconId: lintRuleIconResolve(details.rule).id,
      }),
    );

    const providerLabels = lintRuleProviderLabelsCreate(details);
    if (providerLabels.length > 0) {
      items.push(
        lintRuleMetadataItemCreate({
          id: `codepol.lintRule.providers:${ruleId}`,
          label: 'Providers',
          description: providerLabels.join(' • '),
          tooltip: [
            'Providers',
            ...details.rule.providers.map((provider) => [
              `${provider.platform} (${provider.languages.join(', ') || 'all'})`,
              provider.configSummary,
            ].filter(Boolean).join('\n')),
          ].join('\n\n'),
          iconId: 'link',
        }),
      );
    }

    if (details.rule.targetPatterns.length > 0) {
      items.push(
        lintRuleMetadataItemCreate({
          id: `codepol.lintRule.targets:${ruleId}`,
          label: 'Targets',
          description: details.rule.targetPatterns.join(', '),
          tooltip: ['Targets', ...details.rule.targetPatterns].join('\n'),
          iconId: 'files',
        }),
      );
    }

    if (details.rule.fixSurfaceNotes.length > 0) {
      items.push(
        lintRuleMetadataItemCreate({
          id: `codepol.lintRule.fixSurface:${ruleId}`,
          label: 'Fix Surface',
          description: details.rule.fixSurfaceNotes.join(', '),
          tooltip: ['Fix Surface', ...details.rule.fixSurfaceNotes].join('\n'),
          iconId: 'wrench',
        }),
      );
    }

    if (details.rule.analyzerIssues.length > 0) {
      items.push(
        Object.assign(
          new StaticTreeItem(
            `Analyzer Issues (${details.rule.analyzerIssues.length})`,
            {
              id: `codepol.lintRule.analyzerIssues:${ruleId}`,
              collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
              tooltip: details.rule.analyzerIssues.join('\n'),
              iconPath: new vscode.ThemeIcon('warning'),
            },
          ),
          {
            kind: 'lint_rule_analyzer_issues' as const,
            ruleId,
            analyzerIssues: details.rule.analyzerIssues,
          },
        ),
      );
    }

    items.push(
      ...details.groups.map((group) =>
        Object.assign(
          new StaticTreeItem(group.workspaceRelativePath, {
            id: `codepol.lintRule.file:${ruleId}:${group.uri}`,
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
            description: String(group.diagnostics.length),
            tooltip: [
              group.workspaceRelativePath,
              lintRuleDiagnosticCountLabelCreate(group.diagnostics.length),
            ].join('\n'),
            iconPath: new vscode.ThemeIcon('file'),
          }),
          {
            kind: 'lint_rule_diagnostic_file' as const,
            ruleId,
            diagnosticGroup: group,
            fixSupported: lintRuleHasFixProvider(details.rule),
          },
        ),
      ),
    );

    if (details.groups.length === 0) {
      items.push(
        lintRulePassiveItemCreate({
          id: `codepol.lintRule.noDiagnostics:${ruleId}`,
          label: 'No current workspace diagnostics',
        }),
      );
    }

    return items;
  }
}
