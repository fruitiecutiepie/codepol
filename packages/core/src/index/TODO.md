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
**Status**: Mostly Implemented

- [x] `ImportBindingRelation` type defined
- [x] Named imports (`import { foo }`)
- [x] Default imports (`import foo from`)
- [x] Namespace imports (`import * as foo`)
- [x] Import aliases (`import { foo as bar }`) — resolved via `childForFieldName('alias')` on the `import_specifier` AST node in both `symbolsExtract()` and `importBindingsExtract()`
- [x] CommonJS requires (`require()`) — tree-sitter query patterns added with `#eq?` predicate for `require` identifier. Whole-module (`const mod = require("module")`) creates `ImportBindingRelation` with `isDefault: true`; destructured (`const { foo } = require("module")`) creates named bindings. Adapter extraction was pre-existing in `adapterCore.ts`. Cross-file resolution, module graph inclusion, and external package handling all work via existing `ImportBindingRelation` pipeline. Tested in `tests/index.cross-file-resolution.spec.ts`.
- [x] Dynamic imports (`import("module")`) — specifier extraction and binding resolution. Tree-sitter query patterns: `import.source`/`import.side_effect` for specifier tracking, `import.dynamic_name`/`import.dynamic_source` for whole-module binding (`const mod = await import("module")` creates `ImportBindingRelation` with `isNamespace: true`), `import.dynamic_binding`/`import.dynamic_source` for destructured binding (`const { foo } = await import("module")` creates named bindings). `ImportsRelation.resolvedModulePath` set during `crossFileResolve` Step 7 for side-effect imports. Tested in `tests/index.cross-file-resolution.spec.ts`.
- [x] Dynamic import binding resolution (`const mod = await import("./module")`) — tree-sitter query patterns capture the `await_expression` > `call_expression` > `import` pattern inside `variable_declarator`. Whole-module creates namespace-like `ImportBindingRelation`; destructured creates named bindings. Cross-file resolution, namespace member resolution, and external package handling all work via existing pipelines.
- [x] Dynamic import module graph integration — `ImportsRelation.resolvedModulePath` resolved during `crossFileResolve` Step 7. `moduleGraphBuild` reads both `ImportBindingRelation` and `ImportsRelation` resolved paths to build edges. Covers dynamic imports with bindings, bare dynamic imports, and static side-effect imports.

## Not Yet Implemented

### High Priority

#### 1. Module Graph
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

### Medium Priority

#### 4. Control Flow Graph (CFG)
**Status**: Implemented  
**What's done**: Per-function CFG construction, storage, querying, cyclomatic complexity, and all common control flow patterns

Implementation:
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

**No remaining gaps.**

Use cases:
- Cyclomatic complexity calculation
- Dead code detection (unreachable after return/throw/break/continue)
- Path counting
- Reachability analysis

#### 5. Type Relations
**Status**: Implemented  
**What's done**: Extends/implements extraction, querying, and cross-file resolution

Implemented in the full stack:
- [x] `TypeRelation` type in `indexTypes.ts` — captures `extends` and `implements` relationships with `symbolId`, `targetName`, `relationKind`, `byteRange`, and optional `resolvedTargetId`
- [x] Tree-sitter query (`typeRelations.ts`) — patterns for class extends, class implements, abstract class extends/implements, interface extends
- [x] `typeRelationsExtract()` in `adapterCore.ts` — extracts type relations from query captures, resolves file-local targets
- [x] `IndexStore` indexes — `typeRelationsBySymbol`, `typeRelationsByTargetName`, `typeRelationsByFile` with query methods and proper cleanup in `filePut`/`fileRemove`/`clear`
- [x] `IndexStore.relationUpdate` TypeRelation branch — updates all three TypeRelation indexes when a relation is modified
- [x] `ProjectIndex` API — `typeRelationsGet(symbolId)`, `subTypesGet(symbolId)`, `typeRelationsInFileGet(file)`
- [x] Cross-file `resolvedTargetId` resolution — Step 6 in `crossFileResolve` (`indexBuilder.ts`) follows import bindings to resolve `resolvedTargetId` to the actual exported symbol from the source module. Works with re-export chains and aliased imports.
- [x] Unit tests (5 IndexStore + 3 ProjectIndex) and integration tests (15 in `tests/index.type-relations.spec.ts`)

**What's remaining**:
- [ ] `TypeOf` relation — value-to-type mapping requires type inference beyond tree-sitter's capabilities. Deferred.

#### 6. Persistence / Caching
**Status**: In-memory only  
**What's missing**: Disk persistence for large projects

Options:
- SQLite-based storage
- Binary serialization
- LSP-style caching

Benefits:
- Faster startup for unchanged files
- Reduced memory for large codebases
- Shareable between processes

#### 7. Watch Mode / Incremental Updates
**Status**: API exists, no integration  
**What's missing**: File watcher integration

`projectIndexUpdate()` exists but nothing calls it automatically. Need:
- File system watcher
- Debounced re-indexing
- Dirty file tracking

### Lower Priority

#### 8. Additional Language Adapters
**Status**: TypeScript/Python only  
**What's missing**: Other languages

Candidates:
- JavaScript (can reuse TS adapter mostly)
- Rust
- Go
- Java

Each needs:
- Tree-sitter grammar WASM
- Query packs (scopes.ts, symbols.ts, refs.ts, calls.ts, imports.ts)
- Kind mappings
- Language-specific ref filtering

#### 9. Query Optimization
**Status**: Naive implementation  
**What's missing**: Efficient queries for large codebases

Current implementation uses linear scans in some cases. Could add:
- Bloom filters for name existence checks
- Interval trees for range queries
- Lazy loading of relations

#### 10. LSP Integration
**Status**: Not implemented  
**What's missing**: Language Server Protocol bridge

The original spec mentioned "LSP++ sidecar":
- Expose index via LSP custom methods
- Editor-agnostic navigation
- Headless CI usage

### Known Limitations

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

## Documentation Needed

- [x] API reference for ProjectIndex — `docs/project-index-api.md`
- [x] Guide for creating language adapters — `docs/creating-language-adapters.md`
- [x] Examples of cross-file analysis rules — `docs/cross-file-analysis.md`
- [x] Architecture documentation with diagrams — `docs/semantic-index.md`
