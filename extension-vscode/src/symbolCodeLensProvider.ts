/**
 * Per-symbol CodeLens provider.
 *
 * Sibling to {@link CodepolArchitectureCodeLensProvider} — both
 * register on `{ scheme: 'file' }` and VS Code merges lenses from
 * multiple providers automatically. This provider fires *one batched
 * round-trip* per file open via `querySymbolsInFileWithCallCounts`,
 * so a file with 30 functions costs 1 RPC, not 30.
 *
 * Click target is `codepol.extension.showCallGraph` with the symbol
 * id passed via the lens command argument; the command resolves the
 * graph and opens the dedicated call-graph panel.
 *
 * Refresh trigger: `readiness.onDidChange` (mirrors the architecture
 * lens). The CodeLens API itself re-fires `provideCodeLenses` on
 * document edits, so that path is already covered.
 */
import * as vscode from 'vscode';
import {
  symbolCodeLensViewModelsCreate,
  type SymbolCallGraphCommandArgument,
  type SymbolCodeLensViewModel,
} from './symbolCodeLensViewModels';
import type { CodepolProtocolClient } from './protocolClient';
import { codepolRequestSupersededErrorIs } from './readiness';

export type CodepolSymbolCodeLensProviderHost = {
  protocol: Pick<CodepolProtocolClient, 'querySymbolsInFileWithCallCounts'>;
  showCallGraphCommandId: string;
};

export class CodepolSymbolCodeLensProvider implements vscode.CodeLensProvider {
  private readonly didChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.didChangeEmitter.event;

  constructor(private readonly host: CodepolSymbolCodeLensProviderHost) {}

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
    let viewModels: SymbolCodeLensViewModel[] = [];
    try {
      const result = await this.host.protocol.querySymbolsInFileWithCallCounts({
        uri: focusUri,
      });
      if (token.isCancellationRequested || !result) {
        return [];
      }
      viewModels = symbolCodeLensViewModelsCreate({ result });
    } catch (error) {
      if (codepolRequestSupersededErrorIs(error)) {
        return [];
      }
      throw error;
    }

    if (viewModels.length === 0) {
      return [];
    }

    return viewModels.map((vm) => {
      const range = new vscode.Range(vm.line, vm.character, vm.line, vm.character);
      const argument: SymbolCallGraphCommandArgument = {
        symbolId: vm.symbolId,
        focusSymbolName: vm.focusSymbolName,
      };
      return new vscode.CodeLens(range, {
        title: vm.title,
        tooltip: vm.tooltip,
        command: this.host.showCallGraphCommandId,
        arguments: [argument],
      });
    });
  }
}
