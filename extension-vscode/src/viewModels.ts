import type {
  WorkspacePrepareRenameResult,
  WorkspaceRenamePreviewResult,
  WorkspaceSemanticDefinitionResult,
  WorkspaceSemanticHoverAction,
  WorkspaceSemanticHoverResult,
  WorkspaceSemanticReferencesResult,
} from '@codepol/core';
import type { RenameTargetCandidate } from './discovery';

export type PanelLocationViewModel = {
  uri: string;
  label: string;
  detail?: string;
  line: number;
  character: number;
};

export type HoverActionViewModel = {
  action: WorkspaceSemanticHoverAction;
  label: string;
};

export type HoverCardViewModel = {
  title: string;
  subtitle?: string;
  summary?: string;
  statusText?: string;
  fields: Array<{ label: string; value: string }>;
  actions: HoverActionViewModel[];
};

export type SemanticDefinitionPanelViewModel = {
  uri: string;
  hoverCard: HoverCardViewModel | null;
  locations: PanelLocationViewModel[];
};

export type SemanticReferencesPanelGroupViewModel = {
  group: string;
  totalCount: number;
  truncated: boolean;
  items: PanelLocationViewModel[];
};

export type SemanticReferencesPanelViewModel = {
  uri: string;
  hoverCard: HoverCardViewModel | null;
  totalItems: number;
  totalAvailableItems: number;
  truncated: boolean;
  groups: SemanticReferencesPanelGroupViewModel[];
};

export type RenamePreviewPanelGroupViewModel = {
  title: string;
  edits: Array<{
    uri: string;
    line: number;
    character: number;
    oldText: string;
    newText: string;
    kind: string;
  }>;
};

export type RenamePreviewPanelViewModel = {
  targetLabel: string;
  prepareMessage?: string;
  currentName?: string;
  namespaceId?: string;
  impactedSiteCount?: number;
  namingRules: string[];
  previewMessage?: string;
  oldName?: string;
  newName?: string;
  groups: RenamePreviewPanelGroupViewModel[];
  warnings: string[];
  blockingIssues: string[];
  canApply: boolean;
  planId?: string;
  applyMessage?: string;
};

function hoverActionLabelResolve(action: WorkspaceSemanticHoverAction): string {
  switch (action) {
    case 'go_to_definition':
      return 'Go To Definition';
    case 'find_references':
      return 'Show Architecture Links';
    case 'show_graph':
      return 'Show Graph';
  }
}

export function semanticHoverCardViewModelCreate(
  hover: WorkspaceSemanticHoverResult | null,
): HoverCardViewModel | null {
  if (!hover) {
    return null;
  }

  return {
    title: hover.title,
    subtitle: hover.subtitle,
    summary: hover.summary,
    statusText: hover.statusText,
    fields: hover.fields.map((field) => ({
      label: field.label,
      value: field.value,
    })),
    actions: (hover.actions ?? []).map((action) => ({
      action,
      label: hoverActionLabelResolve(action),
    })),
  };
}

function locationViewModelCreate(input: {
  uri: string;
  line: number;
  character: number;
  label: string;
  detail?: string;
}): PanelLocationViewModel {
  return {
    uri: input.uri,
    line: input.line,
    character: input.character,
    label: input.label,
    detail: input.detail,
  };
}

export function semanticDefinitionPanelViewModelCreate(input: {
  uri: string;
  definition: WorkspaceSemanticDefinitionResult | null;
  hover: WorkspaceSemanticHoverResult | null;
}): SemanticDefinitionPanelViewModel {
  const locations: PanelLocationViewModel[] = [];
  if (input.definition) {
    locations.push(
      locationViewModelCreate({
        uri: input.definition.location.uri,
        line: input.definition.location.range.start.line,
        character: input.definition.location.range.start.character,
        label: 'Canonical location',
        detail: input.definition.location.uri,
      }),
    );
  }

  return {
    uri: input.uri,
    hoverCard: semanticHoverCardViewModelCreate(input.hover),
    locations,
  };
}

export function semanticReferencesPanelViewModelCreate(input: {
  uri: string;
  references: WorkspaceSemanticReferencesResult | null;
  hover: WorkspaceSemanticHoverResult | null;
}): SemanticReferencesPanelViewModel {
  return {
    uri: input.uri,
    hoverCard: semanticHoverCardViewModelCreate(input.hover),
    totalItems: input.references?.totalItems ?? 0,
    totalAvailableItems: input.references?.totalAvailableItems ?? 0,
    truncated: input.references?.truncated ?? false,
    groups:
      input.references?.groups.map((group) => ({
        group: group.group,
        totalCount: group.totalCount,
        truncated: group.truncated,
        items: group.items.map((item) =>
          locationViewModelCreate({
            uri: item.location.uri,
            line: item.location.range.start.line,
            character: item.location.range.start.character,
            label: item.label,
            detail: item.detail,
          }),
        ),
      })) ?? [],
  };
}

function namingRuleLinesCreate(
  prepare: Extract<WorkspacePrepareRenameResult, { ok: true }>,
): string[] {
  const rules: string[] = [];
  if (prepare.namingRules.patternDescription) {
    rules.push(`Pattern: ${prepare.namingRules.patternDescription}`);
  }
  if (prepare.namingRules.casePolicy) {
    rules.push(`Case policy: ${prepare.namingRules.casePolicy}`);
  }
  if (prepare.namingRules.minLength !== undefined) {
    rules.push(`Min length: ${prepare.namingRules.minLength}`);
  }
  if (prepare.namingRules.maxLength !== undefined) {
    rules.push(`Max length: ${prepare.namingRules.maxLength}`);
  }
  return rules;
}

function renameGroupTitleResolve(group: string): string {
  switch (group) {
    case 'declarations':
      return 'Declarations';
    case 'references':
      return 'References';
    case 'config':
      return 'Config';
    case 'metadata':
      return 'Metadata';
    case 'labels':
      return 'Labels';
    default:
      return group;
  }
}

export function renamePreviewPanelViewModelCreate(input: {
  candidate?: RenameTargetCandidate;
  prepare: WorkspacePrepareRenameResult;
  preview?: WorkspaceRenamePreviewResult;
  applyMessage?: string;
}): RenamePreviewPanelViewModel {
  const targetLabel =
    input.candidate?.label ??
    (input.prepare.ok ? input.prepare.displayName : 'Codepol rename');
  const namingRules = input.prepare.ok ? namingRuleLinesCreate(input.prepare) : [];

  if (!input.preview) {
    return {
      targetLabel,
      prepareMessage: input.prepare.ok ? undefined : input.prepare.message,
      currentName: input.prepare.ok ? input.prepare.currentName : undefined,
      namespaceId: input.prepare.ok ? input.prepare.namespaceId : undefined,
      impactedSiteCount: input.prepare.ok ? input.prepare.impactedSiteCount : undefined,
      namingRules,
      groups: [],
      warnings: [],
      blockingIssues: [],
      canApply: false,
      applyMessage: input.applyMessage,
    };
  }

  if (!input.preview.ok) {
    return {
      targetLabel,
      prepareMessage: input.prepare.ok ? undefined : input.prepare.message,
      currentName: input.prepare.ok ? input.prepare.currentName : undefined,
      namespaceId: input.prepare.ok ? input.prepare.namespaceId : undefined,
      impactedSiteCount: input.prepare.ok ? input.prepare.impactedSiteCount : undefined,
      namingRules,
      previewMessage: input.preview.message,
      groups: [],
      warnings: [],
      blockingIssues: [],
      canApply: false,
      applyMessage: input.applyMessage,
    };
  }

  return {
    targetLabel,
    prepareMessage: input.prepare.ok ? undefined : input.prepare.message,
    currentName: input.prepare.ok ? input.prepare.currentName : undefined,
    namespaceId: input.preview.namespaceId,
    impactedSiteCount: input.prepare.ok ? input.prepare.impactedSiteCount : undefined,
    namingRules,
    previewMessage: input.preview.canApply ? undefined : 'Preview is blocked.',
    oldName: input.preview.oldName,
    newName: input.preview.newName,
    groups: input.preview.groups.map((group) => ({
      title: renameGroupTitleResolve(group.group),
      edits: group.edits.map((edit) => ({
        uri: edit.uri,
        line: edit.range.start.line,
        character: edit.range.start.character,
        oldText: edit.oldText,
        newText: edit.newText,
        kind: edit.kind,
      })),
    })),
    warnings: input.preview.warnings.map((warning) => warning.message),
    blockingIssues: input.preview.blockingIssues.map((issue) => issue.message),
    canApply: input.preview.canApply && Boolean(input.preview.plan),
    planId: input.preview.plan?.id,
    applyMessage: input.applyMessage,
  };
}
