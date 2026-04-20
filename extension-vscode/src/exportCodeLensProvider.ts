/**
 * Per-export "N importers" CodeLens provider.
 *
 * Phase 5 follow-up — sibling to {@link CodepolArchitectureCodeLensProvider}
 * (file-level head lens), {@link CodepolSymbolCodeLensProvider} (per
 * function/method call counts), and {@link CodepolTypeHierarchyCodeLensProvider}
 * (per-interface implementer counts).
 *
 * Surfaces "N importers" above every top-level `export` declaration in
 * supported TS/JS files so users see how depended-on the symbol is
 * without opening a panel. Click invokes
 * {@link codepol.architecture.peek} with the declaration's
 * `{ uri, position }`; the peek command resolves the cursor symbol and
 * routes to the call graph / type hierarchy / file impact-radius panel
 * by symbol kind.
 *
 * Following the {@link CodepolTypeHierarchyCodeLensProvider} pattern,
 * this provider does not parse TS/JS in the extension. It uses a tiny
 * regex to find candidate top-level export lines, then defers to the
 * LSP for symbol-id resolution (`querySymbolAtPosition`) and the
 * importer count (`querySymbolImporterCount`). The fan-out is N RPCs
 * per file (one position lookup + one importer-count lookup per
 * export); top-level exports are typically 0-15 per file in real-world
 * codebases, which is acceptable for the editor hot path.
 *
 * Language scope: `typescript | typescriptreact | javascript |
 * javascriptreact`. Python uses `__all__` rather than the `export`
 * keyword and is documented as a follow-up gap.
 */
import * as vscode from 'vscode';
import {
  exportCodeLensViewModelCreate,
  type ExportCodeLensCommandArgument,
} from './exportCodeLensViewModels';
import type { CodepolProtocolClient } from './protocolClient';
import { codepolRequestSupersededErrorIs } from './readiness';

export type CodepolExportCodeLensProviderHost = {
  protocol: Pick<
    CodepolProtocolClient,
    'querySymbolAtPosition' | 'querySymbolImporterCount'
  >;
  peekCommandId: string;
};

/**
 * Match a top-level `export` declaration. Captures the declared
 * identifier's column so the position lookup hits the right symbol.
 *
 * Intentionally narrow:
 * - Only matches at column 0 with the `export` keyword as the first
 *   token. Skips indented / nested declarations.
 * - Skips bare `export {...}` re-export blocks (no anchor identifier
 *   on this line; per-symbol importers belong to the original
 *   declaration in another file).
 * - Skips `export * from '...'` star re-exports for the same reason.
 *
 * Examples that match:
 *   `export function helper() {`
 *   `export const value = 42;`
 *   `export default function helper() {` (anchor at `helper`)
 *   `export async function fetchData() {`
 *   `export class Animal {`
 *   `export interface Renderable {`
 *   `export type Handler = ...`
 *   `export enum Status {`
 *   `export abstract class Shape {`
 *   `export namespace Util {`
 *
 * Examples that do not match:
 *   `  export function inner() {` (indented)
 *   `export { helper } from './a'` (re-export block)
 *   `export * from './b'` (star re-export)
 */
const EXPORT_DECL_REGEX =
  /^(?<prefix>export\s+(?:default\s+)?(?:async\s+)?(?:abstract\s+)?)(?<keyword>const|let|var|function|class|interface|type|enum|namespace)\s+(?<name>[A-Za-z_$][\w$]*)/;

type DeclarationCandidate = {
  line: number;
  character: number;
  name: string;
};

function declarationCandidatesScan(
  document: vscode.TextDocument,
): DeclarationCandidate[] {
  const candidates: DeclarationCandidate[] = [];
  const lineCount = document.lineCount;
  for (let line = 0; line < lineCount; line += 1) {
    const text = document.lineAt(line).text;
    const match = EXPORT_DECL_REGEX.exec(text);
    if (!match || !match.groups) continue;
    const name = match.groups.name ?? '';
    if (!name) continue;
    // Re-find the actual identifier index in case the regex absorbed
    // extra whitespace; the LSP requires the position of the
    // identifier, not the keyword.
    const nameIndex = text.indexOf(name, match[0].length - name.length);
    candidates.push({
      line,
      character: nameIndex >= 0 ? nameIndex : match[0].length - name.length,
      name,
    });
  }
  return candidates;
}

function languageIsSupported(languageId: string): boolean {
  return (
    languageId === 'typescript' ||
    languageId === 'typescriptreact' ||
    languageId === 'javascript' ||
    languageId === 'javascriptreact'
  );
}

export class CodepolExportCodeLensProvider implements vscode.CodeLensProvider {
  private readonly didChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.didChangeEmitter.event;

  constructor(private readonly host: CodepolExportCodeLensProviderHost) {}

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
    if (!languageIsSupported(document.languageId)) {
      return [];
    }

    const candidates = declarationCandidatesScan(document);
    if (candidates.length === 0) return [];

    const focusUri = document.uri.toString();
    const lenses: vscode.CodeLens[] = [];
    for (const candidate of candidates) {
      if (token.isCancellationRequested) return [];

      let symbolId: string;
      let symbolName: string;
      try {
        const positionResult = await this.host.protocol.querySymbolAtPosition({
          uri: focusUri,
          position: { line: candidate.line, character: candidate.character },
        });
        if (token.isCancellationRequested) return [];
        const symbol = positionResult?.symbol;
        if (!symbol) continue;
        symbolId = symbol.symbolId;
        symbolName = symbol.name;
      } catch (error) {
        if (codepolRequestSupersededErrorIs(error)) {
          return [];
        }
        throw error;
      }

      let importerCountResult;
      try {
        importerCountResult = await this.host.protocol.querySymbolImporterCount({
          symbolId,
        });
        if (token.isCancellationRequested) return [];
      } catch (error) {
        if (codepolRequestSupersededErrorIs(error)) {
          return [];
        }
        throw error;
      }
      if (!importerCountResult) continue;

      const viewModel = exportCodeLensViewModelCreate({
        importerCount: importerCountResult.importerCount,
        declarationName: symbolName,
        declarationUri: focusUri,
        declarationLine: candidate.line,
        declarationCharacter: candidate.character,
      });
      if (!viewModel) continue;

      const range = new vscode.Range(
        viewModel.line,
        viewModel.character,
        viewModel.line,
        viewModel.character,
      );
      const argument: ExportCodeLensCommandArgument = viewModel.commandArgument;
      lenses.push(
        new vscode.CodeLens(range, {
          title: viewModel.title,
          tooltip: viewModel.tooltip,
          command: this.host.peekCommandId,
          arguments: [argument],
        }),
      );
    }
    return lenses;
  }
}
