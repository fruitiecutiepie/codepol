/**
 * Tree-sitter query for "function-as-argument" flow sites in
 * TypeScript/TSX.
 *
 * Captures every `call_expression` that has at least one bare
 * identifier argument; the extractor then resolves each captured
 * identifier and only emits a {@link SymbolFlowRelation} when the
 * referent is a `function` or `method` symbol.
 *
 * Inline arrow functions and `function () {}` literals are intentionally
 * NOT captured here — those are out of scope for the MVP per the Gap-1
 * design. Adding subtype fan-out or anonymous-callable tracking is left
 * to a `TypeAwareCallGraphSource` binding (Phase 9.2).
 *
 * Each `call_expression` match exposes:
 *
 * - `flow.call`             — the whole call expression node (used to
 *                             scope argument-index calculation and to
 *                             distinguish nested-call sites).
 * - `flow.callee.id`        — bare identifier callee (e.g. `arr(handler)`).
 * - `flow.callee.member.obj`/`flow.callee.member.prop`
 *                           — `obj.method(handler)` style callee. The
 *                             extractor resolves `obj` to a local symbol
 *                             and uses the property name to look up the
 *                             receiving method on that symbol's type.
 * - `flow.argument`         — every bare identifier argument node. The
 *                             extractor walks the call's `arguments` list
 *                             to compute the 0-based `argumentIndex`.
 *
 * The query is intentionally permissive — the hard filtering (kind ==
 * function/method, identifier resolves locally, not the same node as the
 * callee identifier) lives in `symbolFlowExtract.ts` so the resolution
 * logic can stay together with the `resolveLocal`/`callsExtract`
 * conventions already used by the adapter.
 */
export const SYMBOL_FLOW_QUERY = `
; =========================
;  Calls with bare-identifier argument(s)
;  - simple callee:   foo(handler)
; =========================

(call_expression
  function: (identifier) @flow.callee.id
  arguments: (arguments
    (identifier) @flow.argument)) @flow.call

; =========================
;  Calls with bare-identifier argument(s)
;  - member callee:   obj.method(handler)
; =========================

(call_expression
  function: (member_expression
    object: (identifier) @flow.callee.member.obj
    property: (property_identifier) @flow.callee.member.prop)
  arguments: (arguments
    (identifier) @flow.argument)) @flow.call
`;
