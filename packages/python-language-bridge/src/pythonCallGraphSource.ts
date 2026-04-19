/**
 * @packageDocumentation
 * Python implementation of {@link TypeAwareCallGraphSource}.
 *
 * Phase 9.2 / Gap 1 follow-up. The bridge speaks LSP via the transport
 * supplied by the host — it never spawns `pyright` / `pylance` itself.
 * Two LSP requests power the source today (both standard, no
 * server-specific extensions):
 *
 * - `textDocument/prepareCallHierarchy` + `callHierarchy/incomingCalls`
 *   for `typeAwareCallersGet`.
 * - `textDocument/prepareCallHierarchy` + `callHierarchy/outgoingCalls`
 *   for `typeAwareCalleesGet`.
 *
 * Symbol identifiers in the codepol index are opaque hashes (see
 * `adapterCore.symbolIdCreate`) — the bridge needs a way to translate
 * them into the `(uri, position)` tuples LSP speaks. The host supplies
 * that translation via {@link PythonCallGraphSourceOptions.symbolLocate}
 * and {@link PythonCallGraphSourceOptions.symbolIdResolve} (typically
 * backed by the workspace service's symbol registry).
 *
 * Honesty trade-off: when the language server cannot distinguish
 * direct vs dynamic-dispatch vs higher-order, the bridge defaults to
 * `'direct'`. Inventing a less-precise label would falsely advertise
 * type-aware classification the source did not actually provide. This
 * matches the TypeScript bridge's contract.
 *
 * Python-specific notes for `callKind` derivation:
 *
 * - Pyright surfaces hints in `CallHierarchyItem.detail` for
 *   `@abstractmethod`, `Protocol`, and `@overload` declarations. The
 *   parser below treats `abstract` / `protocol` / `overload` /
 *   `dynamic` / `virtual` markers as `'dynamic-dispatch'` because
 *   each implies the call site cannot statically resolve to a single
 *   implementation.
 * - `callback` / `higher-order` markers map to `'higher-order'` for
 *   functions stored in variables / passed around (the structural
 *   call graph already misses these — see `querySymbolFlow`).
 * - All other items default to `'direct'`.
 */

import type {
  SymbolId,
  TypeAwareCallEdge,
  TypeAwareCallGraphSource,
  TypeAwareCallKind,
} from '@codepol/core';
import type { LspTransport } from './lspTransport';

/**
 * Minimal `(uri, line, character)` tuple the bridge sends in LSP
 * requests. Defined locally so the bridge has no compile-time
 * dependency on `vscode-languageserver-types`.
 */
export type LspSymbolLocation = {
  uri: string;
  line: number;
  character: number;
};

/**
 * Host-supplied callback that translates a codepol {@link SymbolId} to
 * the `(uri, position)` tuple LSP needs and back. The translation is
 * lossy in both directions:
 *
 * - `symbolLocate` may return `undefined` for symbols the host has not
 *   yet indexed (e.g. anonymous `lambda` expressions or symbols
 *   declared inside conditional branches the index didn't traverse).
 * - `symbolIdResolve` may return `undefined` for LSP-reported
 *   declarations the host's index does not know about (e.g. symbols
 *   in `site-packages` or the standard library). In both cases the
 *   bridge skips the edge — the workspace merge then falls back to
 *   structural for that endpoint.
 */
export type PythonCallGraphSourceOptions = {
  transport: LspTransport;
  symbolLocate(symbolId: SymbolId): LspSymbolLocation | undefined;
  symbolIdResolve(location: LspSymbolLocation): SymbolId | undefined;
};

/**
 * Shape of one item from `prepareCallHierarchy`. The bridge consumes
 * the `name`, `kind`, `uri`, and `selectionRange.start` fields plus
 * the opaque `data` field to feed back into `incoming/outgoingCalls`.
 *
 * Defined locally rather than imported from `vscode-languageserver-types`
 * so the bridge has zero external SDK dependencies.
 */
type LspCallHierarchyItem = {
  name: string;
  kind: number;
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  selectionRange: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  data?: unknown;
  /**
   * Best-effort hint the language server may set to mark items derived
   * from a dynamic-dispatch / higher-order site. Standard LSP does not
   * carry this — most servers leave it absent and the bridge defaults
   * to `'direct'`.
   */
  detail?: string;
};

type LspIncomingCall = {
  from: LspCallHierarchyItem;
  fromRanges: Array<{
    start: { line: number; character: number };
    end: { line: number; character: number };
  }>;
};

type LspOutgoingCall = {
  to: LspCallHierarchyItem;
  fromRanges: Array<{
    start: { line: number; character: number };
    end: { line: number; character: number };
  }>;
};

/**
 * Build a Python {@link TypeAwareCallGraphSource} backed by the
 * supplied LSP transport. The transport's lifecycle is owned by the
 * host; the bridge only issues requests through it.
 */
export function pythonCallGraphSourceCreate(
  options: PythonCallGraphSourceOptions,
): TypeAwareCallGraphSource {
  return {
    async typeAwareCallersGet(symbolId: SymbolId): Promise<TypeAwareCallEdge[]> {
      const location = options.symbolLocate(symbolId);
      if (!location) return [];

      const items = await options.transport.request<LspCallHierarchyItem[] | null>(
        'textDocument/prepareCallHierarchy',
        callHierarchyPrepareParamsCreate(location),
      );
      if (!items || items.length === 0) return [];

      const edges: TypeAwareCallEdge[] = [];
      for (const item of items) {
        const incoming = await options.transport.request<LspIncomingCall[] | null>(
          'callHierarchy/incomingCalls',
          { item },
        );
        if (!incoming) continue;
        for (const call of incoming) {
          const callerSymbolId = options.symbolIdResolve({
            uri: call.from.uri,
            line: call.from.selectionRange.start.line,
            character: call.from.selectionRange.start.character,
          });
          if (!callerSymbolId) continue;
          edges.push({
            callerSymbolId,
            calleeSymbolId: symbolId,
            callKind: callKindFromItem(call.from),
          });
        }
      }
      return edges;
    },

    async typeAwareCalleesGet(symbolId: SymbolId): Promise<TypeAwareCallEdge[]> {
      const location = options.symbolLocate(symbolId);
      if (!location) return [];

      const items = await options.transport.request<LspCallHierarchyItem[] | null>(
        'textDocument/prepareCallHierarchy',
        callHierarchyPrepareParamsCreate(location),
      );
      if (!items || items.length === 0) return [];

      const edges: TypeAwareCallEdge[] = [];
      for (const item of items) {
        const outgoing = await options.transport.request<LspOutgoingCall[] | null>(
          'callHierarchy/outgoingCalls',
          { item },
        );
        if (!outgoing) continue;
        for (const call of outgoing) {
          const calleeSymbolId = options.symbolIdResolve({
            uri: call.to.uri,
            line: call.to.selectionRange.start.line,
            character: call.to.selectionRange.start.character,
          });
          if (!calleeSymbolId) continue;
          edges.push({
            callerSymbolId: symbolId,
            calleeSymbolId,
            callKind: callKindFromItem(call.to),
          });
        }
      }
      return edges;
    },
  };
}

function callHierarchyPrepareParamsCreate(location: LspSymbolLocation): {
  textDocument: { uri: string };
  position: { line: number; character: number };
} {
  return {
    textDocument: { uri: location.uri },
    position: { line: location.line, character: location.character },
  };
}

/**
 * Map an LSP call-hierarchy item to a {@link TypeAwareCallKind}. The
 * standard LSP shape carries no kind axis, so the bridge inspects the
 * (server-specific) `detail` hint and otherwise defaults to
 * `'direct'` — the conservative choice when the source was not
 * confident.
 *
 * The Python-flavored markers extend the TypeScript bridge's set:
 * `abstract` / `protocol` / `overload` all imply a call site that
 * cannot statically resolve to a single implementation, so they map
 * to `'dynamic-dispatch'`.
 */
function callKindFromItem(item: LspCallHierarchyItem): TypeAwareCallKind {
  const detail = item.detail?.toLowerCase() ?? '';
  if (
    detail.includes('abstract') ||
    detail.includes('protocol') ||
    detail.includes('overload') ||
    detail.includes('dynamic') ||
    detail.includes('virtual')
  ) {
    return 'dynamic-dispatch';
  }
  if (detail.includes('higher-order') || detail.includes('callback')) {
    return 'higher-order';
  }
  return 'direct';
}
