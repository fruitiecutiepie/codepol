/**
 * Tree-sitter type relation query for Python.
 *
 * Captures Python class inheritance via `class_definition.superclasses`
 * (the parenthesised superclass list). Python doesn't distinguish
 * `extends` from `implements` syntactically — every parent in the
 * parens is just another base class participating in the MRO. The
 * shared extractor (`typeRelationsExtract` in `adapterCore.ts`) reads
 * the `typerel.extends_target` capture and emits
 * `relationKind: 'extends'`, which is the right semantic mapping for
 * Python.
 *
 * MVP scope (matches the symbol-flow precedent):
 *
 * - **Captured:** bare identifier superclasses.
 *   - `class Dog(Animal):` -> 1 extends edge to `Animal`
 *   - `class Dog(Animal, Trainable):` -> 2 extends edges (one per
 *     bare identifier in the list — tree-sitter matches each
 *     identifier separately under the same `(argument_list ...)`
 *     pattern)
 *
 * - **Skipped silently** (the capture pattern doesn't match these
 *   node types so they produce no `TypeRelation` records — no errors,
 *   no fabricated edges):
 *   - `class Foo(Generic[T]):` — `Generic[T]` is a `subscript` node.
 *     Generic-parameterised parents need type-system support to
 *     resolve correctly; the structural pipeline can't.
 *   - `class Foo(typing.Protocol):` — `typing.Protocol` is an
 *     `attribute` node (module-qualified). Out of MVP scope; a
 *     follow-up could add a separate capture and resolve through
 *     namespace imports.
 *   - `class Foo(metaclass=Meta):` — the metaclass parent lives in a
 *     `keyword_argument`, not the positional argument list. Not part
 *     of the MRO so should not appear in the hierarchy anyway.
 *
 * Cross-file resolution is handled uniformly by `crossFileResolve`
 * Step 6 (which walks all `TypeRelation` records and rewrites
 * `resolvedTargetId` from import bindings) — `from .animals import
 * Animal` then `class Dog(Animal):` resolves automatically because
 * the cross-file pass is language-agnostic.
 */
export const TYPE_RELATIONS_QUERY = `
; =========================
;  Class extends (Python — positional bare-identifier superclass)
; =========================

; class Dog(Animal):
; class Dog(Animal, Trainable):  ; matches each bare identifier separately
(class_definition
  name: (identifier) @typerel.child_name
  superclasses: (argument_list
    (identifier) @typerel.extends_target)) @typerel.class_extends
`;
