import type {
  WorkspacePrepareRenameResult,
  WorkspaceRenamePreviewResult,
  WorkspaceSupportedRenameTarget,
} from '@codepol/core';
import type { RenameTargetCandidate } from './discovery';
import type {
  CodepolProtocolClient,
} from './protocolClient';
import type {
  RenamePreviewPanelViewModel,
  SemanticDefinitionPanelViewModel,
  SemanticReferencesPanelViewModel,
} from './viewModels';
import {
  renamePreviewPanelViewModelCreate,
  semanticDefinitionPanelViewModelCreate,
  semanticReferencesPanelViewModelCreate,
} from './viewModels';

export type RenameCommandOptions = {
  target?: WorkspaceSupportedRenameTarget;
  newName?: string;
  autoApply?: boolean;
};

type OpenLocationInput = {
  uri: string;
  line: number;
  character: number;
};

export type CodepolPanels = {
  showSemanticDefinition(input: SemanticDefinitionPanelViewModel): void;
  showArchitectureLinks(input: SemanticReferencesPanelViewModel): void;
  showRenamePreview(input: RenamePreviewPanelViewModel): void;
};

export type CodepolCommandHost = {
  activeUriGet(): string | undefined;
  renameTargetsLoad(): Promise<RenameTargetCandidate[]>;
  renameTargetPick(
    candidates: RenameTargetCandidate[],
  ): Promise<RenameTargetCandidate | undefined>;
  renamePrompt(input: {
    title: string;
    value: string;
    namingRules: string[];
  }): Promise<string | undefined>;
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

export class CodepolCommandController {
  constructor(
    private readonly protocol: CodepolProtocolClient,
    private readonly panels: CodepolPanels,
    private readonly host: CodepolCommandHost,
  ) {}

  async showSemanticDefinition(uri?: string): Promise<SemanticDefinitionPanelViewModel | null> {
    const targetUri = uri ?? this.host.activeUriGet();
    if (!targetUri) {
      await this.host.errorShow('Open a workspace file before requesting a semantic definition.');
      return null;
    }

    const [definition, hover] = await Promise.all([
      this.protocol.querySemanticDefinition(targetUri),
      this.protocol.querySemanticHover(targetUri),
    ]);
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

  async showArchitectureLinks(uri?: string): Promise<SemanticReferencesPanelViewModel | null> {
    const targetUri = uri ?? this.host.activeUriGet();
    if (!targetUri) {
      await this.host.errorShow('Open a workspace file before requesting architecture links.');
      return null;
    }

    const [references, hover] = await Promise.all([
      this.protocol.querySemanticReferences(targetUri),
      this.protocol.querySemanticHover(targetUri),
    ]);
    const model = semanticReferencesPanelViewModelCreate({
      uri: targetUri,
      references,
      hover,
    });
    this.panels.showArchitectureLinks(model);
    return model;
  }

  async renameCodepolEntity(
    options: RenameCommandOptions = {},
  ): Promise<WorkspacePrepareRenameResult | WorkspaceRenamePreviewResult | null> {
    const selection = await this.renameTargetResolve(options.target);
    if (!selection) {
      return null;
    }

    const prepare = await this.protocol.prepareRename(selection.target);
    if (!prepare) {
      await this.host.errorShow('Codepol rename is not available for this workspace yet.');
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

    const preview = await this.protocol.previewRename(selection.target, newName);
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
    if (target) {
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
    return this.host.renameTargetPick(candidates);
  }
}
