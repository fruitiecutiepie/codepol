import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import {
  CODEPOL_EXTENSION_COMMAND_SHOW_ARCHITECTURE_LINKS,
  CODEPOL_EXTENSION_PANEL_ARCHITECTURE_SUMMARY,
  CODEPOL_EXTENSION_PANEL_ARCHITECTURE_LINKS,
  CODEPOL_EXTENSION_PANEL_CALL_GRAPH,
  CODEPOL_EXTENSION_PANEL_DEPENDENCY_GRAPH,
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
  dependencyGraphControlMessageIs,
  dependencyGraphControlStateUpdate,
  dependencyGraphPanelControlStateInitialArchitectureLinks,
  dependencyGraphPanelControlStateInitialDependencyGraph,
  type ArchitectureLinksPanelRebuilder,
  type DependencyGraphPanelControlMessage,
  type DependencyGraphPanelControlState,
  type DependencyGraphPanelRebuilder,
} from './controls';
import { codepolHoverActionCommandResolve } from './messages';
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
  | TypeHierarchyPanelControlMessage;

type PanelKind =
  | 'semanticDefinition'
  | 'architectureSummary'
  | 'dependencyGraph'
  | 'architectureLinks'
  | 'lintRuleDetails'
  | 'renamePreview'
  | 'callGraph'
  | 'typeHierarchy';

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

export type CodepolPanelActions = {
  openLocation(input: {
    uri: string;
    line: number;
    character: number;
  }): Promise<void>;
  applyEditPlan(planId: string): Promise<void>;
  executeCommand(command: string, uri?: string): Promise<void>;
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

    if (typeHierarchyPanelControlMessageIs(message)) {
      await this.typeHierarchyControlMessageHandle(message);
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
