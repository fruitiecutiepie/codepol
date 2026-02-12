/**
 * Tree-sitter reference query for Python.
 * Captures identifier-like nodes that may be references.
 * Post-filtering is applied to remove declaration sites.
 */
export const REFS_QUERY = `
; =========================
;  Identifier references
; =========================

; All identifiers (will be filtered)
(identifier) @ref.id

; Attribute access - capture the object part
(attribute
  object: (identifier) @ref.obj)
`;
