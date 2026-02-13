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
| `getCallers` / `getCallees` via ProjectIndex API | Integration | `tests/index.builder.spec.ts` | Skipped (symbol ranges need full declaration span) |
| `crossFileResolve` — named imports | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists |
| `crossFileResolve` — default imports | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists |
| `crossFileResolve` — namespace imports | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists (binding indexed; module path not resolved — known gap) |
| `crossFileResolve` — aliased imports | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists |
| `crossFileResolve` — re-exports (A re-exports from B) | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists (re-export chain followed via `exportMapAddReexportedSymbols`) |
| `crossFileResolve` — circular imports (A imports B, B imports A) | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists |
| `crossFileResolve` — diamond dependency (A imports B+C, both import D) | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists |
| `crossFileResolve` — star exports (`export *`) | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists (star exports expanded via `exportMapAddReexportedSymbols`; imports traced through proxy) |
| `crossFileResolve` — missing file (import to non-existent module) | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists |
| File with parse errors — graceful skip | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists |
| Empty file — no crash | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists |

#### Index Query / ProjectIndex (`index/indexQuery.ts`)

Methods that are thin wrappers over `IndexStore` can be unit-tested with a pre-populated store (no parser). Methods that depend on cross-file resolution or real parse output need integration tests.

| Method | Layer | Test File | Status |
|--------|-------|-----------|--------|
| `getSymbols()` — all symbols | Unit | `packages/core/src/index/indexQuery.spec.ts` | Exists |
| `getSymbol(id)` | Unit | `packages/core/src/index/indexQuery.spec.ts` | Exists |
| `getSymbolsInFile(file)` | Unit | `packages/core/src/index/indexQuery.spec.ts` | Exists |
| `getSymbolsByName(name)` | Unit | `packages/core/src/index/indexQuery.spec.ts` | Exists |
| `getExportedSymbols({ file })` | Unit | `packages/core/src/index/indexQuery.spec.ts` | Exists |
| `getReferences(symbolId)` | Unit | `packages/core/src/index/indexQuery.spec.ts` | Exists (asserted in cross-file test) |
| `getReferencesInFile(file)` | Unit | `packages/core/src/index/indexQuery.spec.ts` | Exists |
| `getCallers(symbolId)` | Unit | `packages/core/src/index/indexQuery.spec.ts` | Exists |
| `getCallees(symbolId)` | Unit | `packages/core/src/index/indexQuery.spec.ts` | Exists |
| `getScope(scopeId)` | Unit | `packages/core/src/index/indexQuery.spec.ts` | Exists (used indirectly in cross-file test) |
| `getScopesInFile(file)` | Unit | `packages/core/src/index/indexQuery.spec.ts` | Exists |
| `getImportBindings(file)` | Unit | `packages/core/src/index/indexQuery.spec.ts` | Exists (asserted in cross-file test) |
| `getFileExports(file)` | Unit | `packages/core/src/index/indexQuery.spec.ts` | Exists (asserted in cross-file test) |
| `resolveImport(fromFile, specifier, name)` | Unit | `packages/core/src/index/indexQuery.spec.ts` | Exists |
| `getStats()` | Unit | `packages/core/src/index/indexQuery.spec.ts` | Exists |
| `capabilities` | Unit | `packages/core/src/index/indexQuery.spec.ts` | Exists |

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
| `fix: true` applies autofixes | Integration | `tests/esbuild.policy-plugin.spec.ts` | Skipped (esbuild plugin does not wire codepol ESLint rules into flat config — ESLint fix pipeline not exercised) |
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
| `--fix` applies fixes to disk | E2E | `tests/e2e.cli.spec.ts` | Skipped (same ESLint rule wiring gap as esbuild plugin fix:true) |
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
| IndexStore | 14 | 0 | 100% |
| Index builder | 33 | 0 | 100% |
| Index query (ProjectIndex) | 16 | 0 | 100% |
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
| esbuild plugin | 5 | 1 | 83% |
| CLI | 8 | 2 | 80% |
| Policy contract | 5 | 0 | 100% |

### Priority order for closing gaps

Ordered by risk (silent corruption potential) and effort (lower effort = do it sooner).

| Priority | Category | Risk | Effort | Rationale | Status |
|----------|----------|------|--------|-----------|--------|
| 1 | moduleResolver | High | Small (9 tests, pure functions, temp dirs only) | Path resolution bugs silently break every cross-file feature. Has the most edge cases per line of code (extensions, aliases, index files, platform separators). Small module, easy to test exhaustively. | Done |
| 2 | IndexStore | High | Medium (14 tests, need test helper for `FileIndexDelta`) | In-memory data structure that all queries depend on. Bugs here corrupt symbols, references, and exports silently. Requires building a `testDeltaCreate` helper first, which pays for itself across all store and query tests. | Done |
| 3 | Result utilities | Low | Trivial (8 tests, ~30 min) | Low risk because the implementation is simple, but the tests validate the error-handling contract that every `Result`-returning function depends on. Quick win. | Done |
| 4 | ProjectIndex query methods | Medium | Small (10 tests, reuse IndexStore test helper) | Thin wrappers, but untested wrappers can silently drop filters or mismap fields. Once the IndexStore helper exists, these are fast to write. | Done |
| 5 | Index builder topologies | High | Large (17 new tests, each needs multi-file setups) | Cross-file resolution is the hardest feature. Circular imports, re-exports, star exports, diamond deps, missing files — these are the scenarios where bugs actually ship. | Done (topology tests in `cross-file-resolution.spec.ts`; symbol extraction, scopes, calls, async builder, incremental APIs, `adapterRegister` in `index.builder.spec.ts`. Re-export chain and star export symbols propagated into the export map via `exportMapAddReexportedSymbols` — 2 previously skipped tests now pass. Namespace import member resolution remains skipped.) |
| 6 | Policy loading | Medium | Small (6 tests, inline policy objects) | Glob matching and target resolution are used by every rule. Bugs here cause rules to silently skip files. | Done |
| 7 | Config discovery | Medium | Medium (6 tests, temp directories with config files) | Users hit config discovery issues first. Needs temp directory scaffolding but each test is straightforward. | Done (11 tests: discovery, precedence, walk-up, error paths, JS config loading async/sync, cache clear, defineConfig) |
| 7b | Tree check adapter | Low | Trivial (2 tests, pure functions) | Small module but 0% coverage. Pure mapper functions, quick to test exhaustively. | Done (6 tests: field mapping, severity, fix pass-through, array mapping) |
| 7c | Policy check output | Low | Trivial (1 test, pure function) | Output formatting was untested. Pure function, easy to verify. | Done (3 tests: empty, single, multi-file grouped output) |
| 7d | Policy tree check + check runner | Medium | Small (4 tests, temp dirs with real plugin) | `policyViolationsGetForFile` had no direct Ok-path test. `policyViolationsGetFromDir` exclude patterns untested. `policyCheck` full pipeline untested. Bugs in exclude filtering or pipeline wiring silently skip files. | Done (1 direct violation test in `core.plugins.spec.ts`, 2 exclude pattern tests in `treesitter.require-logger-enter-exit.spec.ts`, 2 pipeline tests in `core.policy-check.spec.ts`) |
| 7e | Logger ESLint rule completeness | Medium | Small (3 RuleTester cases) | Multiple functions, nested functions, and class methods were untested — the most common real-world patterns. ESLint fix-merging behavior for overlapping fixes was undocumented. | Done (3 invalid cases in `eslint.require-logger-enter-exit.spec.ts`: multiple functions, nested functions, class methods. Discovered: ESLint one-pass fix only instruments one function when import insertion causes range overlap; class methods produce 2 reports due to MethodDefinition + FunctionExpression dual visit.) |
| 8 | CLI E2E | Medium | Large (9 tests, subprocess spawning, file assertions) | User-facing surface. Requires building a test harness for subprocess execution. Most effort per test, but validates the entire pipeline. | Partial (8 passing, 2 skipped: --fix blocked by ESLint rule wiring gap, --watch complex async lifecycle. --config <path> now tested with explicit config in subdirectory.) |
| 9 | eslintPluginCreate + adapter | Low | Small (3 tests, mock plugin objects) | Plugin assembly bugs would be caught by existing RuleTester tests. These unit tests add defense in depth. | Done (10 plugin tests + 6 adapter cache/state clearing tests + 4 requiresProjectIndex integration tests: CJS/ESM interop, lint provider assembly, treeCheck adaptation, multi-rule, invalid input, policyCacheClear, providerInitStateClear, projectIndexCacheClear. Adapter with `requiresProjectIndex: true` verified via `unusedExportsRule` in `eslint.unused-exports-adapter.spec.ts`.) |
| 10 | Parser/language registration | Low | Small (6 tests, but complicated by global state) | Edge cases (duplicate registration, unknown extensions) are unlikely in practice. The global singleton issue makes these tests tricky to isolate. | Done (18 unit tests in `parserLangs.spec.ts`: langAdd validation, error paths, duplicate/conflict handling, langsGet, wasmPathGet, langExists, langGetForFile. 4 integration tests in `parserInit.spec.ts`: init, parser lookup, error paths. Vitest file-level isolation avoids global state conflicts.) |
| 11 | esbuild plugin scenarios | Low | Medium (4 tests, each needs esbuild + temp project) | Existing tests cover the critical path. Additional scenarios (fix mode, auto-discovery) are nice-to-have. | Done (3 passing + 1 skipped: auto-discovery, no-matching-files, multiple-rules pass; fix:true skipped — esbuild plugin does not wire codepol ESLint rules into flat config) |

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

Location: `*.bench.ts` files co-located with the module they benchmark (consistent with Vitest's bench convention).

```
packages/core/src/index/indexBuilder.bench.ts    — Indexing throughput
packages/core/src/index/indexQuery.bench.ts      — Query latency
packages/plugin/src/unusedExportsCheck.bench.ts  — Per-file check latency
```

Run separately from normal tests: `pnpm vitest bench`

### What to benchmark

| Benchmark | What it measures | Target |
|-----------|-----------------|--------|
| Index 100 files | `projectIndexBuildSync` throughput | TBD — run baseline first |
| Index 500 files | Scale behavior (should be ~linear) | TBD |
| Cross-file resolve (100 files, 50 imports each) | Resolution throughput | TBD |
| `unusedExportsCheck` on 100-file index | Per-file check latency | TBD |
| `policyViolationsGetFromDir` (100 files) | Full pipeline | TBD |

**Setting targets:** Run each benchmark 3 times on CI hardware, take the p95, and set the target at 2x that value. Record the baseline hardware and date. Revisit targets when CI hardware changes.

### Implementation

Use Vitest's `bench()` function, which provides statistical analysis (iterations, min, max, p95) rather than a single `performance.now()` sample:

```typescript
import { bench, describe, beforeAll } from 'vitest';

describe('indexing throughput', () => {
  let files: string[];
  let testDir: string;

  beforeAll(async () => {
    // Warm up: initialize parser and WASM once so bench measures indexing, not loading
    await parserInit();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-bench-'));
    files = generateTestFiles(100, testDir);
  });

  bench('index 100 files', () => {
    projectIndexBuildSync({ files, dir: testDir });
  });
});
```

**Warm-up:** Tree-sitter WASM loading is a one-time cost. Always initialize parsers in `beforeAll` so the benchmark measures the operation, not the startup.

---

## 8. CI Integration

> **Status:** No CI pipeline exists yet. This section defines the target design. Implementation requires adding a CI config (e.g., `.github/workflows/test.yml`) and the `package.json` scripts below.

### Package scripts

Define named scripts in the root `package.json` instead of relying on shell glob expansion (which varies between bash versions and CI environments):

```jsonc
{
  "scripts": {
    "test:unit": "vitest run --config vitest.config.ts --project unit",
    "test:integration": "vitest run --config vitest.config.ts --project integration",
    "test:e2e": "vitest run --config vitest.config.ts --project e2e",
    "test": "vitest run",
    "bench": "vitest bench"
  }
}
```

This requires Vitest workspace projects (or separate configs) to separate the three layers. An alternative is a single config with `include` patterns:

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    include: ['packages/**/*.spec.ts', 'tests/**/*.spec.ts'],
    exclude: ['tests/e2e.*.spec.ts'], // excluded from default `pnpm test` for speed
  },
});
```

With E2E run explicitly: `pnpm vitest run --include 'tests/e2e.*.spec.ts'`

### Pipeline stages

```
Stage 1: Typecheck
  pnpm typecheck
  Catches type errors before any tests run.

Stage 2: Unit Tests
  pnpm test:unit
  Co-located specs in packages/. No tree-sitter WASM, no cross-package wiring.
  Target: < 10 seconds.

Stage 3: Integration Tests
  pnpm test:integration
  Cross-package specs in tests/. Real parsers, real files, esbuild builds.
  Target: < 60 seconds.

Stage 4: E2E Tests
  pnpm test:e2e
  CLI subprocess tests only.
  Target: < 120 seconds.

Stage 5: Benchmarks (main branch only)
  pnpm bench
  Records timings. Fails if any benchmark exceeds 2x its baseline target.
```

Stages 2-4 can run in parallel in CI since they test disjoint file sets.

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
| `packages/core/src/index/indexQuery.spec.ts` | Unit | ProjectIndex query methods: symbols, references, callers/callees, exports, scopes, resolveImport, stats, capabilities |
| `packages/core/src/policy/policyGet.spec.ts` | Unit | Target resolution, glob matching, language matching, policyFileGetChecked, ruleMatchesGet, policy contract validation (unknown refs, empty targets map, empty targets array) |
| `tests/index.builder.spec.ts` | Integration | Symbol extraction (functions, classes, variables, types, interfaces, enums, enum members, async flag), scope tree construction, heuristic call detection, async builder, incremental APIs (updateFromSource, removeFiles, crossFileResolveForFile). Async flag detection and enum member extraction implemented in the TypeScript adapter; `abstract_class` and `generator` symbol kind mappings added as drive-by fixes. |
| `packages/core/src/adapter/treeCheckAdapter.spec.ts` | Unit | violationToLintDiagnostic (field mapping, severity, fix pass-through), violationsToLintDiagnostics (empty, multi-element, custom severity) |
| `packages/core/src/policy/policyCheck.spec.ts` | Unit | policyViolationsGetOutputPretty (empty, single violation, multi-file grouped output with relative paths) |
| `packages/core/src/config/configDiscover.spec.ts` | Unit/Integration | configFileDiscover (direct, walk-up, not found, precedence), configGet error path, configGetFromPath/Sync (JS loading, error paths), configCacheClear, defineConfig identity |
| `packages/eslint-plugin/src/eslintPluginCreate.spec.ts` | Unit | eslintPluginCreate: CJS/ESM interop (array, __esModule, default, pluginRules), lint provider rule assembly, treeCheckProvider auto-adaptation, platform filtering, multi-rule collection, invalid input rejection |
| `packages/eslint-plugin/src/eslintAdapter.spec.ts` | Unit | Cache/state clearing: policyCacheClear, providerInitStateClear, projectIndexCacheClear (smoke tests for singleton Map clearing) |
| `tests/esbuild.policy-plugin.spec.ts` (expanded) | Integration | Added: config auto-discovery, no matching files, multiple rules, fix:true (skipped). Existing: build fail/succeed with policy plugin |
| `packages/core/src/parser/parserLangs.spec.ts` | Unit | langAdd (register, normalize, default/custom wasmPath, error paths for empty langId, no extensions, wasmPath conflict, extension conflict, duplicate merge), langsGet, wasmPathGet, langExists, langGetForFile (known/unknown/no extension, case-insensitive, unloaded language) |
| `packages/core/src/parser/parserInit.spec.ts` | Integration | parserInit (successful init, idempotent), parserGetForFile (Ok for known extension, Err before init, Err for unknown extension) |
| `tests/treesitter.require-logger-enter-exit.spec.ts` (expanded) | Integration | Added: method definitions, function expressions, async functions, empty function body, generator functions, target-level exclude patterns, global policy-level exclude patterns. Existing: fixture-based function declaration / arrow function / already-instrumented check. Generator function support implemented by adding `generator_function_declaration` and `generator_function` node types to `functionsVisit`. |
| `tests/core.plugins.spec.ts` (expanded) | Integration | Added: `policyViolationsGetForFile` Ok path with real logger plugin (returns violations for uninstrumented function). Existing: Err paths for missing capability and wrong language |
| `tests/eslint.require-logger-enter-exit.spec.ts` (expanded) | Integration | Added: multiple functions in one file (2 errors, one-pass fix), nested functions (2 errors, inner fixed first), class methods (2 errors from dual MethodDefinition+FunctionExpression visit). Existing: block function, arrow expression, reuse import, valid instrumented, excluded file |
| `tests/core.policy-check.spec.ts` | Integration | `policyCheck` full pipeline: loads config from temp dir via jiti, finds matching files, returns tree violations. Error path: config not found returns Err |
| `tests/e2e.cli.spec.ts` (expanded) | E2E | CLI subprocess tests: --help, --version, --check-plugins, no violations (exit 0), violations present (exit 1), config not found (error), --config <path> with explicit config (exit 0 + violation detection). 2 skipped: --fix (ESLint wiring gap), --watch (complex async lifecycle). Uses symlinked node_modules for module resolution. |
| `tests/index.builder.spec.ts` (expanded) | Integration | Added: `adapterRegister` — registers spy adapter for 'typescript', verifies factory and indexFile calls, validates spy delta in resulting index. Documents `languageIdFromFile` hardcoded switch as known gap for custom languages. Un-skipped: async flag detection (adapter now checks for `async` keyword child on declaration nodes), enum member extraction (symbols query now captures `enum_assignment` nodes as `enumMember` kind). |
| `tests/eslint.unused-exports-adapter.spec.ts` | Integration | ESLint adapter with `requiresProjectIndex: true`: adapts `unusedExportsRule`, builds ProjectIndex from multi-file temp dir, verifies unused exports detected via treeCheckViolation. Valid cases: all-exports-consumed file, consumer-only file. Invalid case: file with unused export. Exercises `getOrBuildProjectIndex`, `discoverIndexableFiles`, and cross-file import resolution through the ESLint adapter pipeline. |
| `packages/core/src/index/testHelpers.ts` | — | Shared test helper for building `FileIndexDelta`, `SymbolRecord`, and `ScopeRecord` objects without tree-sitter. Extracted from duplicate helpers in `indexStore.spec.ts` and `indexQuery.spec.ts`. Exports: `byteRangeGet`, `scopeRecordNew`, `symbolRecordNew`, `fileIndexDeltaNew`. |
| `tests/index.cross-file-resolution.spec.ts` (expanded) | Integration | Un-skipped: re-export chain (consumer import traced through proxy to origin symbol via `exportMapAddReexportedSymbols`), star export expansion (imports from `export *` proxy mapped to origin symbols, references updated). TS export query extended with `export.reexport_name` and `export.reexport_source` captures for `export { foo } from "module"` patterns. 1 test remains skipped: namespace import member resolution. |

### Known gaps discovered during testing

#### Cross-file resolution gaps

- **Namespace imports** (`import * as X`): The `ImportBinding` is indexed with `isNamespace: true` and `importedName: "*"`, but `resolvedModulePath` is not set. Individual member accesses (`X.foo`) are not resolved to the exporter's symbols. Test remains skipped.
- **Named re-exports** (`export { x } from './y'`): **Fixed.** TS export query now captures `export.reexport_name` and `export.reexport_source`. `exportMapAddReexportedSymbols` in `indexBuilder.ts` follows `sourceModule` references in `ExportsRelation`, looks up the origin symbol ID, and adds it to the proxy file's export map. Consumer bindings trace through the proxy to the origin symbol.
- **Star exports** (`export * from './y'`): **Fixed.** `exportMapAddReexportedSymbols` copies all non-default symbol IDs from the source module's export map into the proxy file's export map. Handles chains (A star-exports from B which star-exports from C) via iterative propagation with a max iteration limit to prevent infinite loops from circular re-exports.

#### Adapter extraction gaps

- **getCallers/getCallees accuracy**: These query methods match calls to symbols by comparing scope ranges against symbol ranges. However, symbol ranges are the name span (e.g., the identifier `foo`), not the full declaration span. This means scope-based matching is unreliable. The underlying `CallsRelation` data is correct — calls are extracted and file-locally resolved — but the higher-level caller/callee queries need symbol ranges to be expanded to full declaration spans to work correctly.

#### ESLint logger rule: fix merging and dual-visit behavior

- **One-pass fix limitation for multiple functions**: When multiple functions in one file are uninstrumented, each ESLint report includes both an import insertion (at file position 0) and a block body replacement. The import insertion causes all fix effective ranges to start at 0, making them overlap. ESLint's one-pass fixer applies only the first non-overlapping fix. Result: only one function is instrumented per pass. Repeated lint+fix cycles would eventually instrument all functions, but a single `eslint --fix` run may leave some unfixed.
- **Nested function fix ordering**: For nested functions, the inner function's fix has a smaller effective range and is applied first by the fixer. The outer function remains uninstrumented after one pass.
- **MethodDefinition + FunctionExpression dual visit**: Class methods trigger both the `MethodDefinition` and `FunctionExpression` ESLint visitors, producing 2 reports for the same function body. Both reports generate identical fixes targeting the same block range. Only one fix applies (they overlap), and after that pass both visitors see the instrumented code and stop reporting. The functional outcome is correct but the double-report is noisy. A guard to skip `FunctionExpression` when the parent is a `MethodDefinition` would fix this.

#### esbuild plugin ESLint rule wiring gap

- **`fix: true` does not exercise ESLint codepol rules**: The esbuild plugin injects the codepol ESLint plugin via the ESLint constructor's `plugins` option, but the ESLint flat config file generated for the build does not enable any `codepol/*` rules. As a result, ESLint lints files but finds no codepol violations, so `fix: true` has nothing to fix. The tree-sitter check runs independently and still finds violations. To make `fix: true` work end-to-end, the esbuild plugin would need to either (a) generate an `overrideConfig` that enables the codepol rules with proper targets/args, or (b) use the ESLint API to programmatically enable rules after config loading.

#### CLI ESLint provider collection gap

- **Unfiltered ESLint providers from unconfigured plugin rules**: The CLI iterates all plugin rules loaded from `plugins: [{ module: '@codepol/plugin' }]` and collects their ESLint lint providers. When a plugin rule (e.g., `unusedExportsRule`) has no matching entry in the policy's `rules` array, the `matchingRule?.providers` filter is undefined and the provider passes through unfiltered. This causes ESLint to run with `codepol/no-unused-exports` enabled even when the policy doesn't configure it. The E2E test works around this by providing a proper ESLint config with the codepol plugin registered and targeting only the specific policy file. The fix would be to skip ESLint providers for plugin rules that have no matching policy rule.

#### adapterRegister: custom language gap

- **`languageIdFromFile` hardcoded switch**: The `adapterRegister` function correctly stores custom adapter factories in the `adapterFactories` Map, but `languageIdFromFile` (a private function in `indexBuilder.ts`) uses a hardcoded switch statement to map file extensions to language IDs. It does not consult the `langAdd` registry. This means a custom language registered via `adapterRegister('custom', factory)` and `langAdd({ langId: 'custom', fileExtensions: ['.custom'] })` will never be routed to the custom adapter because `languageIdFromFile` won't recognize `.custom` files. The `adapterRegister` test validates the contract by overriding an existing language ('typescript').

### Planned tests (not yet created)

No remaining planned test files. All identified gaps either have tests (possibly skipped) or are documented as known implementation gaps above. The shared `testHelpers.ts` has been created and is in use by `indexStore.spec.ts` and `indexQuery.spec.ts`.

Remaining skipped tests (5 total across 4 files):
- `tests/index.cross-file-resolution.spec.ts`: namespace import member resolution (requires `utils.alpha` style property access resolution)
- `tests/index.builder.spec.ts`: getCallers/getCallees (symbol ranges need full declaration span)
- `tests/e2e.cli.spec.ts`: `--fix` (ESLint rule wiring gap), `--watch` (complex async lifecycle)
- `tests/esbuild.policy-plugin.spec.ts`: `fix: true` (ESLint rule wiring gap)

### Fixtures (current)

| Fixture | Suggested rename | Purpose |
|---------|-----------------|---------|
| `tests/fixtures/ts/missing.ts` | `logger.missing-instrumentation.ts` | Function without logger (violation) |
| `tests/fixtures/ts/arrow.ts` | `logger.arrow-missing-instrumentation.ts` | Arrow function without logger (violation) |
| `tests/fixtures/ts/already.ts` | `logger.already-instrumented.ts` | Already-instrumented function (valid) |
| `tests/fixtures/ts/logger.ts` | `logger.mock.ts` | Logger mock module |
