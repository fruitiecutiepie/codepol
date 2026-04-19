/**
 * Per-document marker layer for in-file import specifiers.
 *
 * Identity rule (`TODO_CODEPOL_LSP_HOVER_MODEL.md`): Codepol may only
 * return a hover when the hovered range carries an extension-owned
 * marker. The Phase 5 hover work was deferred precisely because no
 * marker layer existed for arbitrary editor positions. This controller
 * fills the gap for import specifiers: it asks the workspace service
 * for the in-file workspace-resolved import-specifier ranges, applies a
 * subtle dotted underline as the marker, and exposes a
 * `markerAt(uri, position)` lookup the hover provider uses to gate the
 * hover.
 *
 * The controller is decoration-side state only — it does not return any
 * card content. The hover provider asks for `markerAt`, then fans out
 * `queryImpactRadius` to populate the card. Two consumers, one
 * marker.
 *
 * Staleness is handled by tagging each refresh with the live document
 * version. A response that arrives after the document moved is dropped
 * before mutating state. Refreshes are debounced 200 ms because
 * keystroke storms otherwise saturate the editor-driven `high` queue
 * lane.
 */

import * as vscode from 'vscode';
import type { WorkspaceDependencyGraphEdgeKind } from '@codepol/core';
import type { CodepolProtocolClient } from './protocolClient';
import { codepolRequestSupersededErrorIs } from './readiness';

const IMPORT_SPECIFIER_MARKER_REFRESH_DEBOUNCE_MS = 200;

/**
 * One marker entry. Carries everything the hover provider needs to
 * render the card and anchor the hover range without re-querying
 * anything.
 */
export type ImportSpecifierMarker = {
  range: vscode.Range;
  resolvedModuleUri: string;
  resolvedModuleWorkspaceRelativePath: string;
  edgeKind: WorkspaceDependencyGraphEdgeKind;
  bindingCount: number;
  crossesPackageBoundary?: boolean;
  crossesLayerBoundary?: boolean;
};

export type ImportSpecifierMarkerControllerHost = {
  protocol: Pick<CodepolProtocolClient, 'queryImportSpecifiersInFile'>;
};

type DocumentMarkerState = {
  /**
   * Document version at the time the markers were computed. A response
   * tagged with a version older than the document's current version is
   * stale and must not mutate state.
   */
  docVersion: number;
  /** Markers sorted by `(range.start.line, range.start.character)`. */
  markers: ImportSpecifierMarker[];
};

export class ImportSpecifierMarkerController implements vscode.Disposable {
  private readonly decorationType: vscode.TextEditorDecorationType;
  private readonly markersByDocUri = new Map<string, DocumentMarkerState>();
  private readonly refreshTimers = new Map<string, NodeJS.Timeout>();
  private readonly disposables: vscode.Disposable[] = [];
  private disposed = false;

  constructor(private readonly host: ImportSpecifierMarkerControllerHost) {
    // Subtle dotted underline. Uses the editor's `textLink.foreground`
    // theme color so the marker stays legible in light and dark themes
    // without hard-coding a color.
    this.decorationType = vscode.window.createTextEditorDecorationType({
      textDecoration:
        'underline dotted var(--vscode-textLink-foreground, currentColor) 1px',
    });
    this.disposables.push(this.decorationType);

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) this.attachToEditor(editor);
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        this.scheduleRefreshForDocument(event.document);
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        this.markersByDocUri.delete(document.uri.toString());
        this.refreshTimerClear(document.uri.toString());
      }),
    );
  }

  attachToEditor(editor: vscode.TextEditor): void {
    if (this.disposed) return;
    if (editor.document.uri.scheme !== 'file') {
      return;
    }
    this.scheduleRefreshForDocument(editor.document);
  }

  /**
   * Find the marker covering `position` in `uri`, or `undefined` when
   * the position is not inside any known import specifier. The lookup
   * is the hover provider's identity gate — when this returns
   * `undefined`, the hover provider must return `null` without
   * consulting the protocol.
   */
  markerAt(
    uri: string,
    position: vscode.Position,
  ): ImportSpecifierMarker | undefined {
    const state = this.markersByDocUri.get(uri);
    if (!state || state.markers.length === 0) {
      return undefined;
    }
    return importSpecifierMarkerLocate(state.markers, position);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const timer of this.refreshTimers.values()) {
      clearTimeout(timer);
    }
    this.refreshTimers.clear();
    this.markersByDocUri.clear();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private scheduleRefreshForDocument(document: vscode.TextDocument): void {
    if (this.disposed) return;
    if (document.uri.scheme !== 'file') return;
    const docUri = document.uri.toString();
    this.refreshTimerClear(docUri);
    const timer = setTimeout(() => {
      this.refreshTimers.delete(docUri);
      void this.refreshDocument(document);
    }, IMPORT_SPECIFIER_MARKER_REFRESH_DEBOUNCE_MS);
    this.refreshTimers.set(docUri, timer);
  }

  private refreshTimerClear(docUri: string): void {
    const existing = this.refreshTimers.get(docUri);
    if (existing) {
      clearTimeout(existing);
      this.refreshTimers.delete(docUri);
    }
  }

  private async refreshDocument(document: vscode.TextDocument): Promise<void> {
    if (this.disposed) return;
    const docUri = document.uri.toString();
    const requestVersion = document.version;
    let result;
    try {
      result = await this.host.protocol.queryImportSpecifiersInFile({
        uri: docUri,
      });
    } catch (error) {
      if (codepolRequestSupersededErrorIs(error)) return;
      throw error;
    }
    if (this.disposed) return;
    // Race / staleness guard: skip if the document moved while we were
    // waiting on the response. The next change will re-trigger a
    // refresh, so we don't need to retry here.
    if (document.version !== requestVersion) return;

    const markers = (result?.specifiers ?? []).map(
      (descriptor): ImportSpecifierMarker => ({
        range: new vscode.Range(
          descriptor.range.start.line,
          descriptor.range.start.character,
          descriptor.range.end.line,
          descriptor.range.end.character,
        ),
        resolvedModuleUri: descriptor.resolvedModuleUri,
        resolvedModuleWorkspaceRelativePath:
          descriptor.resolvedModuleWorkspaceRelativePath,
        edgeKind: descriptor.edgeKind,
        bindingCount: descriptor.bindingCount,
        ...(descriptor.crossesPackageBoundary !== undefined
          ? { crossesPackageBoundary: descriptor.crossesPackageBoundary }
          : {}),
        ...(descriptor.crossesLayerBoundary !== undefined
          ? { crossesLayerBoundary: descriptor.crossesLayerBoundary }
          : {}),
      }),
    );
    this.markersByDocUri.set(docUri, { docVersion: requestVersion, markers });
    this.applyDecorations(document, markers);
  }

  private applyDecorations(
    document: vscode.TextDocument,
    markers: ImportSpecifierMarker[],
  ): void {
    const docUri = document.uri.toString();
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.toString() !== docUri) continue;
      editor.setDecorations(
        this.decorationType,
        markers.map((marker) => marker.range),
      );
    }
  }
}

/**
 * Linear scan over a sorted marker list to find the first marker whose
 * range contains `position`. The marker list is small (one per import
 * statement in the file), so a binary search is not worth the
 * complexity — a 200-import file still scans in microseconds.
 *
 * Exported for the controller's unit tests.
 */
export function importSpecifierMarkerLocate(
  markers: readonly ImportSpecifierMarker[],
  position: vscode.Position,
): ImportSpecifierMarker | undefined {
  for (const marker of markers) {
    if (marker.range.contains(position)) {
      return marker;
    }
  }
  return undefined;
}
