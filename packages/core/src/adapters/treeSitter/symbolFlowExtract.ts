/**
 * @packageDocumentation
 * "Function-as-argument" flow extractor — Phase 9.1 / Gap 1.
 *
 * One job: walk tree-sitter `call_expression` matches with bare-identifier
 * arguments, resolve each argument identifier to a same-file symbol, and
 * emit a {@link SymbolFlowRelation} when the referent is a function or
 * method. The result is a *separate* surface from the call graph — it
 * does NOT mutate {@link CallsRelation} entries and the workspace
 * service must not merge it into call-graph edges.
 *
 * Resolution is file-local on purpose. The extractor takes a
 * `symbolByName` lookup that the caller (the adapter core) builds from
 * the file's symbols, so the language-specific scope-walking already
 * used by `refsExtract` / `callsExtract` is reused without duplicating
 * it. Cross-file rewriting (chasing import bindings to their canonical
 * declaration) lives in `crossFileResolve` and runs uniformly over all
 * relation kinds; the extractor only needs to produce a faithful
 * file-local fact.
 *
 * Inline arrow functions and `function () {}` literals are explicitly
 * out of scope (see {@link SYMBOL_FLOW_QUERY} — only bare identifier
 * argument nodes are captured).
 */

import type Parser from 'web-tree-sitter';
import type {
  ByteRange,
  ScopeId,
  SymbolFlowRelation,
  SymbolRecord,
  ScopeRecord,
} from '../../index/indexTypes';

/**
 * Minimal language-pack input the extractor needs. Mirrors the shape
 * the adapter core already builds for `callsExtract` so the wiring in
 * `indexFileWithTreeSitter` is symmetric with `typeRelationsExtract`.
 */
export type SymbolFlowExtractInput = {
  /** The pre-compiled tree-sitter query (`SYMBOL_FLOW_QUERY`). */
  query: Parser.Query;
  /** Root node of the parsed file tree. */
  rootNode: Parser.SyntaxNode;
  /** Source text used to slice identifier names. */
  source: string;
  /** Absolute file path where the flow site lives. */
  file: string;
  /** All scopes in the file, used to resolve the owning function scope. */
  scopes: ScopeRecord[];
  /**
   * File-local name → symbol map. Built by the adapter core; passed in
   * so the extractor neither walks the symbol table itself nor reaches
   * into the index store.
   */
  symbolsByName: Map<string, SymbolRecord[]>;
  /**
   * Resolves a bare identifier reference to a file-local symbol using
   * the same scope-aware shadowing rules `refsExtract` uses. Passing
   * the resolver as a callback keeps the extractor independent of the
   * adapter core's internal helpers.
   */
  resolveLocal: (
    name: string,
    refNode: Parser.SyntaxNode,
  ) => SymbolRecord | undefined;
};

/**
 * Walk symbol-flow captures and build the relation list. Edges are
 * sorted deterministically by `(byteRange.start, argumentIndex)` so two
 * runs over byte-identical input produce byte-identical output.
 */
export function symbolFlowExtract(input: SymbolFlowExtractInput): SymbolFlowRelation[] {
  const relations: SymbolFlowRelation[] = [];
  const matches = input.query.matches(input.rootNode);

  for (const match of matches) {
    let callNode: Parser.SyntaxNode | undefined;
    let calleeIdNode: Parser.SyntaxNode | undefined;
    let calleeMemberObjNode: Parser.SyntaxNode | undefined;
    let calleeMemberPropNode: Parser.SyntaxNode | undefined;
    const argumentNodes: Parser.SyntaxNode[] = [];

    for (const capture of match.captures) {
      switch (capture.name) {
        case 'flow.call':
          callNode = capture.node;
          break;
        case 'flow.callee.id':
          calleeIdNode = capture.node;
          break;
        case 'flow.callee.member.obj':
          calleeMemberObjNode = capture.node;
          break;
        case 'flow.callee.member.prop':
          calleeMemberPropNode = capture.node;
          break;
        case 'flow.argument':
          argumentNodes.push(capture.node);
          break;
        default:
          // Unknown capture — ignore to stay forward-compatible if the
          // query gains optional captures later.
          break;
      }
    }

    if (!callNode || argumentNodes.length === 0) continue;

    // Resolve the receiving call's symbol (best-effort, file-local
    // only). Cross-file resolution may later upgrade this through
    // `relationUpdate` once `crossFileResolve` rewrites the receiver.
    const receivingCallSymbol = receivingCallSymbolResolve({
      calleeIdNode,
      calleeMemberObjNode,
      calleeMemberPropNode,
      source: input.source,
      symbolsByName: input.symbolsByName,
      resolveLocal: input.resolveLocal,
    });

    // Compute 0-based argument indices by walking the call's
    // `arguments` named children. Using the call's own AST (not the
    // capture order) keeps the index stable when the query batches
    // multiple captures from one call.
    const argumentIndexByNodeId = argumentIndexMapBuild(callNode);

    for (const argumentNode of argumentNodes) {
      // Defensive: the same identifier can be both a callee and an
      // argument when nested (`f(g)(h)` — `g` is an argument of `f`'s
      // call, not a callee at this match). Comparing node identities
      // skips false positives when the same identifier is also marked
      // as a callee within the same match (cannot happen with the
      // current query but stays correct if the query grows).
      if (
        calleeIdNode && argumentNode.id === calleeIdNode.id
      ) {
        continue;
      }

      const argumentIndex = argumentIndexByNodeId.get(argumentNode.id);
      if (argumentIndex === undefined) continue;

      const name = sliceText(input.source, argumentNode.startIndex, argumentNode.endIndex);
      const flowingSymbol = input.resolveLocal(name, argumentNode);
      if (!flowingSymbol) continue;
      if (flowingSymbol.kind !== 'function' && flowingSymbol.kind !== 'method') {
        continue;
      }

      const byteRange: ByteRange = {
        start: argumentNode.startIndex,
        end: argumentNode.endIndex,
      };
      const ownerScopeId = ownerScopeIdGet(input.scopes, byteRange);

      relations.push({
        kind: 'SymbolFlow',
        flowingSymbolId: flowingSymbol.id,
        ownerScopeId,
        file: input.file,
        byteRange,
        flowKind: 'argument',
        ...(receivingCallSymbol
          ? { receivingCallSymbolId: receivingCallSymbol.id }
          : {}),
        argumentIndex,
      });
    }
  }

  relations.sort((left, right) => {
    if (left.byteRange.start !== right.byteRange.start) {
      return left.byteRange.start - right.byteRange.start;
    }
    const leftIndex = left.argumentIndex ?? 0;
    const rightIndex = right.argumentIndex ?? 0;
    return leftIndex - rightIndex;
  });

  return relations;
}

function receivingCallSymbolResolve(input: {
  calleeIdNode: Parser.SyntaxNode | undefined;
  calleeMemberObjNode: Parser.SyntaxNode | undefined;
  calleeMemberPropNode: Parser.SyntaxNode | undefined;
  source: string;
  symbolsByName: Map<string, SymbolRecord[]>;
  resolveLocal: SymbolFlowExtractInput['resolveLocal'];
}): SymbolRecord | undefined {
  if (input.calleeIdNode) {
    const name = sliceText(
      input.source,
      input.calleeIdNode.startIndex,
      input.calleeIdNode.endIndex,
    );
    const resolved = input.resolveLocal(name, input.calleeIdNode);
    if (resolved && (resolved.kind === 'function' || resolved.kind === 'method')) {
      return resolved;
    }
    // Fall back to file-local symbol-by-name lookup so we still resolve
    // simple top-level functions that `resolveLocal` may not pick up
    // when the file shadows them (mirrors `callsExtract`).
    const candidates = input.symbolsByName.get(name);
    return candidates?.find((s) => s.kind === 'function' || s.kind === 'method');
  }

  if (input.calleeMemberPropNode) {
    // For member callees we resolve only the property name into a
    // method symbol; the receiver type is unknown without a
    // type-aware source. This is good enough for "which method is
    // being passed handler?" when the project uses unique method
    // names, and degrades cleanly to undefined otherwise.
    const propName = sliceText(
      input.source,
      input.calleeMemberPropNode.startIndex,
      input.calleeMemberPropNode.endIndex,
    );
    const candidates = input.symbolsByName.get(propName);
    if (!candidates || candidates.length === 0) return undefined;
    const methodCandidates = candidates.filter((s) => s.kind === 'method');
    // Only return when the lookup is unambiguous — otherwise the
    // receiver is left undefined so downstream consumers can tell that
    // the resolver was not confident. This is the conservative choice
    // and matches the spec's "Unresolved receiver" test case.
    if (methodCandidates.length === 1) return methodCandidates[0];
    return undefined;
  }

  return undefined;
}

function argumentIndexMapBuild(callNode: Parser.SyntaxNode): Map<number, number> {
  const map = new Map<number, number>();
  const argsNode = callNode.childForFieldName('arguments');
  if (!argsNode) return map;
  let index = 0;
  for (let i = 0; i < argsNode.namedChildCount; i++) {
    const child = argsNode.namedChild(i);
    if (!child) continue;
    map.set(child.id, index);
    index += 1;
  }
  return map;
}

function ownerScopeIdGet(scopes: ScopeRecord[], byteRange: ByteRange): ScopeId {
  // Pick the smallest function/method scope that contains the flow
  // site. Falling back to the smallest containing scope of any kind
  // (and ultimately the file scope) keeps `ownerScopeId` total without
  // ever fabricating a scope id.
  let bestFunction: ScopeRecord | undefined;
  let bestAny: ScopeRecord | undefined;
  for (const scope of scopes) {
    if (scope.byteRange.start > byteRange.start) continue;
    if (scope.byteRange.end < byteRange.end) continue;
    const sizeBest = bestAny
      ? bestAny.byteRange.end - bestAny.byteRange.start
      : Number.POSITIVE_INFINITY;
    const sizeScope = scope.byteRange.end - scope.byteRange.start;
    if (sizeScope < sizeBest) {
      bestAny = scope;
    }
    if (scope.kind === 'function') {
      const sizeBestFn = bestFunction
        ? bestFunction.byteRange.end - bestFunction.byteRange.start
        : Number.POSITIVE_INFINITY;
      if (sizeScope < sizeBestFn) {
        bestFunction = scope;
      }
    }
  }
  return (bestFunction ?? bestAny ?? scopes[0]!).id;
}

function sliceText(source: string, start: number, end: number): string {
  return source.slice(start, end);
}
