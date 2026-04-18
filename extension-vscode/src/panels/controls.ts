import type { WorkspaceDependencyGraphEdgeKind } from '@codepol/core';
import type {
  ArchitectureLinksPanelViewModel,
  DependencyGraphFilterState,
  DependencyGraphLayoutMode,
  DependencyGraphPanelViewModel,
} from '../viewModels';

export type DependencyGraphPanelControlState = {
  filters: DependencyGraphFilterState;
  layoutMode: DependencyGraphLayoutMode;
  blastRadiusUri?: string;
};

export type DependencyGraphPanelRebuilder = (
  state: DependencyGraphPanelControlState,
) => DependencyGraphPanelViewModel;

export type ArchitectureLinksPanelRebuilder = (
  state: DependencyGraphPanelControlState,
) => ArchitectureLinksPanelViewModel;

export type DependencyGraphPanelControlMessage =
  | { type: 'graphFilterToggle'; filter?: string }
  | { type: 'graphEdgeKindToggle'; edgeKindChipId?: string }
  | { type: 'graphLayoutSet'; layout?: string }
  | { type: 'graphBlastRadiusSet'; uri?: string | null };

const SUPPORTED_FILTERS: Array<keyof DependencyGraphFilterState> = [
  'crossPackageOnly',
  'crossLayerOnly',
  'hideTests',
];

const SUPPORTED_EDGE_KINDS: WorkspaceDependencyGraphEdgeKind[] = [
  'static',
  'dynamic',
  'side_effect',
  'cjs',
  'type_only',
];

const SUPPORTED_LAYOUTS: DependencyGraphLayoutMode[] = ['layered', 'radial', 'force'];

function filtersToggleBoolean(
  filters: DependencyGraphFilterState,
  key: 'crossPackageOnly' | 'crossLayerOnly' | 'hideTests',
): DependencyGraphFilterState {
  const next: DependencyGraphFilterState = { ...filters };
  if (next[key] === true) {
    next[key] = undefined;
  } else {
    next[key] = true;
  }
  return next;
}

function edgeKindsToggle(
  filters: DependencyGraphFilterState,
  edgeKind: WorkspaceDependencyGraphEdgeKind,
): DependencyGraphFilterState {
  const current = new Set(filters.edgeKinds ?? []);
  if (current.has(edgeKind)) {
    current.delete(edgeKind);
  } else {
    current.add(edgeKind);
  }
  const nextEdgeKinds = SUPPORTED_EDGE_KINDS.filter((kind) => current.has(kind));
  return {
    ...filters,
    edgeKinds: nextEdgeKinds.length > 0 ? nextEdgeKinds : undefined,
  };
}

function edgeKindFromChipIdResolve(
  chipId: string | undefined,
): WorkspaceDependencyGraphEdgeKind | undefined {
  if (!chipId) {
    return undefined;
  }
  const prefix = 'edgeKind:';
  if (!chipId.startsWith(prefix)) {
    return undefined;
  }
  const candidate = chipId.slice(prefix.length) as WorkspaceDependencyGraphEdgeKind;
  return SUPPORTED_EDGE_KINDS.includes(candidate) ? candidate : undefined;
}

function layoutFromMessageResolve(
  layout: string | undefined,
): DependencyGraphLayoutMode | undefined {
  if (!layout) {
    return undefined;
  }
  return SUPPORTED_LAYOUTS.includes(layout as DependencyGraphLayoutMode)
    ? (layout as DependencyGraphLayoutMode)
    : undefined;
}

function controlStateApplyMessage(
  state: DependencyGraphPanelControlState,
  message: DependencyGraphPanelControlMessage,
): DependencyGraphPanelControlState | null {
  if (message.type === 'graphFilterToggle') {
    if (
      message.filter !== 'crossPackageOnly' &&
      message.filter !== 'crossLayerOnly' &&
      message.filter !== 'hideTests'
    ) {
      return null;
    }
    return {
      ...state,
      filters: filtersToggleBoolean(state.filters, message.filter),
    };
  }
  if (message.type === 'graphEdgeKindToggle') {
    const edgeKind = edgeKindFromChipIdResolve(message.edgeKindChipId);
    if (!edgeKind) {
      return null;
    }
    return {
      ...state,
      filters: edgeKindsToggle(state.filters, edgeKind),
    };
  }
  if (message.type === 'graphLayoutSet') {
    const layout = layoutFromMessageResolve(message.layout);
    if (!layout) {
      return null;
    }
    return {
      ...state,
      layoutMode: layout,
    };
  }
  if (message.type === 'graphBlastRadiusSet') {
    if (message.uri === null || message.uri === undefined) {
      return {
        ...state,
        blastRadiusUri: undefined,
      };
    }
    return {
      ...state,
      blastRadiusUri: message.uri,
    };
  }
  return null;
}

export function dependencyGraphControlStateUpdate(
  state: DependencyGraphPanelControlState,
  message: DependencyGraphPanelControlMessage,
): DependencyGraphPanelControlState | null {
  return controlStateApplyMessage(state, message);
}

export function architectureLinksGraphControlStateUpdate(
  state: DependencyGraphPanelControlState,
  message: DependencyGraphPanelControlMessage,
): DependencyGraphPanelControlState | null {
  return controlStateApplyMessage(state, message);
}

export function dependencyGraphControlMessageIs(
  message: { type?: string },
): message is DependencyGraphPanelControlMessage {
  return (
    message.type === 'graphFilterToggle' ||
    message.type === 'graphEdgeKindToggle' ||
    message.type === 'graphLayoutSet' ||
    message.type === 'graphBlastRadiusSet'
  );
}

export const dependencyGraphPanelControlStateInitialDependencyGraph: DependencyGraphPanelControlState = {
  filters: {},
  layoutMode: 'layered',
};

export const dependencyGraphPanelControlStateInitialArchitectureLinks: DependencyGraphPanelControlState = {
  filters: {},
  layoutMode: 'radial',
};

export const SUPPORTED_FILTER_KEYS = SUPPORTED_FILTERS;
export const SUPPORTED_EDGE_KIND_VALUES = SUPPORTED_EDGE_KINDS;
export const SUPPORTED_LAYOUT_MODES = SUPPORTED_LAYOUTS;
