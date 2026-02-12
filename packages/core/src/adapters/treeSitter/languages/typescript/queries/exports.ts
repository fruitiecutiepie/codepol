/**
 * Tree-sitter export query for TypeScript/TSX.
 * Captures export statements for cross-file resolution.
 * 
 * Note: Simplified to avoid optional fields and node types that may not be supported.
 */
export const EXPORTS_QUERY = `
; =========================
;  Export Declarations
; =========================

; export const/let/var foo = ...
(export_statement
  declaration: (lexical_declaration
    (variable_declarator
      name: (identifier) @export.decl_name))) @export.declaration

; export function foo() { ... }
(export_statement
  declaration: (function_declaration
    name: (identifier) @export.decl_name)) @export.declaration

; export function* gen() { ... } (generator function)
(export_statement
  declaration: (generator_function_declaration
    name: (identifier) @export.decl_name)) @export.declaration

; export class Foo { ... }
(export_statement
  declaration: (class_declaration
    name: (type_identifier) @export.decl_name)) @export.declaration

; export type MyType = ...
(export_statement
  declaration: (type_alias_declaration
    name: (type_identifier) @export.decl_name)) @export.declaration

; export interface MyInterface { ... }
(export_statement
  declaration: (interface_declaration
    name: (type_identifier) @export.decl_name)) @export.declaration

; export enum MyEnum { ... }
(export_statement
  declaration: (enum_declaration
    name: (identifier) @export.decl_name)) @export.declaration

; export abstract class Foo { ... }
(export_statement
  declaration: (abstract_class_declaration
    name: (type_identifier) @export.decl_name)) @export.declaration

; export namespace NS { ... } / export module M { ... }
(export_statement
  declaration: (internal_module
    name: (identifier) @export.decl_name)) @export.declaration

; =========================
;  Named Exports
; =========================

; export { foo }
(export_statement
  (export_clause
    (export_specifier
      name: (identifier) @export.name))) @export.named

; =========================
;  Default Exports
; =========================

; export default foo (identifier)
(export_statement
  value: (identifier) @export.default_name) @export.default

; export default class Foo { ... } (class without declaration: field means default)
(export_statement
  "default"
  (class_declaration
    name: (type_identifier) @export.default_name)) @export.default

; export default function foo() { ... } (function without declaration: field means default)
(export_statement
  "default"
  (function_declaration
    name: (identifier) @export.default_name)) @export.default

; =========================
;  Re-exports
; =========================

; export * from './mod' (star re-export)
(export_statement
  "*"
  source: (string) @export.star_source) @export.star

; export * as ns from './mod' (namespace re-export)
(export_statement
  (namespace_export
    (identifier) @export.namespace_name)
  source: (string) @export.namespace_source) @export.namespace_reexport
`;
