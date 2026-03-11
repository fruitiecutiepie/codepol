# Python Adapter: Remaining Work

Tracks incomplete implementations for the Python language adapter in `packages/core/src/adapters/treeSitter/languages/python/`.

## Current State

The Python adapter is fully coded with query packs for scopes, symbols, refs, calls, imports, and exports, plus `pythonRefFilter`. It is registered in `indexBuilder.ts` (line 92–94). Integration tests exist in `tests/index.python.spec.ts` (41 passing, 0 skipped).

Adapter core fixes already applied:
- `memberRefsExtract` supports Python's `attribute` node type as a fallback when `member_expression` (JS/TS) is not in the grammar, enabling dotted access resolution (e.g., `submodule.func()`)
- Python exports query `#eq?` predicate syntax corrected (capture must precede predicate)
- `importBindingsExtract` handles `import.module_name` (bare `import foo`) and `import.module_alias` (`import foo as f`) captures
- `importBindingsExtract` handles `import.binding_alias` capture for `from foo import bar as b` aliased imports
- `exportsExtract` handles Python capture names: `export.func_name`, `export.class_name`, `export.var_name` for module-level definitions
- `exportsExtract` handles `export.all_name` + `export.all_item` for `__all__` list/tuple definitions
- `Exported` flag is correctly set on Python symbols via `exportsExtract`
- CFG builder recognizes `function_definition` node type (Python functions and methods)
- CFG builder handles `block` node type (Python's indentation-based blocks)
- CFG builder handles `raise_statement` as a terminator (mapped to `throw` flow node kind)
- CFG builder `forProcess` detects Python's `for_statement` (`right` field) and delegates to `pythonForProcess`, which uses the iterable expression as the loop node's byte range
- `pythonModuleResolve` in `moduleResolver.ts` handles Python import resolution: dot-prefix relative imports (`.foo`, `..bar`), `__init__.py` as directory entry points, dotted absolute imports resolved relative to `baseDir`
- Cross-file resolution works for Python: relative imports, dotted package imports, and reference resolution through imports
- `crossFileResolve` in `indexBuilder.ts` handles submodule-style package imports (`from package import submodule`) via `pythonSubmoduleResolve` fallback: when a named import isn't found in a package's `__init__.py` export map, it resolves the name as a submodule file (e.g., `package/submodule.py`) and treats it as a namespace import

---

## Remaining Items

No remaining items. All planned Python adapter features are implemented and tested.

---

## Testing Status

- [x] Single-file symbol extraction (classes, functions, variables, parameters, import bindings, methods) — `tests/index.python.spec.ts`
- [x] Scope tree (module-level, nested class/function, lambda) — `tests/index.python.spec.ts`
- [x] Reference resolution with `pythonRefFilter` — `tests/index.python.spec.ts`
- [x] Call detection (simple + dotted) — `tests/index.python.spec.ts`
- [x] Import extraction (from-imports, aliased, `ImportsRelation`) — `tests/index.python.spec.ts`
- [x] `ImportBindingRelation` for bare `import foo` — `tests/index.python.spec.ts`
- [x] `ImportBindingRelation` for aliased `import foo as f` — `tests/index.python.spec.ts`
- [x] `ImportBindingRelation` with correct alias for `from foo import bar as b` — `tests/index.python.spec.ts`
- [x] `ExportsRelation` for module-level functions, classes, and variables — `tests/index.python.spec.ts`
- [x] `ExportsRelation` from `__all__` list and tuple — `tests/index.python.spec.ts`
- [x] `Exported` flag set on Python symbols — `tests/index.python.spec.ts`
- [x] CFG extraction for Python functions (simple, if/else, raise, while, for, try/except, methods, multiple functions) — `tests/index.python.spec.ts`
- [x] Cross-file relative imports (`from .sibling import helper`) — `tests/index.python.spec.ts`
- [x] Cross-file dotted package imports (`from mypkg.utils import compute`) — `tests/index.python.spec.ts`
- [x] Cross-file reference resolution through imports — `tests/index.python.spec.ts`
- [x] Cross-file submodule imports (`from package import submodule`) — `tests/index.python.spec.ts`
- [x] Export-takes-precedence over submodule fallback — `tests/index.python.spec.ts`
- [x] Cross-file submodule member access (`submodule.func()`) — `tests/index.python.spec.ts`
