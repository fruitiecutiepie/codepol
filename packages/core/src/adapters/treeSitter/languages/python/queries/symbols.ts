/**
 * Tree-sitter symbol declaration query for Python.
 * Captures nodes that represent declarations (symbols).
 */
export const SYMBOLS_QUERY = `
; =========================
;  Classes
; =========================

(class_definition
  name: (identifier) @name) @decl.class

; =========================
;  Functions / Methods
; =========================

(function_definition
  name: (identifier) @name) @decl.function

; =========================
;  Parameters
; =========================

; Simple parameter
(parameters
  (identifier) @name) @decl.parameter

; Default parameter: def foo(x=1)
(parameters
  (default_parameter
    name: (identifier) @name)) @decl.parameter

; Typed parameter: def foo(x: int)
(parameters
  (typed_parameter
    (identifier) @name)) @decl.parameter

; Typed default parameter: def foo(x: int = 1)
(parameters
  (typed_default_parameter
    name: (identifier) @name)) @decl.parameter

; *args
(parameters
  (list_splat_pattern
    (identifier) @name)) @decl.parameter

; **kwargs
(parameters
  (dictionary_splat_pattern
    (identifier) @name)) @decl.parameter

; =========================
;  Variables (assignments)
; =========================

; Simple assignment: x = 1
(assignment
  left: (identifier) @name) @decl.variable

; Annotated assignment: x: int = 1
(assignment
  left: (identifier) @name
  type: (_)) @decl.variable

; =========================
;  Import bindings
; =========================

; import foo
(import_statement
  name: (dotted_name
    (identifier) @name)) @decl.import_binding

; from foo import bar
(import_from_statement
  name: (dotted_name
    (identifier) @name)) @decl.import_binding

; import foo as f
(aliased_import
  alias: (identifier) @name) @decl.import_binding

; =========================
;  For loop variables
; =========================

(for_statement
  left: (identifier) @name) @decl.variable

; =========================
;  With statement binding
; =========================

(with_item
  (as_pattern
    alias: (as_pattern_target
      (identifier) @name))) @decl.variable

; =========================
;  Except clause binding
; =========================

(except_clause
  (as_pattern
    alias: (as_pattern_target
      (identifier) @name))) @decl.variable
`;
