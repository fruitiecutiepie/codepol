/**
 * Tree-sitter symbol declaration query for TypeScript/TSX.
 * Captures nodes that represent declarations (symbols).
 * 
 * Note: Simplified to use only widely-supported node types.
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

; Generator functions: function* gen() {}
(generator_function_declaration
  name: (identifier) @name) @decl.generator

; =========================
;  Methods
; =========================

(method_definition
  name: (property_identifier) @name) @decl.method

; =========================
;  Parameters
; =========================

(formal_parameters
  (required_parameter
    name: (identifier) @name)) @decl.parameter

(formal_parameters
  (required_parameter
    pattern: (identifier) @name)) @decl.parameter

(formal_parameters
  (required_parameter
    name: (rest_pattern
      (identifier) @name))) @decl.parameter

(formal_parameters
  (optional_parameter
    name: (identifier) @name)) @decl.parameter

(formal_parameters
  (optional_parameter
    pattern: (identifier) @name)) @decl.parameter

; =========================
;  Variables (var/let/const)
; =========================

(lexical_declaration
  (variable_declarator
    name: (identifier) @name)) @decl.variable

(variable_declaration
  (variable_declarator
    name: (identifier) @name)) @decl.variable

; Destructuring - object pattern: const { a, b } = obj
(lexical_declaration
  (variable_declarator
    name: (object_pattern
      (shorthand_property_identifier_pattern) @name))) @decl.variable

; Destructuring - array pattern: const [x, y] = arr
(lexical_declaration
  (variable_declarator
    name: (array_pattern
      (identifier) @name))) @decl.variable

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
`;
