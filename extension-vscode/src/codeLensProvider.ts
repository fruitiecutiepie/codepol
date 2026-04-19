import * as vscode from 'vscode';
import {
  architectureCodeLensViewModelCreate,
  type ArchitectureCodeLensViewModel,
} from './codeLensViewModels';
import type { CodepolProtocolClient } from './protocolClient';
import { codepolRequestSupersededErrorIs } from './readiness';

export type CodepolArchitectureCodeLensProviderHost = {
  protocol: Pick<
    CodepolProtocolClient,
    'queryImpactRadius' | 'queryArchitectureSummary'
  >;
  peekCommandId: string;
};

export class CodepolArchitectureCodeLensProvider
  implements vscode.CodeLensProvider
{
  private readonly didChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.didChangeEmitter.event;

  constructor(private readonly host: CodepolArchitectureCodeLensProviderHost) {}

  refresh(): void {
    this.didChangeEmitter.fire();
  }

  dispose(): void {
    this.didChangeEmitter.dispose();
  }

  async provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken,
  ): Promise<vscode.CodeLens[]> {
    if (document.uri.scheme !== 'file') {
      return [];
    }
    const focusUri = document.uri.toString();
    let viewModel: ArchitectureCodeLensViewModel | null;
    try {
      // Fan out impact radius and architecture summary in parallel so
      // the lens still fires once per document. The summary is
      // optional: when it is not yet ready (or the workspace exposes no
      // metrics), the lens degrades to the legacy importer/importee
      // title.
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
      if (token.isCancellationRequested || !graphResult) {
        return [];
      }
      viewModel = architectureCodeLensViewModelCreate({
        graph: graphResult,
        focusUri,
        summary: summaryResult ?? null,
      });
    } catch (error) {
      if (codepolRequestSupersededErrorIs(error)) {
        return [];
      }
      throw error;
    }

    if (!viewModel) {
      return [];
    }

    const range = new vscode.Range(0, 0, 0, 0);
    return [
      new vscode.CodeLens(range, {
        title: viewModel.title,
        tooltip: viewModel.tooltip,
        command: this.host.peekCommandId,
        arguments: [viewModel.commandArgument.uri],
      }),
    ];
  }
}
