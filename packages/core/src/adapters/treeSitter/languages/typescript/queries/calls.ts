/**
 * Tree-sitter call expression query for TypeScript/TSX.
 * Captures call sites for building the call graph.
 */
export const CALLS_QUERY = `
; =========================
;  Call sites (heuristic)
; =========================

; foo()
(call_expression
  function: (identifier) @callee.id)

; foo.bar()
(call_expression
  function: (member_expression
    object: (identifier) @callee.obj
    property: (property_identifier) @callee.prop))

; new Foo()
(new_expression
  constructor: (identifier) @callee.id)

; new Foo.Bar()
(new_expression
  constructor: (member_expression
    object: (identifier) @callee.obj
    property: (property_identifier) @callee.prop))
`;
