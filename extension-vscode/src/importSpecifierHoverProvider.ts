/**
 * Hover provider that surfaces per-import-specifier metrics.
 *
 * Identity rule (`TODO_CODEPOL_LSP_HOVER_MODEL.md`): Codepol may only
 * return a hover when the hovered range carries an extension-owned
 * marker. The provider asks the
 * {@link ImportSpecifierMarkerController} for the marker covering the
 * cursor position; when none exists, the provider returns `null`
 * without consulting the protocol so the language server's default
 * hover wins.
 *
 * On a hit, the provider fans out `queryImpactRadius` for the resolved
 * module URI and delegates rendering to the pure
 * `importSpecifierHoverViewModelCreate`. The hover range is anchored
 * to the marker so the editor highlights exactly the import specifier
 * the card describes.
 */

import * as vscode from 'vscode';
import {
  importSpecifierHoverViewModelCreate,
  type ImportSpecifierHoverViewModel,
} from './importSpecifierHoverViewModel';
import type { ImportSpecifierMarker } from './importSpecifierMarkerController';
import type { CodepolProtocolClient } from './protocolClient';
import { codepolRequestSupersededErrorIs } from './readiness';

export type CodepolImportSpecifierHoverProviderHost = {
  protocol: Pick<CodepolProtocolClient, 'queryImpactRadius'>;
  markers: {
    markerAt(
      uri: string,
      position: vscode.Position,
    ): ImportSpecifierMarker | undefined;
  };
  peekCommandId: string;
};

export class CodepolImportSpecifierHoverProvider
  implements vscode.HoverProvider
{
  constructor(
    private readonly host: CodepolImportSpecifierHoverProviderHost,
  ) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.Hover | null> {
    if (document.uri.scheme !== 'file') return null;

    const focusUri = document.uri.toString();
    const marker = this.host.markers.markerAt(focusUri, position);
    if (!marker) return null;

    let viewModel: ImportSpecifierHoverViewModel | null;
    try {
      const graphResult = await this.host.protocol.queryImpactRadius({
        uri: marker.resolvedModuleUri,
        direction: 'both',
        depth: 1,
      });
      if (token.isCancellationRequested) return null;
      viewModel = importSpecifierHoverViewModelCreate({
        resolvedModuleUri: marker.resolvedModuleUri,
        resolvedModuleWorkspaceRelativePath:
          marker.resolvedModuleWorkspaceRelativePath,
        edgeKind: marker.edgeKind,
        ...(marker.crossesLayerBoundary !== undefined
          ? { crossesLayerBoundary: marker.crossesLayerBoundary }
          : {}),
        ...(marker.crossesPackageBoundary !== undefined
          ? { crossesPackageBoundary: marker.crossesPackageBoundary }
          : {}),
        graph: graphResult ?? null,
        peekCommandId: this.host.peekCommandId,
      });
    } catch (error) {
      if (codepolRequestSupersededErrorIs(error)) return null;
      throw error;
    }

    if (!viewModel) return null;

    const markdown = new vscode.MarkdownString(viewModel.markdown);
    // The hover body contains a `command:` link for "Open architecture
    // panel". `MarkdownString` rejects command URIs unless the host
    // explicitly opts in by setting `isTrusted`.
    markdown.isTrusted = true;
    markdown.supportThemeIcons = true;
    return new vscode.Hover(markdown, marker.range);
  }
}
