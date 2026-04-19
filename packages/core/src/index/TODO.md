# Cross-File Analysis: Remaining Work

This document tracks incomplete implementations and future work for the semantic index.

## Current State

The semantic index provides:
- Symbol extraction (functions, classes, variables, types, interfaces, enums, enum members)
- Scope tree construction
- File-local reference resolution
- Cross-file reference resolution (fully implemented — named, default, namespace, aliased imports/exports, re-export chains, star exports, namespace re-exports, CommonJS require, dynamic import)
- Heuristic call detection
- Import statement extraction (named, default, namespace, CommonJS require, dynamic import)
- Export statement extraction (all patterns including anonymous defaults, type-only, aliases)
- Type relations extraction (extends/implements, cross-file resolution)
- Control flow graph construction (per-function, all common patterns)
- Module graph (dependency order, cycle detection, entry points)
- Query API for plugins (`ProjectIndex`)

## Implementation Status

### 1. Cross-File Symbol Resolution
**Status**: Implemented

All cross-file resolution features are complete:

- [x] `ImportBindingRelation` type defined
- [x] `crossFileResolve()` function in `indexBuilder.ts`
- [x] Module path resolution (`moduleResolver.ts`)
- [x] Export map building from `IndexStore`
- [x] Basic import-to-export resolution
- [x] Re-export chain following (A re-exports from B re-exports from C) — `exportMapAddReexportedSymbols` in `indexBuilder.ts`
- [x] Star export enumeration (`export *` should list all symbols) — `exportMapAddReexportedSymbols` copies source module symbols into proxy's export map
- [x] Circular re-export detection — max iteration limit in `exportMapAddReexportedSymbols` prevents infinite loops
- [x] Namespace import member resolution (`import * as X` → `X.foo` resolved to exported symbol) — `memberRefsExtract` in `adapterCore.ts` + namespace member resolution pass in `crossFileResolve`

The `crossFileResolve()` function:
1. Builds export map: `Map<filePath, Map<exportedName, SymbolId>>`
2. Resolves `ImportBinding` relations to their source exports
3. Updates `References.resolvedSymbolId` to point to actual exported symbols

### 2. Export Relation
**Status**: Implemented

All export patterns are handled. No remaining gaps.

- [x] `ExportsRelation` type with all fields (`symbolId`, `exportedName`, `isDefault`, `sourceModule`, `sourceName`)
- [x] `IndexStore` indexes (`exportsByFile`, `exportsByName`, `exportMapBuild()`)
- [x] `exportsExtract()` function in `adapterCore.ts`
- [x] `ProjectIndex` API (`fileExportsGet()`, `exportLocationsGet()`)
- [x] Basic export declarations (`export const/function/class`)
- [x] Named exports (`export { foo }`)
- [x] Default exports (`export default foo`)
- [x] Export aliases (`export { foo as bar }`) — resolved via `childForFieldName('alias')` on the `export_specifier` AST node in `exportsExtract()`
- [x] Re-exports (`export { foo } from "module"`) — TS query captures `export.reexport_name` + `export.reexport_source`
- [x] Star exports (`export * from "module"`) — already captured via `export.star_source`; symbols added to export map by `exportMapAddReexportedSymbols`
- [x] Namespace re-exports (`export * as ns from './mod'`) — `exportsExtract()` processes `export.namespace_name` + `export.namespace_source` captures; sentinel ID (`__ns_reexport:path`) in export map; `crossFileResolve` converts consumer named import to namespace binding; member accesses resolved via namespace member resolution pass
- [x] Interface/type/enum exports — tree-sitter queries for `export interface`, `export type`, `export enum` exist and work via `export.decl_name` capture pattern. Verified with cross-file integration tests in `tests/index.cross-file-resolution.spec.ts`.
- [x] Type-only named exports (`export type { Foo }`) — tree-sitter produces identical `export_clause` > `export_specifier` structure as `export { Foo }`; `type` keyword is just an extra unnamed child. `Exported` flag set by `exportsExtract` named export handler.
- [x] Anonymous default exports (`export default class {}`, `export default function() {}`) — AST walking in `exportsExtract` detects unhandled default exports and creates synthetic `SymbolRecord` (name `"default"`, appropriate kind, `Exported` flag). `indexFileWithTreeSitter` merges synthetic symbols into the delta.

### 3. Import Binding Relations
**Status**: Implemented

- [x] `ImportBindingRelation` type defined
- [x] Named imports (`import { foo }`)
- [x] Default imports (`import foo from`)
- [x] Namespace imports (`import * as foo`)
- [x] Import aliases (`import { foo as bar }`) — resolved via `childForFieldName('alias')` on the `import_specifier` AST node in both `symbolsExtract()` and `importBindingsExtract()`
- [x] CommonJS requires (`require()`) — tree-sitter query patterns added with `#eq?` predicate for `require` identifier. Whole-module (`const mod = require("module")`) creates `ImportBindingRelation` with `isDefault: true`; destructured (`const { foo } = require("module")`) creates named bindings. Adapter extraction was pre-existing in `adapterCore.ts`. Cross-file resolution, module graph inclusion, and external package handling all work via existing `ImportBindingRelation` pipeline. Tested in `tests/index.cross-file-resolution.spec.ts`.
- [x] Dynamic imports (`import("module")`) — specifier extraction and binding resolution. Tree-sitter query patterns: `import.source`/`import.side_effect` for specifier tracking, `import.dynamic_name`/`import.dynamic_source` for whole-module binding (`const mod = await import("module")` creates `ImportBindingRelation` with `isNamespace: true`), `import.dynamic_binding`/`import.dynamic_source` for destructured binding (`const { foo } = await import("module")` creates named bindings). `ImportsRelation.resolvedModulePath` set during `crossFileResolve` Step 7 for side-effect imports. Tested in `tests/index.cross-file-resolution.spec.ts`.
- [x] Dynamic import binding resolution (`const mod = await import("./module")`) — tree-sitter query patterns capture the `await_expression` > `call_expression` > `import` pattern inside `variable_declarator`. Whole-module creates namespace-like `ImportBindingRelation`; destructured creates named bindings. Cross-file resolution, namespace member resolution, and external package handling all work via existing pipelines.
- [x] Dynamic import module graph integration — `ImportsRelation.resolvedModulePath` resolved during `crossFileResolve` Step 7. `moduleGraphBuild` reads both `ImportBindingRelation` and `ImportsRelation` resolved paths to build edges. Covers dynamic imports with bindings, bare dynamic imports, and static side-effect imports.

### 4. Module Graph
**Status**: Implemented

Module-level dependency graph built from import relations in `packages/core/src/index/moduleGraph.ts`.

- [x] Import relations stored in `IndexStore`
- [x] Module specifier extraction
- [x] `ModuleGraph` type and API — `moduleGraphBuild(store)` in `moduleGraph.ts`
- [x] `moduleGraphImportersGet(file)` / `moduleGraphImporteesGet(file)` — forward/reverse adjacency from resolved import bindings and resolved `ImportsRelation` entries (covers side-effect and dynamic imports)
- [x] Topological sort (`moduleGraphDependencyOrderGet()`) — Kahn's algorithm on reversed dependency graph
- [x] Circular dependency detection (`moduleGraphCyclesGet()`) — Tarjan's SCC algorithm
- [x] Entry point detection (`moduleGraphEntryPointsGet()`) — files with no importers in the indexed set, sorted alphabetically

Exposed on `ProjectIndex` as `moduleImportersGet()`, `moduleImporteesGet()`, `moduleDependencyOrderGet()`, `moduleCyclesGet()`, `moduleEntryPointsGet()`. Graph is lazily built and cached.

Integration tests in `tests/index.module-graph.spec.ts`: linear chain, circular imports, diamond dependencies, isolated files, external package filtering, unknown files, multi-import deduplication, entry point detection (linear chain root, diamond root, isolated files, circular imports, external-only imports), dynamic import module graph edges (binding-based, side-effect dynamic, static side-effect).

### 5. Control Flow Graph (CFG)
**Status**: Implemented

Per-function CFG construction, storage, querying, cyclomatic complexity, and all common control flow patterns.

- [x] `FlowNode`, `FlowEdge`, `FlowGraph` types in `indexTypes.ts`
- [x] `FlowNodeKind`: `'entry' | 'exit' | 'statement' | 'branch' | 'merge' | 'loop' | 'return' | 'throw'`
- [x] `FlowEdge` labels: `'true' | 'false' | 'loop-back' | 'unconditional' | 'break' | 'continue' | 'case' | 'default' | 'exception' | 'finally'`
- [x] `cfgsExtract()` in `packages/core/src/adapters/treeSitter/cfgBuild.ts` — AST walking for function body CFG construction
- [x] `LoopContext` type threaded through recursive processing for break/continue targeting (including labeled break/continue via parent chain)
- [x] `IndexStore` storage: `cfgByScope`, `cfgsByFile` with put/remove/clear/query
- [x] `ProjectIndex` API: `cfgGet(scopeId)`, `cyclomaticComplexityGet(symbolId)` (V(G) = E - N + 2)
- [x] `controlFlowGraph` field in `IndexCapabilities`
- [x] Wired into `indexFileWithTreeSitter` extraction pipeline
- [x] Supported patterns: sequential, if/else, ternary expressions (nested supported), while, for, do...while, for...in, for...of, return, throw, break/continue (nested + labeled), switch/case/default (with fallthrough), try/catch/finally, labeled statements, nested control flow, arrow functions (block + expression body)
- [x] Unit tests (5 IndexStore + 3 ProjectIndex) and integration tests (37 in `tests/index.cfg.spec.ts`)
- [x] Ternary expressions within CFG — `ternaryExpressionFind` recursively scans statement subtrees for `ternary_expression` nodes; `ternaryProcess` models branch(condition) → true/false paths → merge, with `ternaryBranchProcess` handling nested ternaries recursively via `incomingEdgeLabel` propagation

### 7. Symbol-Flow Relations (Phase 9.1 / Gap 1)
**Status**: Implemented (TypeScript only; other languages no-op until they ship a `symbolFlow` query)

Tracks "function-as-argument" flow as a *separate* edge stream from the
call graph so `callersGet` / `calleesGet` stay honest about what the
source code actually expresses.

- [x] `SymbolFlowRelation` type in `indexTypes.ts` — `flowKind: 'argument' | 'return' | 'assignment' | 'storage'` (MVP emits only `'argument'`); other variants are reserved for the next phase
- [x] Tree-sitter query (`languages/typescript/queries/symbolFlow.ts`) — captures bare-identifier arguments only; inline arrow / `function () {}` literals are out of scope for the MVP
- [x] `symbolFlowExtract` in `adapters/treeSitter/symbolFlowExtract.ts` — one job: walk captures, resolve via the same `resolveLocal` pipeline `refsExtract` uses, emit relations
- [x] `IndexStore` indexes — `symbolFlowsByFlowingSymbol`, `symbolFlowsByReceivingCallSymbol`, `symbolFlowsByFile` with put/remove/clear/`relationUpdate` parity to the existing `typeRelationsBy*` pattern
- [x] `ProjectIndex` API — `symbolFlowsForSymbolGet`, `symbolFlowsForReceiverGet`, `symbolFlowsInFileGet`
- [x] Workspace contract — `querySymbolFlow({ symbolId, direction: 'outgoing' | 'incoming' })` → `WorkspaceSymbolFlowResult`; LSP method `codepol/symbolFlow`; CLI `codepol graph flow <symbolId>`
- [x] `IndexCapabilities.symbolFlow` flag — `true` when the index has at least one language adapter that emits `SymbolFlowRelation` (today: TypeScript / TSX)
- [x] Tests: `packages/core/src/index/indexStore.spec.ts` (round-trip + `relationUpdate`), `tests/index.symbol-flow-extraction.spec.ts` (extraction matrix), `tests/workspace-service.symbol-flow.spec.ts` (engine integration), `tests/e2e.cli.graph.spec.ts` (CLI happy-path)

### 8. Type-Aware Call Graph Source (Phase 9.2 / Gap 1)
**Status**: Implemented — interface + registry + workspace merge; binding lives in `@codepol/typescript-language-bridge`

Per-language seam the workspace consults to upgrade `queryCallGraph`
results when a host registers a binding around a language server.
Default behavior (no source registered) is byte-identical to before
— the merge is purely additive.

- [x] `TypeAwareCallGraphSource` interface in `index/typeAwareCallGraphSource.ts` — `typeAwareCallersGet?` / `typeAwareCalleesGet?` returning `TypeAwareCallEdge[]` with `callKind: 'direct' | 'dynamic-dispatch' | 'higher-order'`
- [x] `TypeAwareCallGraphSourceRegistry` in `index/typeAwareCallGraphSourceRegistry.ts` — last-write-wins per-language registration; constructed once per `WorkspaceServiceEngine`, no module-level singleton
- [x] Independent of `TypeAwareTypeHierarchySource` (Phase 9.5) — registering one does not require or affect the other
- [x] Workspace merge in `workspaceCallGraphResultCreate` (`packages/workspace-service/src/index.ts`) — implements the conflict-resolution table from Phase 9.2 / Step 4 with the "type-aware never demotes structural" guarantee
- [x] Additive workspace contract fields — `WorkspaceDependencyGraphEdge.callGraphConfidence?: 'structural' | 'type-aware'`, `WorkspaceDependencyGraphEdge.callGraphKind?: 'direct' | 'dynamic-dispatch' | 'higher-order'`; both absent ⇒ legacy structural-only output
- [x] Additive `queryCallGraph` input — `requireTypeAware?: boolean` fails with structured error `{ code: 'type-aware-source-missing', languageId }` when no source is registered
- [x] Daemon round-trip — `query_call_graph` request/ack carry `requireTypeAware`; LSP / extension client pass it through additively
- [x] TypeScript binding — `@codepol/typescript-language-bridge` package supplies `typeScriptCallGraphSourceCreate({ transport, symbolLocate, symbolIdResolve })`. The bridge does NOT spawn `tsserver` itself; the host owns the transport lifecycle.
- [x] Tests: `packages/core/src/index/typeAwareCallGraphSourceRegistry.spec.ts` (registry round-trip), `tests/workspace-service.call-graph-type-aware.spec.ts` (every row of the conflict-resolution table + source-rejection / `requireTypeAware` paths), `packages/typescript-language-bridge/src/typeScriptCallGraphSource.spec.ts` (contract tests against a fake transport), daemon round-trip extended in `packages/workspace-service/src/daemon.spec.ts`

### 6. Type Relations
**Status**: Implemented

Extends/implements extraction, querying, and cross-file resolution.

- [x] `TypeRelation` type in `indexTypes.ts` — captures `extends` and `implements` relationships with `symbolId`, `targetName`, `relationKind`, `byteRange`, and optional `resolvedTargetId`
- [x] Tree-sitter query (`typeRelations.ts`) — patterns for class extends, class implements, abstract class extends/implements, interface extends
- [x] `typeRelationsExtract()` in `adapterCore.ts` — extracts type relations from query captures, resolves file-local targets
- [x] `IndexStore` indexes — `typeRelationsBySymbol`, `typeRelationsByTargetName`, `typeRelationsByFile` with query methods and proper cleanup in `filePut`/`fileRemove`/`clear`
- [x] `IndexStore.relationUpdate` TypeRelation branch — updates all three TypeRelation indexes when a relation is modified
- [x] `ProjectIndex` API — `typeRelationsGet(symbolId)`, `subTypesGet(symbolId)`, `typeRelationsInFileGet(file)`
- [x] Cross-file `resolvedTargetId` resolution — Step 6 in `crossFileResolve` (`indexBuilder.ts`) follows import bindings to resolve `resolvedTargetId` to the actual exported symbol from the source module. Works with re-export chains and aliased imports.
- [x] Unit tests (5 IndexStore + 3 ProjectIndex) and integration tests (15 in `tests/index.type-relations.spec.ts`)

---

## Remaining TODOs

### Python adapter

See [TODO_ADAPTER_PY.md](TODO_ADAPTER_PY.md) for Python-specific remaining work (cross-file module resolution, exports adapter gap, CFG support).

---

### Native `no-unused-vars` parity

**Priority**: Medium
**Status**: Partial primitives only
**Effort**: Medium-Large

The semantic index is sufficient for a baseline "declared binding has no resolved references" rule, but not yet for ESLint- or typescript-eslint-style `no-unused-vars` parity.

`ruleArgs` already supports rich rule options, so config plumbing is not the main blocker. The missing work is semantic fidelity in the TypeScript adapter and reference model.

Missing pieces:

- [ ] Parameter declarations in the TS/TSX adapter. `SymbolKind` includes `parameter`, but `packages/core/src/adapters/treeSitter/languages/typescript/queries/symbols.ts` does not currently capture `@decl.parameter`. Need support for simple, default, rest, and destructured parameters.
- [ ] Catch bindings and catch-local scopes. `packages/core/src/adapters/treeSitter/languages/typescript/queries/scopes.ts` currently captures only class/function/block scopes. Need `catch_clause` coverage plus symbol extraction for catch identifiers.
- [ ] Rich reference usage kinds. `ReferencesRelation` in `indexTypes.ts` only stores `scopeId`, `name`, `byteRange`, and optional `resolvedSymbolId`. High-parity unused-vars needs at least read/write classification and enough metadata to distinguish assignment-only refs, self-updates, and type-only refs from real value reads.
- [ ] Better TS ref extraction. `packages/core/src/adapters/treeSitter/languages/typescript/queries/refs.ts` is intentionally simplified and captures broad `identifier` / `type_identifier` nodes. A native unused-vars rule needs more precise filtering for declaration-vs-use, value-vs-type positions, and destructuring/default-value cases.
- [ ] More accurate local resolution. `resolveLocal()` in `packages/core/src/adapters/treeSitter/adapterCore.ts` is a practical scope-chain heuristic and can fall back to the first candidate. Unused-vars parity needs tighter handling for shadowing edge cases, named function expressions, loop-head bindings, and nested destructuring scopes.
- [ ] Destructuring metadata. Need to know whether a binding came from object vs array destructuring, whether it has rest siblings, whether a name is a property key or bound identifier, and whether default initializers introduce reads.
- [ ] Parameter ordering metadata for `args: "after-used"`. The rule needs either indexed parameter order or a reliable AST-side reconstruction of "last used parameter" semantics.
- [ ] Rule-level parity behavior after index support exists. Implement ESLint-style handling for `varsIgnorePattern`, `argsIgnorePattern`, `caughtErrorsIgnorePattern`, `destructuredArrayIgnorePattern`, `ignoreRestSiblings`, `reportUsedIgnorePattern`, and write-only/self-update edge cases such as `a = 1`, `a++`, and `a = a + 1`.

Test matrix once implemented:

- [ ] Unused locals, params, and catch bindings
- [ ] Destructuring with defaults and rest siblings
- [ ] `args: "after-used"` behavior
- [ ] Write-only refs vs true reads
- [ ] Type-only references in TS
- [ ] Ignore-pattern and report-used-ignore-pattern behavior

---

### 1. `TypeOf` relation

**Priority**: Low (deferred)
**Status**: Not implemented
**Effort**: Large

Value-to-type mapping (e.g., `const x: Foo = ...` → `x` has type `Foo`) requires type inference beyond what tree-sitter can provide. Tree-sitter gives syntax structure but not type resolution. This would require either:
- TypeScript compiler API integration (heavy dependency)
- Heuristic inference from annotations only (limited utility)

Intentionally deferred — the ROI is low for the current use cases (policy enforcement, unused exports).

---

### 2. Index persistence / caching

**Priority**: Medium
**Status**: In-memory only
**Effort**: Large

The `IndexStore` is entirely in-memory. For large projects, this means:
- Full re-indexing on every startup
- High memory usage for large codebases
- No sharing between processes (ESLint, CLI, IDE)

Options:
- SQLite-based storage (structured queries, proven durability)
- Binary serialization (fast load, custom format)
- LSP-style caching (editor integration)

---

### 3. Watch mode / incremental index updates

**Priority**: Medium
**Status**: API exists, no integration
**Effort**: Medium

`projectIndexUpdate()` and `crossFileResolveForFile()` exist and are tested, but nothing calls them automatically on file changes. Need:
- File system watcher integration (chokidar already a dependency)
- Debounced re-indexing
- Dirty file tracking
- Integration with the CLI `--watch` mode (which itself is tested but skipped — see item 5)

---

### 4. Additional language adapters

**Priority**: Low
**Status**: TypeScript (full), Python (single-file only)
**Effort**: Medium per language

Each new language requires:
- Tree-sitter grammar WASM file
- Query packs: `scopes.ts`, `symbols.ts`, `refs.ts`, `calls.ts`, `imports.ts`, `exports.ts`
- Kind mappings (symbol kinds, scope kinds)
- Language-specific ref filter (to exclude definition sites from references)
- Tests

Candidates:
- **JavaScript**: can mostly reuse the TypeScript adapter (already works via `languageIdFromFile` fallback that routes `.js`/`.jsx` to TS/TSX parsers)
- **Rust, Go, Java**: would need full adapter implementations

---

### 5. CLI `--watch` mode test

**Priority**: Low
**Status**: 1 skipped test in `tests/e2e.cli.spec.ts`
**Effort**: Medium

The `--watch` command starts a chokidar file watcher with debounced re-runs. Testing requires:
- Spawning a long-running CLI process
- Modifying source files while the process is running
- Asserting on incremental stdout output
- Graceful process cleanup

The test is currently `it.skip` with a TODO comment.

---

### 6. Query optimization

**Priority**: Low
**Status**: Naive implementation
**Effort**: Medium-Large

Current `IndexStore` queries use linear scans in some cases. Potential optimizations:
- Bloom filters for name existence checks
- Interval trees for byte-range queries
- Lazy loading of relations (only materialize when queried)

Not a bottleneck at current scale — benchmarks exist in `indexBuilder.bench.ts` and `indexQuery.bench.ts`.

---

### 7. LSP integration

**Priority**: Low
**Status**: Not implemented
**Effort**: Large

The original spec mentioned an "LSP++ sidecar":
- Expose index via LSP custom methods
- Editor-agnostic navigation (go-to-definition, find-references)
- Headless CI usage

This would make the semantic index available to IDEs without the ESLint adapter overhead.

---

### 8. ESM/CJS dual-publish for `@codepol/plugin`

**Priority**: Low
**Status**: Workaround in place
**Effort**: Small

Two `TODO` comments reference this:
- `packages/core/src/policy/policyPluginsGet.ts:103` — `pluginExported` unwrapping handles nested `default` from CJS→ESM interop
- `packages/plugin-eslint/src/index.ts:36` — `pluginRulesNormalize` handles the same interop for ESLint plugin assembly

The workaround is stable and tested but adds complexity. Fix by adding proper `exports` field to `@codepol/plugin`'s `package.json` with separate CJS and ESM entry points.

---

### 9. Unit tests for adapter query execution

**Priority**: Low
**Status**: Unchecked item in Testing Status
**Effort**: Medium

The adapter core's query execution (running tree-sitter queries against parse trees and processing captures) is exercised indirectly through integration tests (`index.builder.spec.ts`, `index.python.spec.ts`, etc.) but has no dedicated unit tests that test query execution in isolation with mocked parse trees.

---

## Known Limitations

These are intentional constraints, not bugs:

1. **No AST exposure** - Index contains semantic primitives, not syntax nodes
2. **Best-effort resolution** - Unresolved references are valid results
3. **No type inference** - Tree-sitter alone can't do type analysis
4. **Heuristic call detection** - May miss indirect calls, report false positives
5. **Single-threaded indexing** - Could parallelize per-file

## Testing Status

- [x] Unit tests for IndexStore operations (`packages/core/src/index/indexStore.spec.ts`)
- [ ] Unit tests for adapter query execution
- [x] Integration tests for cross-file scenarios (`tests/index.cross-file-resolution.spec.ts`)
- [x] Performance benchmarks for large codebases (`packages/core/src/index/indexBuilder.bench.ts`, `indexQuery.bench.ts`, `packages/plugin/src/unusedExportsCheck.bench.ts`)
- [x] Edge case coverage (circular imports, re-exports, star exports, diamond deps, missing files, namespace imports)
- [x] `callersGet`/`calleesGet` via ProjectIndex API (`tests/index.builder.spec.ts`)
- [x] Import aliases (`import { foo as bar }`) — tested in `tests/index.cross-file-resolution.spec.ts`
- [x] Export aliases (`export { foo as bar }`) — tested in `tests/index.cross-file-resolution.spec.ts`
- [x] Module graph queries — tested in `tests/index.module-graph.spec.ts` (linear chain, circular, diamond, isolated, external packages)
- [x] Cross-file interface/type/enum exports — tested in `tests/index.cross-file-resolution.spec.ts` (interface, type alias, enum, re-exported interface through chain)
- [x] Type-only named exports (`export type { Foo }`) — tested in `tests/index.cross-file-resolution.spec.ts`; tree-sitter produces identical `export_clause` structure; `Exported` flag set by `exportsExtract`
- [x] Anonymous default exports — tested in `tests/index.cross-file-resolution.spec.ts`; synthetic symbols created via AST walking in `exportsExtract`
- [x] CommonJS require() — tested in `tests/index.cross-file-resolution.spec.ts` (whole-module, destructured, ESM interop, module graph, external packages)
- [x] Dynamic import() binding resolution — tested in `tests/index.cross-file-resolution.spec.ts` (whole-module namespace binding, destructured named bindings, member access resolution, external package handling, `ImportsRelation` specifier resolution)
- [x] Dynamic import() module graph integration — tested in `tests/index.module-graph.spec.ts` (dynamic import with binding, side-effect dynamic import, static side-effect import all create edges)
- [x] Control flow graph extraction — tested in `tests/index.cfg.spec.ts` (37 tests: empty function, sequential, if/else, ternary expressions (simple, expression statement, nested), while/for/do-while/for-in/for-of, return/throw, break/continue with labels, switch/case/default with fallthrough, try/catch/finally, nested control flow, cyclomatic complexity, arrow functions)
- [x] CFG storage and queries — tested in `packages/core/src/index/indexStore.spec.ts` (put/get/remove/clear) and `packages/core/src/index/indexQuery.spec.ts` (cfgGet, cyclomaticComplexityGet)
- [x] Python adapter single-file tests — tested in `tests/index.python.spec.ts` (18 tests: symbols, scopes, refs, calls, imports, exports)
- [ ] Python adapter cross-file tests — 3 skipped tests pending Python module resolution in `moduleResolver.ts`

## Plugin Rules Using the Semantic Index

The following plugin rules in `@codepol/plugin` consume the `ProjectIndex` or use TypeScript compiler API for analysis:

- **unusedExportsCheck** — uses `ProjectIndex` for cross-file import/export resolution to detect unused exports. Tested (26 tests in `unusedExportsCheck.spec.ts`).
- **noDuplicateExportsCheck** — uses TypeScript compiler API to extract exports across files and detect duplicate export names. Tested (47 tests in `noDuplicateExportsCheck.spec.ts`).
- **noInterfaceCheck** / **noInterfaceFix** — uses TypeScript compiler API to detect interface declarations and autofix them to type aliases. Tested (25 tests in `noInterfaceCheck.spec.ts`).
- **forbiddenWordsCheck** — regex-based identifier extraction with compound-word-aware forbidden word matching. Tested (23 tests in `forbiddenWordsCheck.spec.ts`).
- **forbiddenPathWordsCheck** — path segment analysis for forbidden words in file/directory names. Tested (26 tests in `forbiddenPathWordsCheck.spec.ts`).
- **noVerbFunctionNameCheck** — function name analysis using `identifierSplitByCasing` to detect verb-prefixed names while allowing compound words. Tested (63 tests in `noVerbFunctionNameCheck.spec.ts`).

## Documentation Status

- [x] API reference for ProjectIndex — `docs/project-index-api.md`
- [x] Guide for creating language adapters — `docs/creating-language-adapters.md`
- [x] Examples of cross-file analysis rules — `docs/cross-file-analysis.md`
- [x] Architecture documentation with diagrams — `docs/semantic-index.md`
- [x] Full API reference including Semantic Index — `docs/api-reference.md`
