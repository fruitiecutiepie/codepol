# Codepol Test Plan

Canonical reference for how the codepol monorepo should be tested. Every new feature, rule, or package change should be evaluated against this plan before merging.

---

## Table of Contents

1. [Principles](#1-principles)
2. [Test Layers](#2-test-layers)
3. [Per-Package Coverage Matrix](#3-per-package-coverage-matrix)
4. [Gap Analysis: Current State](#4-gap-analysis-current-state)
5. [Conventions](#5-conventions)
6. [Fixtures Strategy](#6-fixtures-strategy)
7. [Performance Benchmarks](#7-performance-benchmarks)
8. [CI Integration](#8-ci-integration)

---

## 1. Principles

### Test the interface, not the implementation

Every test targets a public API or a well-defined module boundary. Internal refactors (renaming private helpers, changing data layout) must not break tests.

### Each layer testable in isolation

A plugin author should be able to run plugin tests without standing up esbuild. A core contributor should be able to run `IndexStore` tests without loading tree-sitter WASM.

**Global singletons (`langAdd`, `parserInit`) are the main threat to isolation.** These mutate module-level state. To prevent interference between test files running in parallel:
- Use a Vitest global setup file (`vitest.setup.ts`) that calls `langAdd` and `parserInit` once for all tests that need parsers.
- Unit tests that don't need parsers must not import or depend on parser initialization.
- Never call `langAdd` inside individual test files. If a test file needs a parser, it relies on the global setup.

### Validate the Result type at boundaries

Every function that returns `Result<T, E>` must have tests for both the `Ok` and `Err` paths. The `Err` path must assert on the error message content so regressions in error quality are caught.

### Use real parsers for integration tests; test helpers for unit tests

Tree-sitter is a core dependency, not an external service. Integration tests that exercise structural analysis must use real WASM parsers via the global setup. The only exception is tests that validate error paths when parsers are _not_ initialized.

Unit tests for data structures like `IndexStore` need realistic `FileIndexDelta` objects but should not depend on tree-sitter. Provide test helpers (e.g., `testDeltaCreate(...)`) that build valid delta objects from inline descriptions, so unit tests get realistic data without a parser dependency.

### Test the plugin contract

Every plugin capability interface (`TreeCheckProvider`, `LintProvider`, `FixProvider`) must have a contract test that validates the interface. When a new plugin is created, it should be runnable against the contract test to verify it satisfies the API. This ensures the plugin architecture is real, not aspirational.

### Test cross-file topologies, not just happy paths

Cross-file resolution is the hardest thing codepol does. Tests must cover the topology, not just "A imports from B":
- Circular imports (A imports B, B imports A)
- Diamond dependencies (A imports B and C, both import D)
- Re-export chains (A re-exports from B, B re-exports from C)
- Missing files (import points to non-existent module)
- Star exports (`export * from`)

A cross-file test that only covers linear import chains is incomplete.

### Fixtures represent stable, documented inputs

Checked-in fixture files under `tests/fixtures/` represent canonical inputs. When a rule's behavior changes, add new fixtures rather than modifying existing ones — old fixtures serve as regression anchors. Temp directories (via `fs.mkdtempSync`) are for tests that need to control file layout dynamically.

### Tests are deterministic

No network calls, no reliance on system clock, no dependency on file ordering from `fs.readdirSync`. Tests that need ordering must sort explicitly. Tests that need paths must use `path.join` and `os.tmpdir`, never hardcoded absolute paths.

---

## 2. Test Layers

```
Layer 3: End-to-End (E2E)
  Process boundaries — CLI as a subprocess
  Location: tests/e2e.<feature>.spec.ts

Layer 2: Integration
  Multi-module, cross-package, real parsers and real files
  Includes third-party library calls (esbuild build(), ESLint RuleTester)
  Location: tests/<feature>.spec.ts

Layer 1: Unit
  Single module, no cross-package wiring, no tree-sitter
  Location: packages/<pkg>/src/<module>.spec.ts (co-located with source)
```

### Layer 1 -- Unit

Scope: One module, one function, one data structure. No file I/O unless the module under test is specifically about file I/O. No tree-sitter initialization. Uses test helpers for data construction.

Examples:
- `Result` utilities (`Ok`, `Err`, `isOk`, `isErr`, `resultFrom`, `resultFromAsync`)
- `moduleResolve` with pre-created temp dirs
- `IndexStore` CRUD operations with hand-built `FileIndexDelta` objects
- `policyRuleTargetsResolve` with inline policy objects
- `globPatternsGetMatchAny` with path strings
- `pluginRuleNew` validation
- `ProjectIndex` query methods with a pre-populated store (no parser needed)

### Layer 2 -- Integration

Scope: Multiple modules collaborating. Real tree-sitter parsers. Real file system (temp dirs). Third-party library calls that run in-process. Tests verify that the wiring between modules produces correct data.

Examples:
- `projectIndexBuildSync` with multi-file TypeScript projects
- Cross-file import resolution with various topologies (circular, diamond, re-exports)
- `policyViolationsGetForFile` with real plugins and real parsed trees
- `eslintAdapter.adapt()` producing a working ESLint rule via `RuleTester`
- `unusedExportsCheck` with a built `ProjectIndex`
- esbuild `build()` with the policy plugin (runs in-process, not a subprocess)

### Layer 3 -- End-to-End (E2E)

Scope: Process boundaries only. The test spawns a subprocess and asserts on its exit code, stdout, and side effects on disk. This layer is reserved for the CLI because it is the only codepol surface that users interact with as a process.

Examples:
- `codepol --help` prints usage and exits 0
- `codepol` exits non-zero when violations exist
- `codepol --fix` modifies files on disk
- `codepol --config <path>` uses an explicit config

**Why esbuild is not E2E:** `esbuild.build()` is called as a library function within the test process. It shares memory, has no process isolation, and throws errors directly. This makes it integration, not E2E. Treating it as E2E would exclude it from fast CI stages unnecessarily.

---

## 3. Per-Package Coverage Matrix

### 3.1 `@codepol/core`

#### Result Utilities (`result/result.ts`)

| Function | Layer | Test File | Status |
|----------|-------|-----------|--------|
| `Ok(value)` | Unit | `packages/core/src/result/result.spec.ts` | Exists |
| `Err(error)` | Unit | `packages/core/src/result/result.spec.ts` | Exists |
| `isOk(result)` | Unit | `packages/core/src/result/result.spec.ts` | Exists |
| `isErr(result)` | Unit | `packages/core/src/result/result.spec.ts` | Exists |
| `resultFrom(fn)` — success | Unit | `packages/core/src/result/result.spec.ts` | Exists |
| `resultFrom(fn)` — throws | Unit | `packages/core/src/result/result.spec.ts` | Exists |
| `resultFromAsync(fn)` — resolves | Unit | `packages/core/src/result/result.spec.ts` | Exists |
| `resultFromAsync(fn)` — rejects | Unit | `packages/core/src/result/result.spec.ts` | Exists |

#### Module Resolver (`index/moduleResolver.ts`)

| Function | Layer | Test File | Status |
|----------|-------|-----------|--------|
| `isRelativeImport` — `./`, `../`, absolute | Unit | `packages/core/src/index/moduleResolver.spec.ts` | Exists |
| `isExternalPackage` — scoped, bare, relative | Unit | `packages/core/src/index/moduleResolver.spec.ts` | Exists |
| `moduleResolve` — relative, no extension | Unit | `packages/core/src/index/moduleResolver.spec.ts` | Exists |
| `moduleResolve` — relative, explicit `.ts` | Unit | `packages/core/src/index/moduleResolver.spec.ts` | Exists |
| `moduleResolve` — directory with `index.ts` | Unit | `packages/core/src/index/moduleResolver.spec.ts` | Exists |
| `moduleResolve` — path aliases | Unit | `packages/core/src/index/moduleResolver.spec.ts` | Exists |
| `moduleResolve` — `.tsx`, `.js` extensions | Unit | `packages/core/src/index/moduleResolver.spec.ts` | Exists |
| `moduleResolve` — non-existent file returns undefined | Unit | `packages/core/src/index/moduleResolver.spec.ts` | Exists |
| `moduleResolve` — external package returns undefined | Unit | `packages/core/src/index/moduleResolver.spec.ts` | Exists |

#### IndexStore (`index/indexStore.ts`)

| Operation | Layer | Test File | Status |
|-----------|-------|-----------|--------|
| `indexStoreNew()` returns empty store | Unit | `packages/core/src/index/indexStore.spec.ts` | Exists |
| `filePut` / `symbolsGet` round-trip | Unit | `packages/core/src/index/indexStore.spec.ts` | Exists |
| `filePut` / `scopesInFileGet` round-trip | Unit | `packages/core/src/index/indexStore.spec.ts` | Exists |
| `filePut` / `referencesGet` round-trip | Unit | `packages/core/src/index/indexStore.spec.ts` | Exists |
| `filePut` / `callsGet` round-trip | Unit | `packages/core/src/index/indexStore.spec.ts` | Exists |
| `filePut` / `importBindingsInFileGet` round-trip | Unit | `packages/core/src/index/indexStore.spec.ts` | Exists |
| `filePut` / `exportsInFileGet` round-trip | Unit | `packages/core/src/index/indexStore.spec.ts` | Exists |
| `fileRemove` clears all relations for file | Unit | `packages/core/src/index/indexStore.spec.ts` | Exists |
| `exportMapBuild` correctness | Unit | `packages/core/src/index/indexStore.spec.ts` | Exists |
| `relationUpdate` modifies existing relations | Unit | `packages/core/src/index/indexStore.spec.ts` | Exists |
| `symbolGet` by ID returns correct symbol | Unit | `packages/core/src/index/indexStore.spec.ts` | Exists |
| `symbolsGet` with `SymbolFilter` (by name, kind, file, flags) | Unit | `packages/core/src/index/indexStore.spec.ts` | Exists |
| `filesGet` lists indexed files | Unit | `packages/core/src/index/indexStore.spec.ts` | Exists |
| `clear()` empties everything | Unit | `packages/core/src/index/indexStore.spec.ts` | Exists |
| `filePut` / `typeRelationsForSymbolGet` round-trip | Unit | `packages/core/src/index/indexStore.spec.ts` | Exists |
| `typeRelationsByTargetNameGet` lookup | Unit | `packages/core/src/index/indexStore.spec.ts` | Exists |
| `typeRelationsInFileGet` lookup | Unit | `packages/core/src/index/indexStore.spec.ts` | Exists |
| `fileRemove` clears type relations | Unit | `packages/core/src/index/indexStore.spec.ts` | Exists |
| `clear()` empties type relations | Unit | `packages/core/src/index/indexStore.spec.ts` | Exists |

#### Index Builder (`index/indexBuilder.ts`)

| Function | Layer | Test File | Status |
|----------|-------|-----------|--------|
| `projectIndexBuildSync` — single file | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists |
| `projectIndexBuildSync` — multi-file with imports | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists |
| `projectIndexBuild` — async variant | Integration | `tests/index.builder.spec.ts` | Exists |
| `projectIndexUpdateFileSync` — no change returns false | Integration | `packages/plugin/src/unusedExportsCheck.spec.ts` | Exists |
| `projectIndexUpdateFileSync` — changed file returns true | Integration | `packages/plugin/src/unusedExportsCheck.spec.ts` | Exists |
| `projectIndexUpdateFileFromSource` — update from string | Integration | `tests/index.builder.spec.ts` | Exists |
| `projectIndexUpdateFileFromSource` — unchanged returns false | Integration | `tests/index.builder.spec.ts` | Exists |
| `projectIndexRemoveFiles` — removes file data | Integration | `tests/index.builder.spec.ts` | Exists |
| `crossFileResolveForFile` — re-resolves one file | Integration | `tests/index.builder.spec.ts` | Exists |
| `adapterRegister` — custom language adapter | Integration | `tests/index.builder.spec.ts` | Exists (overrides built-in adapter with spy; custom language blocked by hardcoded `languageIdFromFile` — known gap) |
| Symbol extraction — function declarations | Integration | `tests/index.builder.spec.ts` | Exists |
| Symbol extraction — classes | Integration | `tests/index.builder.spec.ts` | Exists |
| Symbol extraction — variables (const, let) | Integration | `tests/index.builder.spec.ts` | Exists |
| Symbol extraction — type aliases | Integration | `tests/index.builder.spec.ts` | Exists |
| Symbol extraction — interfaces | Integration | `tests/index.builder.spec.ts` | Exists |
| Symbol extraction — enums | Integration | `tests/index.builder.spec.ts` | Exists |
| Symbol extraction — async flag | Integration | `tests/index.builder.spec.ts` | Exists |
| Symbol extraction — enum members | Integration | `tests/index.builder.spec.ts` | Exists |
| Scope tree construction — nested functions, classes, blocks | Integration | `tests/index.builder.spec.ts` | Exists |
| Heuristic call detection | Integration | `tests/index.builder.spec.ts` | Exists |
| `callersGet` / `calleesGet` via ProjectIndex API | Integration | `tests/index.builder.spec.ts` | Exists (symbol ranges expanded to full declaration span; `callersGet` fixed to use file-scoped range containment) |
| `crossFileResolve` — named imports | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists |
| `crossFileResolve` — default imports | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists |
| `crossFileResolve` — namespace imports | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists (binding indexed with `resolvedModulePath`; member accesses like `utils.alpha` resolved to exported symbols via `memberRefsExtract` + namespace member resolution pass) |
| `crossFileResolve` — aliased imports | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists (`importedName` is original exported name; local symbol uses alias via `childForFieldName('alias')` on `import_specifier` AST node) |
| `crossFileResolve` — export aliases (`export { foo as bar }`) | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists (export alias resolved via `childForFieldName('alias')` on `export_specifier`; consumer imports by aliased name) |
| `crossFileResolve` — re-exports (A re-exports from B) | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists (re-export chain followed via `exportMapAddReexportedSymbols`) |
| `crossFileResolve` — circular imports (A imports B, B imports A) | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists |
| `crossFileResolve` — diamond dependency (A imports B+C, both import D) | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists |
| `crossFileResolve` — star exports (`export *`) | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists (star exports expanded via `exportMapAddReexportedSymbols`; imports traced through proxy) |
| `crossFileResolve` — namespace re-exports (`export * as ns`) | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists (namespace re-export extracted in `exportsExtract`; sentinel ID in export map; consumer named import converted to namespace binding in `crossFileResolve`; member accesses resolved via namespace member resolution pass) |
| `crossFileResolve` — chained namespace re-exports | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists (namespace re-export from a star-export proxy; chained resolution through `exportMapAddReexportedSymbols`) |
| `crossFileResolve` — cross-file interface exports | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists (export query captures `interface_declaration` via `export.decl_name`; import binding resolves to exported interface symbol) |
| `crossFileResolve` — cross-file type alias exports | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists (export query captures `type_alias_declaration` via `export.decl_name`; supports generic type aliases) |
| `crossFileResolve` — cross-file enum exports | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists (enum symbol and enum members extracted; import binding resolves to exported enum symbol) |
| `crossFileResolve` — re-exported interface through chain | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists (re-export chain followed to origin via `exportMapAddReexportedSymbols`; `resolvedExportId` traces back to origin's interface symbol) |
| `crossFileResolve` — type-only named exports (`export type { Foo }`) | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists (tree-sitter produces identical `export_clause` > `export_specifier` structure for `export type { }` and `export { }`; `type` keyword is just an extra unnamed child — no query change needed. `Exported` flag now set on symbols referenced by named export clauses in `exportsExtract`) |
| `crossFileResolve` — anonymous default class export | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists (anonymous default class produces `class` expression node with no `name` field; `exportsExtract` walks AST to detect unhandled default exports and creates a synthetic `SymbolRecord` with name `"default"` and kind `"class"`) |
| `crossFileResolve` — anonymous default function export | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists (anonymous default function produces `function_expression` node with no `name` field; same synthetic symbol mechanism as anonymous class, with kind `"function"`) |
| `crossFileResolve` — missing file (import to non-existent module) | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists |
| `crossFileResolve` — CommonJS require (whole-module) | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists (`const mod = require('./module')` creates `ImportBindingRelation` with `isDefault: true`; adapter extraction via `import.require_name` + `import.require_source` captures with `#eq?` predicate for `require` identifier) |
| `crossFileResolve` — CommonJS require (destructured) | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists (`const { alpha, beta } = require('./module')` creates named `ImportBindingRelation` entries; adapter extraction via `import.require_binding` captures) |
| `crossFileResolve` — CommonJS require + ESM exports interop | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists (CJS `require()` consuming ESM `export const`/`export function` — destructured bindings resolve to exported symbols) |
| `crossFileResolve` — CommonJS require in module graph | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists (require() imports create `ImportBindingRelation` with `resolvedModulePath`, picked up by module graph forward/reverse adjacency) |
| `crossFileResolve` — external require (no resolvedModulePath) | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists (`require('lodash')` creates binding with `isDefault: true`; `resolvedModulePath` and `resolvedExportId` are undefined for external packages) |
| Dynamic `import()` — whole-module binding (`const mod = await import()`) | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists (`const mod = await import('./module')` creates `ImportBindingRelation` with `isNamespace: true` via `import.dynamic_name`/`import.dynamic_source` query captures; namespace member resolution resolves `mod.foo` accesses) |
| Dynamic `import()` — destructured binding (`const { foo } = await import()`) | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists (destructured dynamic import creates named `ImportBindingRelation` entries; cross-file resolution maps to exported symbols) |
| Dynamic `import()` — member access resolution | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists (namespace binding + `memberRefsExtract` + namespace member resolution pass resolves `mod.greet()` to exported symbol) |
| Dynamic `import()` — external package (no resolution) | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists (`await import('lodash')` creates namespace binding; `resolvedModulePath` and `resolvedExportId` are undefined for external packages) |
| `ImportsRelation` specifier resolution — side-effect imports | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists (`import './module'` gets `resolvedModulePath` set during `crossFileResolve` Step 7) |
| File with parse errors — graceful skip | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists |
| Empty file — no crash | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists |

#### Index Query / ProjectIndex (`index/indexQuery.ts`)

Methods that are thin wrappers over `IndexStore` can be unit-tested with a pre-populated store (no parser). Methods that depend on cross-file resolution or real parse output need integration tests.

| Method | Layer | Test File | Status |
|--------|-------|-----------|--------|
| `symbolsGet()` — all symbols | Unit | `packages/core/src/index/indexQuery.spec.ts` | Exists |
| `symbolGet(id)` | Unit | `packages/core/src/index/indexQuery.spec.ts` | Exists |
| `symbolsInFileGet(file)` | Unit | `packages/core/src/index/indexQuery.spec.ts` | Exists |
| `symbolsGetByName(name)` | Unit | `packages/core/src/index/indexQuery.spec.ts` | Exists |
| `exportedSymbolsGet({ file })` | Unit | `packages/core/src/index/indexQuery.spec.ts` | Exists |
| `referencesGet(symbolId)` | Unit | `packages/core/src/index/indexQuery.spec.ts` | Exists (asserted in cross-file test) |
| `referencesInFileGet(file)` | Unit | `packages/core/src/index/indexQuery.spec.ts` | Exists |
| `callersGet(symbolId)` | Unit | `packages/core/src/index/indexQuery.spec.ts` | Exists |
| `calleesGet(symbolId)` | Unit | `packages/core/src/index/indexQuery.spec.ts` | Exists |
| `scopeGet(scopeId)` | Unit | `packages/core/src/index/indexQuery.spec.ts` | Exists (used indirectly in cross-file test) |
| `scopesInFileGet(file)` | Unit | `packages/core/src/index/indexQuery.spec.ts` | Exists |
| `importBindingsGet(file)` | Unit | `packages/core/src/index/indexQuery.spec.ts` | Exists (asserted in cross-file test) |
| `fileExportsGet(file)` | Unit | `packages/core/src/index/indexQuery.spec.ts` | Exists (asserted in cross-file test) |
| `importResolve(fromFile, specifier, name)` | Unit | `packages/core/src/index/indexQuery.spec.ts` | Exists |
| `statsGet()` | Unit | `packages/core/src/index/indexQuery.spec.ts` | Exists |
| `capabilities` | Unit | `packages/core/src/index/indexQuery.spec.ts` | Exists |
| `typeRelationsGet(symbolId)` — type relations for a symbol | Unit | `packages/core/src/index/indexQuery.spec.ts` | Exists |
| `subTypesGet(symbolId)` — reverse type relation lookup | Unit | `packages/core/src/index/indexQuery.spec.ts` | Exists |
| `typeRelationsInFileGet(file)` — all type relations in file | Unit | `packages/core/src/index/indexQuery.spec.ts` | Exists |

#### Module Graph (`index/moduleGraph.ts`)

| Method | Layer | Test File | Status |
|--------|-------|-----------|--------|
| `moduleImportersGet(file)` — reverse dependency edges | Integration | `tests/index.module-graph.spec.ts` | Exists |
| `moduleImporteesGet(file)` — forward dependency edges | Integration | `tests/index.module-graph.spec.ts` | Exists |
| `moduleDependencyOrderGet()` — topological sort | Integration | `tests/index.module-graph.spec.ts` | Exists |
| `moduleCyclesGet()` — circular dependency detection | Integration | `tests/index.module-graph.spec.ts` | Exists |
| Linear chain topology (A imports B imports C) | Integration | `tests/index.module-graph.spec.ts` | Exists |
| Circular imports (A imports B, B imports A) | Integration | `tests/index.module-graph.spec.ts` | Exists |
| Diamond dependency (A imports B+C, both import D) | Integration | `tests/index.module-graph.spec.ts` | Exists |
| Isolated file (no imports/exports) | Integration | `tests/index.module-graph.spec.ts` | Exists |
| External packages excluded from graph | Integration | `tests/index.module-graph.spec.ts` | Exists |
| Unknown file returns empty arrays | Integration | `tests/index.module-graph.spec.ts` | Exists |
| Multiple imports between same files deduplicated | Integration | `tests/index.module-graph.spec.ts` | Exists |
| `moduleEntryPointsGet()` — files with no importers | Integration | `tests/index.module-graph.spec.ts` | Exists |
| Entry points — linear chain (only root) | Integration | `tests/index.module-graph.spec.ts` | Exists |
| Entry points — diamond (only root) | Integration | `tests/index.module-graph.spec.ts` | Exists |
| Entry points — isolated files are entry points | Integration | `tests/index.module-graph.spec.ts` | Exists |
| Entry points — circular imports have no entry points | Integration | `tests/index.module-graph.spec.ts` | Exists |
| Entry points — external-only imports are entry points | Integration | `tests/index.module-graph.spec.ts` | Exists |
| Dynamic `import()` creates module graph edges | Integration | `tests/index.module-graph.spec.ts` | Exists (`const mod = await import('./target')` creates forward/reverse edges via `ImportBindingRelation`; dynamic importer is entry point) |
| Side-effect dynamic `import()` in module graph | Integration | `tests/index.module-graph.spec.ts` | Exists (`await import('./target')` without binding creates edges via `ImportsRelation.resolvedModulePath`) |
| Static side-effect `import` in module graph | Integration | `tests/index.module-graph.spec.ts` | Exists (`import './module'` creates edges via `ImportsRelation.resolvedModulePath` resolved in `crossFileResolve` Step 7) |

#### Type Relations (`index/indexTypes.ts`, `adapters/treeSitter/adapterCore.ts`)

| Method / Scenario | Layer | Test File | Status |
|-------------------|-------|-----------|--------|
| `filePut` / `typeRelationsForSymbolGet` round-trip | Unit | `packages/core/src/index/indexStore.spec.ts` | Exists |
| `typeRelationsByTargetNameGet` lookup | Unit | `packages/core/src/index/indexStore.spec.ts` | Exists |
| `typeRelationsInFileGet` lookup | Unit | `packages/core/src/index/indexStore.spec.ts` | Exists |
| `fileRemove` clears type relations | Unit | `packages/core/src/index/indexStore.spec.ts` | Exists |
| `clear()` empties type relations | Unit | `packages/core/src/index/indexStore.spec.ts` | Exists |
| `typeRelationsGet(symbolId)` returns extends/implements | Unit | `packages/core/src/index/indexQuery.spec.ts` | Exists |
| `subTypesGet(symbolId)` returns children | Unit | `packages/core/src/index/indexQuery.spec.ts` | Exists |
| `typeRelationsInFileGet(file)` returns all relations | Unit | `packages/core/src/index/indexQuery.spec.ts` | Exists |
| Class extends class (same file) | Integration | `tests/index.type-relations.spec.ts` | Exists |
| Class implements interface (same file) | Integration | `tests/index.type-relations.spec.ts` | Exists |
| Class implements multiple interfaces | Integration | `tests/index.type-relations.spec.ts` | Exists |
| Interface extends interface | Integration | `tests/index.type-relations.spec.ts` | Exists |
| Abstract class extends + implements | Integration | `tests/index.type-relations.spec.ts` | Exists |
| Class extends with generic type parameter | Integration | `tests/index.type-relations.spec.ts` | Exists |
| `subTypesGet` reverse lookup | Integration | `tests/index.type-relations.spec.ts` | Exists |
| No type relations returns empty array | Integration | `tests/index.type-relations.spec.ts` | Exists |
| Symbol with no extends/implements returns empty | Integration | `tests/index.type-relations.spec.ts` | Exists |
| Cross-file extends (import + extends) | Integration | `tests/index.type-relations.spec.ts` | Exists (`resolvedTargetId` resolved to actual exported symbol via `crossFileResolve` Step 6) |
| Cross-file implements (import + implements) | Integration | `tests/index.type-relations.spec.ts` | Exists |
| Cross-file extends through re-export chain | Integration | `tests/index.type-relations.spec.ts` | Exists |
| Cross-file extends with aliased import | Integration | `tests/index.type-relations.spec.ts` | Exists |
| Cross-file interface extends imported interface | Integration | `tests/index.type-relations.spec.ts` | Exists |
| Interface extends multiple interfaces | Integration | `tests/index.type-relations.spec.ts` | Exists |

#### Control Flow Graph (`adapters/treeSitter/cfgBuild.ts`, `index/indexStore.ts`, `index/indexQuery.ts`)

| Method / Scenario | Layer | Test File | Status |
|-------------------|-------|-----------|--------|
| `filePut` / `cfgGet` round-trip | Unit | `packages/core/src/index/indexStore.spec.ts` | Exists |
| `cfgsInFileGet` returns CFGs for file | Unit | `packages/core/src/index/indexStore.spec.ts` | Exists |
| `fileRemove` clears CFGs | Unit | `packages/core/src/index/indexStore.spec.ts` | Exists |
| `clear()` empties CFGs | Unit | `packages/core/src/index/indexStore.spec.ts` | Exists |
| `cfgGet` returns undefined for unknown scope | Unit | `packages/core/src/index/indexStore.spec.ts` | Exists |
| `cfgGet(scopeId)` via ProjectIndex | Unit | `packages/core/src/index/indexQuery.spec.ts` | Exists |
| `cyclomaticComplexityGet(symbolId)` returns correct value | Unit | `packages/core/src/index/indexQuery.spec.ts` | Exists |
| `cyclomaticComplexityGet` returns undefined for non-function | Unit | `packages/core/src/index/indexQuery.spec.ts` | Exists |
| Empty function — entry + exit, 1 edge | Integration | `tests/index.cfg.spec.ts` | Exists |
| Sequential statements — linear chain | Integration | `tests/index.cfg.spec.ts` | Exists |
| Single `if` (no else) — branch + merge | Integration | `tests/index.cfg.spec.ts` | Exists |
| `if/else` — branch with true/false paths + merge | Integration | `tests/index.cfg.spec.ts` | Exists |
| `while` loop — loop node + back-edge | Integration | `tests/index.cfg.spec.ts` | Exists |
| `for` loop — loop node + back-edge | Integration | `tests/index.cfg.spec.ts` | Exists |
| `do...while` — body first, condition, back-edge | Integration | `tests/index.cfg.spec.ts` | Exists |
| `return` inside function — edge to exit | Integration | `tests/index.cfg.spec.ts` | Exists |
| `throw` inside function — edge to exit | Integration | `tests/index.cfg.spec.ts` | Exists |
| Nested if inside while | Integration | `tests/index.cfg.spec.ts` | Exists |
| Cyclomatic complexity: linear function = 1 | Integration | `tests/index.cfg.spec.ts` | Exists |
| Cyclomatic complexity: if/else = 2 | Integration | `tests/index.cfg.spec.ts` | Exists |
| Cyclomatic complexity: while + if = 3 | Integration | `tests/index.cfg.spec.ts` | Exists |
| Arrow function with block body | Integration | `tests/index.cfg.spec.ts` | Exists |
| Arrow function with expression body | Integration | `tests/index.cfg.spec.ts` | Exists |
| Multiple functions — CFG per function scope | Integration | `tests/index.cfg.spec.ts` | Exists |
| `for...of` — loop node + back-edge + true/false edges | Integration | `tests/index.cfg.spec.ts` | Exists |
| `for...in` — loop node + back-edge | Integration | `tests/index.cfg.spec.ts` | Exists |
| `for...of` with break — loop + break edge to merge | Integration | `tests/index.cfg.spec.ts` | Exists |
| `switch` with cases returning — branch + case edges | Integration | `tests/index.cfg.spec.ts` | Exists |
| `switch` with fallthrough (no break between cases) | Integration | `tests/index.cfg.spec.ts` | Exists |
| `switch` with default only | Integration | `tests/index.cfg.spec.ts` | Exists |
| `switch` with all cases returning | Integration | `tests/index.cfg.spec.ts` | Exists |
| Cyclomatic complexity: switch with 3 cases = 3 | Integration | `tests/index.cfg.spec.ts` | Exists |
| `break/continue` in loops — correct edge targets | Integration | `tests/index.cfg.spec.ts` | Exists |
| `break` inside nested loop — only breaks inner | Integration | `tests/index.cfg.spec.ts` | Exists |
| `continue` inside nested loop — only continues inner | Integration | `tests/index.cfg.spec.ts` | Exists |
| Labeled `break` exits outer loop | Integration | `tests/index.cfg.spec.ts` | Exists |
| `try/catch/finally` — both paths reachable, finally on all | Integration | `tests/index.cfg.spec.ts` | Exists |
| `try` without catch (only finally) | Integration | `tests/index.cfg.spec.ts` | Exists |
| `try` without finally — try and catch merge | Integration | `tests/index.cfg.spec.ts` | Exists |
| Cyclomatic complexity: try/catch = 2 | Integration | `tests/index.cfg.spec.ts` | Exists |
| Ternary in variable declaration — branch + merge | Integration | `tests/index.cfg.spec.ts` | Exists |
| Ternary in expression statement — branch + merge | Integration | `tests/index.cfg.spec.ts` | Exists |
| Nested ternary — 2 branch nodes with nested merge | Integration | `tests/index.cfg.spec.ts` | Exists |
| Cyclomatic complexity: single ternary = 2 | Integration | `tests/index.cfg.spec.ts` | Exists |
| Cyclomatic complexity: ternary + if = 3 | Integration | `tests/index.cfg.spec.ts` | Exists |

#### Policy Loading (`policyGet.ts`)

| Function | Layer | Test File | Status |
|----------|-------|-----------|--------|
| `policyRuleTargetsResolve` — rule with targets | Unit | `packages/core/src/policy/policyGet.spec.ts` | Exists |
| `policyRuleTargetsResolve` — rule with missing target key | Unit | `packages/core/src/policy/policyGet.spec.ts` | Exists |
| `globPatternsGetMatchAny` — matching path | Unit | `packages/core/src/policy/policyGet.spec.ts` | Exists |
| `globPatternsGetMatchAny` — non-matching path | Unit | `packages/core/src/policy/policyGet.spec.ts` | Exists |
| `ruleTargetMatchesLanguage` — match and mismatch | Unit | `packages/core/src/policy/policyGet.spec.ts` | Exists |
| `ruleMatchesGet` — files matching rules | Unit | `packages/core/src/policy/policyGet.spec.ts` | Exists |
| `policyFileGetChecked` — file in scope vs out of scope | Unit | `packages/core/src/policy/policyGet.spec.ts` | Exists |

#### Policy Tree Check (`policyTreeCheck.ts`)

| Function | Layer | Test File | Status |
|----------|-------|-----------|--------|
| `policyViolationsGetForFile` — plugin missing capability | Integration | `tests/core.plugins.spec.ts` | Exists |
| `policyViolationsGetForFile` — plugin wrong language | Integration | `tests/core.plugins.spec.ts` | Exists |
| `policyViolationsGetForFile` — missing logger config | Integration | `tests/core.error-handling.spec.ts` | Exists |
| `policyViolationsGetForFile` — valid check returns violations | Integration | `tests/core.plugins.spec.ts` | Exists |
| `policyViolationsGetFromDir` — finds violations across files | Integration | `tests/treesitter.require-logger-enter-exit.spec.ts` | Exists |
| `policyViolationsGetFromDir` — respects target-level exclude | Integration | `tests/treesitter.require-logger-enter-exit.spec.ts` | Exists |
| `policyViolationsGetFromDir` — respects global policy exclude | Integration | `tests/treesitter.require-logger-enter-exit.spec.ts` | Exists |

#### Policy Check Runner (`policyCheck.ts`)

| Function | Layer | Test File | Status |
|----------|-------|-----------|--------|
| `policyCheck` — full pipeline | Integration | `tests/core.policy-check.spec.ts` | Exists |
| `policyCheck` — config not found | Integration | `tests/core.policy-check.spec.ts` | Exists |
| `policyViolationsGetOutputPretty` — empty violations | Unit | `packages/core/src/policy/policyCheck.spec.ts` | Exists |
| `policyViolationsGetOutputPretty` — single violation, relative path | Unit | `packages/core/src/policy/policyCheck.spec.ts` | Exists |
| `policyViolationsGetOutputPretty` — multiple violations grouped by file | Unit | `packages/core/src/policy/policyCheck.spec.ts` | Exists |

#### Parser and Languages (`parser/parserInit.ts`, `parser/parserLangs.ts`)

| Function | Layer | Test File | Status |
|----------|-------|-----------|--------|
| `wasmPathGet` — returns resolved WASM path | Unit | `packages/core/src/parser/parserLangs.spec.ts` | Exists |
| `langAdd` — registers language with normalized extensions | Unit | `packages/core/src/parser/parserLangs.spec.ts` | Exists |
| `langAdd` — assigns default wasmPath | Unit | `packages/core/src/parser/parserLangs.spec.ts` | Exists |
| `langAdd` — uses custom wasmPath | Unit | `packages/core/src/parser/parserLangs.spec.ts` | Exists |
| `langAdd` — empty langId throws | Unit | `packages/core/src/parser/parserLangs.spec.ts` | Exists |
| `langAdd` — whitespace-only langId throws | Unit | `packages/core/src/parser/parserLangs.spec.ts` | Exists |
| `langAdd` — empty extensions throws | Unit | `packages/core/src/parser/parserLangs.spec.ts` | Exists |
| `langAdd` — duplicate langId with same wasmPath merges extensions | Unit | `packages/core/src/parser/parserLangs.spec.ts` | Exists |
| `langAdd` — duplicate langId with different wasmPath throws | Unit | `packages/core/src/parser/parserLangs.spec.ts` | Exists |
| `langAdd` — extension conflict between different languages throws | Unit | `packages/core/src/parser/parserLangs.spec.ts` | Exists |
| `langsGet` — returns all registered languages | Unit | `packages/core/src/parser/parserLangs.spec.ts` | Exists |
| `langExists` — false before langSet, true after | Unit | `packages/core/src/parser/parserLangs.spec.ts` | Exists |
| `langGetForFile` — returns Language for known extension | Unit | `packages/core/src/parser/parserLangs.spec.ts` | Exists |
| `langGetForFile` — returns null for unknown extension | Unit | `packages/core/src/parser/parserLangs.spec.ts` | Exists |
| `langGetForFile` — returns null for file with no extension | Unit | `packages/core/src/parser/parserLangs.spec.ts` | Exists |
| `langGetForFile` — matches extensions case-insensitively | Unit | `packages/core/src/parser/parserLangs.spec.ts` | Exists |
| `langGetForFile` — returns null when Language not yet loaded | Unit | `packages/core/src/parser/parserLangs.spec.ts` | Exists |
| `parserGetForFile` — returns Err before parserInit | Integration | `packages/core/src/parser/parserInit.spec.ts` | Exists |
| `parserInit` — initializes successfully (idempotent) | Integration | `packages/core/src/parser/parserInit.spec.ts` | Exists |
| `parserGetForFile` — returns Ok with parser for known extension | Integration | `packages/core/src/parser/parserInit.spec.ts` | Exists |
| `parserGetForFile` — returns Err for unknown extension | Integration | `packages/core/src/parser/parserInit.spec.ts` | Exists |

#### Config Discovery (`configDiscover.ts`)

| Function | Layer | Test File | Status |
|----------|-------|-----------|--------|
| `configFileDiscover` — finds `codepol.config.ts` in starting dir | Unit | `packages/core/src/config/configDiscover.spec.ts` | Exists |
| `configFileDiscover` — walks up to parent directory | Unit | `packages/core/src/config/configDiscover.spec.ts` | Exists |
| `configFileDiscover` — returns null when not found | Unit | `packages/core/src/config/configDiscover.spec.ts` | Exists |
| `configFileDiscover` — respects precedence (.ts over .js) | Unit | `packages/core/src/config/configDiscover.spec.ts` | Exists |
| `configGetFromPath` — loads JS config file | Integration | `packages/core/src/config/configDiscover.spec.ts` | Exists |
| `configGetFromPath` — throws for non-existent file | Unit | `packages/core/src/config/configDiscover.spec.ts` | Exists |
| `configGetFromPathSync` — loads JS config file | Integration | `packages/core/src/config/configDiscover.spec.ts` | Exists |
| `configGetFromPathSync` — throws for non-existent file | Unit | `packages/core/src/config/configDiscover.spec.ts` | Exists |
| `configGet` — throws when no config found | Unit | `packages/core/src/config/configDiscover.spec.ts` | Exists |
| `configCacheClear` — clears cache safely | Unit | `packages/core/src/config/configDiscover.spec.ts` | Exists |
| `defineConfig` — returns input unchanged (type helper) | Unit | `packages/core/src/config/configDiscover.spec.ts` | Exists |

#### Tree Check Adapter (`treeCheckAdapter.ts`)

| Function | Layer | Test File | Status |
|----------|-------|-----------|--------|
| `violationToLintDiagnostic` — maps fields with default severity | Unit | `packages/core/src/adapter/treeCheckAdapter.spec.ts` | Exists |
| `violationToLintDiagnostic` — custom severity | Unit | `packages/core/src/adapter/treeCheckAdapter.spec.ts` | Exists |
| `violationToLintDiagnostic` — passes through fix data | Unit | `packages/core/src/adapter/treeCheckAdapter.spec.ts` | Exists |
| `violationsToLintDiagnostics` — empty array | Unit | `packages/core/src/adapter/treeCheckAdapter.spec.ts` | Exists |
| `violationsToLintDiagnostics` — maps multiple violations | Unit | `packages/core/src/adapter/treeCheckAdapter.spec.ts` | Exists |
| `violationsToLintDiagnostics` — applies custom severity to all | Unit | `packages/core/src/adapter/treeCheckAdapter.spec.ts` | Exists |

---

### 3.2 `@codepol/plugin`

#### Logger Tree Check Provider (`policyPluginLogger.ts`)

| Scenario | Layer | Test File | Status |
|----------|-------|-----------|--------|
| Detects missing logger in function declaration | Integration | `tests/treesitter.require-logger-enter-exit.spec.ts` | Exists |
| Detects missing logger in arrow function | Integration | `tests/treesitter.require-logger-enter-exit.spec.ts` | Exists |
| Skips already-instrumented functions | Integration | `tests/treesitter.require-logger-enter-exit.spec.ts` | Exists |
| Handles method definitions | Integration | `tests/treesitter.require-logger-enter-exit.spec.ts` | Exists |
| Handles function expressions | Integration | `tests/treesitter.require-logger-enter-exit.spec.ts` | Exists |
| Handles async functions | Integration | `tests/treesitter.require-logger-enter-exit.spec.ts` | Exists |
| Handles generator functions | Integration | `tests/treesitter.require-logger-enter-exit.spec.ts` | Exists |
| Empty function body | Integration | `tests/treesitter.require-logger-enter-exit.spec.ts` | Exists |

#### Logger ESLint Rule (`loggerLintProvider`)

| Scenario | Layer | Test File | Status |
|----------|-------|-----------|--------|
| Valid: already instrumented function | Integration | `tests/eslint.require-logger-enter-exit.spec.ts` | Exists |
| Valid: excluded file pattern | Integration | `tests/eslint.require-logger-enter-exit.spec.ts` | Exists |
| Invalid: block function + autofix | Integration | `tests/eslint.require-logger-enter-exit.spec.ts` | Exists |
| Invalid: arrow expression + autofix | Integration | `tests/eslint.require-logger-enter-exit.spec.ts` | Exists |
| Invalid: reuses existing import + autofix | Integration | `tests/eslint.require-logger-enter-exit.spec.ts` | Exists |
| Multiple functions in one file | Integration | `tests/eslint.require-logger-enter-exit.spec.ts` | Exists |
| Nested functions | Integration | `tests/eslint.require-logger-enter-exit.spec.ts` | Exists |
| Class methods | Integration | `tests/eslint.require-logger-enter-exit.spec.ts` | Exists |

#### Unused Exports Check (`unusedExportsCheck.ts`)

| Scenario | Layer | Test File | Status |
|----------|-------|-----------|--------|
| Identifies unused named exports | Integration | `packages/plugin/src/unusedExportsCheck.spec.ts` | Exists |
| Handles default exports (used) | Integration | `packages/plugin/src/unusedExportsCheck.spec.ts` | Exists |
| Reports unused default exports | Integration | `packages/plugin/src/unusedExportsCheck.spec.ts` | Exists |
| `ignoreEntryPoints` skips index.ts/main.ts | Integration | `packages/plugin/src/unusedExportsCheck.spec.ts` | Exists |
| No project index returns empty | Integration | `packages/plugin/src/unusedExportsCheck.spec.ts` | Exists |
| File with no exports returns empty | Integration | `packages/plugin/src/unusedExportsCheck.spec.ts` | Exists |
| All exports used returns empty | Integration | `packages/plugin/src/unusedExportsCheck.spec.ts` | Exists |
| Unused classes | Integration | `packages/plugin/src/unusedExportsCheck.spec.ts` | Exists |
| Unused type aliases | Integration | `packages/plugin/src/unusedExportsCheck.spec.ts` | Exists |
| Unused interfaces | Integration | `packages/plugin/src/unusedExportsCheck.spec.ts` | Exists |
| Unused enums | Integration | `packages/plugin/src/unusedExportsCheck.spec.ts` | Exists |
| Mixed default and named | Integration | `packages/plugin/src/unusedExportsCheck.spec.ts` | Exists |
| Export clause (`export { a, b }`) | Integration | `packages/plugin/src/unusedExportsCheck.spec.ts` | Exists |
| Abstract classes | Integration | `packages/plugin/src/unusedExportsCheck.spec.ts` | Exists |
| Namespaces | Integration | `packages/plugin/src/unusedExportsCheck.spec.ts` | Exists |
| Default class/function exports | Integration | `packages/plugin/src/unusedExportsCheck.spec.ts` | Exists |
| Generator functions | Integration | `packages/plugin/src/unusedExportsCheck.spec.ts` | Exists |
| Namespace imports (`import * as`) | Integration | `packages/plugin/src/unusedExportsCheck.spec.ts` | Exists |
| Aliased imports (`import { a as b }`) | Integration | `packages/plugin/src/unusedExportsCheck.spec.ts` | Exists |
| Multiple consumers | Integration | `packages/plugin/src/unusedExportsCheck.spec.ts` | Exists |
| Directory index resolution | Integration | `packages/plugin/src/unusedExportsCheck.spec.ts` | Exists |
| Explicit `.ts` extension in import | Integration | `packages/plugin/src/unusedExportsCheck.spec.ts` | Exists |
| Incremental: add consumer | Integration | `packages/plugin/src/unusedExportsCheck.spec.ts` | Exists |
| Incremental: remove consumer | Integration | `packages/plugin/src/unusedExportsCheck.spec.ts` | Exists |
| Incremental: rename export | Integration | `packages/plugin/src/unusedExportsCheck.spec.ts` | Exists |
| Revision-based change detection | Integration | `packages/plugin/src/unusedExportsCheck.spec.ts` | Exists |

---

### 3.3 `@codepol/eslint-plugin`

| Function / Scenario | Layer | Test File | Status |
|---------------------|-------|-----------|--------|
| `eslintPluginCreate` — assembles rules from `lintProviders` | Unit | `packages/eslint-plugin/src/eslintPluginCreate.spec.ts` | Exists |
| `eslintPluginCreate` — adapts `treeCheckProvider`-only rules | Unit | `packages/eslint-plugin/src/eslintPluginCreate.spec.ts` | Exists |
| `eslintPluginCreate` — handles CJS/ESM interop (`default` export) | Unit | `packages/eslint-plugin/src/eslintPluginCreate.spec.ts` | Exists |
| `eslintPluginCreate` — handles `{ pluginRules: [...] }` format | Unit | `packages/eslint-plugin/src/eslintPluginCreate.spec.ts` | Exists |
| `eslintPluginCreate` — skips non-eslint platforms | Unit | `packages/eslint-plugin/src/eslintPluginCreate.spec.ts` | Exists |
| `eslintPluginCreate` — does not auto-adapt when eslint lintProvider exists | Unit | `packages/eslint-plugin/src/eslintPluginCreate.spec.ts` | Exists |
| `eslintPluginCreate` — collects from multiple plugin rules | Unit | `packages/eslint-plugin/src/eslintPluginCreate.spec.ts` | Exists |
| `eslintPluginCreate` — throws for invalid input | Unit | `packages/eslint-plugin/src/eslintPluginCreate.spec.ts` | Exists |
| `eslintAdapter.adapt` — valid code passes | Integration | `tests/eslint.tree-check-adapter.spec.ts` | Exists |
| `eslintAdapter.adapt` — invalid code reports `treeCheckViolation` | Integration | `tests/eslint.tree-check-adapter.spec.ts` | Exists |
| `eslintAdapter.adapt` — excluded file skipped | Integration | `tests/eslint.tree-check-adapter.spec.ts` | Exists |
| `eslintAdapter.adapt` — custom severity | Integration | `tests/eslint.tree-check-adapter.spec.ts` | Exists |
| `eslintAdapter.platform` identifier | Unit | `tests/eslint.tree-check-adapter.spec.ts` | Exists |
| `policyCacheClear` / `providerInitStateClear` | Unit | `packages/eslint-plugin/src/eslintAdapter.spec.ts` | Exists |
| `projectIndexCacheClear` | Unit | `packages/eslint-plugin/src/eslintAdapter.spec.ts` | Exists |
| Adapter with `requiresProjectIndex: true` | Integration | `tests/eslint.unused-exports-adapter.spec.ts` | Exists |

---

### 3.4 `@codepol/esbuild-plugin`

`esbuild.build()` is called in-process as a library function, making these integration tests (not E2E).

| Scenario | Layer | Test File | Status |
|----------|-------|-----------|--------|
| Build fails when violations exist | Integration | `tests/esbuild.policy-plugin.spec.ts` | Exists |
| Build succeeds after fix | Integration | `tests/esbuild.policy-plugin.spec.ts` | Exists |
| `fix: true` applies autofixes | Integration | `tests/esbuild.policy-plugin.spec.ts` | Exists (esbuild plugin now generates `overrideConfig` from policy, enabling codepol ESLint rules) |
| Config auto-discovery (no `configPath`) | Integration | `tests/esbuild.policy-plugin.spec.ts` | Exists |
| No matching files — build passes | Integration | `tests/esbuild.policy-plugin.spec.ts` | Exists |
| Multiple rules — all checked | Integration | `tests/esbuild.policy-plugin.spec.ts` | Exists |

---

### 3.5 `@codepol/cli`

| Scenario | Layer | Test File | Status |
|----------|-------|-----------|--------|
| `--help` prints usage and exits 0 | E2E | `tests/e2e.cli.spec.ts` | Exists |
| `--version` prints version and exits 0 | E2E | `tests/e2e.cli.spec.ts` | Exists |
| `--check-plugins` validates config and exits | E2E | `tests/e2e.cli.spec.ts` | Exists |
| No violations — exits 0 | E2E | `tests/e2e.cli.spec.ts` | Exists |
| Violations present — exits non-zero | E2E | `tests/e2e.cli.spec.ts` | Exists |
| `--fix` applies fixes to disk | E2E | `tests/e2e.cli.spec.ts` | Exists (ESLint wiring fixed; config uses both ESLint and treesitter providers) |
| `--config <path>` uses explicit config | E2E | `tests/e2e.cli.spec.ts` | Exists |
| Config not found — exits with error | E2E | `tests/e2e.cli.spec.ts` | Exists |
| `--watch` mode starts and responds to changes | E2E | `tests/e2e.cli.spec.ts` | Skipped (complex async lifecycle — chokidar watcher with debounced re-runs) |

---

### 3.6 Policy Contract (`codepol.config.ts` validation)

| Scenario | Layer | Test File | Status |
|----------|-------|-----------|--------|
| Rule IDs are unique | Integration | `tests/policy.contract.spec.ts` | Exists |
| Every rule has at least one target glob | Integration | `tests/policy.contract.spec.ts` | Exists |
| Invalid config shapes (empty targets array) handled | Unit | `packages/core/src/policy/policyGet.spec.ts` | Exists |
| Unknown rule references rejected (partially valid list) | Unit | `packages/core/src/policy/policyGet.spec.ts` | Exists |
| Empty targets map — rule reference throws | Unit | `packages/core/src/policy/policyGet.spec.ts` | Exists |

---

## 4. Gap Analysis: Current State

### Summary

"Exists" means a test with `expect()` assertions. Logged-but-not-asserted entries count as missing.

| Category | Asserted | Missing | Coverage |
|----------|----------|---------|----------|
| Result utilities | 8 | 0 | 100% |
| Module resolver | 9 | 0 | 100% |
| IndexStore | 24 | 0 | 100% |
| Index builder | 54 | 0 | 100% |
| Index query (ProjectIndex) | 23 | 0 | 100% |
| Module graph | 19 | 0 | 100% |
| Type relations | 23 | 0 | 100% |
| Control flow graph | 37 | 0 | 100% |
| Policy loading | 7 | 0 | 100% |
| Policy tree check | 7 | 0 | 100% |
| Policy check runner | 5 | 0 | 100% |
| Parser/languages | 21 | 0 | 100% |
| Config discovery | 11 | 0 | 100% |
| Tree check adapter | 6 | 0 | 100% |
| Plugin: logger tree check | 8 | 0 | 100% |
| Plugin: logger ESLint rule | 8 | 0 | 100% |
| Plugin: unused exports | 26 | 0 | 100% |
| ESLint plugin | 16 | 0 | 100% |
| esbuild plugin | 6 | 0 | 100% |
| CLI | 9 | 1 | 90% |
| Policy contract | 5 | 0 | 100% |

### Priority order for closing gaps

Ordered by risk (silent corruption potential) and effort (lower effort = do it sooner).

| Priority | Category | Risk | Effort | Rationale | Status |
|----------|----------|------|--------|-----------|--------|
| 1 | moduleResolver | High | Small (9 tests, pure functions, temp dirs only) | Path resolution bugs silently break every cross-file feature. Has the most edge cases per line of code (extensions, aliases, index files, platform separators). Small module, easy to test exhaustively. | Done |
| 2 | IndexStore | High | Medium (14 tests, need test helper for `FileIndexDelta`) | In-memory data structure that all queries depend on. Bugs here corrupt symbols, references, and exports silently. Requires building a `testDeltaCreate` helper first, which pays for itself across all store and query tests. | Done |
| 3 | Result utilities | Low | Trivial (8 tests, ~30 min) | Low risk because the implementation is simple, but the tests validate the error-handling contract that every `Result`-returning function depends on. Quick win. | Done |
| 4 | ProjectIndex query methods | Medium | Small (10 tests, reuse IndexStore test helper) | Thin wrappers, but untested wrappers can silently drop filters or mismap fields. Once the IndexStore helper exists, these are fast to write. | Done |
| 5 | Index builder topologies | High | Large (17 new tests, each needs multi-file setups) | Cross-file resolution is the hardest feature. Circular imports, re-exports, star exports, diamond deps, missing files — these are the scenarios where bugs actually ship. | Done (topology tests in `cross-file-resolution.spec.ts`; symbol extraction, scopes, calls, async builder, incremental APIs, `adapterRegister` in `index.builder.spec.ts`. Re-export chain and star export symbols propagated into the export map via `exportMapAddReexportedSymbols`. Namespace import member resolution implemented via `memberRefsExtract` and namespace member resolution pass in `crossFileResolve`. `callersGet`/`calleesGet` working after symbol byteRange expanded to full declaration span and `callersGet` fixed to use file-scoped range containment.) |
| 6 | Policy loading | Medium | Small (6 tests, inline policy objects) | Glob matching and target resolution are used by every rule. Bugs here cause rules to silently skip files. | Done |
| 7 | Config discovery | Medium | Medium (6 tests, temp directories with config files) | Users hit config discovery issues first. Needs temp directory scaffolding but each test is straightforward. | Done (11 tests: discovery, precedence, walk-up, error paths, JS config loading async/sync, cache clear, defineConfig) |
| 7b | Tree check adapter | Low | Trivial (2 tests, pure functions) | Small module but 0% coverage. Pure mapper functions, quick to test exhaustively. | Done (6 tests: field mapping, severity, fix pass-through, array mapping) |
| 7c | Policy check output | Low | Trivial (1 test, pure function) | Output formatting was untested. Pure function, easy to verify. | Done (3 tests: empty, single, multi-file grouped output) |
| 7d | Policy tree check + check runner | Medium | Small (4 tests, temp dirs with real plugin) | `policyViolationsGetForFile` had no direct Ok-path test. `policyViolationsGetFromDir` exclude patterns untested. `policyCheck` full pipeline untested. Bugs in exclude filtering or pipeline wiring silently skip files. | Done (1 direct violation test in `core.plugins.spec.ts`, 2 exclude pattern tests in `treesitter.require-logger-enter-exit.spec.ts`, 2 pipeline tests in `core.policy-check.spec.ts`) |
| 7e | Logger ESLint rule completeness | Medium | Small (3 RuleTester cases) | Multiple functions, nested functions, and class methods were untested — the most common real-world patterns. ESLint fix-merging behavior for overlapping fixes was undocumented. | Done (3 invalid cases in `eslint.require-logger-enter-exit.spec.ts`: multiple functions, nested functions, class methods. Discovered: ESLint one-pass fix only instruments one function when import insertion causes range overlap; class methods produce 2 reports due to MethodDefinition + FunctionExpression dual visit.) |
| 8 | CLI E2E | Medium | Large (9 tests, subprocess spawning, file assertions) | User-facing surface. Requires building a test harness for subprocess execution. Most effort per test, but validates the entire pipeline. | Done (9 passing, 1 skipped: --fix now works after ESLint wiring fix and CLI provider collection fix; --watch still skipped due to complex async lifecycle. --config <path> tested with explicit config in subdirectory.) |
| 9 | eslintPluginCreate + adapter | Low | Small (3 tests, mock plugin objects) | Plugin assembly bugs would be caught by existing RuleTester tests. These unit tests add defense in depth. | Done (10 plugin tests + 6 adapter cache/state clearing tests + 4 requiresProjectIndex integration tests: CJS/ESM interop, lint provider assembly, treeCheck adaptation, multi-rule, invalid input, policyCacheClear, providerInitStateClear, projectIndexCacheClear. Adapter with `requiresProjectIndex: true` verified via `unusedExportsRule` in `eslint.unused-exports-adapter.spec.ts`.) |
| 10 | Parser/language registration | Low | Small (6 tests, but complicated by global state) | Edge cases (duplicate registration, unknown extensions) are unlikely in practice. The global singleton issue makes these tests tricky to isolate. | Done (18 unit tests in `parserLangs.spec.ts`: langAdd validation, error paths, duplicate/conflict handling, langsGet, wasmPathGet, langExists, langGetForFile. 4 integration tests in `parserInit.spec.ts`: init, parser lookup, error paths. Vitest file-level isolation avoids global state conflicts.) |
| 11 | esbuild plugin scenarios | Low | Medium (4 tests, each needs esbuild + temp project) | Existing tests cover the critical path. Additional scenarios (fix mode, auto-discovery) are nice-to-have. | Done (5 passing: auto-discovery, no-matching-files, multiple-rules, fix:true — esbuild plugin now loads plugins via `policyPluginsGet` and generates `overrideConfig` to enable codepol ESLint rules) |
| 12 | Type relations (Extends/Implements) | Medium | Medium (23 tests: 8 unit + 15 integration) | Class hierarchy analysis and interface compliance checking. New `TypeRelation` relation type with full stack: tree-sitter queries, adapter extraction, IndexStore storage, ProjectIndex API. Cross-file `resolvedTargetId` resolution via `crossFileResolve` Step 6. | Done (5 IndexStore unit tests, 3 ProjectIndex unit tests, 15 integration tests covering class extends, implements, multiple implements, interface extends, abstract class, generics, subTypesGet, empty results, multi-interface extends, cross-file extends/implements/re-export chain/aliased import/interface extends. `resolvedTargetId` fully resolved to exported symbols via `crossFileResolve` Step 6 and `relationUpdate` TypeRelation support in IndexStore.) |
| 13 | CommonJS require() + dynamic import() | Medium | Small (6 tests, query patterns only — adapter extraction already existed) | CommonJS `require()` is common in Node.js codebases and needed for mixed CJS/ESM projects. Dynamic `import()` specifier extraction enables module dependency awareness for lazy-loaded modules. | Done (5 require tests: whole-module, destructured, ESM interop, module graph inclusion, external package. 5 dynamic import tests: whole-module binding (`const mod = await import()`), destructured binding (`const { foo } = await import()`), member access resolution, external package, side-effect `ImportsRelation` specifier resolution. Dynamic import binding resolution via `import.dynamic_name`/`import.dynamic_source` query captures creates `ImportBindingRelation` with `isNamespace: true`; namespace member resolution resolves `mod.foo` accesses. `ImportsRelation.resolvedModulePath` set during `crossFileResolve` Step 7. Module graph integration: 3 tests for dynamic import edges, side-effect dynamic import edges, and static side-effect import edges via `ImportsRelation.resolvedModulePath`.) |
| 14 | Control Flow Graph (CFG) | Medium | Medium (45 tests: 8 unit + 37 integration) | Per-function control flow graph construction enabling cyclomatic complexity calculation, dead code detection, and reachability analysis. Full stack: `FlowNode`/`FlowEdge`/`FlowGraph` types in `indexTypes.ts`, AST-walking extraction in `cfgBuild.ts` with `LoopContext` threading for break/continue, `IndexStore` storage with `cfgByScope`/`cfgsByFile`, `ProjectIndex` API (`cfgGet`, `cyclomaticComplexityGet`). | Done (5 IndexStore unit tests, 3 ProjectIndex unit tests, 37 integration tests covering: empty function, sequential, if/else, ternary expressions (simple, expression statement, nested, cyclomatic complexity), while/for/do-while loops, for...in/for...of, return/throw, nested control flow, break/continue (with labeled break), switch/case/default (with fallthrough), try/catch/finally, arrow functions, multiple functions, cyclomatic complexity for all patterns. No remaining CFG gaps.) |

---

## 5. Conventions

### File naming

```
packages/<pkg>/src/<module>.spec.ts        — Unit tests (co-located with source)
tests/<feature>.spec.ts                    — Cross-package integration tests
tests/e2e.<feature>.spec.ts               — End-to-end tests
```

**Decision tree** -- when adding a test, follow this:

1. **Does the test exercise a single module in a single package?**
   Put the spec next to the source: `packages/<pkg>/src/<module>.spec.ts`.
   When you open the module, its tests are right there. When you delete the module, its tests delete with it.

2. **Does the test exercise multiple packages working together?**
   Put it in root `tests/<feature>.spec.ts`. The name describes the scenario, not the package.
   Examples: `cross-file-resolution.spec.ts`, `require-logger-enter-exit.spec.ts`.

3. **Does the test cross a process boundary (CLI subprocess, esbuild build)?**
   Put it in root `tests/e2e.<feature>.spec.ts`.
   Examples: `e2e.cli.spec.ts`, `e2e.esbuild.spec.ts`.

This means there is no ambiguity about placement. A module's tests live with the module. Cross-cutting tests live in `tests/`. The directory structure provides context, not filename prefixes.

### Describe block structure

```typescript
describe('<module or feature name>', () => {
  // Setup (beforeAll / beforeEach) at top

  describe('<sub-feature or function name>', () => {
    it('should <expected behavior> when <condition>', () => {
      // Arrange
      // Act
      // Assert
    });
  });
});
```

### Assertion style

- Use `expect(...).toBe(...)` for primitives
- Use `expect(...).toEqual(...)` for objects/arrays
- Use `expect(...).toContain(...)` for substring/array-member checks
- Prefer specific matchers over `.toBe(true)` — e.g., `expect(arr).toHaveLength(2)` not `expect(arr.length === 2).toBe(true)`
- For Result types: `expect('Ok' in result).toBe(true)` then `expect(result.Ok).toEqual(...)`, or equivalently `expect(isOk(result)).toBe(true)`

### Console output in tests

Avoid `console.log` in committed tests. Debug logging should use Vitest's `--reporter=verbose` flag, not inline prints. Existing tests with `console.log` should be cleaned up when next touched.

### Test isolation

- Each `it` block must be independent. No reliance on execution order within a `describe`.
- Shared state (temp directories, parser initialization) belongs in `beforeAll` at the narrowest enclosing `describe`.
- Always clean up temp files in `afterAll` or use `os.tmpdir()` (OS handles cleanup).

---

## 6. Fixtures Strategy

### Checked-in fixtures (`tests/fixtures/`)

```
tests/fixtures/
  ts/
    logger.mock.ts                          — Logger mock module (shared dependency)
    logger.already-instrumented.ts          — Function with logger enter/exit (valid)
    logger.missing-instrumentation.ts       — Function without logger (violation)
    logger.arrow-missing-instrumentation.ts — Arrow function without logger (violation)
```

**Naming convention:** `<rule>.<scenario>.ts`. The rule prefix groups related fixtures; the scenario describes the expected outcome. A developer seeing `logger.missing-instrumentation.ts` knows what rule it targets and what it represents without opening the file.

**When to use checked-in fixtures:**
- The fixture content is stable and worth reading as documentation
- Multiple tests share the same fixture
- The fixture represents a real-world pattern

**Versioning:** Fixtures are append-only. When a rule's behavior changes (e.g., it starts checking generator functions), add a new fixture (`logger.generator-missing.ts`) rather than modifying existing ones. Existing fixtures become regression anchors — if an old fixture starts failing, it means the rule changed behavior, which is a signal, not noise.

### Dynamic fixtures (temp directories)

Use `fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-test-'))` when:
- The test needs a specific multi-file layout (e.g., cross-file resolution topologies)
- The test modifies files during execution (e.g., incremental update tests)
- File content is generated from test parameters

Pattern:
```typescript
let testDir: string;

beforeAll(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-test-'));
});

afterAll(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});
```

### Test helpers

Unit tests for `IndexStore` and `ProjectIndex` need realistic `FileIndexDelta` objects without depending on tree-sitter. Provide a shared helper:

```typescript
// packages/core/src/index/testHelpers.ts (not exported from package, only used by co-located specs)
export function testDeltaCreate(opts: {
  file: string;
  symbols?: Array<{ name: string; kind: SymbolKind; flags?: number }>;
  scopes?: Array<{ kind: ScopeKind }>;
  references?: Array<{ name: string; resolvedSymbolId?: string }>;
  // ...
}): FileIndexDelta { ... }
```

This helper is the bridge between "use real parsers for integration" and "unit tests don't depend on tree-sitter." It should be created as priority #2 prerequisite (IndexStore tests).

---

## 7. Performance Benchmarks

### Goal

Detect performance regressions in indexing, cross-file resolution, and policy checking. Benchmarks are not correctness tests — they measure throughput and latency so regressions are caught before they compound.

### Benchmark files

> **Status:** All 3 benchmark files exist and run via `pnpm bench`.

Location: `*.bench.ts` files co-located with the module they benchmark (consistent with Vitest's bench convention).

```
packages/core/src/index/indexBuilder.bench.ts    — Indexing throughput        (Exists)
packages/core/src/index/indexQuery.bench.ts      — Query latency              (Exists)
packages/plugin/src/unusedExportsCheck.bench.ts  — Per-file check latency     (Exists)
```

A shared helper `tests/benchHelpers.ts` generates realistic multi-file TypeScript projects (functions, classes, imports, exports) in a temp directory. Each file imports from up to 3 earlier files, creating a topology with linear chains and fan-out.

Run separately from normal tests: `pnpm bench`

### What to benchmark

| Benchmark | What it measures | Bench File | Target |
|-----------|-----------------|------------|--------|
| Index 100 files | `projectIndexBuildSync` throughput | `indexBuilder.bench.ts` | TBD — run baseline first |
| Index 500 files | Scale behavior (should be ~linear) | `indexBuilder.bench.ts` | TBD |
| Index 100 files (no cross-file) | Indexing without resolution | `indexBuilder.bench.ts` | TBD |
| `symbolsGet()` (all, no filter) | Full symbol scan | `indexQuery.bench.ts` | TBD |
| `symbolsInFileGet(file)` | File-scoped query | `indexQuery.bench.ts` | TBD |
| `symbolsGetByName(name)` | Name lookup | `indexQuery.bench.ts` | TBD |
| `exportedSymbolsGet({ file })` | Export filter | `indexQuery.bench.ts` | TBD |
| `referencesGet(symbolId)` | Reference lookup | `indexQuery.bench.ts` | TBD |
| `callersGet(symbolId)` | Call graph traversal | `indexQuery.bench.ts` | TBD |
| `unusedExportsCheck` (single file, 100-file index) | Per-file check latency | `unusedExportsCheck.bench.ts` | TBD |

**Setting targets:** Run each benchmark 3 times on CI hardware, take the p95, and set the target at 2x that value. Record the baseline hardware and date. Revisit targets when CI hardware changes.

### Implementation

All benchmarks use Vitest's `bench()` function, which provides statistical analysis (iterations, min, max, p95) rather than a single `performance.now()` sample. Parsers are warmed up in `beforeAll` and temp directories are cleaned up in `afterAll`.

**Warm-up:** Tree-sitter WASM loading is a one-time cost. Always initialize parsers in `beforeAll` so the benchmark measures the operation, not the startup.

---

## 8. CI Integration

> **Status:** CI pipeline exists at `.github/workflows/test.yml`. Runs on pushes to `master` and PRs targeting `master`. Uses `pnpm/action-setup@v4` (reads `packageManager` field) and Node 22.

### Package scripts

Named scripts in the root `package.json` separate the three test layers for CI:

```jsonc
{
  "scripts": {
    "test": "pnpm build && vitest run --exclude '**/e2e.*.spec.ts'",
    "test:unit": "vitest run packages/",
    "test:integration": "vitest run tests/ --exclude '**/e2e.*.spec.ts'",
    "test:e2e": "vitest run tests/e2e.",
    "bench": "vitest bench"
  }
}
```

The default `pnpm test` builds first and runs all non-E2E tests (unit + integration). E2E tests are excluded via `--exclude` and run explicitly via `pnpm test:e2e`. The layer scripts use Vitest 4.x positional filter patterns to scope which files run.

### Pipeline stages

```
Build (shared artifact)
  pnpm install && pnpm build
  Uploads dist/ and WASM to artifact for downstream jobs.

Stage 1: Typecheck (parallel with stages 2-4)
  pnpm typecheck
  Catches type errors before any tests run.

Stage 2: Unit Tests (parallel with stages 1, 3-4)
  pnpm test:unit
  Co-located specs in packages/. No tree-sitter WASM, no cross-package wiring.
  Target: < 10 seconds.

Stage 3: Integration Tests (parallel with stages 1-2, 4)
  pnpm test:integration
  Cross-package specs in tests/. Real parsers, real files, esbuild builds.
  Target: < 60 seconds.

Stage 4: E2E Tests (parallel with stages 1-3)
  pnpm test:e2e
  CLI subprocess tests only.
  Target: < 120 seconds.

Stage 5: Benchmarks (main branch only, non-blocking)
  pnpm bench
  Records timings. continue-on-error: true so benchmark regressions don't block PRs.
```

Stages 1-4 run in parallel after the build job completes. Stage 5 only runs on `master` pushes.

### Coverage

Enable coverage in CI (not locally by default):

```bash
pnpm vitest run --coverage
```

**Thresholds:** TBD — set after running an initial coverage report on the current test suite. Aspirational targets once gaps are closed:

| Package | Aspirational Target |
|---------|---------------------|
| `@codepol/core` (result, moduleResolver, indexStore) | 90% |
| `@codepol/core` (indexBuilder, indexQuery) | 80% |
| `@codepol/core` (policy*, config*) | 80% |
| `@codepol/plugin` | 85% |
| `@codepol/eslint-plugin` | 75% |
| `@codepol/esbuild-plugin` | 70% |
| `@codepol/cli` | 70% |

### Coverage ratchet

"Coverage does not decrease on touched files" requires enforcement tooling. Options:
- **GitHub Actions:** Use `vitest-coverage-report` action to post coverage diffs on PRs
- **Manual:** Run `vitest --coverage` locally before pushing, compare with main branch
- **Vitest native:** Configure `coverage.thresholds` in vitest config once baseline is established

Until tooling is in place, the ratchet is advisory, not enforced.

### Required checks for PRs

- All unit, integration, and E2E tests pass
- No new TypeScript errors (`pnpm typecheck`)
- Coverage does not decrease on touched files (once ratchet tooling is configured)

---

## Appendix: Test File Inventory

### Pre-existing tests (before this test plan)

These tests existed in the repo before the test plan was written. They represent the organic test coverage that grew alongside features.

| File | Layer | What it tests |
|------|-------|---------------|
| `packages/plugin/src/unusedExportsCheck.spec.ts` | Unit | Unused exports check against ProjectIndex |
| `tests/policy.contract.spec.ts` | Integration | Real config: unique IDs, non-empty targets |
| `tests/core.plugins.spec.ts` | Integration | Plugin capability validation (mock plugins) |
| `tests/core.error-handling.spec.ts` | Integration | Error path for missing logger config |
| `tests/treesitter.require-logger-enter-exit.spec.ts` | Integration | Tree-sitter logger check against fixtures |
| `tests/eslint.require-logger-enter-exit.spec.ts` | Integration | ESLint logger rule + autofix via RuleTester |
| `tests/eslint.tree-check-adapter.spec.ts` | Integration | eslintAdapter.adapt() via RuleTester |
| `tests/index.cross-file-resolution.spec.ts` | Integration | Semantic index cross-file resolution |
| `tests/esbuild.policy-plugin.spec.ts` | Integration | esbuild build pass/fail with policy plugin |

### Recently added tests (gap-filling)

These were added as part of closing gaps identified in this plan.

| File | Layer | What it tests |
|------|-------|---------------|
| `packages/core/src/result/result.spec.ts` | Unit | Ok, Err, isOk, isErr, resultFrom, resultFromAsync |
| `packages/core/src/index/indexStore.spec.ts` | Unit | Store CRUD, queries, filters, export map, clear |
| `packages/core/src/index/moduleResolver.spec.ts` | Unit | Path resolution, extensions, aliases, index files |
| `packages/core/src/index/indexQuery.spec.ts` | Unit | ProjectIndex query methods: symbols, references, callers/callees, exports, scopes, importResolve, stats, capabilities |
| `packages/core/src/policy/policyGet.spec.ts` | Unit | Target resolution, glob matching, language matching, policyFileGetChecked, ruleMatchesGet, policy contract validation (unknown refs, empty targets map, empty targets array) |
| `tests/index.builder.spec.ts` | Integration | Symbol extraction (functions, classes, variables, types, interfaces, enums, enum members, async flag), scope tree construction, heuristic call detection, async builder, incremental APIs (updateFromSource, removeFiles, crossFileResolveForFile). Async flag detection and enum member extraction implemented in the TypeScript adapter; `abstract_class` and `generator` symbol kind mappings added as drive-by fixes. |
| `packages/core/src/adapter/treeCheckAdapter.spec.ts` | Unit | violationToLintDiagnostic (field mapping, severity, fix pass-through), violationsToLintDiagnostics (empty, multi-element, custom severity) |
| `packages/core/src/policy/policyCheck.spec.ts` | Unit | policyViolationsGetOutputPretty (empty, single violation, multi-file grouped output with relative paths) |
| `packages/core/src/config/configDiscover.spec.ts` | Unit/Integration | configFileDiscover (direct, walk-up, not found, precedence), configGet error path, configGetFromPath/Sync (JS loading, error paths), configCacheClear, defineConfig identity |
| `packages/eslint-plugin/src/eslintPluginCreate.spec.ts` | Unit | eslintPluginCreate: CJS/ESM interop (array, __esModule, default, pluginRules), lint provider rule assembly, treeCheckProvider auto-adaptation, platform filtering, multi-rule collection, invalid input rejection |
| `packages/eslint-plugin/src/eslintAdapter.spec.ts` | Unit | Cache/state clearing: policyCacheClear, providerInitStateClear, projectIndexCacheClear (smoke tests for singleton Map clearing) |
| `tests/esbuild.policy-plugin.spec.ts` (expanded) | Integration | Added: config auto-discovery, no matching files, multiple rules, fix:true (un-skipped — esbuild plugin now loads plugins via `policyPluginsGet` and generates `overrideConfig`). Temp dirs now symlink `node_modules` for module resolution. Existing: build fail/succeed with policy plugin |
| `packages/core/src/parser/parserLangs.spec.ts` | Unit | langAdd (register, normalize, default/custom wasmPath, error paths for empty langId, no extensions, wasmPath conflict, extension conflict, duplicate merge), langsGet, wasmPathGet, langExists, langGetForFile (known/unknown/no extension, case-insensitive, unloaded language) |
| `packages/core/src/parser/parserInit.spec.ts` | Integration | parserInit (successful init, idempotent), parserGetForFile (Ok for known extension, Err before init, Err for unknown extension) |
| `tests/treesitter.require-logger-enter-exit.spec.ts` (expanded) | Integration | Added: method definitions, function expressions, async functions, empty function body, generator functions, target-level exclude patterns, global policy-level exclude patterns. Existing: fixture-based function declaration / arrow function / already-instrumented check. Generator function support implemented by adding `generator_function_declaration` and `generator_function` node types to `functionsVisit`. |
| `tests/core.plugins.spec.ts` (expanded) | Integration | Added: `policyViolationsGetForFile` Ok path with real logger plugin (returns violations for uninstrumented function). Existing: Err paths for missing capability and wrong language |
| `tests/eslint.require-logger-enter-exit.spec.ts` (expanded) | Integration | Added: multiple functions in one file (2 errors, one-pass fix), nested functions (2 errors, inner fixed first), class methods (2 errors from dual MethodDefinition+FunctionExpression visit). Existing: block function, arrow expression, reuse import, valid instrumented, excluded file |
| `tests/core.policy-check.spec.ts` | Integration | `policyCheck` full pipeline: loads config from temp dir via jiti, finds matching files, returns tree violations. Error path: config not found returns Err |
| `tests/e2e.cli.spec.ts` (expanded) | E2E | CLI subprocess tests: --help, --version, --check-plugins, no violations (exit 0), violations present (exit 1), config not found (error), --config <path> with explicit config (exit 0 + violation detection), --fix applies ESLint fixes to disk (un-skipped — uses config with both ESLint and treesitter providers). 1 skipped: --watch (complex async lifecycle). Uses symlinked node_modules for module resolution. |
| `tests/index.builder.spec.ts` (expanded) | Integration | Added: `adapterRegister` — registers spy adapter for 'typescript', verifies factory and indexFile calls, validates spy delta in resulting index. Documents `languageIdFromFile` hardcoded switch as known gap for custom languages. Un-skipped: async flag detection (adapter now checks for `async` keyword child on declaration nodes), enum member extraction (symbols query now captures `enum_assignment` nodes as `enumMember` kind). Un-skipped: `callersGet`/`calleesGet` via ProjectIndex API — symbol `byteRange` expanded to full declaration span in `adapterCore.ts`; `callersGet` algorithm fixed to use file-scoped symbol range containment instead of scopeId-based lookup. |
| `tests/eslint.unused-exports-adapter.spec.ts` | Integration | ESLint adapter with `requiresProjectIndex: true`: adapts `unusedExportsRule`, builds ProjectIndex from multi-file temp dir, verifies unused exports detected via treeCheckViolation. Valid cases: all-exports-consumed file, consumer-only file. Invalid case: file with unused export. Exercises `getOrBuildProjectIndex`, `discoverIndexableFiles`, and cross-file import resolution through the ESLint adapter pipeline. |
| `tests/index.type-relations.spec.ts` (expanded) | Integration | Type relation extraction and query: class extends class, class implements interface (single/multiple), interface extends interface, abstract class extends + implements, generic type parameter, subTypesGet reverse lookup, empty results for no relations, interface extends multiple interfaces. Cross-file type relation resolution: extends, implements, re-export chain, aliased import, interface extends — all verify `resolvedTargetId` points to the actual exported symbol via `crossFileResolve` Step 6. 15 tests exercising full stack from tree-sitter extraction through ProjectIndex API. |
| `packages/core/src/index/testHelpers.ts` | — | Shared test helper for building `FileIndexDelta`, `SymbolRecord`, and `ScopeRecord` objects without tree-sitter. Extracted from duplicate helpers in `indexStore.spec.ts` and `indexQuery.spec.ts`. Exports: `byteRangeGet`, `scopeRecordNew`, `symbolRecordNew`, `fileIndexDeltaNew`. |
| `tests/index.cross-file-resolution.spec.ts` (expanded) | Integration | Un-skipped: re-export chain (consumer import traced through proxy to origin symbol via `exportMapAddReexportedSymbols`), star export expansion (imports from `export *` proxy mapped to origin symbols, references updated). TS export query extended with `export.reexport_name` and `export.reexport_source` captures for `export { foo } from "module"` patterns. Un-skipped: namespace import member resolution — `memberRefsExtract` creates dotted references for member expressions, `crossFileResolve` sets `resolvedModulePath` on namespace bindings and resolves dotted references against the namespace's module export map. Added: import alias test tightened to verify `importedName === 'originalName'` and local symbol named `'renamedFn'`. Added: export alias test (`export { foo as bar }`) verifying aliased export name and consumer resolution. Added: namespace re-export resolution (`export * as ns from './mod'`) — consumer named import converted to namespace binding, member accesses resolved to origin symbols. Added: chained namespace re-export (through star-export intermediary). Added: cross-file interface exports, type alias exports, enum exports (all verified working via `export.decl_name` capture). Added: re-exported interface through chain (resolvedExportId traces to origin symbol). Un-skipped: type-only named exports (`export type { Foo }` — tree-sitter produces identical `export_clause` structure; `Exported` flag now set by `exportsExtract`), anonymous default class export (synthetic symbol via AST walking), anonymous default function export (same mechanism). Added: CommonJS require() support — whole-module (`const mod = require('./module')`), destructured (`const { a, b } = require('./module')`), ESM interop, module graph inclusion, external package handling. Tree-sitter query patterns with `#eq?` predicate for `require` identifier; adapter extraction pre-existed in `adapterCore.ts`. Added: dynamic `import()` binding resolution — whole-module (`const mod = await import('./module')`) creates namespace binding, destructured (`const { foo } = await import('./module')`) creates named bindings, member access resolution via namespace pass, external package handling, `ImportsRelation` specifier resolution for side-effect imports. All 36 tests passing, 0 skipped. |
| `tests/index.module-graph.spec.ts` (expanded) | Integration | Module graph API: linear chain (importers/importees, dependency order, no cycles), circular imports (cycle detection, bidirectional edges), diamond dependency (no false cycles, correct ordering), isolated files (included in graph), external packages filtered out, unknown files return empty, multi-import deduplication. Entry point detection — linear chain (only root), diamond (only root), isolated files (both entry points), circular imports (no entry points), external-only imports (entry points). Dynamic import module graph integration — dynamic import with binding creates edges, side-effect dynamic import creates edges via `ImportsRelation.resolvedModulePath`, static side-effect import creates edges. 17 tests exercising `moduleImportersGet`, `moduleImporteesGet`, `moduleDependencyOrderGet`, `moduleCyclesGet`, `moduleEntryPointsGet` via `ProjectIndex`. |
| `packages/core/src/index/moduleGraph.ts` (expanded) | — | Module graph implementation: `moduleGraphBuild(store)` builds forward/reverse adjacency lists from both `ImportBindingRelation.resolvedModulePath` and `ImportsRelation.resolvedModulePath`. Topological sort (Kahn's algorithm), cycle detection (Tarjan's SCC), entry point detection (files with empty reverse adjacency). Lazily built, cached. Exported from `@codepol/core`. |
| `tests/benchHelpers.ts` | — | Shared benchmark helper for generating realistic multi-file TypeScript projects in a temp directory. Generates N files with exported functions, classes, types, interfaces, and cross-file imports. Used by all 3 benchmark files. Exports: `benchProjectGenerate`, `benchProjectCleanup`. |
| `packages/core/src/index/indexBuilder.bench.ts` | Bench | Indexing throughput: `projectIndexBuildSync` on 100 and 500 generated files, plus a variant without cross-file resolution. |
| `packages/core/src/index/indexQuery.bench.ts` | Bench | Query latency on a 100-file pre-built index: `symbolsGet`, `symbolsInFileGet`, `symbolsGetByName`, `exportedSymbolsGet`, `referencesGet`, `referencesInFileGet`, `callersGet`, `calleesGet`, `scopesInFileGet`, `importBindingsGet`, `fileExportsGet`, `statsGet`. |
| `packages/plugin/src/unusedExportsCheck.bench.ts` | Bench | Per-file `unusedExportsCheck` latency on a 100-file index. Benchmarks checking a middle file, first file (likely all used), and last file (likely unused exports). |
| `tests/index.cfg.spec.ts` | Integration | Control flow graph extraction: 37 tests covering empty function, sequential statements, if/else branching, ternary expressions (simple variable declaration, expression statement, nested with recursive branch processing, cyclomatic complexity single=2, ternary+if=3), while/for/do-while/for-in/for-of loops, return/throw termination, break/continue (nested, labeled), switch/case/default (fallthrough, all-return), try/catch/finally (with/without catch, with/without finally), nested control flow, cyclomatic complexity (linear=1, if/else=2, while+if=3, switch-3-cases=3, try/catch=2), arrow functions (block + expression body), multiple functions per file. 0 skipped. |
| `packages/core/src/adapters/treeSitter/cfgBuild.ts` | — | CFG construction module: `cfgsExtract(tree, file, scopes)` walks function body ASTs to build per-function control flow graphs. `LoopContext` type threaded through recursive processing for break/continue target resolution (including labeled break via parent chain). Handles: sequential flow, if/else branching (branch + merge nodes), ternary expressions (`ternaryExpressionFind` recursively scans statement subtrees; `ternaryProcess` models branch/merge with `ternaryBranchProcess` handling nested ternaries via `incomingEdgeLabel` propagation), while/for/do-while/for-in/for-of loops (loop node + back-edges), return/throw (edge to exit), break/continue (edge to loop merge/header), switch/case/default (multi-branch with fallthrough), try/catch/finally (conservative catch-always-reachable model), labeled statements. Uses edge-count tracking for branch label assignment. |

### Known gaps discovered during testing

#### Cross-file resolution gaps

- **Namespace imports** (`import * as X`): **Fixed.** `resolvedModulePath` is now set on namespace import bindings. Member accesses (`X.foo`) are resolved to the exporter's symbols via a two-part mechanism: (1) `memberRefsExtract` in `adapterCore.ts` creates `ReferencesRelation` entries with dotted names (e.g., `"utils.alpha"`) pointing to the namespace import symbol, and (2) a namespace member resolution pass in `crossFileResolve` maps these dotted references to the actual exported symbols using the namespace's module export map.
- **Named re-exports** (`export { x } from './y'`): **Fixed.** TS export query now captures `export.reexport_name` and `export.reexport_source`. `exportMapAddReexportedSymbols` in `indexBuilder.ts` follows `sourceModule` references in `ExportsRelation`, looks up the origin symbol ID, and adds it to the proxy file's export map. Consumer bindings trace through the proxy to the origin symbol.
- **Star exports** (`export * from './y'`): **Fixed.** `exportMapAddReexportedSymbols` copies all non-default symbol IDs from the source module's export map into the proxy file's export map. Handles chains (A star-exports from B which star-exports from C) via iterative propagation with a max iteration limit to prevent infinite loops from circular re-exports.
- **Import aliases** (`import { foo as bar }`): **Fixed.** `symbolsExtract()` now uses `declNode.childForFieldName('alias')` to detect aliased imports and use the alias as the local symbol name. `importBindingsExtract()` uses `bindingNameNode.parent?.childForFieldName('alias')` to distinguish the imported name (original exported name) from the local name (alias). `importedName` stores the original name for correct export map lookup; `localSymbolId` points to the alias-named symbol.
- **Export aliases** (`export { foo as bar }`): **Fixed.** `exportsExtract()` now uses `namedNode.parent?.childForFieldName('alias')` on the `export_specifier` node to detect aliased exports. The `exportedName` is the alias; the `symbolId` references the original symbol. Consumers import by the aliased name.
- **Namespace re-exports** (`export * as ns from './mod'`): **Fixed.** The tree-sitter query (`export.namespace_name`, `export.namespace_source`) was already in place; `exportsExtract()` in `adapterCore.ts` now processes these captures to create an `ExportsRelation` with `exportedName = ns`, `sourceModule`, `sourceName = '*'`. In `exportMapAddReexportedSymbols`, the namespace re-export is detected when `sourceName === '*'` and `exportedName !== '*'`, and a sentinel ID (`__ns_reexport:resolvedPath`) is placed in the export map. In `crossFileResolve`, when a consumer's named import resolves to a sentinel, the binding is converted to `isNamespace: true` with `resolvedModulePath` pointing to the source module. The existing namespace member resolution pass (Step 5) then resolves dotted member accesses (`ns.foo`) against the source module's export map. Chained namespace re-exports (through star-export intermediaries) work via `exportMapAddReexportedSymbols` iterative propagation.
- **CommonJS require()** (`const foo = require('./module')`): **Fixed.** Tree-sitter query patterns added to TypeScript `IMPORTS_QUERY` for both whole-module (`const mod = require("module")`) and destructured (`const { foo } = require("module")`) forms. Uses `#eq?` predicate to match only `require` function calls, avoiding false positives from other call expressions. The adapter extraction logic in `adapterCore.ts` (handling `import.require_name`, `import.require_source`, `import.require_binding` captures) was already implemented — only the query patterns were missing. Whole-module require creates an `ImportBindingRelation` with `isDefault: true`; destructured require creates named bindings. Cross-file resolution, module graph inclusion, and external package handling all work via the existing `ImportBindingRelation` pipeline.
- **Dynamic imports** (`import("module")`): **Fixed.** Full binding resolution implemented for `const mod = await import("./module")` and `const { foo } = await import("./module")`. Tree-sitter query patterns `import.dynamic_name`/`import.dynamic_source` (whole-module) and `import.dynamic_binding`/`import.dynamic_source` (destructured) added to `IMPORTS_QUERY`. Whole-module creates `ImportBindingRelation` with `isNamespace: true`; destructured creates named bindings. Cross-file resolution, namespace member resolution, and external package handling all work via the existing `ImportBindingRelation` pipeline. `ImportsRelation` specifiers (including bare `import("module")` and static side-effect `import "module"`) are resolved to file paths during `crossFileResolve` Step 7, with `resolvedModulePath` stored on the `ImportsRelation`. Module graph now includes edges from both `ImportBindingRelation` and resolved `ImportsRelation` entries, covering dynamic imports with and without bindings.

#### Cross-file interface/type/enum export resolution

- **Interface exports** (`export interface Foo { }`): **Verified working.** The tree-sitter export query captures `interface_declaration` via the `export.decl_name` pattern. `symbolsExtract` creates the symbol with `kind: 'interface'`, and `exportsExtract` creates the `ExportsRelation` via `findExportSymbol`. Cross-file import bindings resolve to the exported interface symbol. Tested in `tests/index.cross-file-resolution.spec.ts`.
- **Type alias exports** (`export type Status = 'ok' | 'err'`): **Verified working.** Same mechanism as interfaces — captured via `type_alias_declaration` in the export query. Supports generic type aliases (e.g., `Pair<A, B>`). Tested in `tests/index.cross-file-resolution.spec.ts`.
- **Enum exports** (`export enum Color { Red, Green, Blue }`): **Verified working.** Enum symbol extracted with `kind: 'enum'`; enum members extracted as `kind: 'enumMember'`. Cross-file import resolves to the enum symbol. Tested in `tests/index.cross-file-resolution.spec.ts`.
- **Re-exported interfaces through chains**: **Verified working.** An interface defined in file A, re-exported via `export { Base } from './a'` in file B, and imported in file C resolves correctly. `resolvedExportId` traces back to the origin file's interface symbol. Tested in `tests/index.cross-file-resolution.spec.ts`.
- **Type-only named exports** (`export type { Foo }`): **Fixed.** Investigation revealed the tree-sitter grammar produces an identical `export_clause` > `export_specifier` structure for both `export type { }` and `export { }`. The `type` keyword is just an extra unnamed child node of `export_statement` — no query change was needed. The fix was ensuring the `Exported` flag is set on symbols referenced by named export clauses (in `exportsExtract`), since the symbol declaration itself is not inside an `export_statement`. Tested in `tests/index.cross-file-resolution.spec.ts`.
- **Anonymous default exports** (`export default class { }`, `export default function() { }`): **Fixed.** Anonymous default class produces a `class` expression node (not `class_declaration`) and anonymous default function produces a `function_expression` node (not `function_declaration`). Neither has a `name` field, so tree-sitter query patterns can't capture them reliably. Fixed by adding AST walking in `exportsExtract`: after query-based processing, root-level `export_statement` nodes with a `default` keyword and no corresponding export relation are detected. For each, a synthetic `SymbolRecord` (name `"default"`, kind `"class"` or `"function"`) is created and an `ExportsRelation` with `isDefault: true` is emitted. Synthetic symbols are merged into the delta by `indexFileWithTreeSitter`. Tested in `tests/index.cross-file-resolution.spec.ts`.

#### Module graph

- **Module graph API**: **Implemented.** `ModuleGraph` type and `moduleGraphBuild(store)` in `packages/core/src/index/moduleGraph.ts`. Builds forward/reverse adjacency lists from both resolved `ImportBindingRelation.resolvedModulePath` and `ImportsRelation.resolvedModulePath` data. This means side-effect imports (`import "./module"`), dynamic imports without bindings (`await import("./module")`), and dynamic imports with bindings all create module graph edges. External packages (unresolved paths) are excluded. Exposed on `ProjectIndex` as `moduleImportersGet()`, `moduleImporteesGet()`, `moduleDependencyOrderGet()`, `moduleCyclesGet()`, `moduleEntryPointsGet()`. Graph is lazily built and cached. Topological sort uses Kahn's algorithm on the reversed dependency graph. Cycle detection uses Tarjan's SCC algorithm. Entry point detection implemented via `moduleGraphEntryPointsGet()` — files with no importers in the indexed set, sorted alphabetically.

#### Cross-file type relation resolution

- **Cross-file `resolvedTargetId` resolution**: **Fixed.** When a class extends/implements an imported symbol, `resolvedTargetId` previously pointed to the local import binding symbol rather than the actual exported symbol from the source module. Fixed by adding Step 6 to `crossFileResolve` in `indexBuilder.ts`: iterates all TypeRelation entries per file, checks if `resolvedTargetId` points to an import binding symbol (via `importResolutionMap`), and replaces it with the resolved export symbol ID. `relationUpdate` in `indexStore.ts` extended with a `TypeRelation` branch to properly update `typeRelationsBySymbol`, `typeRelationsByTargetName`, and `typeRelationsByFile` indexes. Works with re-export chains and aliased imports because the `importResolutionMap` already traces through re-exports to origin symbols.

#### Adapter extraction gaps

- **callersGet/calleesGet accuracy**: **Fixed.** Symbol `byteRange` now uses the full declaration span (the `declNode` range from tree-sitter, e.g., the entire `function foo() { ... }`) instead of just the name span. This enables reliable scope-based containment checks in `calleesGet`. Additionally, `callersGet` was fixed to search for function symbols by file and byte range containment instead of by `scopeId`, because `findInnermostScope` places function symbols inside their own function scope rather than the parent scope where the declaration lives.

#### ESLint logger rule: fix merging and dual-visit behavior

- **One-pass fix limitation for multiple functions**: When multiple functions in one file are uninstrumented, each ESLint report includes both an import insertion (at file position 0) and a block body replacement. The import insertion causes all fix effective ranges to start at 0, making them overlap. ESLint's one-pass fixer applies only the first non-overlapping fix. Result: only one function is instrumented per pass. Repeated lint+fix cycles would eventually instrument all functions, but a single `eslint --fix` run may leave some unfixed.
- **Nested function fix ordering**: For nested functions, the inner function's fix has a smaller effective range and is applied first by the fixer. The outer function remains uninstrumented after one pass.
- **MethodDefinition + FunctionExpression dual visit**: **Fixed.** The `FunctionExpression` visitor now skips when `node.parent?.type === TSESTree.AST_NODE_TYPES.MethodDefinition`, since the `MethodDefinition` handler already processes the method body. Class methods now produce exactly 1 report instead of 2.

#### esbuild plugin ESLint rule wiring gap

- **`fix: true` does not exercise ESLint codepol rules**: **Fixed.** The esbuild plugin now loads plugins from the policy via `policyPluginsGet`, collects ESLint lint providers filtered by policy rules (skipping unconfigured rules), and generates an `overrideConfig` with the matching rules enabled. The `plugins` option still injects the codepol ESLint plugin, while `overrideConfig` activates the specific rules. `fix: true` now works end-to-end: ESLint applies autofix, writes the fixed file to disk, then tree-sitter re-reads the fixed file and finds no violations.

#### CLI ESLint provider collection gap

- **Unfiltered ESLint providers from unconfigured plugin rules**: **Fixed.** Added `if (!matchingRule) continue;` guard in the CLI's provider collection loop (`apps/cli/src/index.ts`). ESLint providers are now only collected for plugin rules that have a matching entry in the policy's `rules` array. The same guard is applied in the esbuild plugin's provider collection.

#### adapterRegister: custom language gap

- **`languageIdFromFile` hardcoded switch**: **Fixed.** `languageIdFromFile` now consults the `langAdd` registry (via new `langIdGetForFile` function in `parserLangs.ts`) before falling back to the hardcoded switch. Custom languages registered via `langAdd({ langId: 'custom', fileExtensions: ['.custom'] })` + `adapterRegister('custom', factory)` will be routed to their adapter. The hardcoded switch remains as a fallback for extensions like `.js`/`.jsx` that may not be explicitly registered via `langAdd`.

#### ESLint rule CWD mismatch in esbuild plugin context

- **`policyFileGetMatch` used `process.cwd()` for path relativization**: **Fixed.** The `policyFileGetMatch` function in the ESLint logger rule (`packages/plugin/src/index.ts`) previously used `process.cwd()` to relativize absolute file paths for glob matching. When ESLint runs via the esbuild plugin (where the ESLint CWD differs from the process CWD), this caused target file patterns to not match. Fixed by accepting an optional `cwd` parameter and using `context.cwd` from the ESLint rule context.

#### IndexStore `referencesByFile` stale data after `relationUpdate`

- **`relationUpdate` did not update `referencesByFile` index for References**: **Fixed.** When `crossFileResolve` updated a `ReferencesRelation` via `relationUpdate`, the `referencesBySymbol` index was correctly updated but `referencesByFile` retained the old object reference. This caused `referencesInFileGet()` to return stale data where dotted references (e.g., `utils.alpha`) still showed the namespace import symbol instead of the resolved exported symbol. Fixed by adding a `referencesByFile` update in `relationUpdate` that finds and replaces the old relation object in the file's reference array. Discovered while implementing namespace re-export resolution.

#### Anonymous default export extraction

- **Anonymous default class/function exports** (`export default class {}`, `export default function() {}`): **Fixed.** Tree-sitter produces `class` (expression, not `class_declaration`) and `function_expression` (not `function_declaration`) nodes for anonymous defaults — both lack a `name` field, so the export query patterns can't capture them. Fixed by adding an AST walking pass at the end of `exportsExtract` in `adapterCore.ts`: after query-based processing, root-level `export_statement` nodes with a `default` keyword and no corresponding export relation are detected. For each, a synthetic `SymbolRecord` (name `"default"`, appropriate `kind`, `SymbolFlags.Exported`) is created alongside an `ExportsRelation` with `isDefault: true`. The return type of `exportsExtract` was changed to `ExportsExtractResult` (containing `exports` and `syntheticSymbols`), and `indexFileWithTreeSitter` merges synthetic symbols into the delta. Cross-file default import resolution works: the consumer's `isDefault` import binding resolves to `'default'` in the export map, finding the synthetic symbol's ID.

#### Type-only named export flag

- **`Exported` flag not set for named export clauses**: **Fixed.** Symbols referenced by `export { foo }` or `export type { Foo }` (where the declaration is separate from the export statement) did not have `SymbolFlags.Exported` set, because the flag was only applied when the declaration's ancestor chain includes `export_statement`. Fixed by setting `symbol.flags |= SymbolFlags.Exported` in the named export handler within `exportsExtract`. This also fixes `exportedSymbolsGet()` which filters by the `Exported` flag. The tree-sitter grammar produces an identical `export_clause` > `export_specifier` structure for both `export type { }` and `export { }` — the `type` keyword is just an extra unnamed child node — so no query change was needed.

#### Pre-existing build error in eslint-plugin

- **`ByteRange` type mismatch in `eslintAdapter.ts`**: **Fixed.** `fixer.replaceTextRange` expects `readonly [number, number]` but was receiving a `ByteRange` object (`{ start, end }`). Fixed by converting to `[byteRange.start, byteRange.end]` tuple.

### Planned tests (not yet created)

No remaining planned test files. All identified gaps either have tests (possibly skipped) or are documented as known implementation gaps above. The shared `testHelpers.ts` has been created and is in use by `indexStore.spec.ts` and `indexQuery.spec.ts`.

Remaining skipped tests (1 total across 1 file):
- `tests/e2e.cli.spec.ts`: `--watch` (complex async lifecycle — chokidar watcher with debounced re-runs)

No remaining future work items — CFG Phase 2 (switch/case, break/continue, try/catch/finally, for...in/for...of) and Phase 3 (ternary expressions with nested support) are complete.

### Fixtures (current)

| Fixture | Suggested rename | Purpose |
|---------|-----------------|---------|
| `tests/fixtures/ts/missing.ts` | `logger.missing-instrumentation.ts` | Function without logger (violation) |
| `tests/fixtures/ts/arrow.ts` | `logger.arrow-missing-instrumentation.ts` | Arrow function without logger (violation) |
| `tests/fixtures/ts/already.ts` | `logger.already-instrumented.ts` | Already-instrumented function (valid) |
| `tests/fixtures/ts/logger.ts` | `logger.mock.ts` | Logger mock module |
