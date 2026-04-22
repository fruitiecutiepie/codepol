import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import {
  CODEPOL_EXTENSION_PANEL_ARCHITECTURE_SUMMARY,
  CODEPOL_EXTENSION_PANEL_ARCHITECTURE_LINKS,
  CODEPOL_EXTENSION_PANEL_CALL_GRAPH,
  CODEPOL_EXTENSION_PANEL_DEAD_MODULES,
  CODEPOL_EXTENSION_PANEL_DEPENDENCY_DIFF,
  CODEPOL_EXTENSION_PANEL_DEPENDENCY_GRAPH,
  CODEPOL_EXTENSION_PANEL_DEPENDENCY_PATH,
  CODEPOL_EXTENSION_PANEL_LINT_RULE_DETAILS,
  CODEPOL_EXTENSION_PANEL_RENAME_PREVIEW,
  CODEPOL_EXTENSION_PANEL_SEMANTIC_DEFINITION,
  CODEPOL_EXTENSION_PANEL_TYPE_HIERARCHY,
} from '../constants';
import type {
  ArchitectureLinksPanelViewModel,
  ArchitectureSummaryPanelViewModel,
  DependencyGraphPanelViewModel,
  LintRuleDetailsPanelViewModel,
  RenamePreviewPanelViewModel,
  SemanticDefinitionPanelViewModel,
} from '../viewModels';
import {
  callGraphNodeOpenLocationResolve,
  type CallGraphPanelDepth,
  type CallGraphPanelDirection,
  type CallGraphPanelViewModel,
} from '../callGraphViewModels';
import {
  typeHierarchyNodeOpenLocationResolve,
  type TypeHierarchyPanelDepth,
  type TypeHierarchyPanelDirection,
  type TypeHierarchyPanelViewModel,
} from '../typeHierarchyViewModels';
import {
  DEPENDENCY_PATH_PANEL_MAX_PATHS_VALUES,
  type DependencyPathPanelMaxPaths,
  type DependencyPathPanelViewModel,
} from '../dependencyPathViewModels';
import type { DeadModulesPanelViewModel } from '../deadModulesViewModels';
import type { DependencyDiffPanelViewModel } from '../dependencyDiffViewModels';
import {
  dependencyGraphControlMessageIs,
  dependencyGraphControlStateUpdate,
  type ArchitectureLinksPanelRebuilder,
  type DependencyGraphPanelControlMessage,
  type DependencyGraphPanelControlState,
  type DependencyGraphPanelRebuilder,
} from './controls';
import { codepolHoverActionCommandResolve } from './messages';
import {
  type PanelLensFocus,
  type PanelLensValue,
} from './panelShared';
import { codepolPanelHtmlRender, type CodepolPanelViewModel } from './render';

export type CallGraphPanelControlMessage =
  | {
      type: 'callGraphDirectionSet';
      direction?: string;
    }
  | {
      type: 'callGraphDepthSet';
      depth?: string;
    };

export type TypeHierarchyPanelControlMessage =
  | {
      type: 'typeHierarchyDirectionSet';
      direction?: string;
    }
  | {
      type: 'typeHierarchyDepthSet';
      depth?: string;
    };

/**
 * Chip click on the dependency-path panel. The chip is serialized as a
 * string in the webview; the manager parses it via
 * {@link dependencyPathMaxPathsParse} before calling the rebuilder.
 */
export type DependencyPathPanelControlMessage = {
  type: 'dependencyPathMaxPathsSet';
  maxPaths?: string;
};

/**
 * Dead-modules panel header buttons. The "Use natural entry points"
 * button emits this with `entryPointUris === undefined`; the
 * "Configure entry points..." button emits the separate
 * {@link DeadModulesPanelEntryPointsConfigureRequest} message because
 * the host has to drive a multi-select picker before the rebuilder can
 * fire.
 */
export type DeadModulesPanelControlMessage = {
  type: 'deadModulesEntryPointsSet';
  entryPointUris?: string[];
};

export type DeadModulesPanelEntryPointsConfigureRequest = {
  type: 'deadModulesEntryPointsConfigureRequest';
};

/**
 * Dependency-diff panel header buttons. `choose-baseline` runs a host
 * prompt; `use-configured-baseline` reads the current
 * `codepol.architecture.baselineLabel` value through the host and
 * replays the rebuilder with that label.
 */
export type DependencyDiffChooseBaselineRequest = {
  type: 'dependencyDiffChooseBaselineRequest';
};

export type DependencyDiffUseConfiguredBaselineRequest = {
  type: 'dependencyDiffUseConfiguredBaselineRequest';
};

/**
 * Phase 7 panel lens switcher message. Fired by the
 * `panel-lens-switcher` button row in any panel header. The host
 * routes to the right `show*` controller method based on the
 * `lens` value and uses `focus` as the input argument.
 *
 * `focus` is opaque to the panel — the renderer JSON-stringified the
 * payload onto a data-attribute and the BASE_SCRIPT echoed it back
 * untouched. The host validates / coerces before dispatch.
 */
export type PanelLensSetMessage = {
  type: 'panelLensSet';
  lens?: string;
  focus?: unknown;
};

/**
 * Phase 7 mode-clear message. Fired by the `×` button on a
 * {@link panelModePillHtml} pill. The manager unsets the panel's
 * `mode` and re-renders.
 */
export type PanelModeClearMessage = {
  type: 'panelModeClear';
  modeId?: string;
};

/**
 * Phase 7 call-graph confidence/kind chip messages. Fired by the
 * Confidence and Kind chip rows in the call-graph panel. Currently
 * call-graph-only (the type-hierarchy panel uses a single
 * confidence axis surfaced through its legend).
 */
export type CallGraphConfidenceToggleMessage = {
  type: 'callGraphConfidenceToggle';
  confidence?: string;
};

export type CallGraphKindToggleMessage = {
  type: 'callGraphKindToggle';
  kind?: string;
};

type CodepolPanelMessage =
  | {
      type: 'openLocation';
      uri?: string;
      line?: number;
      character?: number;
    }
  | {
      type: 'hoverAction';
      action?: string;
      uri?: string;
    }
  | {
      type: 'applyPlan';
      planId?: string;
    }
  | DependencyGraphPanelControlMessage
  | CallGraphPanelControlMessage
  | CallGraphConfidenceToggleMessage
  | CallGraphKindToggleMessage
  | TypeHierarchyPanelControlMessage
  | DependencyPathPanelControlMessage
  | DeadModulesPanelControlMessage
  | DeadModulesPanelEntryPointsConfigureRequest
  | DependencyDiffChooseBaselineRequest
  | DependencyDiffUseConfiguredBaselineRequest
  | PanelLensSetMessage
  | PanelModeClearMessage;

type PanelKind =
  | 'semanticDefinition'
  | 'architectureSummary'
  | 'dependencyGraph'
  | 'architectureLinks'
  | 'lintRuleDetails'
  | 'renamePreview'
  | 'callGraph'
  | 'typeHierarchy'
  | 'dependencyPath'
  | 'deadModules'
  | 'dependencyDiff';

/**
 * Rebuilder shape supplied alongside `showCallGraph(model, rebuilder)`.
 * The manager calls it whenever a chip-toggle message arrives so the
 * panel can re-fire `queryCallGraph` with the new direction / depth.
 */
export type CallGraphPanelRebuilder = (input: {
  direction: CallGraphPanelDirection;
  depth: CallGraphPanelDepth;
}) => Promise<CallGraphPanelViewModel | null>;

type CallGraphPanelControls = {
  state: { direction: CallGraphPanelDirection; depth: CallGraphPanelDepth };
  rebuilder: CallGraphPanelRebuilder;
};

/**
 * Rebuilder shape for the type-hierarchy panel. Same shape as
 * {@link CallGraphPanelRebuilder} but the direction values are
 * disjoint (`supertypes` / `subtypes` / `both`).
 */
export type TypeHierarchyPanelRebuilder = (input: {
  direction: TypeHierarchyPanelDirection;
  depth: TypeHierarchyPanelDepth;
}) => Promise<TypeHierarchyPanelViewModel | null>;

type TypeHierarchyPanelControls = {
  state: { direction: TypeHierarchyPanelDirection; depth: TypeHierarchyPanelDepth };
  rebuilder: TypeHierarchyPanelRebuilder;
};

/**
 * Rebuilder shape supplied alongside `showDependencyPath(model, rebuilder)`.
 * The manager calls it whenever the `maxPaths` chip is toggled so the
 * controller can re-fire `queryDependencyPath` with the new cap.
 */
export type DependencyPathPanelRebuilder = (
  input: { maxPaths: DependencyPathPanelMaxPaths },
) => Promise<DependencyPathPanelViewModel | null>;

type DependencyPathPanelControls = {
  state: { maxPaths: DependencyPathPanelMaxPaths };
  rebuilder: DependencyPathPanelRebuilder;
};

/**
 * Rebuilder shape for the dead-modules panel. `entryPointUris` is
 * forwarded directly to `queryDeadModules`; `undefined` (or an empty
 * array) means "natural entry points".
 */
export type DeadModulesPanelRebuilder = (
  input: { entryPointUris?: string[] },
) => Promise<DeadModulesPanelViewModel | null>;

type DeadModulesPanelControls = {
  state: { entryPointUris?: string[] };
  rebuilder: DeadModulesPanelRebuilder;
};

/**
 * Rebuilder shape for the dependency-diff panel. The manager replays it
 * whenever the user chooses a new baseline label (typed prompt) or asks
 * to use the configured baseline label from settings.
 */
export type DependencyDiffPanelRebuilder = (
  input: { baselineLabel: string },
) => Promise<DependencyDiffPanelViewModel | null>;

type DependencyDiffPanelControls = {
  state: { baselineLabel: string };
  rebuilder: DependencyDiffPanelRebuilder;
};

function callGraphPanelControlMessageIs(
  message: CodepolPanelMessage,
): message is CallGraphPanelControlMessage {
  return (
    message.type === 'callGraphDirectionSet' ||
    message.type === 'callGraphDepthSet'
  );
}

function typeHierarchyPanelControlMessageIs(
  message: CodepolPanelMessage,
): message is TypeHierarchyPanelControlMessage {
  return (
    message.type === 'typeHierarchyDirectionSet' ||
    message.type === 'typeHierarchyDepthSet'
  );
}

function callGraphDirectionParse(
  raw: string | undefined,
): CallGraphPanelDirection | undefined {
  if (raw === 'callers' || raw === 'callees' || raw === 'both') return raw;
  return undefined;
}

function callGraphDepthParse(
  raw: string | undefined,
): CallGraphPanelDepth | undefined {
  if (raw === '1') return 1;
  if (raw === '2') return 2;
  if (raw === 'unbounded') return 'unbounded';
  return undefined;
}

function typeHierarchyDirectionParse(
  raw: string | undefined,
): TypeHierarchyPanelDirection | undefined {
  if (raw === 'supertypes' || raw === 'subtypes' || raw === 'both') return raw;
  return undefined;
}

function typeHierarchyDepthParse(
  raw: string | undefined,
): TypeHierarchyPanelDepth | undefined {
  if (raw === '1') return 1;
  if (raw === '2') return 2;
  if (raw === 'unbounded') return 'unbounded';
  return undefined;
}

function dependencyPathPanelControlMessageIs(
  message: CodepolPanelMessage,
): message is DependencyPathPanelControlMessage {
  return message.type === 'dependencyPathMaxPathsSet';
}

function deadModulesPanelControlMessageIs(
  message: CodepolPanelMessage,
): message is DeadModulesPanelControlMessage {
  return message.type === 'deadModulesEntryPointsSet';
}

function deadModulesPanelEntryPointsConfigureRequestIs(
  message: CodepolPanelMessage,
): message is DeadModulesPanelEntryPointsConfigureRequest {
  return message.type === 'deadModulesEntryPointsConfigureRequest';
}

function dependencyPathMaxPathsParse(
  raw: string | undefined,
): DependencyPathPanelMaxPaths | undefined {
  const parsed = Number(raw);
  return DEPENDENCY_PATH_PANEL_MAX_PATHS_VALUES.find((value) => value === parsed);
}

function dependencyDiffChooseBaselineRequestIs(
  message: CodepolPanelMessage,
): message is DependencyDiffChooseBaselineRequest {
  return message.type === 'dependencyDiffChooseBaselineRequest';
}

function dependencyDiffUseConfiguredBaselineRequestIs(
  message: CodepolPanelMessage,
): message is DependencyDiffUseConfiguredBaselineRequest {
  return message.type === 'dependencyDiffUseConfiguredBaselineRequest';
}

const PANEL_LENS_VALUES = ['module', 'links', 'callers', 'type-hierarchy'] as const;

function panelLensValueParse(raw: unknown): PanelLensValue | undefined {
  if (typeof raw !== 'string') return undefined;
  return (PANEL_LENS_VALUES as readonly string[]).includes(raw)
    ? (raw as PanelLensValue)
    : undefined;
}

function panelLensFocusParse(raw: unknown): PanelLensFocus | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const candidate = raw as { kind?: unknown; uri?: unknown; symbolId?: unknown; symbolName?: unknown };
  if (candidate.kind === 'file' && typeof candidate.uri === 'string') {
    return { kind: 'file', uri: candidate.uri };
  }
  if (
    candidate.kind === 'symbol' &&
    typeof candidate.symbolId === 'string'
  ) {
    const focus: PanelLensFocus = { kind: 'symbol', symbolId: candidate.symbolId };
    if (typeof candidate.symbolName === 'string') {
      focus.symbolName = candidate.symbolName;
    }
    return focus;
  }
  return undefined;
}

export type CodepolPanelActions = {
  openLocation(input: {
    uri: string;
    line: number;
    character: number;
  }): Promise<void>;
  applyEditPlan(planId: string): Promise<void>;
  executeCommand(command: string, uri?: string): Promise<void>;
  /**
   * Phase 7 lens switcher. Routes the panel's `View as` button
   * click to the right `show*` controller method without the
   * manager itself owning a `CodepolCommandController` reference
   * (which would create a circular type dependency).
   *
   * The host wires this when constructing the manager (see
   * `extension.ts → activate`) and is responsible for translating
   * the {@link PanelLensValue} + {@link PanelLensFocus} pair into
   * the underlying command call.
   */
  panelLensOpen?(input: {
    lens: PanelLensValue;
    focus: PanelLensFocus;
  }): Promise<void>;
  /**
   * Phase 7 signature-impact mode clear. The host calls
   * `peekSignatureImpact` again with no `mode` to re-open the panel
   * in interactive mode using the already-resolved focus symbol.
   * Implemented as an action rather than wired straight into the
   * manager so the host owns the command surface.
   */
  panelModeClear?(input: {
    modeId: string;
    focus: PanelLensFocus;
  }): Promise<void>;
  /**
   * Run a multi-select picker for the dead-modules panel's "Configure
   * entry points..." button. Returns the chosen URIs (in pick order),
   * or `undefined` when the user cancels.
   *
   * The host injects a vscode-backed implementation; tests can supply a
   * deterministic stub. The panel manager calls this when it receives a
   * {@link DeadModulesPanelEntryPointsConfigureRequest} from the
   * webview.
   */
  deadModulesEntryPointsPick?(input: {
    currentEntryPointUris?: string[];
  }): Promise<string[] | undefined>;
  /**
   * Read the currently configured architecture baseline label from the
   * host. Mirrors the semantics used by `CodepolArchitectureDiffOverlay`
   * (`codepol.architecture.baselineLabel`). Empty string means
   * "disabled / unset".
   */
  architectureBaselineLabelGet?(): string;
  /**
   * Prompt the user for a dependency-diff baseline label. The manager
   * calls this when the panel posts
   * `dependencyDiffChooseBaselineRequest`. Returning `undefined`
   * cancels the re-render.
   */
  architectureBaselineLabelPrompt?(currentLabel: string): Promise<string | undefined>;
};

type DependencyGraphPanelControls = {
  state: DependencyGraphPanelControlState;
  rebuilder: DependencyGraphPanelRebuilder;
};

type ArchitectureLinksPanelControls = {
  state: DependencyGraphPanelControlState;
  rebuilder: ArchitectureLinksPanelRebuilder;
};

type ManagedPanel = {
  panel: vscode.WebviewPanel;
  model: CodepolPanelViewModel;
  dependencyGraphControls?: DependencyGraphPanelControls;
  architectureLinksControls?: ArchitectureLinksPanelControls;
  callGraphControls?: CallGraphPanelControls;
  typeHierarchyControls?: TypeHierarchyPanelControls;
  dependencyPathControls?: DependencyPathPanelControls;
  deadModulesControls?: DeadModulesPanelControls;
  dependencyDiffControls?: DependencyDiffPanelControls;
};

export class CodepolPanelManager implements vscode.Disposable {
  private readonly panels = new Map<PanelKind, ManagedPanel>();

  constructor(private readonly actions: CodepolPanelActions) {}

  dispose(): void {
    for (const entry of this.panels.values()) {
      entry.panel.dispose();
    }
    this.panels.clear();
  }

  showSemanticDefinition(model: SemanticDefinitionPanelViewModel): void {
    this.panelShow('semanticDefinition', {
      kind: 'semanticDefinition',
      title: 'Codepol: Semantic Definition',
      uri: model.uri,
      data: model,
    });
  }

  showArchitectureSummary(model: ArchitectureSummaryPanelViewModel): void {
    this.panelShow('architectureSummary', {
      kind: 'architectureSummary',
      title: 'Codepol: Architecture Summary',
      data: model,
    });
  }

  showDependencyGraph(
    model: DependencyGraphPanelViewModel,
    rebuilder?: DependencyGraphPanelRebuilder,
  ): void {
    this.panelShow('dependencyGraph', {
      kind: 'dependencyGraph',
      title: 'Codepol: Dependency Graph',
      data: model,
    });
    if (rebuilder) {
      const managed = this.panels.get('dependencyGraph');
      if (managed) {
        managed.dependencyGraphControls = {
          state: {
            filters: model.filters,
            layoutMode: model.layoutMode,
            blastRadiusUri: model.blastRadiusUri,
          },
          rebuilder,
        };
      }
    }
  }

  showArchitectureLinks(
    model: ArchitectureLinksPanelViewModel,
    rebuilder?: ArchitectureLinksPanelRebuilder,
  ): void {
    this.panelShow('architectureLinks', {
      kind: 'architectureLinks',
      title: 'Codepol: Architecture Links',
      uri: model.uri,
      data: model,
    });
    if (rebuilder) {
      const managed = this.panels.get('architectureLinks');
      if (managed) {
        managed.architectureLinksControls = {
          state: {
            filters: model.filters,
            layoutMode: model.layoutMode,
            blastRadiusUri: model.blastRadiusUri,
          },
          rebuilder,
        };
      }
    }
  }

  showLintRuleDetails(model: LintRuleDetailsPanelViewModel): void {
    this.panelShow('lintRuleDetails', {
      kind: 'lintRuleDetails',
      title: 'Codepol: Lint Rule Details',
      data: model,
    });
  }

  showRenamePreview(model: RenamePreviewPanelViewModel): void {
    this.panelShow('renamePreview', {
      kind: 'renamePreview',
      title: 'Codepol: Rename Preview',
      data: model,
    });
  }

  showCallGraph(
    model: CallGraphPanelViewModel,
    rebuilder?: CallGraphPanelRebuilder,
  ): void {
    const headingName = model.focusSymbolName.length > 0
      ? model.focusSymbolName
      : '<anonymous>';
    this.panelShow('callGraph', {
      kind: 'callGraph',
      title: `Codepol: Call Graph (${headingName})`,
      data: model,
    });
    if (rebuilder) {
      const managed = this.panels.get('callGraph');
      if (managed) {
        managed.callGraphControls = {
          state: { direction: model.direction, depth: model.depth },
          rebuilder,
        };
      }
    }
  }

  closeCallGraph(): void {
    const managed = this.panels.get('callGraph');
    if (!managed) return;
    managed.panel.dispose();
    this.panels.delete('callGraph');
  }

  /**
   * Show (or refresh) the dedicated type-hierarchy panel.
   * Phase 9.4 / 9.5 — `model.edgeCounts` lets the panel header
   * advertise how many edges came from declared / shape-matched /
   * type-aware sources without the user inspecting the SVG.
   */
  showTypeHierarchy(
    model: TypeHierarchyPanelViewModel,
    rebuilder?: TypeHierarchyPanelRebuilder,
  ): void {
    const headingName = model.focusSymbolName.length > 0
      ? model.focusSymbolName
      : '<anonymous>';
    this.panelShow('typeHierarchy', {
      kind: 'typeHierarchy',
      title: `Codepol: Type Hierarchy (${headingName})`,
      data: model,
    });
    if (rebuilder) {
      const managed = this.panels.get('typeHierarchy');
      if (managed) {
        managed.typeHierarchyControls = {
          state: { direction: model.direction, depth: model.depth },
          rebuilder,
        };
      }
    }
  }

  closeTypeHierarchy(): void {
    const managed = this.panels.get('typeHierarchy');
    if (!managed) return;
    managed.panel.dispose();
    this.panels.delete('typeHierarchy');
  }

  /**
   * Show (or refresh) the dedicated dependency-path panel. The panel
   * answers "why does {from} depend on {to}?" by listing the simple
   * paths the workspace service returned. When a `rebuilder` is
   * supplied, chip clicks replay it with the new `maxPaths` cap.
   */
  showDependencyPath(
    model: DependencyPathPanelViewModel,
    rebuilder?: DependencyPathPanelRebuilder,
  ): void {
    this.panelShow('dependencyPath', {
      kind: 'dependencyPath',
      title: `Codepol: Dependency Path (${model.fromWorkspaceRelativePath} → ${model.toWorkspaceRelativePath})`,
      data: model,
    });
    if (rebuilder) {
      const managed = this.panels.get('dependencyPath');
      if (managed) {
        managed.dependencyPathControls = {
          state: { maxPaths: model.maxPaths },
          rebuilder,
        };
      }
    }
  }

  closeDependencyPath(): void {
    const managed = this.panels.get('dependencyPath');
    if (!managed) return;
    managed.panel.dispose();
    this.panels.delete('dependencyPath');
  }

  /**
   * Show (or refresh) the dedicated dead-modules panel. The panel lists
   * unreachable files grouped by directory. When a `rebuilder` is
   * supplied, the panel header's `Configure entry points...` /
   * `Use natural entry points` buttons replay it with the new entry
   * point set.
   */
  showDeadModules(
    model: DeadModulesPanelViewModel,
    rebuilder?: DeadModulesPanelRebuilder,
  ): void {
    this.panelShow('deadModules', {
      kind: 'deadModules',
      title: 'Codepol: Dead Modules',
      data: model,
    });
    if (rebuilder) {
      const managed = this.panels.get('deadModules');
      if (managed) {
        managed.deadModulesControls = {
          state: {
            entryPointUris:
              model.entryPointUris.length > 0 ? model.entryPointUris : undefined,
          },
          rebuilder,
        };
      }
    }
  }

  closeDeadModules(): void {
    const managed = this.panels.get('deadModules');
    if (!managed) return;
    managed.panel.dispose();
    this.panels.delete('deadModules');
  }

  /**
   * Show (or refresh) the dedicated dependency-diff panel. The panel
   * answers "what changed since baseline X?" by listing added/removed
   * nodes, edges, and cycles. When a `rebuilder` is supplied, the panel
   * header buttons replay it with a new baseline label.
   */
  showDependencyDiff(
    model: DependencyDiffPanelViewModel,
    rebuilder?: DependencyDiffPanelRebuilder,
  ): void {
    this.panelShow('dependencyDiff', {
      kind: 'dependencyDiff',
      title: 'Codepol: Dependency Diff',
      data: model,
    });
    if (rebuilder) {
      const managed = this.panels.get('dependencyDiff');
      if (managed) {
        managed.dependencyDiffControls = {
          state: { baselineLabel: model.baselineLabel },
          rebuilder,
        };
      }
    }
  }

  closeDependencyDiff(): void {
    const managed = this.panels.get('dependencyDiff');
    if (!managed) return;
    managed.panel.dispose();
    this.panels.delete('dependencyDiff');
  }

  private panelShow(kind: PanelKind, model: CodepolPanelViewModel): void {
    const existing = this.panels.get(kind);
    if (existing) {
      existing.model = model;
      existing.panel.title = model.title;
      existing.panel.reveal(vscode.ViewColumn.Beside, true);
      existing.panel.webview.html = codepolPanelHtmlRender({
        nonce: randomBytes(16).toString('hex'),
        model,
      });
      return;
    }

    const panelId =
      kind === 'semanticDefinition'
        ? CODEPOL_EXTENSION_PANEL_SEMANTIC_DEFINITION
        : kind === 'architectureSummary'
          ? CODEPOL_EXTENSION_PANEL_ARCHITECTURE_SUMMARY
          : kind === 'dependencyGraph'
            ? CODEPOL_EXTENSION_PANEL_DEPENDENCY_GRAPH
        : kind === 'architectureLinks'
          ? CODEPOL_EXTENSION_PANEL_ARCHITECTURE_LINKS
        : kind === 'lintRuleDetails'
          ? CODEPOL_EXTENSION_PANEL_LINT_RULE_DETAILS
        : kind === 'renamePreview'
          ? CODEPOL_EXTENSION_PANEL_RENAME_PREVIEW
        : kind === 'typeHierarchy'
          ? CODEPOL_EXTENSION_PANEL_TYPE_HIERARCHY
        : kind === 'dependencyPath'
          ? CODEPOL_EXTENSION_PANEL_DEPENDENCY_PATH
        : kind === 'deadModules'
          ? CODEPOL_EXTENSION_PANEL_DEAD_MODULES
        : kind === 'dependencyDiff'
          ? CODEPOL_EXTENSION_PANEL_DEPENDENCY_DIFF
        : CODEPOL_EXTENSION_PANEL_CALL_GRAPH;
    const panel = vscode.window.createWebviewPanel(
      panelId,
      model.title,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );
    const managed: ManagedPanel = { panel, model };
    this.panels.set(kind, managed);
    panel.onDidDispose(() => {
      this.panels.delete(kind);
    });
    panel.webview.onDidReceiveMessage((message: CodepolPanelMessage) => {
      void this.messageHandle(kind, message);
    });
    panel.webview.html = codepolPanelHtmlRender({
      nonce: randomBytes(16).toString('hex'),
      model,
    });
  }

  private graphControlMessageHandle(
    kind: PanelKind,
    message: DependencyGraphPanelControlMessage,
  ): void {
    const managed = this.panels.get(kind);
    if (!managed) {
      return;
    }

    if (
      kind === 'dependencyGraph' &&
      managed.dependencyGraphControls &&
      managed.model.kind === 'dependencyGraph'
    ) {
      const controls = managed.dependencyGraphControls;
      const nextState = dependencyGraphControlStateUpdate(controls.state, message);
      if (!nextState) {
        return;
      }
      const nextModel = controls.rebuilder(nextState);
      managed.dependencyGraphControls = {
        state: {
          filters: nextModel.filters,
          layoutMode: nextModel.layoutMode,
          blastRadiusUri: nextModel.blastRadiusUri,
        },
        rebuilder: controls.rebuilder,
      };
      managed.model = {
        ...managed.model,
        data: nextModel,
      };
      managed.panel.webview.html = codepolPanelHtmlRender({
        nonce: randomBytes(16).toString('hex'),
        model: managed.model,
      });
      return;
    }

    if (
      kind === 'architectureLinks' &&
      managed.architectureLinksControls &&
      managed.model.kind === 'architectureLinks'
    ) {
      const controls = managed.architectureLinksControls;
      const nextState = dependencyGraphControlStateUpdate(controls.state, message);
      if (!nextState) {
        return;
      }
      const nextModel = controls.rebuilder(nextState);
      managed.architectureLinksControls = {
        state: {
          filters: nextModel.filters,
          layoutMode: nextModel.layoutMode,
          blastRadiusUri: nextModel.blastRadiusUri,
        },
        rebuilder: controls.rebuilder,
      };
      managed.model = {
        ...managed.model,
        data: nextModel,
      };
      managed.panel.webview.html = codepolPanelHtmlRender({
        nonce: randomBytes(16).toString('hex'),
        model: managed.model,
      });
    }
  }

  private async messageHandle(
    kind: PanelKind,
    message: CodepolPanelMessage,
  ): Promise<void> {
    if (dependencyGraphControlMessageIs(message)) {
      this.graphControlMessageHandle(kind, message);
      return;
    }

    if (callGraphPanelControlMessageIs(message)) {
      await this.callGraphControlMessageHandle(message);
      return;
    }

    if (
      message.type === 'callGraphConfidenceToggle' ||
      message.type === 'callGraphKindToggle'
    ) {
      // Phase 7 confidence/kind chip toggles are no-ops in the
      // manager today: the panel still routes through the existing
      // `callGraphDirectionSet` / `callGraphDepthSet` rebuilder
      // closure, which doesn't carry filter state. Wiring per-tier
      // filtering through the rebuilder is a follow-up — the chip
      // remains visually interactive (and the message arrives
      // here) so the protocol contract is in place.
      return;
    }

    if (typeHierarchyPanelControlMessageIs(message)) {
      await this.typeHierarchyControlMessageHandle(message);
      return;
    }

    if (dependencyPathPanelControlMessageIs(message)) {
      await this.dependencyPathControlMessageHandle(message);
      return;
    }

    if (deadModulesPanelControlMessageIs(message)) {
      await this.deadModulesControlMessageHandle(message);
      return;
    }

    if (deadModulesPanelEntryPointsConfigureRequestIs(message)) {
      await this.deadModulesEntryPointsConfigureHandle();
      return;
    }

    if (dependencyDiffChooseBaselineRequestIs(message)) {
      await this.dependencyDiffChooseBaselineHandle();
      return;
    }

    if (dependencyDiffUseConfiguredBaselineRequestIs(message)) {
      await this.dependencyDiffUseConfiguredBaselineHandle();
      return;
    }

    if (message.type === 'panelLensSet') {
      await this.panelLensSetHandle(message);
      return;
    }

    if (message.type === 'panelModeClear') {
      await this.panelModeClearHandle(kind, message);
      return;
    }

    if (message.type === 'openLocation' && message.uri) {
      // Symbol-graph panels render synthetic `codepol-symbol://`
      // URIs the editor cannot open directly; translate them through
      // the panel's view-model to the symbol's declaration before
      // dispatching to the editor.
      const opened =
        this.callGraphOpenLocationTranslate(kind, message.uri) ??
        this.typeHierarchyOpenLocationTranslate(kind, message.uri);
      if (opened) {
        await this.actions.openLocation(opened);
        return;
      }
      await this.actions.openLocation({
        uri: message.uri,
        line: message.line ?? 0,
        character: message.character ?? 0,
      });
      return;
    }

    if (message.type === 'hoverAction' && message.uri) {
      const command = codepolHoverActionCommandResolve(message.action);
      if (command) {
        await this.actions.executeCommand(command, message.uri);
      }
      return;
    }

    if (
      kind === 'renamePreview' &&
      message.type === 'applyPlan' &&
      message.planId
    ) {
      const managed = this.panels.get(kind);
      if (!managed || managed.model.kind !== 'renamePreview') {
        return;
      }
      try {
        await this.actions.applyEditPlan(message.planId);
        managed.model = {
          ...managed.model,
          data: {
            ...managed.model.data,
            canApply: false,
            planId: undefined,
            applyMessage: 'Rename applied through workspace/applyEdit.',
          },
        };
      } catch (error) {
        managed.model = {
          ...managed.model,
          data: {
            ...managed.model.data,
            applyMessage:
              error instanceof Error ? error.message : String(error),
          },
        };
      }
      managed.panel.webview.html = codepolPanelHtmlRender({
        nonce: randomBytes(16).toString('hex'),
        model: managed.model,
      });
    }
  }

  private callGraphOpenLocationTranslate(
    kind: PanelKind,
    uri: string,
  ): { uri: string; line: number; character: number } | null {
    if (kind !== 'callGraph') return null;
    const managed = this.panels.get('callGraph');
    if (!managed || managed.model.kind !== 'callGraph') return null;
    return callGraphNodeOpenLocationResolve({ model: managed.model.data, uri });
  }

  private async callGraphControlMessageHandle(
    message: CallGraphPanelControlMessage,
  ): Promise<void> {
    const managed = this.panels.get('callGraph');
    if (!managed || !managed.callGraphControls) return;
    if (managed.model.kind !== 'callGraph') return;
    const controls = managed.callGraphControls;
    let nextDirection = controls.state.direction;
    let nextDepth = controls.state.depth;
    if (message.type === 'callGraphDirectionSet') {
      const parsed = callGraphDirectionParse(message.direction);
      if (!parsed || parsed === controls.state.direction) return;
      nextDirection = parsed;
    } else if (message.type === 'callGraphDepthSet') {
      const parsed = callGraphDepthParse(message.depth);
      if (parsed === undefined || parsed === controls.state.depth) return;
      nextDepth = parsed;
    }
    const nextModel = await controls.rebuilder({
      direction: nextDirection,
      depth: nextDepth,
    });
    if (!nextModel) return;
    managed.callGraphControls = {
      state: { direction: nextModel.direction, depth: nextModel.depth },
      rebuilder: controls.rebuilder,
    };
    managed.model = {
      ...managed.model,
      data: nextModel,
    };
    managed.panel.webview.html = codepolPanelHtmlRender({
      nonce: randomBytes(16).toString('hex'),
      model: managed.model,
    });
  }

  private typeHierarchyOpenLocationTranslate(
    kind: PanelKind,
    uri: string,
  ): { uri: string; line: number; character: number } | null {
    if (kind !== 'typeHierarchy') return null;
    const managed = this.panels.get('typeHierarchy');
    if (!managed || managed.model.kind !== 'typeHierarchy') return null;
    return typeHierarchyNodeOpenLocationResolve({
      model: managed.model.data,
      uri,
    });
  }

  private async dependencyPathControlMessageHandle(
    message: DependencyPathPanelControlMessage,
  ): Promise<void> {
    const managed = this.panels.get('dependencyPath');
    if (!managed || !managed.dependencyPathControls) return;
    if (managed.model.kind !== 'dependencyPath') return;
    const controls = managed.dependencyPathControls;
    const parsed = dependencyPathMaxPathsParse(message.maxPaths);
    if (parsed === undefined || parsed === controls.state.maxPaths) return;
    const nextModel = await controls.rebuilder({ maxPaths: parsed });
    if (!nextModel) return;
    managed.dependencyPathControls = {
      state: { maxPaths: nextModel.maxPaths },
      rebuilder: controls.rebuilder,
    };
    managed.model = {
      ...managed.model,
      data: nextModel,
    };
    managed.panel.webview.html = codepolPanelHtmlRender({
      nonce: randomBytes(16).toString('hex'),
      model: managed.model,
    });
  }

  private async deadModulesControlMessageHandle(
    message: DeadModulesPanelControlMessage,
  ): Promise<void> {
    await this.deadModulesRebuilderRun(message.entryPointUris);
  }

  private async deadModulesEntryPointsConfigureHandle(): Promise<void> {
    const managed = this.panels.get('deadModules');
    if (!managed || !managed.deadModulesControls) return;
    if (managed.model.kind !== 'deadModules') return;
    const picker = this.actions.deadModulesEntryPointsPick;
    if (!picker) return;
    const picked = await picker({
      currentEntryPointUris: managed.deadModulesControls.state.entryPointUris,
    });
    if (picked === undefined) return;
    const next = picked.length === 0 ? undefined : picked;
    await this.deadModulesRebuilderRun(next);
  }

  private async deadModulesRebuilderRun(
    entryPointUris: string[] | undefined,
  ): Promise<void> {
    const managed = this.panels.get('deadModules');
    if (!managed || !managed.deadModulesControls) return;
    if (managed.model.kind !== 'deadModules') return;
    const controls = managed.deadModulesControls;
    const nextModel = await controls.rebuilder({ entryPointUris });
    if (!nextModel) return;
    managed.deadModulesControls = {
      state: {
        entryPointUris:
          nextModel.entryPointUris.length > 0 ? nextModel.entryPointUris : undefined,
      },
      rebuilder: controls.rebuilder,
    };
    managed.model = {
      ...managed.model,
      data: nextModel,
    };
    managed.panel.webview.html = codepolPanelHtmlRender({
      nonce: randomBytes(16).toString('hex'),
      model: managed.model,
    });
  }

  private async dependencyDiffChooseBaselineHandle(): Promise<void> {
    const managed = this.panels.get('dependencyDiff');
    if (!managed || !managed.dependencyDiffControls) return;
    if (managed.model.kind !== 'dependencyDiff') return;
    const prompt = this.actions.architectureBaselineLabelPrompt;
    if (!prompt) return;
    const picked = await prompt(managed.dependencyDiffControls.state.baselineLabel);
    if (picked === undefined) return;
    const next = picked.trim();
    if (next.length === 0) return;
    await this.dependencyDiffRebuilderRun(next);
  }

  private async dependencyDiffUseConfiguredBaselineHandle(): Promise<void> {
    const getBaseline = this.actions.architectureBaselineLabelGet;
    if (!getBaseline) return;
    const next = getBaseline().trim();
    if (next.length === 0) return;
    await this.dependencyDiffRebuilderRun(next);
  }

  private async dependencyDiffRebuilderRun(
    baselineLabel: string,
  ): Promise<void> {
    const managed = this.panels.get('dependencyDiff');
    if (!managed || !managed.dependencyDiffControls) return;
    if (managed.model.kind !== 'dependencyDiff') return;
    const controls = managed.dependencyDiffControls;
    if (baselineLabel === controls.state.baselineLabel) return;
    const nextModel = await controls.rebuilder({ baselineLabel });
    if (!nextModel) return;
    managed.dependencyDiffControls = {
      state: { baselineLabel: nextModel.baselineLabel },
      rebuilder: controls.rebuilder,
    };
    managed.model = {
      ...managed.model,
      data: nextModel,
    };
    managed.panel.webview.html = codepolPanelHtmlRender({
      nonce: randomBytes(16).toString('hex'),
      model: managed.model,
    });
  }

  /**
   * Phase 7 lens-set handler. Validates the message payload and
   * delegates to the host's `panelLensOpen` action. Silently drops
   * malformed messages — the renderer should never produce them but
   * a defensive shape check beats trusting the webview channel.
   */
  private async panelLensSetHandle(
    message: PanelLensSetMessage,
  ): Promise<void> {
    const lens = panelLensValueParse(message.lens);
    const focus = panelLensFocusParse(message.focus);
    if (!lens || !focus) return;
    if (!this.actions.panelLensOpen) return;
    await this.actions.panelLensOpen({ lens, focus });
  }

  /**
   * Phase 7 mode-clear handler. The webview's `×` button on a
   * `panel-mode-pill` posts this; the manager looks up the panel's
   * current focus from the active model and asks the host to
   * re-open the panel without the locked mode. The handler is
   * panel-kind-aware because focus discovery is panel-specific
   * (call-graph reads `model.focusSymbolId`, others would read
   * different fields).
   */
  private async panelModeClearHandle(
    kind: PanelKind,
    message: PanelModeClearMessage,
  ): Promise<void> {
    if (!message.modeId) return;
    if (!this.actions.panelModeClear) return;
    if (kind !== 'callGraph') return;
    const managed = this.panels.get('callGraph');
    if (!managed || managed.model.kind !== 'callGraph') return;
    const focus: PanelLensFocus = {
      kind: 'symbol',
      symbolId: managed.model.data.focusSymbolId,
      ...(managed.model.data.focusSymbolName.length > 0
        ? { symbolName: managed.model.data.focusSymbolName }
        : {}),
    };
    await this.actions.panelModeClear({ modeId: message.modeId, focus });
  }

  private async typeHierarchyControlMessageHandle(
    message: TypeHierarchyPanelControlMessage,
  ): Promise<void> {
    const managed = this.panels.get('typeHierarchy');
    if (!managed || !managed.typeHierarchyControls) return;
    if (managed.model.kind !== 'typeHierarchy') return;
    const controls = managed.typeHierarchyControls;
    let nextDirection = controls.state.direction;
    let nextDepth = controls.state.depth;
    if (message.type === 'typeHierarchyDirectionSet') {
      const parsed = typeHierarchyDirectionParse(message.direction);
      if (!parsed || parsed === controls.state.direction) return;
      nextDirection = parsed;
    } else if (message.type === 'typeHierarchyDepthSet') {
      const parsed = typeHierarchyDepthParse(message.depth);
      if (parsed === undefined || parsed === controls.state.depth) return;
      nextDepth = parsed;
    }
    const nextModel = await controls.rebuilder({
      direction: nextDirection,
      depth: nextDepth,
    });
    if (!nextModel) return;
    managed.typeHierarchyControls = {
      state: { direction: nextModel.direction, depth: nextModel.depth },
      rebuilder: controls.rebuilder,
    };
    managed.model = {
      ...managed.model,
      data: nextModel,
    };
    managed.panel.webview.html = codepolPanelHtmlRender({
      nonce: randomBytes(16).toString('hex'),
      model: managed.model,
    });
  }
}
