import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import {
  CODEPOL_EXTENSION_COMMAND_SHOW_ARCHITECTURE_LINKS,
  CODEPOL_EXTENSION_COMMAND_SHOW_SEMANTIC_DEFINITION,
  CODEPOL_EXTENSION_PANEL_ARCHITECTURE_LINKS,
  CODEPOL_EXTENSION_PANEL_RENAME_PREVIEW,
  CODEPOL_EXTENSION_PANEL_SEMANTIC_DEFINITION,
} from '../constants';
import type {
  RenamePreviewPanelViewModel,
  SemanticDefinitionPanelViewModel,
  SemanticReferencesPanelViewModel,
} from '../viewModels';
import { codepolPanelHtmlRender, type CodepolPanelViewModel } from './render';

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
    };

type PanelKind = 'semanticDefinition' | 'architectureLinks' | 'renamePreview';

export type CodepolPanelActions = {
  openLocation(input: {
    uri: string;
    line: number;
    character: number;
  }): Promise<void>;
  applyEditPlan(planId: string): Promise<void>;
  executeCommand(command: string, uri: string): Promise<void>;
};

type ManagedPanel = {
  panel: vscode.WebviewPanel;
  model: CodepolPanelViewModel;
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

  showArchitectureLinks(model: SemanticReferencesPanelViewModel): void {
    this.panelShow('architectureLinks', {
      kind: 'architectureLinks',
      title: 'Codepol: Architecture Links',
      uri: model.uri,
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
        : kind === 'architectureLinks'
          ? CODEPOL_EXTENSION_PANEL_ARCHITECTURE_LINKS
          : CODEPOL_EXTENSION_PANEL_RENAME_PREVIEW;
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

  private async messageHandle(
    kind: PanelKind,
    message: CodepolPanelMessage,
  ): Promise<void> {
    if (message.type === 'openLocation' && message.uri) {
      await this.actions.openLocation({
        uri: message.uri,
        line: message.line ?? 0,
        character: message.character ?? 0,
      });
      return;
    }

    if (message.type === 'hoverAction' && message.uri) {
      if (message.action === 'go_to_definition') {
        await this.actions.executeCommand(
          CODEPOL_EXTENSION_COMMAND_SHOW_SEMANTIC_DEFINITION,
          message.uri,
        );
        return;
      }
      if (
        message.action === 'find_references' ||
        message.action === 'show_graph'
      ) {
        await this.actions.executeCommand(
          CODEPOL_EXTENSION_COMMAND_SHOW_ARCHITECTURE_LINKS,
          message.uri,
        );
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
}
