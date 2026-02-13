/**
 * Tree-sitter type relation query for TypeScript/TSX.
 * Captures extends/implements clauses on classes and interfaces.
 *
 * Patterns verified against tree-sitter-typescript AST:
 * - class_declaration / abstract_class_declaration → class_heritage → extends_clause (value: identifier)
 * - class_declaration / abstract_class_declaration → class_heritage → implements_clause (type_identifier children)
 * - interface_declaration → extends_type_clause (type: type_identifier)
 */
export const TYPE_RELATIONS_QUERY = `
; =========================
;  Class extends
; =========================

; class Foo extends Bar { ... }
(class_declaration
  name: (type_identifier) @typerel.child_name
  (class_heritage
    (extends_clause
      value: (identifier) @typerel.extends_target))) @typerel.class_extends

; =========================
;  Class implements
; =========================

; class Foo implements IBar { ... }
; (also matches each interface in: class Foo implements IBar, IBaz)
(class_declaration
  name: (type_identifier) @typerel.child_name
  (class_heritage
    (implements_clause
      (type_identifier) @typerel.implements_target))) @typerel.class_implements

; =========================
;  Abstract class extends
; =========================

; abstract class Foo extends Bar { ... }
(abstract_class_declaration
  name: (type_identifier) @typerel.child_name
  (class_heritage
    (extends_clause
      value: (identifier) @typerel.extends_target))) @typerel.abstract_extends

; =========================
;  Abstract class implements
; =========================

; abstract class Foo implements IBar { ... }
(abstract_class_declaration
  name: (type_identifier) @typerel.child_name
  (class_heritage
    (implements_clause
      (type_identifier) @typerel.implements_target))) @typerel.abstract_implements

; =========================
;  Interface extends
; =========================

; interface IFoo extends IBar { ... }
; (also matches each parent in: interface IFoo extends IBar, IBaz)
(interface_declaration
  name: (type_identifier) @typerel.child_name
  (extends_type_clause
    type: (type_identifier) @typerel.extends_target)) @typerel.interface_extends
`;
