/**
 * Tree-sitter reference query for TypeScript/TSX.
 * Captures identifier-like nodes that may be references.
 * Post-filtering is applied to remove declaration sites.
 * 
 * Note: Simplified to use only widely-supported node types.
 */
export const REFS_QUERY = `
; =========================
;  Identifier references
; =========================

; Plain identifiers (most references)
(identifier) @ref.id

; Type identifiers used in type positions
(type_identifier) @ref.type

; Member access - capture the object part
(member_expression
  object: (identifier) @ref.id)
`;
