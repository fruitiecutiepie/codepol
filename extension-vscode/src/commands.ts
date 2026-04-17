import type {
  WorkspaceLintRuleDetailsResult,
  WorkspacePrepareRenameResult,
  WorkspaceRange,
  WorkspaceRenamePreviewResult,
  WorkspaceSearchResult,
  WorkspaceSupportedRenameTarget,
} from '@codepol/core';
import type { RenameTargetCandidate } from './discovery';
import type {
  CodepolProtocolQuickFixAction,
  CodepolProtocolClient,
} from './protocolClient';
import type {
  CodepolReadinessFeature,
  CodepolReadinessSnapshot,
} from './readiness';
import {
  codepolFeatureGateResolve,
  codepolFeatureUnavailableMessageResolve,
  codepolRequestSupersededErrorIs,
  codepolReadinessStateResolve,
} from './readiness';
import type {
  ArchitectureLinksPanelViewModel,
  ArchitectureSummaryPanelViewModel,
  DependencyGraphPanelViewModel,
  LintRuleDetailsPanelViewModel,
  RenamePreviewPanelViewModel,
  SemanticDefinitionPanelViewModel,
} from './viewModels';
import {
  architectureLinksPanelViewModelCreate,
  architectureSummaryPanelViewModelCreate,
  dependencyGraphPanelViewModelCreate,
  lintRuleDetailsPanelViewModelCreate,
  renamePreviewPanelViewModelCreate,
  semanticDefinitionPanelViewModelCreate,
} from './viewModels';

export type RenameCommandOptions = {
  target?: WorkspaceSupportedRenameTarget;
  newName?: string;
  autoApply?: boolean;
};

export type SemanticSearchCommandOptions = {
  query?: string;
  autoOpenFirstResult?: boolean;
};

type OpenLocationInput = {
  uri: string;
  line: number;
  character: number;
};

export type LintRuleDiagnosticQuickFixCommandInput = {
  ruleId: string;
  uri: string;
  message: string;
  range: WorkspaceRange;
};

export type CodepolPanels = {
  showArchitectureSummary(input: ArchitectureSummaryPanelViewModel): void;
  showDependencyGraph(input: DependencyGraphPanelViewModel): void;
  showSemanticDefinition(input: SemanticDefinitionPanelViewModel): void;
  showArchitectureLinks(input: ArchitectureLinksPanelViewModel): void;
  showLintRuleDetails(input: LintRuleDetailsPanelViewModel): void;
  showRenamePreview(input: RenamePreviewPanelViewModel): void;
};

export type CodepolCommandHost = {
  activeUriGet(): string | undefined;
  readinessSnapshotGet(): CodepolReadinessSnapshot;
  semanticSearchInitialQueryResolve(): string | undefined;
  semanticSearchPick(input: {
    initialQuery: string;
    queryResults(query: string): Promise<WorkspaceSearchResult[] | null>;
  }): Promise<WorkspaceSearchResult | null | undefined>;
  renameTargetsLoad(): Promise<RenameTargetCandidate[]>;
  renameTargetPick(
    candidates: RenameTargetCandidate[],
  ): Promise<RenameTargetCandidate | undefined>;
  renamePrompt(input: {
    title: string;
    value: string;
    namingRules: string[];
  }): Promise<string | undefined>;
  quickPick<T>(input: {
    title: string;
    placeholder?: string;
    items: Array<{
      label: string;
      description?: string;
      detail?: string;
      value: T;
    }>;
  }): Promise<T | undefined>;
  infoShow(message: string): void | Promise<void>;
  errorShow(message: string): void | Promise<void>;
  openLocation(input: OpenLocationInput): Promise<void>;
};

function namingRulesCreate(prepare: WorkspacePrepareRenameResult): string[] {
  if (!prepare.ok) {
    return [];
  }

  const rules: string[] = [];
  if (prepare.namingRules.patternDescription) {
    rules.push(prepare.namingRules.patternDescription);
  }
  if (prepare.namingRules.casePolicy) {
    rules.push(`Case: ${prepare.namingRules.casePolicy}`);
  }
  return rules;
}

function lintRuleQuickFixesSort(
  left: CodepolProtocolQuickFixAction,
  right: CodepolProtocolQuickFixAction,
): number {
  const preferredDelta =
    Number(Boolean(right.isPreferred)) - Number(Boolean(left.isPreferred));
  if (preferredDelta !== 0) {
    return preferredDelta;
  }
  return left.title.localeCompare(right.title);
}

export class CodepolCommandController {
  private static readonly REQUEST_SUPERSEDED = Symbol('request_superseded');

  constructor(
    private readonly protocol: CodepolProtocolClient,
    private readonly panels: CodepolPanels,
    private readonly host: CodepolCommandHost,
  ) {}

  private async protocolRequestRun<TResult>(
    request: Promise<TResult>,
  ): Promise<TResult | typeof CodepolCommandController.REQUEST_SUPERSEDED> {
    try {
      return await request;
    } catch (error) {
      if (codepolRequestSupersededErrorIs(error)) {
        return CodepolCommandController.REQUEST_SUPERSEDED;
      }
      throw error;
    }
  }

  private async protocolOptionalRequestRun<TResult>(
    request: Promise<TResult>,
  ): Promise<TResult | null> {
    const result = await this.protocolRequestRun(request);
    return result === CodepolCommandController.REQUEST_SUPERSEDED ? null : result;
  }

  private featureBlockedMessageResolve(
    feature: CodepolReadinessFeature,
  ): string | undefined {
    return codepolFeatureGateResolve(
      this.host.readinessSnapshotGet(),
      feature,
    ).message;
  }

  private featureUnavailableMessageResolve(
    feature: CodepolReadinessFeature,
    fallback: string,
  ): string {
    const snapshot = this.host.readinessSnapshotGet();
    const state = codepolReadinessStateResolve(snapshot);
    if (state === 'error' || state === 'unknown') {
      return codepolFeatureUnavailableMessageResolve(snapshot, feature);
    }
    return fallback;
  }

  async showSemanticSearch(
    options: SemanticSearchCommandOptions = {},
  ): Promise<WorkspaceSearchResult | null> {
    const blockedMessage = this.featureBlockedMessageResolve('semanticSearch');
    if (blockedMessage) {
      await this.host.errorShow(blockedMessage);
      return null;
    }

    const initialQuery =
      options.query ?? this.host.semanticSearchInitialQueryResolve() ?? '';

    if (options.autoOpenFirstResult === true) {
      const results = await this.protocolRequestRun(
        this.protocol.querySemanticSearch(initialQuery),
      );
      if (results === CodepolCommandController.REQUEST_SUPERSEDED) {
        return null;
      }
      if (!results) {
        await this.host.errorShow(
          this.featureUnavailableMessageResolve(
            'semanticSearch',
            'Codepol semantic search is not available for this workspace yet.',
          ),
        );
        return null;
      }
      const firstResult = results[0];
      if (!firstResult) {
        await this.host.infoShow(
          initialQuery.length > 0
            ? `No Codepol semantic search results matched "${initialQuery}".`
            : 'No Codepol semantic search results are available yet.',
        );
        return null;
      }
      await this.host.openLocation({
        uri: firstResult.location.uri,
        line: firstResult.location.range.start.line,
        character: firstResult.location.range.start.character,
      });
      return firstResult;
    }

    const picked = await this.host.semanticSearchPick({
      initialQuery,
      queryResults: (query) => this.protocol.querySemanticSearch(query),
    });
    if (picked === null) {
      await this.host.errorShow(
        this.featureUnavailableMessageResolve(
          'semanticSearch',
          'Codepol semantic search is not available for this workspace yet.',
        ),
      );
      return null;
    }
    if (!picked) {
      return null;
    }

    await this.host.openLocation({
      uri: picked.location.uri,
      line: picked.location.range.start.line,
      character: picked.location.range.start.character,
    });
    return picked;
  }

  async showSemanticDefinition(uri?: string): Promise<SemanticDefinitionPanelViewModel | null> {
    const targetUri = uri ?? this.host.activeUriGet();
    if (!targetUri) {
      await this.host.errorShow('Open a workspace file before requesting a semantic definition.');
      return null;
    }

    const [definition, hover] = await Promise.all([
      this.protocolRequestRun(this.protocol.querySemanticDefinition(targetUri)),
      this.protocolOptionalRequestRun(this.protocol.querySemanticHover(targetUri)),
    ]);
    if (definition === CodepolCommandController.REQUEST_SUPERSEDED) {
      return null;
    }
    const model = semanticDefinitionPanelViewModelCreate({
      uri: targetUri,
      definition,
      hover,
    });

    this.panels.showSemanticDefinition(model);
    if (definition) {
      await this.host.openLocation({
        uri: definition.location.uri,
        line: definition.location.range.start.line,
        character: definition.location.range.start.character,
      });
    }
    return model;
  }

  async showArchitectureSummary(): Promise<ArchitectureSummaryPanelViewModel | null> {
    const blockedMessage = this.featureBlockedMessageResolve('architectureSummary');
    if (blockedMessage) {
      await this.host.errorShow(blockedMessage);
      return null;
    }

    const summary = await this.protocolRequestRun(
      this.protocol.queryArchitectureSummary(),
    );
    if (summary === CodepolCommandController.REQUEST_SUPERSEDED) {
      return null;
    }
    if (!summary) {
      await this.host.errorShow(
        this.featureUnavailableMessageResolve(
          'architectureSummary',
          'Codepol architecture summary is not available for this workspace yet.',
        ),
      );
      return null;
    }

    const model = architectureSummaryPanelViewModelCreate({ summary });
    this.panels.showArchitectureSummary(model);
    return model;
  }

  async showDependencyGraph(
    uri?: string,
  ): Promise<DependencyGraphPanelViewModel | null> {
    const blockedMessage = this.featureBlockedMessageResolve('dependencyGraph');
    if (blockedMessage) {
      await this.host.errorShow(blockedMessage);
      return null;
    }

    const focusUri = uri ?? this.host.activeUriGet();
    const [graph, summary] = await Promise.all([
      this.protocolRequestRun(this.protocol.queryDependencyGraph()),
      this.protocolOptionalRequestRun(this.protocol.queryArchitectureSummary()),
    ]);
    if (graph === CodepolCommandController.REQUEST_SUPERSEDED) {
      return null;
    }
    if (!graph) {
      await this.host.errorShow(
        this.featureUnavailableMessageResolve(
          'dependencyGraph',
          'Codepol dependency graph is not available for this workspace yet.',
        ),
      );
      return null;
    }

    const model = dependencyGraphPanelViewModelCreate({
      graph,
      summary,
      focusUri,
    });
    this.panels.showDependencyGraph(model);
    return model;
  }

  async showArchitectureLinks(uri?: string): Promise<ArchitectureLinksPanelViewModel | null> {
    const targetUri = uri ?? this.host.activeUriGet();
    if (!targetUri) {
      await this.host.errorShow('Open a workspace file before requesting architecture links.');
      return null;
    }

    const blockedMessage = this.featureBlockedMessageResolve('architectureLinks');
    if (blockedMessage) {
      await this.host.errorShow(blockedMessage);
      return null;
    }

    const [references, hover, graph, summary] = await Promise.all([
      this.protocolRequestRun(this.protocol.querySemanticReferences(targetUri)),
      this.protocolOptionalRequestRun(this.protocol.querySemanticHover(targetUri)),
      this.protocolOptionalRequestRun(this.protocol.queryDependencyGraph()),
      this.protocolOptionalRequestRun(this.protocol.queryArchitectureSummary()),
    ]);
    if (references === CodepolCommandController.REQUEST_SUPERSEDED) {
      return null;
    }
    const model = architectureLinksPanelViewModelCreate({
      uri: targetUri,
      references,
      hover,
      graph,
      summary,
    });
    this.panels.showArchitectureLinks(model);
    return model;
  }

  async showLintRuleDetails(
    ruleId: string,
  ): Promise<WorkspaceLintRuleDetailsResult | null> {
    const details = await this.protocolRequestRun(
      this.protocol.queryLintRuleDetails(ruleId),
    );
    if (details === CodepolCommandController.REQUEST_SUPERSEDED) {
      return null;
    }
    if (!details) {
      await this.host.errorShow(`No Codepol lint rule details are available for ${ruleId}.`);
      return null;
    }

    const model = lintRuleDetailsPanelViewModelCreate({
      details,
    });
    this.panels.showLintRuleDetails(model);
    return details;
  }

  async showLintRuleDiagnosticFixes(
    input: LintRuleDiagnosticQuickFixCommandInput,
  ): Promise<CodepolProtocolQuickFixAction | null> {
    const actions = await this.protocolRequestRun(
      this.protocol.queryCodeActions({
        uri: input.uri,
        range: input.range,
      }),
    );
    if (actions === CodepolCommandController.REQUEST_SUPERSEDED) {
      return null;
    }

    const sortedActions = [...actions].sort(lintRuleQuickFixesSort);
    if (sortedActions.length === 0) {
      await this.host.infoShow(
        `No Codepol quick fixes are available for ${input.ruleId} at this diagnostic.`,
      );
      return null;
    }

    const selectedAction =
      sortedActions.length === 1
        ? sortedActions[0]
        : await this.host.quickPick({
            title: `Quick Fix: ${input.ruleId}`,
            placeholder: 'Select a Codepol quick fix to apply',
            items: sortedActions.map((action) => ({
              label: action.title,
              description: action.isPreferred ? 'Preferred quick fix' : 'Quick fix',
              detail: input.message,
              value: action,
            })),
          });
    if (!selectedAction) {
      return null;
    }

    await this.protocol.applyEditPlan(selectedAction.planId);
    return selectedAction;
  }

  async renameCodepolEntity(
    options: RenameCommandOptions = {},
  ): Promise<WorkspacePrepareRenameResult | WorkspaceRenamePreviewResult | null> {
    const selection = await this.renameTargetResolve(options.target);
    if (!selection) {
      return null;
    }

    const prepare = await this.protocolRequestRun(
      this.protocol.prepareRename(selection.target),
    );
    if (prepare === CodepolCommandController.REQUEST_SUPERSEDED) {
      return null;
    }
    if (!prepare) {
      await this.host.errorShow(
        selection.kind === 'workspace_package'
          ? this.featureUnavailableMessageResolve(
              'workspacePackageRename',
              'Codepol rename is not available for this workspace yet.',
            )
          : 'Codepol rename is not available for this workspace yet.',
      );
      return null;
    }
    if (!prepare.ok) {
      await this.host.errorShow(prepare.message);
      return prepare;
    }

    const newName =
      options.newName ??
      (await this.host.renamePrompt({
        title: `Rename ${selection.label}`,
        value: prepare.currentName,
        namingRules: namingRulesCreate(prepare),
      }));
    if (newName === undefined) {
      return prepare;
    }

    const preview = await this.protocolRequestRun(
      this.protocol.previewRename(selection.target, newName),
    );
    if (preview === CodepolCommandController.REQUEST_SUPERSEDED) {
      return prepare;
    }
    if (!preview) {
      await this.host.errorShow('Rename preview is not available for this workspace yet.');
      return null;
    }

    if (
      options.autoApply === true &&
      preview.ok &&
      preview.canApply &&
      preview.plan
    ) {
      await this.protocol.applyEditPlan(preview.plan.id);
      await this.host.infoShow(`Applied rename for ${selection.label}.`);
      return preview;
    }

    const model = renamePreviewPanelViewModelCreate({
      candidate: selection,
      prepare,
      preview,
    });
    this.panels.showRenamePreview(model);
    return preview;
  }

  private async renameTargetResolve(
    target?: WorkspaceSupportedRenameTarget,
  ): Promise<RenameTargetCandidate | undefined> {
    const renameGate = codepolFeatureGateResolve(
      this.host.readinessSnapshotGet(),
      'workspacePackageRename',
    );

    if (target) {
      if (target.semanticClass === 'domain_entity' && renameGate.blocked) {
        await this.host.errorShow(renameGate.message!);
        return undefined;
      }
      return {
        kind:
          target.semanticClass === 'domain_entity'
            ? 'workspace_package'
            : 'config_target',
        label: target.targetId,
        description: '',
        detail: '',
        target,
      };
    }

    const candidates = await this.host.renameTargetsLoad();
    if (candidates.length === 0) {
      await this.host.errorShow('No renameable Codepol targets were discovered in the current workspace.');
      return undefined;
    }

    if (!renameGate.blocked) {
      return this.host.renameTargetPick(candidates);
    }

    const configTargets = candidates.filter(
      (candidate) => candidate.kind === 'config_target',
    );
    if (configTargets.length === 0) {
      await this.host.errorShow(renameGate.message!);
      return undefined;
    }

    const workspacePackageCount = candidates.length - configTargets.length;
    if (workspacePackageCount > 0) {
      await this.host.infoShow(
        `${renameGate.message!} Config target rename is still available.`,
      );
    }
    return this.host.renameTargetPick(configTargets);
  }
}
