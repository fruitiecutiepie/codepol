/**
 * Tree-sitter symbol declaration query for TypeScript/TSX.
 * Captures declaration nodes and lets adapterCore extract binding identifiers
 * from nested patterns where needed.
 */
export const SYMBOLS_QUERY = `
; =========================
;  Classes
; =========================

(class_declaration
  name: (type_identifier) @name) @decl.class

; Abstract classes
(abstract_class_declaration
  name: (type_identifier) @name) @decl.abstract_class

; =========================
;  Functions
; =========================

(function_declaration
  name: (identifier) @name) @decl.function

; Ambient/overload signatures: declare function foo(): void;
(function_signature
  name: (identifier) @name) @decl.function

; Generator functions: function* gen() {}
(generator_function_declaration
  name: (identifier) @name) @decl.generator

; Named function expressions: const x = function y() {}
(function_expression
  name: (identifier) @name) @decl.function_expression_name

; =========================
;  Methods
; =========================

(method_definition
  name: (property_identifier) @name) @decl.method

(method_definition
  name: (private_property_identifier) @name) @decl.method

(method_definition
  name: (string) @name) @decl.method

(method_definition
  name: (number) @name) @decl.method

; =========================
;  Fields
; =========================

(public_field_definition
  name: (property_identifier) @name) @decl.field

(public_field_definition
  name: (private_property_identifier) @name) @decl.field

(public_field_definition
  name: (string) @name) @decl.field

(public_field_definition
  name: (number) @name) @decl.field

; =========================
;  Variables (var/let/const)
; =========================

(lexical_declaration
  (variable_declarator) @decl.variable)

(variable_declaration
  (variable_declarator) @decl.variable)

; =========================
;  Parameters / Catch bindings
; =========================

(required_parameter) @decl.parameter
(optional_parameter) @decl.parameter
(catch_clause) @decl.catch_binding

; =========================
;  Type Aliases
; =========================

(type_alias_declaration
  name: (type_identifier) @name) @decl.type

; =========================
;  Interfaces
; =========================

(interface_declaration
  name: (type_identifier) @name) @decl.interface

; =========================
;  Enums
; =========================

(enum_declaration
  name: (identifier) @name) @decl.enum

; Enum members: enum Color { Red = 'red', Green = 'green' }
(enum_assignment
  name: (property_identifier) @name) @decl.enumMember

; =========================
;  Namespaces / Modules
; =========================

(internal_module
  name: (identifier) @name) @decl.namespace

(internal_module
  name: (nested_identifier) @name) @decl.namespace

(module
  name: (identifier) @name) @decl.module

(module
  name: (nested_identifier) @name) @decl.module

(module
  name: (string
    (string_fragment) @name)) @decl.module

; =========================
;  Import bindings
; =========================

; Named imports: import { foo } from "module"
(import_specifier
  name: (identifier) @name) @decl.import_binding

; Namespace imports: import * as foo from "module"
(namespace_import
  (identifier) @name) @decl.import_binding

; Default imports: import foo from "module"
; The identifier is directly under import_clause when it's a default import
(import_clause
  (identifier) @name) @decl.import_binding

; import foo = require("module")
(import_require_clause
  (identifier) @name) @decl.import_binding

; import Foo = Bar.Baz
(import_alias
  (identifier) @name) @decl.import_binding
`;
