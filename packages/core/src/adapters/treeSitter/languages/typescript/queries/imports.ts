/**
 * Tree-sitter import query for TypeScript/TSX.
 * Captures import statements with binding details for cross-file resolution.
 *
 * Supports:
 * - ESM static imports (named, default, namespace, side-effect)
 * - CommonJS require() (whole-module and destructured)
 * - Dynamic import() with binding resolution and specifier extraction
 *
 * Note: #eq? predicates are used for require() to avoid matching
 * arbitrary call expressions. Confirmed working in web-tree-sitter.
 */
export const IMPORTS_QUERY = `
; =========================
;  Named Imports
; =========================

; import { foo } from "module"
(import_statement
  (import_clause
    (named_imports
      (import_specifier
        name: (identifier) @import.binding_name)))
  source: (string) @import.source) @import.named

; =========================
;  Default Imports
; =========================

; import foo from "module"
(import_statement
  (import_clause
    (identifier) @import.default_name)
  source: (string) @import.source) @import.default

; import foo = require("module")
(import_statement
  (import_require_clause
    (identifier) @import.default_name
    source: (string) @import.source)) @import.default

; =========================
;  Namespace Imports
; =========================

; import * as foo from "module"
(import_statement
  (import_clause
    (namespace_import
      (identifier) @import.namespace_name))
  source: (string) @import.source) @import.namespace

; =========================
;  Side-effect Imports (module specifier only)
; =========================

; import "module" (no bindings)
(import_statement
  source: (string) @import.source) @import.side_effect

; =========================
;  CommonJS require (whole-module)
; =========================

; const foo = require("module")
(lexical_declaration
  (variable_declarator
    name: (identifier) @import.require_name
    value: (call_expression
      function: (identifier) @_fn (#eq? @_fn "require")
      arguments: (arguments (string) @import.require_source)))) @import.require

; =========================
;  CommonJS require (destructured)
; =========================

; const { foo } = require("module")
(lexical_declaration
  (variable_declarator
    name: (object_pattern
      (shorthand_property_identifier_pattern) @import.require_binding)
    value: (call_expression
      function: (identifier) @_fn (#eq? @_fn "require")
      arguments: (arguments (string) @import.require_source)))) @import.require

; =========================
;  Dynamic import (whole-module binding)
; =========================

; const mod = await import("module")
(lexical_declaration
  (variable_declarator
    name: (identifier) @import.dynamic_name
    value: (await_expression
      (call_expression
        function: (import)
        arguments: (arguments (string) @import.dynamic_source))))) @import.dynamic

; =========================
;  Dynamic import (destructured binding)
; =========================

; const { foo } = await import("module")
(lexical_declaration
  (variable_declarator
    name: (object_pattern
      (shorthand_property_identifier_pattern) @import.dynamic_binding)
    value: (await_expression
      (call_expression
        function: (import)
        arguments: (arguments (string) @import.dynamic_source))))) @import.dynamic

; =========================
;  Dynamic import (specifier extraction only)
; =========================

; import("module") — captured as side-effect for module specifier tracking
(call_expression
  function: (import)
  arguments: (arguments (string) @import.source)) @import.side_effect
`;
