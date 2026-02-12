/**
 * Tree-sitter call expression query for Python.
 * Captures call sites for building the call graph.
 */
export const CALLS_QUERY = `
; =========================
;  Call sites (heuristic)
; =========================

; foo()
(call
  function: (identifier) @callee.id)

; foo.bar()
(call
  function: (attribute
    object: (identifier) @callee.obj
    attribute: (identifier) @callee.attr))

; Foo() constructor call (same as function call in Python)
; Already covered by (call function: (identifier))

; super().method() - capture super call
(call
  function: (attribute
    object: (call
      function: (identifier) @callee.id)
    attribute: (identifier) @callee.attr))
`;
