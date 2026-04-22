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
- `memberShape` query (Phase 9.4 / Gap 3 follow-up) — Python Protocol-backed structural matching is now wired through the same end-to-end pipeline as TypeScript. `Protocol` / `typing.Protocol` declarations index as `interface` symbols, `queryTypeHierarchy({ includeStructural: true })` can return structural implementers for `.py` files, the type-hierarchy panel's "M shape-matched" count is non-zero when appropriate, and `no-undeclared-implementer` emits Python-specific diagnostics ("inherit from `ReaderProtocol`") instead of TS-only `implements` wording. The first pass intentionally stays explicit-contract-only: it does not infer arbitrary class-to-class duck typing, and property matching does not inspect `self.name = ...` assignments inside method bodies yet. See `tests/index.member-shape-extraction.python.spec.ts` and `tests/index.structural-shape-resolution.python.spec.ts`.

---

## Remaining Items

The Python adapter is feature-complete for the structural pipeline. Items below are language-specific gaps in the Phase 9 type-aware upgrade — they only matter for workspaces that want the full editor / panel experience that the TypeScript pack already exposes.

### `TypeAwareTypeHierarchySource` host wiring for Python (Phase 9.5 follow-up)

`@codepol/python-language-bridge` now ships both `pythonCallGraphSourceCreate` and `pythonTypeHierarchySourceCreate`, and the Python type-hierarchy bridge has the same fake-transport contract coverage shape as the TypeScript package. The remaining parity work is host wiring:

- provide a concrete pyright / pylance `LspTransport` provider module (or direct in-process transport injection in tests)
- feed that transport through `workspaceTypeAwareBridgeSourcesRegister(...)` so the workspace engine registers the Python call-graph and type-hierarchy bridges at startup
- keep symbol-id / location translation inside workspace-service's bridge symbol-table seam instead of reaching into `ProjectIndex` from app code

Until a host supplies that transport, `queryTypeHierarchy` for Python symbols remains structural-only by default even though the bridge package itself exists and is tested.

### Type-aware supplement for instance-attribute Protocol matches

The Python type-aware hierarchy bridge opens a narrower follow-up than "teach tree-sitter every `self.attr = ...` pattern." Pyright / pylance can often confirm Protocol implementers through `textDocument/implementation` even when satisfaction depends on inferred instance attributes assigned inside methods (`self.name = ...` in `__init__`, etc.). Today that signal is confined to the workspace-service type-hierarchy overlay:

- it can improve `queryTypeHierarchy` as a `type-aware` edge when a host/provider transport is available
- it does **not** populate index-time `MemberShapeRelation`s
- it does **not** affect `ProjectIndex.subTypesGet(...)` consumers like `no-undeclared-implementer`

A future slice could decide whether Python should consult `TypeAwareTypeHierarchySource` for those attribute-backed implementers instead of widening the tree-sitter structural extractor. If that lands, keep the confidence tier explicit (`type-aware`, not `structural-shape`) unless the architecture intentionally changes to let policy/index consumers depend on language-server-confirmed edges.

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
