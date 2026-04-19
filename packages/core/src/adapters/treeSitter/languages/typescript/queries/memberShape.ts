/**
 * Tree-sitter member-shape query for TypeScript / TSX.
 *
 * Phase 9.4 / Gap 3. Captures the public members of every class,
 * interface, and type-alias-of-object so the cross-file structural
 * shape comparison can reason about duck-typed implementers.
 *
 * Capture conventions:
 *
 * - `@shape.owner.{class,interface,type_alias}` — the owning declaration
 * - `@shape.owner_name` — the owner's name node (used for symbol lookup)
 * - `@shape.member` — the captured member node (method / field / signature)
 * - `@shape.member_name` — the member's name node
 *
 * Members marked `private` (TypeScript keyword) and `#`-prefixed
 * (`#name`) are excluded by the extractor (`memberShapeExtract`),
 * not by the query — the grammar does not let us filter on the
 * presence of the `private` modifier inside the pattern, so the
 * post-pass inspects each captured node.
 *
 * Anonymous structural targets (e.g. `function f(x: { read(): string })`
 * — the `{ read(): string }` inline type) are intentionally NOT
 * captured. They have no symbol id to attach the shape to.
 */
export const MEMBER_SHAPE_QUERY = `
; =========================
;  Class members
; =========================

; Methods, public fields, accessors (get/set)
(class_declaration
  name: (type_identifier) @shape.owner_name
  body: (class_body
    (method_definition
      name: (_) @shape.member_name) @shape.member)) @shape.owner.class

(class_declaration
  name: (type_identifier) @shape.owner_name
  body: (class_body
    (public_field_definition
      name: (_) @shape.member_name) @shape.member)) @shape.owner.class

(abstract_class_declaration
  name: (type_identifier) @shape.owner_name
  body: (class_body
    (method_definition
      name: (_) @shape.member_name) @shape.member)) @shape.owner.class

(abstract_class_declaration
  name: (type_identifier) @shape.owner_name
  body: (class_body
    (public_field_definition
      name: (_) @shape.member_name) @shape.member)) @shape.owner.class

(abstract_class_declaration
  name: (type_identifier) @shape.owner_name
  body: (class_body
    (abstract_method_signature
      name: (_) @shape.member_name) @shape.member)) @shape.owner.class

; =========================
;  Interface members
; =========================

(interface_declaration
  name: (type_identifier) @shape.owner_name
  body: (interface_body
    (method_signature
      name: (_) @shape.member_name) @shape.member)) @shape.owner.interface

(interface_declaration
  name: (type_identifier) @shape.owner_name
  body: (interface_body
    (property_signature
      name: (_) @shape.member_name) @shape.member)) @shape.owner.interface

; =========================
;  Type-alias-of-object members
; =========================

(type_alias_declaration
  name: (type_identifier) @shape.owner_name
  value: (object_type
    (method_signature
      name: (_) @shape.member_name) @shape.member)) @shape.owner.type_alias

(type_alias_declaration
  name: (type_identifier) @shape.owner_name
  value: (object_type
    (property_signature
      name: (_) @shape.member_name) @shape.member)) @shape.owner.type_alias
`;
