/**
 * Tree-sitter import query for Python.
 * Captures import statements with binding details for cross-file resolution.
 */
export const IMPORTS_QUERY = `
; =========================
;  Module Imports
; =========================

; import foo
(import_statement
  name: (dotted_name) @import.module_name) @import.module

; import foo as f
(import_statement
  (aliased_import
    name: (dotted_name) @import.module_name
    alias: (identifier) @import.module_alias)) @import.module_aliased

; =========================
;  From Imports
; =========================

; from foo import bar
(import_from_statement
  module_name: (dotted_name) @import.from_module
  name: (dotted_name
    (identifier) @import.binding_name)) @import.from

; from foo import bar as b
(import_from_statement
  module_name: (dotted_name) @import.from_module
  (aliased_import
    name: (dotted_name
      (identifier) @import.binding_name)
    alias: (identifier) @import.binding_alias)) @import.from_aliased

; from foo import *
(import_from_statement
  module_name: (dotted_name) @import.from_module
  (wildcard_import)) @import.from_star

; =========================
;  Relative Imports
; =========================

; from . import foo
(import_from_statement
  module_name: (relative_import) @import.relative_module
  name: (dotted_name
    (identifier) @import.binding_name)) @import.relative

; from .bar import foo
(import_from_statement
  module_name: (relative_import
    (dotted_name) @import.relative_submodule) @import.relative_module
  name: (dotted_name
    (identifier) @import.binding_name)) @import.relative_from

; from .. import foo
(import_from_statement
  module_name: (relative_import
    (import_prefix) @import.relative_prefix) @import.relative_module
  name: (dotted_name
    (identifier) @import.binding_name)) @import.relative_parent
`;
