/**
 * Tree-sitter import query for TypeScript/TSX.
 * Captures import statements with binding details for cross-file resolution.
 * 
 * Note: Simplified to avoid predicates and node types that may not be supported.
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
`;
