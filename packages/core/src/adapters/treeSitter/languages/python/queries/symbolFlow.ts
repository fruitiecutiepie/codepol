/**
 * Tree-sitter query for "function-as-argument" flow sites in Python.
 *
 * Mirrors the TypeScript pack one-for-one — captures every `call` that
 * has at least one bare-identifier argument; the language-agnostic
 * extractor (`packages/core/src/adapters/treeSitter/symbolFlowExtract.ts`)
 * then resolves each captured identifier and emits a
 * {@link SymbolFlowRelation} only when the referent is a `function` or
 * `method` symbol.
 *
 * Inline `lambda` expressions and `def`-as-statement-then-pass are
 * intentionally NOT captured here — anonymous-callable tracking is out
 * of scope for the MVP per the Gap-1 design. The same rule applies in
 * the TypeScript pack for arrow / `function () {}` literals.
 *
 * Keyword arguments (`f(x=handler)`) are also NOT captured: the
 * `handler` identifier sits inside a `keyword_argument` wrapper rather
 * than as a direct child of `argument_list`, so the bare-identifier
 * pattern below skips it. This is intentional — the MVP rule is
 * "positional bare identifier only" so the extractor's
 * `argumentIndex` is unambiguous. A follow-up phase that surfaces
 * keyword-argument flow can add a separate capture (and reserve a
 * matching field on `SymbolFlowRelation`) without churning the
 * existing edges.
 *
 * Each `call` match exposes:
 *
 * - `flow.call`             — the whole call node (used to scope
 *                             argument-index calculation and to
 *                             distinguish nested-call sites).
 * - `flow.callee.id`        — bare identifier callee (e.g. `map(handler, xs)`).
 * - `flow.callee.member.obj`/`flow.callee.member.prop`
 *                           — `obj.method(handler)` style callee. The
 *                             extractor resolves `obj` to a local symbol
 *                             and uses the property name to look up the
 *                             receiving method on that symbol's type.
 * - `flow.argument`         — every bare identifier argument node.
 *
 * The capture *names* match the TypeScript pack exactly so the shared
 * `symbolFlowExtract` module stays language-agnostic (it switches on
 * capture names, not grammar node types).
 */
export const SYMBOL_FLOW_QUERY = `
; =========================
;  Calls with bare-identifier argument(s)
;  - simple callee:   foo(handler)
; =========================

(call
  function: (identifier) @flow.callee.id
  arguments: (argument_list
    (identifier) @flow.argument)) @flow.call

; =========================
;  Calls with bare-identifier argument(s)
;  - member callee:   obj.method(handler)
; =========================

(call
  function: (attribute
    object: (identifier) @flow.callee.member.obj
    attribute: (identifier) @flow.callee.member.prop)
  arguments: (argument_list
    (identifier) @flow.argument)) @flow.call
`;
