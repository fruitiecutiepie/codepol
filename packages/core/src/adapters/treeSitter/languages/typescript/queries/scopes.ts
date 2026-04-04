/**
 * Tree-sitter scope query for TypeScript/TSX.
 * Captures nodes that define lexical/semantic scopes.
 * 
 * Note: Node names vary across tree-sitter grammar versions.
 * We use only the most basic scope types that are universally supported.
 */
export const SCOPES_QUERY = `
; --- Type / class scopes ---
(class_declaration) @scope
(abstract_class_declaration) @scope
(interface_declaration) @scope
(type_alias_declaration) @scope
(object_type) @scope
(internal_module) @scope
(module) @scope

; --- Function scopes ---
(function_declaration) @scope
(generator_function_declaration) @scope
(function_expression) @scope
(arrow_function) @scope
(method_definition) @scope

; --- Catch scopes ---
(catch_clause) @scope

; --- Block scopes ---
(statement_block) @scope
`;
