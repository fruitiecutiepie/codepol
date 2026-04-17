import { describe, expect, it, vi } from 'vitest';
import type {
  IndexStatusResult,
  WorkspaceLintRuleDetailsResult,
  WorkspaceLintRuleSummary,
} from '@codepol/core';

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

import {
  CODEPOL_EXTENSION_COMMAND_OPEN_LINT_RULE_LOCATION,
} from '../extension-vscode/src/constants';
import type { RenameTargetCandidate } from '../extension-vscode/src/discovery';
import {
  LintRulesTreeProvider,
  RenameTargetsTreeProvider,
} from '../extension-vscode/src/treeProviders';

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

function deferredCreate<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return {
    promise,
    resolve,
    reject,
  };
}

async function microtasksFlush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
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

const lintRuleSummary: WorkspaceLintRuleSummary = {
  ruleId: '@codepol/plugin/no-interface',
  severities: ['error'],
  targetPatterns: ['src/**/*.ts'],
  providers: [
    {
      platform: 'tree-sitter',
      languages: ['typescript'],
    },
  ],
  languages: ['typescript'],
  ownership: 'native_preferred',
  hasNativeOwner: true,
  recentNativeDiagnosticCount: 1,
  recentWrappedDiagnosticCount: 0,
  recentNativeLatencyMs: 5,
  recentWrappedLatencyMs: 0,
  fixSurfaceNotes: ['tree_check'],
  analysisState: 'ready',
  analyzerIssues: [],
};

const lintRuleDetailsResult: WorkspaceLintRuleDetailsResult = {
  rule: {
    ...lintRuleSummary,
    recentNativeDiagnosticCount: 2,
    recentWrappedDiagnosticCount: 10,
    fixSurfaceNotes: ['tree_check', 'tree_only_code_actions', 'fix_provider'],
    analyzerIssues: ['Native analysis lagged behind wrapped diagnostics.'],
  },
  totalDiagnosticCount: 12,
  groups: [
    {
      uri: 'file:///workspace/src/app.ts',
      workspaceRelativePath: 'src/app.ts',
      diagnostics: [
        {
          severity: 'error',
          message: 'Unused symbol "value".',
          range: {
            start: { line: 2, character: 4 },
            end: { line: 2, character: 9 },
          },
        },
      ],
    },
  ],
};

function requestSupersededErrorCreate(): Error & {
  data: {
    kind: 'request_superseded';
  };
} {
  const error = new Error('Request superseded') as Error & {
    data: {
      kind: 'request_superseded';
    };
  };
  error.data = {
    kind: 'request_superseded',
  };
  return error;
}

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

  it('keeps the last lint rules result when a refresh is superseded', async () => {
    let loads = 0;
    const provider = new LintRulesTreeProvider(
      async () => {
        loads += 1;
        if (loads === 1) {
          return [lintRuleSummary];
        }
        throw requestSupersededErrorCreate();
      },
      async () => lintRuleDetailsResult,
    );

    const firstGroups = await provider.getChildren();
    expect(firstGroups).toHaveLength(1);

    provider.refresh();
    const secondGroups = await provider.getChildren();
    expect(secondGroups).toHaveLength(1);
    expect(secondGroups[0]).toMatchObject({
      label: 'Native Preferred',
      description: '1',
    });
  });

  it('lazy-loads inline lint rule details and renders grouped children', async () => {
    const detailsDeferred = deferredCreate<WorkspaceLintRuleDetailsResult | null>();
    const detailsLoad = vi.fn(async () => detailsDeferred.promise);
    const provider = new LintRulesTreeProvider(
      async () => [lintRuleSummary],
      detailsLoad,
    );

    const groups = await provider.getChildren();
    const group = groups[0]!;
    const rules = await provider.getChildren(group);
    const rule = rules[0]!;

    expect(rule).toMatchObject({
      id: `codepol.lintRule.rule:${lintRuleSummary.ruleId}`,
      label: lintRuleSummary.ruleId,
      contextValue: 'codepol.lintRule',
      collapsibleState: 1,
      command: undefined,
    });

    const loadingChildren = await provider.getChildren(rule);
    expect(detailsLoad).toHaveBeenCalledTimes(1);
    expect(loadingChildren).toMatchObject([
      {
        label: 'Loading details...',
      },
    ]);

    detailsDeferred.resolve(lintRuleDetailsResult);
    await microtasksFlush();

    const children = await provider.getChildren(rule);
    expect(children.map((item) => item.label)).toEqual([
      'Overview',
      'Providers',
      'Targets',
      'Fix Surface',
      'Analyzer Issues (1)',
      'src/app.ts',
    ]);

    const issueGroup = children[4]!;
    expect(issueGroup).toMatchObject({
      collapsibleState: 1,
      iconPath: { id: 'warning' },
    });
    const issueChildren = await provider.getChildren(issueGroup);
    expect(issueChildren).toMatchObject([
      {
        label: 'Native analysis lagged behind wrapped diagnostics.',
      },
    ]);

    const fileGroup = children[5]!;
    expect(fileGroup).toMatchObject({
      label: 'src/app.ts',
      description: '1',
      collapsibleState: 1,
    });

    const fileChildren = await provider.getChildren(fileGroup);
    expect(fileChildren).toMatchObject([
      {
        label: 'Unused symbol "value".',
        description: 'error • 3:5',
        contextValue: 'codepol.lintRuleDiagnostic.fixable',
        command: {
          command: CODEPOL_EXTENSION_COMMAND_OPEN_LINT_RULE_LOCATION,
          arguments: [
            {
              uri: 'file:///workspace/src/app.ts',
              line: 2,
              character: 4,
            },
          ],
        },
      },
    ]);
  });

  it('does not advertise quick fixes on diagnostic items when the rule has no fix provider', async () => {
    const provider = new LintRulesTreeProvider(
      async () => [lintRuleSummary],
      async () => ({
        ...lintRuleDetailsResult,
        rule: {
          ...lintRuleDetailsResult.rule,
          fixSurfaceNotes: ['tree_check'],
        },
      }),
    );

    const groups = await provider.getChildren();
    const rule = (await provider.getChildren(groups[0]!))[0]!;
    await provider.getChildren(rule);
    await microtasksFlush();
    const children = await provider.getChildren(rule);
    const fileGroup = children[5]!;
    const diagnostics = await provider.getChildren(fileGroup);

    expect(diagnostics[0]).toMatchObject({
      contextValue: 'codepol.lintRuleDiagnostic',
    });
  });

  it('renders passive placeholders when lint rule details are unavailable or superseded', async () => {
    const unavailableProvider = new LintRulesTreeProvider(
      async () => [lintRuleSummary],
      async () => null,
    );
    const unavailableGroups = await unavailableProvider.getChildren();
    const unavailableRule = (await unavailableProvider.getChildren(unavailableGroups[0]!))[0]!;
    await unavailableProvider.getChildren(unavailableRule);
    await microtasksFlush();
    await expect(unavailableProvider.getChildren(unavailableRule)).resolves.toMatchObject([
      {
        label: 'Details unavailable right now',
      },
    ]);

    const supersededProvider = new LintRulesTreeProvider(
      async () => [lintRuleSummary],
      async () => {
        throw requestSupersededErrorCreate();
      },
    );
    const supersededGroups = await supersededProvider.getChildren();
    const supersededRule = (await supersededProvider.getChildren(supersededGroups[0]!))[0]!;
    await supersededProvider.getChildren(supersededRule);
    await microtasksFlush();
    await expect(supersededProvider.getChildren(supersededRule)).resolves.toMatchObject([
      {
        label: 'Details unavailable right now',
      },
    ]);
  });

  it('clears cached lint rule details on refresh and loads them again', async () => {
    const detailsLoad = vi.fn(async () => lintRuleDetailsResult);
    const provider = new LintRulesTreeProvider(
      async () => [lintRuleSummary],
      detailsLoad,
    );

    const firstGroups = await provider.getChildren();
    const firstRule = (await provider.getChildren(firstGroups[0]!))[0]!;
    await provider.getChildren(firstRule);
    await microtasksFlush();
    await provider.getChildren(firstRule);
    expect(detailsLoad).toHaveBeenCalledTimes(1);

    provider.refresh();

    const secondGroups = await provider.getChildren();
    const secondRule = (await provider.getChildren(secondGroups[0]!))[0]!;
    const loadingChildren = await provider.getChildren(secondRule);
    expect(loadingChildren).toMatchObject([
      {
        label: 'Loading details...',
      },
    ]);
    expect(detailsLoad).toHaveBeenCalledTimes(2);
  });
});
