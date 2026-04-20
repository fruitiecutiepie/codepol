/**
 * Per-file cycle gutter decoration controller.
 *
 * Phase 5 follow-up — Phase 6 already publishes `codepol/architecture`
 * diagnostics for cycles, so the user sees one entry per cycle in the
 * Problems panel. This controller adds an editor-side gutter marker
 * per cycle-member file with a hover that lists every member of the
 * cycle, giving continuous awareness without requiring the Problems
 * panel to be open.
 *
 * Mirrors the {@link ImportSpecifierMarkerController} shape:
 *
 * - one shared `vscode.TextEditorDecorationType` (theme-aware)
 * - per-document decoration state, refreshed on active-editor change,
 *   document change/close, and `refresh()` calls
 * - `vscode.workspace.getConfiguration('codepol.diagnostics').get('showCycleDecorations')`
 *   gates the controller — when set to `false` the controller clears
 *   all decorations and never queries the protocol
 *
 * The hover Markdown comes from the pure
 * {@link cycleHoverMarkdownCreate} helper; the membership lookup
 * comes from {@link cycleMembershipLookupCreate}. The controller
 * itself only owns the vscode side.
 *
 * Refresh strategy: cycles change rarely (only when imports change),
 * so the controller fetches `queryDependencyGraph()` lazily and caches
 * the resulting membership lookup until `refresh()` is called or a
 * document change occurs in any cycle file. The `refresh()` hook is
 * called from the readiness `onDidChange` event (registered by
 * `extension.ts`).
 */

import * as vscode from 'vscode';
import {
  cycleHoverMarkdownCreate,
  cycleMembershipLookupCreate,
  type CycleMembershipLookup,
} from './cycleGutterDecorationViewModels';
import type { CodepolProtocolClient } from './protocolClient';
import { codepolRequestSupersededErrorIs } from './readiness';

const CYCLE_DECORATION_REFRESH_DEBOUNCE_MS = 300;
const CYCLE_DECORATION_SETTING_KEY = 'codepol.diagnostics.showCycleDecorations';

export type CodepolCycleGutterDecorationControllerHost = {
  protocol: Pick<CodepolProtocolClient, 'queryDependencyGraph'>;
  peekCommandId: string;
  /**
   * Inject `vscode.workspace.getConfiguration` so tests can drive the
   * setting without a real workspace. Defaults to the live API when
   * absent.
   */
  getConfiguration?: typeof vscode.workspace.getConfiguration;
  /**
   * Inject `vscode.workspace.onDidChangeConfiguration` for the same
   * reason as above.
   */
  onDidChangeConfiguration?: typeof vscode.workspace.onDidChangeConfiguration;
};

export class CodepolCycleGutterDecorationController
  implements vscode.Disposable
{
  private readonly decorationType: vscode.TextEditorDecorationType;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly refreshTimers = new Map<string, NodeJS.Timeout>();
  private readonly getConfiguration: typeof vscode.workspace.getConfiguration;
  private membershipLookup: CycleMembershipLookup | null = null;
  /** URI → workspaceRelativePath, populated together with the lookup. */
  private workspaceRelativePathByUri: Map<string, string> = new Map();
  private membershipPromise: Promise<void> | null = null;
  private disposed = false;

  constructor(
    private readonly host: CodepolCycleGutterDecorationControllerHost,
  ) {
    // Subtle gutter marker. Uses `editorWarning.foreground` so the
    // marker stays legible in light and dark themes and visually
    // matches the existing Problems-panel cycle entries.
    this.decorationType = vscode.window.createTextEditorDecorationType({
      gutterIconPath: undefined,
      overviewRulerColor: new vscode.ThemeColor('editorWarning.foreground'),
      overviewRulerLane: vscode.OverviewRulerLane.Left,
      isWholeLine: false,
      // Use a left-margin border to stand in for a gutter icon that
      // would otherwise require a bundled SVG asset; the dotted style
      // is intentionally subtle so it does not compete with the
      // Problems-panel diagnostic strip.
      borderColor: new vscode.ThemeColor('editorWarning.foreground'),
      borderStyle: 'none none none dotted',
      borderWidth: '0 0 0 2px',
    });
    this.disposables.push(this.decorationType);

    this.getConfiguration =
      host.getConfiguration ?? vscode.workspace.getConfiguration.bind(vscode.workspace);
    const onDidChangeConfiguration =
      host.onDidChangeConfiguration ??
      vscode.workspace.onDidChangeConfiguration.bind(vscode.workspace);

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) this.attachToEditor(editor);
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        // Cycles only change when imports change. Refresh lazily —
        // the next `attachToEditor` / `refresh()` will pull a fresh
        // graph if needed.
        this.scheduleAttachForDocument(event.document);
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        this.refreshTimerClear(document.uri.toString());
      }),
      onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(CYCLE_DECORATION_SETTING_KEY)) {
          this.refresh();
        }
      }),
    );
  }

  /**
   * Drop the cached membership lookup and re-decorate every visible
   * editor. Called from `extension.ts` when readiness changes (the
   * graph may have been recomputed) and from the configuration-change
   * listener when the user toggles the setting.
   */
  refresh(): void {
    if (this.disposed) return;
    this.membershipLookup = null;
    this.workspaceRelativePathByUri.clear();
    this.membershipPromise = null;
    for (const editor of vscode.window.visibleTextEditors) {
      this.attachToEditor(editor);
    }
  }

  attachToEditor(editor: vscode.TextEditor): void {
    if (this.disposed) return;
    if (editor.document.uri.scheme !== 'file') {
      return;
    }
    if (!this.cycleDecorationsEnabled()) {
      // Setting is off — clear any decoration we previously set so
      // toggling the setting takes effect immediately.
      editor.setDecorations(this.decorationType, []);
      return;
    }
    void this.applyCycleDecorationToEditor(editor);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const timer of this.refreshTimers.values()) {
      clearTimeout(timer);
    }
    this.refreshTimers.clear();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private scheduleAttachForDocument(document: vscode.TextDocument): void {
    if (this.disposed) return;
    if (document.uri.scheme !== 'file') return;
    const docUri = document.uri.toString();
    this.refreshTimerClear(docUri);
    const timer = setTimeout(() => {
      this.refreshTimers.delete(docUri);
      // Drop the cached membership so the next attach pulls a
      // fresh graph (the document edit may have changed which
      // files are in cycles).
      this.membershipLookup = null;
      this.membershipPromise = null;
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document.uri.toString() === docUri) {
          this.attachToEditor(editor);
        }
      }
    }, CYCLE_DECORATION_REFRESH_DEBOUNCE_MS);
    this.refreshTimers.set(docUri, timer);
  }

  private refreshTimerClear(docUri: string): void {
    const existing = this.refreshTimers.get(docUri);
    if (existing) {
      clearTimeout(existing);
      this.refreshTimers.delete(docUri);
    }
  }

  private cycleDecorationsEnabled(): boolean {
    const setting = this.getConfiguration('codepol.diagnostics');
    return setting.get<boolean>('showCycleDecorations', true) !== false;
  }

  private async applyCycleDecorationToEditor(
    editor: vscode.TextEditor,
  ): Promise<void> {
    const lookup = await this.membershipLookupEnsure();
    if (this.disposed) return;
    if (!lookup) {
      editor.setDecorations(this.decorationType, []);
      return;
    }
    const focusUri = editor.document.uri.toString();
    const membership = lookup.uriIsInCycle(focusUri);
    if (!membership) {
      editor.setDecorations(this.decorationType, []);
      return;
    }
    const hoverMarkdown = cycleHoverMarkdownCreate({
      focusUri,
      cycleMembers: membership.cycleMembers,
      workspaceRelativePathOf: (uri) =>
        this.workspaceRelativePathByUri.get(uri) ?? uri,
      peekCommandId: this.host.peekCommandId,
    });
    const hover = new vscode.MarkdownString(hoverMarkdown, true);
    hover.isTrusted = true;
    const range = new vscode.Range(0, 0, 0, 0);
    editor.setDecorations(this.decorationType, [
      {
        range,
        hoverMessage: hover,
      },
    ]);
  }

  private membershipLookupEnsure(): Promise<CycleMembershipLookup | null> {
    if (this.membershipLookup) {
      return Promise.resolve(this.membershipLookup);
    }
    if (this.membershipPromise) {
      return this.membershipPromise.then(() => this.membershipLookup);
    }
    this.membershipPromise = this.membershipLookupRefresh();
    return this.membershipPromise.then(() => this.membershipLookup);
  }

  private async membershipLookupRefresh(): Promise<void> {
    try {
      const graph = await this.host.protocol.queryDependencyGraph();
      if (this.disposed) return;
      if (!graph) {
        this.membershipLookup = cycleMembershipLookupCreate([]);
        this.workspaceRelativePathByUri = new Map();
        return;
      }
      this.membershipLookup = cycleMembershipLookupCreate(graph.cycles);
      const pathByUri = new Map<string, string>();
      for (const node of graph.nodes) {
        pathByUri.set(node.uri, node.workspaceRelativePath);
      }
      this.workspaceRelativePathByUri = pathByUri;
    } catch (error) {
      if (codepolRequestSupersededErrorIs(error)) {
        // Leave the cached lookup in place — the next refresh will
        // pull again. Do not clobber a previously-good lookup with
        // an empty one.
        return;
      }
      throw error;
    } finally {
      this.membershipPromise = null;
    }
  }
}
