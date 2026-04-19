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
- `symbolFlow` query (Phase 9.1 / Gap 1 follow-up) — bare-identifier callback flow (`map(handler, xs)` etc.) is captured for Python the same way as TypeScript. Python keyword arguments and `lambda` expressions are out of MVP scope. See `tests/index.symbol-flow-extraction.python.spec.ts`.
- `typeRelations` query (Phase 9 follow-up) — Python class inheritance via `class Dog(Animal):` syntax is captured. Multi-parent inheritance (`class Dog(Animal, Trainable):`) emits one `extends` relation per bare identifier. Generic-parameterised parents (`Generic[T]`), module-qualified parents (`typing.Protocol`), and `metaclass=` keyword arguments are out of MVP scope — they would need either type-system support or namespace-import resolution. Cross-file resolution works through the uniform `crossFileResolve` Step 6 pipeline (no per-language code path required). See `tests/index.type-relations.python.spec.ts`.

---

## Remaining Items

The Python adapter is feature-complete for the structural pipeline. Items below are language-specific gaps in the Phase 9 type-aware upgrade — they only matter for workspaces that want the full editor / panel experience that the TypeScript pack already exposes.

### `memberShape` query (Phase 9.4 / Gap 3 follow-up)

The TypeScript adapter ships a `memberShape` query that captures interface and class member signatures (name + arity + kind) so the workspace can compute structural-shape implementer matches even when no `implements` clause exists. The Python adapter has no equivalent query yet, so:

- `queryTypeHierarchy({ includeStructural: true })` on a Python interface/protocol returns only declared `extends` relations, never structural-shape matches
- the new `no-undeclared-implementer` architecture rule never fires on Python files
- the type-hierarchy panel's "M shape-matched" count is always `0` for Python symbols

Adding this is non-trivial. Python's structural-shape semantics differ from TypeScript's: duck typing means there's no static `implements` declaration to verify against, and the closest analogue (`typing.Protocol`) needs `runtime_checkable` semantics that aren't visible to the parser. A first pass could mirror the TypeScript shape extraction against `class_definition` body methods and `typing.Protocol`-marked classes, but the design needs a separate decision about which Python idioms count as "structural shape" — convention-based duck-typed parameters? Annotated parameter types referencing classes that exist in the codebase? Both?

### `TypeAwareTypeHierarchySource` binding for Python (Phase 9.5 follow-up)

`@codepol/python-language-bridge` currently ships only the call-graph factory (`pythonCallGraphSourceCreate`). The TypeScript bridge ships both call-graph and type-hierarchy factories. To close parity:

- add `pythonTypeHierarchySourceCreate({ transport, symbolLocate, symbolIdResolve })` implementing `TypeAwareTypeHierarchySource`
- back it with pyright/pylance's `textDocument/implementation` + `textDocument/typeDefinition` over the standard LSP transport supplied by the host
- mirror the existing `typeScriptTypeHierarchySource.spec.ts` contract tests against a fake transport

When this lands, `queryTypeHierarchy` for Python symbols can return type-aware edges in addition to the declared / structural-shape ones — closing the same `no first-party consumer` gap that the call-graph bridge had before.

### Symbol-id discovery and editor-side guard symmetry (cross-language)

Not Python-specific — the `cursorSymbolResolve` kind guard added for `showTypeHierarchy` (rejects non-class/interface/type cursors) does not yet have a sibling for `showCallGraph` / `findCallbacks` (which would reject non-function/method cursors). The Python adapter is correctly impacted by both — Python class symbols vs Python function symbols — but the gap is in `extension-vscode/src/commands.ts`, not the adapter.

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
