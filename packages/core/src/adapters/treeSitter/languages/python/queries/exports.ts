/**
 * Tree-sitter export query for Python.
 * Python doesn't have explicit export syntax like JavaScript/TypeScript.
 * Instead, we detect:
 * 1. __all__ list definitions (explicit exports)
 * 2. Module-level public symbols (names not starting with _)
 *
 * For now, we capture __all__ definitions and mark all module-level
 * symbols without leading underscore as potentially exported.
 */
export const EXPORTS_QUERY = `
; =========================
;  __all__ Definition
; =========================

; __all__ = ["foo", "bar"]
(assignment
  left: (identifier) @export.all_name
  right: (list
    (string) @export.all_item))
  (#eq? @export.all_name "__all__") @export.all

; __all__ = ("foo", "bar")
(assignment
  left: (identifier) @export.all_name
  right: (tuple
    (string) @export.all_item))
  (#eq? @export.all_name "__all__") @export.all_tuple

; =========================
;  Module-level Definitions
;  (Potentially exported if public)
; =========================

; Module-level function definitions
(module
  (function_definition
    name: (identifier) @export.func_name)) @export.func

; Module-level class definitions
(module
  (class_definition
    name: (identifier) @export.class_name)) @export.class

; Module-level variable assignments
(module
  (expression_statement
    (assignment
      left: (identifier) @export.var_name))) @export.var
`;
