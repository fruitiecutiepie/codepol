# Python Adapter: Remaining Work

Tracks incomplete implementations for the Python language adapter in `packages/core/src/adapters/treeSitter/languages/python/`.

## Current State

The Python adapter is fully coded with query packs for scopes, symbols, refs, calls, imports, and exports, plus `pythonRefFilter`. It is registered in `indexBuilder.ts` (line 92–94). Single-file integration tests exist in `tests/index.python.spec.ts` (34 passing, 3 skipped).

Adapter core fixes already applied:
- `memberRefsExtract` gracefully handles grammars without `member_expression` (Python uses `attribute`)
- Python exports query `#eq?` predicate syntax corrected (capture must precede predicate)
- `importBindingsExtract` handles `import.module_name` (bare `import foo`) and `import.module_alias` (`import foo as f`) captures
- `importBindingsExtract` handles `import.binding_alias` capture for `from foo import bar as b` aliased imports
- `exportsExtract` handles Python capture names: `export.func_name`, `export.class_name`, `export.var_name` for module-level definitions
- `exportsExtract` handles `export.all_name` + `export.all_item` for `__all__` list/tuple definitions
- `Exported` flag is correctly set on Python symbols via `exportsExtract`
- CFG builder recognizes `function_definition` node type (Python functions and methods)
- CFG builder handles `block` node type (Python's indentation-based blocks)
- CFG builder handles `raise_statement` as a terminator (mapped to `throw` flow node kind)

---

## 1. Cross-file module resolution

**Priority**: Medium
**Status**: 3 skipped tests in `tests/index.python.spec.ts`
**Effort**: Medium (new resolution strategy in `moduleResolver.ts`, plus test infra)

The Python adapter's single-file features (symbols, scopes, refs, calls, imports, exports, CFGs) are fully tested (34 tests). Cross-file resolution is blocked because `moduleResolver.ts` only implements TypeScript/JavaScript path resolution semantics.

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

**Files involved**:
- `packages/core/src/index/moduleResolver.ts` — add Python resolution strategy
- `tests/index.python.spec.ts` — un-skip 3 cross-file tests, potentially add more

---

## 2. CFG: Python `for` loop precision

**Priority**: Low
**Status**: CFGs are generated, but `for` loop model is imprecise
**Effort**: Low

Python's `for_statement` shares the same node type name as TypeScript's C-style `for_statement`, but has different child fields (`left`/`right`/`body` instead of `initializer`/`condition`/`increment`/`body`). The current `forProcess` handler produces a functional CFG (loop node with body correctly processed), but the model lacks the iterable expression as the loop condition.

To fix: add language detection or a separate `forProcess` variant that handles Python's `for` loop semantics (iterate over `right`, bind to `left`, execute `body`).

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
- [x] CFG extraction for Python functions (simple, if/else, raise, while, try/except, methods, multiple functions) — `tests/index.python.spec.ts`
- [ ] Cross-file relative imports (`from .sibling import foo`) — skipped, pending module resolution
- [ ] Cross-file package imports (`from package import module`) — skipped, pending module resolution
- [ ] Cross-file reference resolution through imports — skipped, pending module resolution
