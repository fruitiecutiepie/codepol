/**
 * Hover provider that surfaces per-file Phase 8 metrics.
 *
 * Identity rule (`TODO_CODEPOL_LSP_HOVER_MODEL.md`): Codepol may only
 * return a hover when the hovered range carries an extension-owned
 * marker. The Phase 8 architecture lens already places exactly such a
 * marker at the head of every file (a single CodeLens at line 0). This
 * provider returns `null` for any position outside line 0 so the hover
 * stays inside the marker rule without duplicating the editor's
 * default hover anywhere else in the file.
 *
 * Wiring is fan-out in parallel: the provider asks the protocol for
 * the impact-radius subgraph and the architecture summary at the same
 * time, then delegates the actual rendering to the pure
 * `architectureHoverViewModelCreate`.
 */

import * as vscode from 'vscode';
import {
  architectureHoverViewModelCreate,
  type ArchitectureHoverViewModel,
} from './architectureHoverViewModel';
import type { CodepolProtocolClient } from './protocolClient';
import { codepolRequestSupersededErrorIs } from './readiness';

export type CodepolArchitectureHoverProviderHost = {
  protocol: Pick<
    CodepolProtocolClient,
    'queryImpactRadius' | 'queryArchitectureSummary'
  >;
  peekCommandId: string;
};

export class CodepolArchitectureHoverProvider implements vscode.HoverProvider {
  constructor(private readonly host: CodepolArchitectureHoverProviderHost) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.Hover | null> {
    if (document.uri.scheme !== 'file') return null;
    // Marker rule: only honor hovers that land on the same line the
    // architecture CodeLens decorates. Anything below line 0 belongs
    // to the language server's default hover.
    if (position.line !== 0) return null;

    const focusUri = document.uri.toString();
    let viewModel: ArchitectureHoverViewModel | null;
    try {
      const [graphResult, summaryResult] = await Promise.all([
        this.host.protocol.queryImpactRadius({
          uri: focusUri,
          direction: 'both',
          depth: 1,
        }),
        this.host.protocol
          .queryArchitectureSummary()
          .catch((error) => {
            if (codepolRequestSupersededErrorIs(error)) return null;
            throw error;
          }),
      ]);
      if (token.isCancellationRequested) return null;
      viewModel = architectureHoverViewModelCreate({
        uri: focusUri,
        summary: summaryResult ?? null,
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
    return new vscode.Hover(markdown, new vscode.Range(0, 0, 0, 0));
  }
}
