/**
 * Per-interface "implementers" CodeLens provider.
 *
 * Phase 9.5 / Gap 3 — sibling to {@link CodepolSymbolCodeLensProvider}.
 * Surfaces "N implementers (M shape-matched)" above every interface or
 * type-alias declaration in TypeScript files so users can see the
 * answer without opening a panel.
 *
 * Per the plan, this provider does NOT spawn a TypeScript parser in
 * the extension. It uses a tiny regex to find candidate declaration
 * lines, then defers to the LSP's `querySymbolAtPosition` for symbol
 * id resolution and to `queryTypeHierarchy` for the implementer set.
 * The cost is N RPCs per file (one position lookup + one hierarchy
 * lookup per interface), which is acceptable for the cardinality of
 * interfaces in a single file (typically 0-5).
 *
 * Click target: `codepol.extension.showTypeHierarchy` with the
 * symbol id passed via the lens command argument; the command opens
 * the dedicated panel.
 *
 * Refresh trigger: `readiness.onDidChange` (mirrors the symbol code
 * lens). The CodeLens API itself re-fires `provideCodeLenses` on
 * document edits, so that path is already covered.
 */
import * as vscode from 'vscode';
import {
  typeHierarchyCodeLensViewModelCreate,
  type TypeHierarchyCodeLensCommandArgument,
} from './typeHierarchyCodeLensViewModels';
import type { CodepolProtocolClient } from './protocolClient';
import { codepolRequestSupersededErrorIs } from './readiness';

export type CodepolTypeHierarchyCodeLensProviderHost = {
  protocol: Pick<
    CodepolProtocolClient,
    'querySymbolAtPosition' | 'queryTypeHierarchy'
  >;
  showTypeHierarchyCommandId: string;
};

/**
 * Match a top-level interface or type-alias declaration. Looks for
 * the declaration keyword followed by an identifier name. Captures
 * the name's column so the position lookup hits the right symbol.
 *
 * Intentionally narrow:
 * - Only matches at column 0 (or after `export ` / `export default`
 *   prefix). Skips namespaced or nested declarations.
 * - Does NOT match `type Foo = string` (alias to a non-object type)
 *   — the resolved symbol kind filter on the LSP side handles that
 *   anyway, but the regex skips obvious non-matches to save one
 *   round-trip.
 *
 * Examples that match:
 *   `interface Foo {`
 *   `export interface Foo<T> extends Bar {`
 *   `type Renderable = {`
 *   `export type Handler<T> = {`
 *
 * Examples that do not match:
 *   `  interface Inner {` (indented)
 *   `interface Foo` (no opening brace, body declaration)
 *   `type Alias = number;` (not an object literal)
 */
const INTERFACE_OR_TYPE_DECL_REGEX =
  /^(?<prefix>(?:export\s+(?:default\s+)?)?)(?<keyword>interface|type)\s+(?<name>[A-Za-z_$][\w$]*)/;

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
    const match = INTERFACE_OR_TYPE_DECL_REGEX.exec(text);
    if (!match || !match.groups) continue;
    const prefix = match.groups.prefix ?? '';
    const keyword = match.groups.keyword ?? '';
    const name = match.groups.name ?? '';
    if (!name) continue;
    // For `type` declarations, only emit a candidate when the value
    // looks like an object literal (`= {`). Skip plain aliases
    // (`type X = number`) which never have shape-based implementers.
    if (keyword === 'type' && !/=\s*\{/.test(text)) continue;
    const character = prefix.length + keyword.length + 1; // 1 = single space between keyword and name
    // Re-find the actual name index in case the regex absorbed extra
    // whitespace; the LSP requires the position of the identifier.
    const nameIndex = text.indexOf(name, character - 1);
    candidates.push({
      line,
      character: nameIndex >= 0 ? nameIndex : character,
      name,
    });
  }
  return candidates;
}

export class CodepolTypeHierarchyCodeLensProvider
  implements vscode.CodeLensProvider
{
  private readonly didChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.didChangeEmitter.event;

  constructor(
    private readonly host: CodepolTypeHierarchyCodeLensProviderHost,
  ) {}

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
    const languageId = document.languageId;
    if (
      languageId !== 'typescript' &&
      languageId !== 'typescriptreact'
    ) {
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
      let symbolKind: string | undefined;
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
        symbolKind = symbol.kind;
      } catch (error) {
        if (codepolRequestSupersededErrorIs(error)) {
          return [];
        }
        throw error;
      }

      // Filter to interface and type-alias kinds only. The regex may
      // have matched a type alias for a primitive that the LSP
      // resolved to `'type'` — keep that, since the structural-shape
      // pass also runs on type-alias-of-object owners.
      if (symbolKind !== 'interface' && symbolKind !== 'type') continue;

      let result;
      try {
        result = await this.host.protocol.queryTypeHierarchy({
          symbolId,
          direction: 'subtypes',
          // Phase 9.4 / Gap 3 — opt in to shape-match edges so the
          // CodeLens count matches what the user sees in the panel.
          includeStructural: true,
        });
        if (token.isCancellationRequested) return [];
      } catch (error) {
        if (codepolRequestSupersededErrorIs(error)) {
          return [];
        }
        throw error;
      }
      if (!result) continue;

      const viewModel = typeHierarchyCodeLensViewModelCreate({
        result,
        focusSymbolId: symbolId,
        focusSymbolName: symbolName,
        line: candidate.line,
        character: candidate.character,
      });
      if (!viewModel) continue;

      const range = new vscode.Range(
        viewModel.line,
        viewModel.character,
        viewModel.line,
        viewModel.character,
      );
      const argument: TypeHierarchyCodeLensCommandArgument = {
        symbolId: viewModel.symbolId,
        focusSymbolName: viewModel.focusSymbolName,
      };
      lenses.push(
        new vscode.CodeLens(range, {
          title: viewModel.title,
          tooltip: viewModel.tooltip,
          command: this.host.showTypeHierarchyCommandId,
          arguments: [argument],
        }),
      );
    }
    return lenses;
  }
}
