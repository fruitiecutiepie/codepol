/**
 * Tree-sitter member-shape query for Python.
 *
 * Captures the public members of every class-like declaration so the
 * shared structural-shape pass can compare Protocol contracts against
 * concrete classes. Owner kind is resolved from the indexed symbol,
 * so the same query covers both ordinary classes and Protocol-based
 * interface-like declarations.
 *
 * Scope of the first pass:
 *
 * - Methods declared directly in the class body
 * - Decorated methods (`@property`, `@x.setter`, `@staticmethod`,
 *   `@classmethod`) via the shared extractor's decorator inspection
 * - Class-body attribute declarations like `name: str` or `name = 1`
 *
 * Not captured yet:
 *
 * - Instance attributes introduced via `self.name = ...` inside a
 *   method body — those need a separate design choice because the
 *   parser cannot prove which object owns the attribute.
 */
export const MEMBER_SHAPE_QUERY = `
; =========================
;  Class / Protocol members
; =========================

(class_definition
  name: (identifier) @shape.owner_name
  body: (block
    (function_definition
      name: (identifier) @shape.member_name) @shape.member)) @shape.owner.class

(class_definition
  name: (identifier) @shape.owner_name
  body: (block
    (decorated_definition
      definition: (function_definition
        name: (identifier) @shape.member_name) @shape.member))) @shape.owner.class

(class_definition
  name: (identifier) @shape.owner_name
  body: (block
    (expression_statement
      (assignment
        left: (identifier) @shape.member_name) @shape.member))) @shape.owner.class
`;
