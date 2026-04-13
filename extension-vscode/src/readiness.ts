import type { IndexStatusResult } from '@codepol/core';
import {
  sidebarIndexStatusCreate,
  type SidebarTone,
} from './sidebarModels';

export type CodepolReadinessSnapshot = {
  status: IndexStatusResult | null;
  errorMessage?: string;
};

export type CodepolReadinessState =
  | 'unknown'
  | 'cold'
  | 'warming'
  | 'replay_pending'
  | 'ready'
  | 'error';

export type CodepolReadinessFeature =
  | 'semanticSearch'
  | 'dependencyGraph'
  | 'architectureSummary'
  | 'architectureLinks'
  | 'workspacePackageRename';

export type CodepolFeatureGate = {
  blocked: boolean;
  state: CodepolReadinessState;
  message?: string;
};

export type CodepolStatusBarPresentation = {
  text: string;
  tooltip: string;
  tone: SidebarTone;
};

function featureLabelResolve(feature: CodepolReadinessFeature): string {
  switch (feature) {
    case 'semanticSearch':
      return 'semantic search';
    case 'dependencyGraph':
      return 'dependency graph';
    case 'architectureSummary':
      return 'architecture summary';
    case 'architectureLinks':
      return 'architecture links';
    case 'workspacePackageRename':
      return 'workspace package rename';
  }
}

function blockedSuffixResolve(state: CodepolReadinessState): string {
  switch (state) {
    case 'cold':
      return 'while the workspace index is preparing.';
    case 'warming':
      return 'while the workspace index is warming.';
    case 'replay_pending':
      return 'while Codepol restores workspace state.';
    default:
      return 'until the workspace is ready.';
  }
}

function blockedMessageResolve(
  feature: CodepolReadinessFeature,
  state: CodepolReadinessState,
): string {
  const suffix = blockedSuffixResolve(state);
  if (feature === 'architectureLinks') {
    return `Codepol architecture links are blocked ${suffix}`;
  }
  return `Codepol ${featureLabelResolve(feature)} is blocked ${suffix}`;
}

export function codepolReadinessStateResolve(
  snapshot: CodepolReadinessSnapshot,
): CodepolReadinessState {
  if (snapshot.status?.status === 'error' || snapshot.errorMessage) {
    return 'error';
  }
  if (snapshot.status?.replayState === 'pending') {
    return 'replay_pending';
  }
  if (snapshot.status?.status === 'cold') {
    return 'cold';
  }
  if (snapshot.status?.status === 'warming') {
    return 'warming';
  }
  if (snapshot.status?.status === 'ready') {
    return 'ready';
  }
  return 'unknown';
}

export function codepolFeatureBlockedMessageResolve(
  snapshot: CodepolReadinessSnapshot,
  feature: CodepolReadinessFeature,
): string | undefined {
  const state = codepolReadinessStateResolve(snapshot);
  if (state !== 'cold' && state !== 'warming' && state !== 'replay_pending') {
    return undefined;
  }
  return blockedMessageResolve(feature, state);
}

export function codepolFeatureUnavailableMessageResolve(
  snapshot: CodepolReadinessSnapshot,
  feature: CodepolReadinessFeature,
): string {
  const label = featureLabelResolve(feature);
  const detail = snapshot.status?.lastError ?? snapshot.errorMessage;

  if (detail) {
    return `Codepol ${label} failed: ${detail}. Open the Codepol view for workspace status.`;
  }

  return `Codepol ${label} is not available for this workspace yet. Open the Codepol view for workspace status.`;
}

export function codepolFeatureGateResolve(
  snapshot: CodepolReadinessSnapshot,
  feature: CodepolReadinessFeature,
): CodepolFeatureGate {
  const state = codepolReadinessStateResolve(snapshot);
  const message = codepolFeatureBlockedMessageResolve(snapshot, feature);
  return {
    blocked: message !== undefined,
    state,
    message,
  };
}

export function codepolIndexBackedCommandsEnabledResolve(
  snapshot: CodepolReadinessSnapshot,
): boolean {
  return !codepolFeatureGateResolve(snapshot, 'semanticSearch').blocked;
}

export function codepolWorkspacePackageRenameEnabledResolve(
  snapshot: CodepolReadinessSnapshot,
): boolean {
  return !codepolFeatureGateResolve(snapshot, 'workspacePackageRename').blocked;
}

function statusBarIconResolve(state: CodepolReadinessState): string {
  switch (state) {
    case 'cold':
      return '$(clock)';
    case 'warming':
    case 'replay_pending':
      return '$(sync~spin)';
    case 'ready':
      return '$(check)';
    case 'error':
      return '$(error)';
    default:
      return '$(pulse)';
  }
}

function statusBarLabelResolve(state: CodepolReadinessState): string {
  switch (state) {
    case 'cold':
      return 'Preparing';
    case 'warming':
      return 'Warming';
    case 'replay_pending':
      return 'Restoring';
    case 'ready':
      return 'Ready';
    case 'error':
      return 'Error';
    default:
      return 'Checking';
  }
}

export function codepolStatusBarPresentationCreate(
  snapshot: CodepolReadinessSnapshot,
): CodepolStatusBarPresentation {
  const state = codepolReadinessStateResolve(snapshot);
  const indexStatus = sidebarIndexStatusCreate(snapshot);
  const lines = [
    `Codepol: ${indexStatus.headline}`,
    indexStatus.detail,
  ];

  for (const feature of indexStatus.features) {
    const detail = feature.detail ? ` — ${feature.detail}` : '';
    lines.push(`${feature.label}: ${feature.readiness}${detail}`);
  }
  if (indexStatus.lastError) {
    lines.push(`Last error: ${indexStatus.lastError}`);
  }
  lines.push('Click to open the Codepol view.');

  return {
    text: `${statusBarIconResolve(state)} Codepol ${statusBarLabelResolve(state)}`,
    tooltip: lines.join('\n'),
    tone: indexStatus.tone,
  };
}
