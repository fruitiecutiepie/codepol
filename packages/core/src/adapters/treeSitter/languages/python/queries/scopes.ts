/**
 * Tree-sitter scope query for Python.
 * Captures nodes that define lexical/semantic scopes.
 */
export const SCOPES_QUERY = `
; Module scope (file level)
(module) @scope

; Class scope
(class_definition) @scope

; Function scope
(function_definition) @scope

; Lambda creates a scope
(lambda) @scope

; Comprehensions create their own scope in Python 3
(list_comprehension) @scope
(dictionary_comprehension) @scope
(set_comprehension) @scope
(generator_expression) @scope
`;
