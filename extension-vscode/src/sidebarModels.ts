import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  IndexStatusResult,
  WorkspaceFeatureStatus,
  WorkspaceSearchResult,
  WorkspaceSemanticHoverResult,
} from '@codepol/core';
import { semanticSearchQuickPickItemsCreate } from './semanticSearch';
import {
  semanticHoverCardViewModelCreate,
  type HoverActionViewModel,
} from './viewModels';

export type SidebarTone = 'neutral' | 'success' | 'warning' | 'error';

export type SidebarSearchResultViewModel = {
  uri: string;
  line: number;
  character: number;
  title: string;
  subtitle?: string;
  detail?: string;
  scoreLabel: string;
};

/**
 * Sidebar-only synthetic action kinds. Distinct from
 * {@link HoverActionViewModel.action} (which is sourced from the
 * workspace service's hover result) — these actions are appended by
 * the sidebar itself and don't have a server-side representation.
 *
 * Phase 9.5 / Gap 3 — `show_type_hierarchy` opens the dedicated
 * type-hierarchy panel, defaulting `includeStructural: true`. The
 * sidebar always offers it on TypeScript files so users can ask
 * "what implements this?" in one click; the controller's cursor
 * resolution surfaces a clear error when the cursor is not on a
 * class / interface / type alias.
 */
export type SidebarSyntheticActionKind = 'show_type_hierarchy';

export type SidebarActionViewModel = (
  | HoverActionViewModel
  | { action: SidebarSyntheticActionKind; label: string }
) & {
  disabled?: boolean;
  disabledReason?: string;
};

export type SidebarActiveTargetViewModel = {
  uri?: string;
  title: string;
  subtitle?: string;
  summary?: string;
  statusText?: string;
  fields: Array<{ label: string; value: string }>;
  actions: SidebarActionViewModel[];
  message?: string;
  tone: SidebarTone;
};

export type SidebarMetricViewModel = {
  label: string;
  value: string;
};

export type SidebarFeatureViewModel = {
  label: string;
  readiness: string;
  detail?: string;
  tone: SidebarTone;
};

export type SidebarIndexStatusViewModel = {
  headline: string;
  detail: string;
  tone: SidebarTone;
  metrics: SidebarMetricViewModel[];
  features: SidebarFeatureViewModel[];
  lastError?: string;
};

export type SidebarRecentTargetViewModel = {
  uri: string;
  line: number;
  character: number;
  title: string;
  subtitle?: string;
  detail?: string;
  sourceLabel: string;
};

function uriPathResolve(uri: string): string {
  try {
    return fileURLToPath(uri);
  } catch {
    return uri;
  }
}

function uriBasenameResolve(uri: string): string {
  const filePath = uriPathResolve(uri);
  const basename = path.basename(filePath);
  return basename.length > 0 ? basename : uri;
}

function capitalize(value: string): string {
  return value.length > 0 ? `${value[0]!.toUpperCase()}${value.slice(1)}` : value;
}

function toneFromWorkspaceStatus(status: IndexStatusResult['status']): SidebarTone {
  switch (status) {
    case 'ready':
      return 'success';
    case 'warming':
    case 'cold':
      return 'warning';
    case 'error':
      return 'error';
    default:
      return 'neutral';
  }
}

function toneFromFeatureStatus(status: WorkspaceFeatureStatus): SidebarTone {
  switch (status.readiness) {
    case 'ready':
      return 'success';
    case 'cold':
    case 'warming':
      return 'warning';
    case 'degraded':
    case 'error':
      return 'error';
    default:
      return 'neutral';
  }
}

function featureViewModelCreate(
  label: string,
  status: WorkspaceFeatureStatus | undefined,
): SidebarFeatureViewModel | null {
  if (!status) {
    return null;
  }

  return {
    label,
    readiness: capitalize(status.readiness),
    detail: status.detail,
    tone: toneFromFeatureStatus(status),
  };
}

export function sidebarSearchResultsCreate(
  results: WorkspaceSearchResult[],
  query: string,
): SidebarSearchResultViewModel[] {
  if (results.length === 0) {
    return [];
  }

  const items = semanticSearchQuickPickItemsCreate(results, query);
  return results.map((result, index) => {
    const item = items[index];
    return {
      uri: result.location.uri,
      line: result.location.range.start.line,
      character: result.location.range.start.character,
      title: item?.label ?? result.name,
      subtitle: item?.description,
      detail: item?.detail,
      scoreLabel: `score ${Math.round(result.score)}`,
    };
  });
}

/**
 * Build the synthetic "Show Type Hierarchy" action appended to the
 * active-target card whenever an editor is open. The controller's
 * `cursorSymbolResolve` path validates the symbol kind on click; the
 * sidebar does not pre-filter, so the button is always present
 * (matching the editor context-menu affordance).
 */
function sidebarShowTypeHierarchyActionCreate(
  disabledMessage: string | undefined,
): SidebarActionViewModel {
  const action: SidebarActionViewModel = {
    action: 'show_type_hierarchy',
    label: 'Show Type Hierarchy',
  };
  if (disabledMessage) {
    action.disabled = true;
    action.disabledReason = disabledMessage;
  }
  return action;
}

export function sidebarActiveTargetCreate(input: {
  activeUri?: string;
  hover: WorkspaceSemanticHoverResult | null;
  errorMessage?: string;
  disabledActionMessages?: Partial<
    Record<HoverActionViewModel['action'] | SidebarSyntheticActionKind, string>
  >;
}): SidebarActiveTargetViewModel {
  if (!input.activeUri) {
    return {
      title: 'No active file',
      message: 'Open a workspace file to inspect its Codepol semantic target.',
      fields: [],
      actions: [],
      tone: 'neutral',
    };
  }

  const typeHierarchyAction = sidebarShowTypeHierarchyActionCreate(
    input.disabledActionMessages?.show_type_hierarchy,
  );

  const card = semanticHoverCardViewModelCreate(input.hover);
  if (card) {
    const cardActions: SidebarActionViewModel[] = card.actions.map((action) => {
      const disabledReason = input.disabledActionMessages?.[action.action];
      return disabledReason
        ? {
            ...action,
            disabled: true,
            disabledReason,
          }
        : action;
    });
    return {
      uri: input.activeUri,
      title: card.title,
      subtitle: card.subtitle,
      summary: card.summary,
      statusText: card.statusText,
      fields: card.fields,
      actions: [...cardActions, typeHierarchyAction],
      tone: 'neutral',
    };
  }

  return {
    uri: input.activeUri,
    title: uriBasenameResolve(input.activeUri),
    subtitle: uriPathResolve(input.activeUri),
    message:
      input.errorMessage ?? 'No Codepol semantic summary is available for this file yet.',
    fields: [],
    actions: [typeHierarchyAction],
    tone: input.errorMessage ? 'warning' : 'neutral',
  };
}

export function sidebarIndexStatusCreate(input: {
  status: IndexStatusResult | null;
  errorMessage?: string;
}): SidebarIndexStatusViewModel {
  if (!input.status) {
    return {
      headline: 'Index status unavailable',
      detail:
        input.errorMessage ?? 'Codepol has not reported workspace readiness yet.',
      tone: input.errorMessage ? 'warning' : 'neutral',
      metrics: [],
      features: [],
      lastError: input.errorMessage,
    };
  }

  const status = input.status;
  const detailParts = [`${status.indexedFileCount} indexed files`];
  if (status.workspaceReady !== undefined) {
    detailParts.push(status.workspaceReady ? 'workspace ready' : 'workspace not ready');
  }
  if (status.replayState) {
    detailParts.push(`replay ${status.replayState}`);
  }

  const features = [
    featureViewModelCreate('Workspace Index', status.featureStatus?.workspaceIndex),
    featureViewModelCreate('Semantic Search', status.featureStatus?.semanticSearch),
    featureViewModelCreate('Dependency Graph', status.featureStatus?.dependencyGraph),
    featureViewModelCreate(
      'Architecture Summary',
      status.featureStatus?.architectureSummary,
    ),
    featureViewModelCreate('Edit Plans', status.featureStatus?.editPlans),
  ].filter((feature): feature is SidebarFeatureViewModel => feature !== null);

  return {
    headline: capitalize(status.status),
    detail: detailParts.join(' • '),
    tone: toneFromWorkspaceStatus(status.status),
    metrics: [
      { label: 'Indexed files', value: String(status.indexedFileCount) },
      { label: 'Open documents', value: String(status.openDocumentCount) },
      { label: 'Overlays', value: String(status.overlayCount) },
      { label: 'Analysis generation', value: String(status.analysisGeneration) },
    ],
    features,
    lastError: status.lastError,
  };
}

export function sidebarRecentTargetCreate(input: {
  uri: string;
  line: number;
  character: number;
  sourceLabel: string;
  hover?: WorkspaceSemanticHoverResult | null;
  fallbackTitle?: string;
  fallbackSubtitle?: string;
  fallbackDetail?: string;
}): SidebarRecentTargetViewModel {
  const card = semanticHoverCardViewModelCreate(input.hover ?? null);

  return {
    uri: input.uri,
    line: input.line,
    character: input.character,
    title: card?.title ?? input.fallbackTitle ?? uriBasenameResolve(input.uri),
    subtitle: card?.subtitle ?? input.fallbackSubtitle,
    detail: card?.summary ?? input.fallbackDetail ?? uriPathResolve(input.uri),
    sourceLabel: input.sourceLabel,
  };
}

export function sidebarRecentTargetsNext(
  previous: SidebarRecentTargetViewModel[],
  next: SidebarRecentTargetViewModel,
  maxItems = 8,
): SidebarRecentTargetViewModel[] {
  return [next, ...previous.filter((item) => item.uri !== next.uri)].slice(
    0,
    maxItems,
  );
}
