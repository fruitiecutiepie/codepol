# Python Adapter: Remaining Work

Tracks incomplete implementations for the Python language adapter in `packages/core/src/adapters/treeSitter/languages/python/`.

## Current State

The Python adapter is fully coded with query packs for scopes, symbols, refs, calls, imports, and exports, plus `pythonRefFilter`. It is registered in `indexBuilder.ts` (line 92–94). Single-file integration tests exist in `tests/index.python.spec.ts` (18 passing, 3 skipped).

Adapter core fixes already applied:
- `memberRefsExtract` gracefully handles grammars without `member_expression` (Python uses `attribute`)
- Python exports query `#eq?` predicate syntax corrected (capture must precede predicate)

---

## 1. Cross-file module resolution

**Priority**: Medium
**Status**: 3 skipped tests in `tests/index.python.spec.ts`
**Effort**: Medium (new resolution strategy in `moduleResolver.ts`, plus test infra)

The Python adapter's single-file features (symbols, scopes, refs, calls, imports, exports) are fully tested (18 tests). Cross-file resolution is blocked because `moduleResolver.ts` only implements TypeScript/JavaScript path resolution semantics.

Python module resolution differs significantly:
- **`__init__.py` package detection**: directories with `__init__.py` are importable packages
- **No file extensions in specifiers**: `from foo import bar` could mean `foo/bar.py`, `foo/bar/__init__.py`, or a name inside `foo.py`
- **Relative imports**: `from . import sibling` and `from ..parent import thing` use dot-prefix notation (different from `./` and `../`)
- **Package-relative resolution**: `from package import module` needs to find the package root

What needs to change:
- Add a Python resolution strategy to `moduleResolve()` in `packages/core/src/index/moduleResolver.ts` (or a parallel `pythonModuleResolve` function)
- Handle the `.`/`..` prefix → directory traversal mapping
- Handle `__init__.py` as directory entry points
- Un-skip the 3 cross-file tests in `tests/index.python.spec.ts`

Additionally, the adapter core has two Python-specific gaps in `importBindingsExtract`:
- `import foo` (bare module import) does not create an `ImportBindingRelation` because the adapter looks for `import.source`/`import.from_module`/`import.relative_module` as module specifier captures, but the Python query uses `import.module_name` which isn't in that list
- `from os import path as p` aliased imports don't create `ImportBindingRelation` — the adapter resolves aliases via `specifierNode?.childForFieldName('alias')` which works for TypeScript's `import_specifier` AST node but not Python's `aliased_import` node. The Python query provides an `import.binding_alias` capture, but the adapter core doesn't consume it.

**Files involved**:
- `packages/core/src/index/moduleResolver.ts` — add Python resolution strategy
- `packages/core/src/adapters/treeSitter/adapterCore.ts` — handle `import.module_name` and `import.binding_alias` captures
- `tests/index.python.spec.ts` — un-skip 3 cross-file tests, potentially add more

---

## 2. Exports adapter gap

**Priority**: Low
**Status**: Not implemented
**Effort**: Medium

The Python exports query (`packages/core/src/adapters/treeSitter/languages/python/queries/exports.ts`) captures `export.func_name`, `export.class_name`, `export.var_name`, and `export.all_name`/`export.all_item`, but the adapter core's `exportsExtract()` function in `adapterCore.ts` only processes TypeScript-specific capture names (`export.decl_name`, `export.name`, `export.default_name`, `export.reexport_name`, `export.star_source`, `export.namespace_name`).

This means:
- Python module-level definitions are extracted as symbols but no `ExportsRelation` entries are created
- `__all__` definitions are captured by the query but not processed into relations
- The `Exported` flag is never set on Python symbols (the flag-setting logic in `symbolsExtract` checks for parent nodes with `'export'` in their type name, which Python doesn't have)

To fix:
- Either add Python-specific capture name handling to `exportsExtract()`, or
- Normalize the Python exports query to use the same capture names as TypeScript, or
- Add a language-specific export extraction hook to `LangConfig`

---

## 3. CFG support

**Priority**: Low
**Status**: Not implemented (silently skipped)
**Effort**: Medium

The CFG builder (`packages/core/src/adapters/treeSitter/cfgBuild.ts`) uses TypeScript-specific node types in `FUNCTION_NODE_TYPES`: `function_declaration`, `generator_function_declaration`, `arrow_function`, `method_definition`, `function`, `generator_function`. Python uses `function_definition` for all function declarations, so `functionNodesCollect` never finds Python functions and no CFGs are generated.

Similarly, the `statementsProcess` switch cases reference TypeScript node types (`return_statement`, `if_statement`, `while_statement`, etc.) — Python has the same names for most of these, but the function node type mismatch prevents any CFG from being built.

To fix: add `'function_definition'` to `FUNCTION_NODE_TYPES` in `cfgBuild.ts` and verify that the statement-level node type names match Python's grammar.

---

## Testing Status

- [x] Single-file symbol extraction (classes, functions, variables, parameters, import bindings, methods) — `tests/index.python.spec.ts`
- [x] Scope tree (module-level, nested class/function, lambda) — `tests/index.python.spec.ts`
- [x] Reference resolution with `pythonRefFilter` — `tests/index.python.spec.ts`
- [x] Call detection (simple + dotted) — `tests/index.python.spec.ts`
- [x] Import extraction (from-imports, aliased, `ImportsRelation`) — `tests/index.python.spec.ts`
- [x] Export extraction (module-level functions/classes) — `tests/index.python.spec.ts`
- [ ] Cross-file relative imports (`from .sibling import foo`) — skipped, pending module resolution
- [ ] Cross-file package imports (`from package import module`) — skipped, pending module resolution
- [ ] Cross-file reference resolution through imports — skipped, pending module resolution
- [ ] `ExportsRelation` entries for Python symbols — not tested (adapter core doesn't process Python capture names)
- [ ] CFG extraction for Python functions — not tested (function node type not recognized)
