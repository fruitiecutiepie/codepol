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

Every test targets a public API or a well-defined module boundary. Internal refactors (renaming private helpers, changing data layout) must not break tests. If a test reaches into unexported internals, it belongs in a unit test co-located with the module, not in the root `tests/` directory.

### Each layer testable in isolation

A plugin author should be able to run plugin tests without standing up esbuild. A core contributor should be able to run `IndexStore` tests without loading tree-sitter WASM. Tests declare their own setup and do not rely on shared global state unless explicitly scoped to a `describe` block with `beforeAll`.

### Validate the Result type at boundaries

Every function that returns `Result<T, E>` must have tests for both the `Ok` and `Err` paths. The `Err` path must assert on the error message content so regressions in error quality are caught.

### Use real parsers, not mocks

Tree-sitter is a core dependency, not an external service. Tests that exercise structural analysis must use real WASM parsers via `parserInit()`. This keeps tests honest about parse edge cases. The only exception is tests that validate error paths when parsers are _not_ initialized.

### Test fixtures are source of truth

Checked-in fixture files under `tests/fixtures/` represent canonical inputs. Temp directories (via `fs.mkdtempSync`) are for tests that generate files dynamically (e.g., cross-file resolution with varying topologies). Both approaches are valid; prefer checked-in fixtures when the input is stable and readable, prefer temp dirs when the test needs to control the file layout precisely.

### Tests are deterministic

No network calls, no reliance on system clock, no dependency on file ordering from `fs.readdirSync`. Tests that need ordering must sort explicitly. Tests that need paths must use `path.join` and `os.tmpdir`, never hardcoded absolute paths.

---

## 2. Test Layers

```
Layer 3: End-to-End (E2E)
  CLI invocations, esbuild builds, full policy check pipelines
  Location: tests/e2e.*.spec.ts

Layer 2: Integration
  Multi-module interactions with real parsers and real files
  Location: tests/<domain>.<feature>.spec.ts

Layer 1: Unit
  Pure functions, data structure operations, single-module logic
  Location: packages/<pkg>/src/<module>.spec.ts (co-located)
           OR tests/unit.<domain>.<feature>.spec.ts
```

### Layer 1 -- Unit

Scope: One module, one function, one data structure. No file I/O unless the module under test is specifically about file I/O. No tree-sitter initialization.

Examples:
- `Result` utilities (`Ok`, `Err`, `isOk`, `isErr`, `resultFrom`, `resultFromAsync`)
- `moduleResolve` with mocked `fs.existsSync` or pre-created temp dirs
- `IndexStore` CRUD operations (add symbols, query, remove file)
- `policyRuleTargetsResolve` with inline policy objects
- `globPatternsGetMatchAny` with path strings
- `pluginRuleNew` validation

### Layer 2 -- Integration

Scope: Multiple modules collaborating. Real tree-sitter parsers. Real file system (temp dirs). Tests verify that the wiring between modules produces correct end-to-end data.

Examples:
- `projectIndexBuildSync` with multi-file TypeScript projects
- Cross-file import resolution with various module topologies
- `policyViolationsGetForFile` with real plugins and real parsed trees
- `eslintAdapter.adapt()` producing a working ESLint rule via `RuleTester`
- `unusedExportsCheck` with a built `ProjectIndex`

### Layer 3 -- End-to-End (E2E)

Scope: External process boundaries. The CLI as a subprocess, esbuild as a library call, full config discovery from disk.

Examples:
- `codepol` CLI with `--check-plugins` exits 0 on valid config
- `codepol` CLI exits non-zero when violations exist
- `codepol --fix` modifies files on disk
- esbuild plugin fails the build on violations, passes after fix
- Config discovery from nested directories

---

## 3. Per-Package Coverage Matrix

### 3.1 `@codepol/core`

#### Result Utilities (`result/result.ts`)

| Function | Layer | Test File | Status |
|----------|-------|-----------|--------|
| `Ok(value)` | Unit | `tests/unit.result.spec.ts` | Missing |
| `Err(error)` | Unit | `tests/unit.result.spec.ts` | Missing |
| `isOk(result)` | Unit | `tests/unit.result.spec.ts` | Missing |
| `isErr(result)` | Unit | `tests/unit.result.spec.ts` | Missing |
| `resultFrom(fn)` — success | Unit | `tests/unit.result.spec.ts` | Missing |
| `resultFrom(fn)` — throws | Unit | `tests/unit.result.spec.ts` | Missing |
| `resultFromAsync(fn)` — resolves | Unit | `tests/unit.result.spec.ts` | Missing |
| `resultFromAsync(fn)` — rejects | Unit | `tests/unit.result.spec.ts` | Missing |

#### Module Resolver (`index/moduleResolver.ts`)

| Function | Layer | Test File | Status |
|----------|-------|-----------|--------|
| `isRelativeImport` — `./`, `../`, absolute | Unit | `tests/unit.moduleResolver.spec.ts` | Missing |
| `isExternalPackage` — scoped, bare, relative | Unit | `tests/unit.moduleResolver.spec.ts` | Missing |
| `moduleResolve` — relative, no extension | Unit | `tests/unit.moduleResolver.spec.ts` | Missing |
| `moduleResolve` — relative, explicit `.ts` | Unit | `tests/unit.moduleResolver.spec.ts` | Missing |
| `moduleResolve` — directory with `index.ts` | Unit | `tests/unit.moduleResolver.spec.ts` | Missing |
| `moduleResolve` — path aliases | Unit | `tests/unit.moduleResolver.spec.ts` | Missing |
| `moduleResolve` — `.tsx`, `.js` extensions | Unit | `tests/unit.moduleResolver.spec.ts` | Missing |
| `moduleResolve` — non-existent file returns undefined | Unit | `tests/unit.moduleResolver.spec.ts` | Missing |
| `moduleResolve` — external package returns undefined | Unit | `tests/unit.moduleResolver.spec.ts` | Missing |

#### IndexStore (`index/indexStore.ts`)

| Operation | Layer | Test File | Status |
|-----------|-------|-----------|--------|
| `indexStoreNew()` returns empty store | Unit | `tests/unit.indexStore.spec.ts` | Missing |
| `filePut` / `symbolsGet` round-trip | Unit | `tests/unit.indexStore.spec.ts` | Missing |
| `filePut` / `scopesInFileGet` round-trip | Unit | `tests/unit.indexStore.spec.ts` | Missing |
| `filePut` / `referencesGet` round-trip | Unit | `tests/unit.indexStore.spec.ts` | Missing |
| `filePut` / `callsGet` round-trip | Unit | `tests/unit.indexStore.spec.ts` | Missing |
| `filePut` / `importBindingsInFileGet` round-trip | Unit | `tests/unit.indexStore.spec.ts` | Missing |
| `filePut` / `exportsInFileGet` round-trip | Unit | `tests/unit.indexStore.spec.ts` | Missing |
| `fileRemove` clears all relations for file | Unit | `tests/unit.indexStore.spec.ts` | Missing |
| `exportMapBuild` correctness | Unit | `tests/unit.indexStore.spec.ts` | Missing |
| `relationUpdate` modifies existing relations | Unit | `tests/unit.indexStore.spec.ts` | Missing |
| `symbolGet` by ID returns correct symbol | Unit | `tests/unit.indexStore.spec.ts` | Missing |
| `symbolsGet` with `SymbolFilter` (by name, kind, file, flags) | Unit | `tests/unit.indexStore.spec.ts` | Missing |
| `filesGet` lists indexed files | Unit | `tests/unit.indexStore.spec.ts` | Missing |
| `clear()` empties everything | Unit | `tests/unit.indexStore.spec.ts` | Missing |

#### Index Builder (`index/indexBuilder.ts`)

| Function | Layer | Test File | Status |
|----------|-------|-----------|--------|
| `projectIndexBuildSync` — single file | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists (partial) |
| `projectIndexBuildSync` — multi-file with imports | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists |
| `projectIndexBuild` — async variant | Integration | — | Missing |
| `projectIndexUpdateFileSync` — no change returns false | Integration | `packages/plugin/src/unusedExportsCheck.spec.ts` | Exists |
| `projectIndexUpdateFileSync` — changed file returns true | Integration | `packages/plugin/src/unusedExportsCheck.spec.ts` | Exists |
| `projectIndexUpdateFileFromSource` — update from string | Integration | — | Missing |
| `projectIndexRemoveFiles` — removes file data | Integration | — | Missing |
| `crossFileResolveForFile` — re-resolves one file | Integration | — | Missing |
| `adapterRegister` — custom language adapter | Integration | — | Missing |
| Symbol extraction — functions, classes, variables, types, interfaces, enums | Integration | — | Missing |
| Scope tree construction — nested functions, classes, blocks | Integration | — | Missing |
| Heuristic call detection | Integration | — | Missing |
| `crossFileResolve` — named imports | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists |
| `crossFileResolve` — default imports | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists |
| `crossFileResolve` — namespace imports | Integration | — | Missing |
| `crossFileResolve` — aliased imports | Integration | — | Missing |
| `crossFileResolve` — re-exports | Integration | — | Missing |
| `crossFileResolve` — circular imports | Integration | — | Missing |
| `crossFileResolve` — star exports | Integration | — | Missing |
| File with parse errors — graceful skip | Integration | — | Missing |
| Empty file — no crash | Integration | — | Missing |

#### Index Query / ProjectIndex (`index/indexQuery.ts`)

| Method | Layer | Test File | Status |
|--------|-------|-----------|--------|
| `getSymbols()` — all symbols | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists (via debug logs) |
| `getSymbol(id)` | Integration | — | Missing |
| `getSymbolsInFile(file)` | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists (partial) |
| `getSymbolsByName(name)` | Integration | — | Missing |
| `getExportedSymbols({ file })` | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists |
| `getReferences(symbolId)` | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists |
| `getReferencesInFile(file)` | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists |
| `getCallers(symbolId)` | Integration | — | Missing |
| `getCallees(symbolId)` | Integration | — | Missing |
| `getScope(scopeId)` | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists (indirect) |
| `getScopesInFile(file)` | Integration | — | Missing |
| `getImportBindings(file)` | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists |
| `getFileExports(file)` | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists |
| `resolveImport(binding)` | Integration | — | Missing |
| `getStats()` | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists |
| `capabilities` | Integration | `tests/index.cross-file-resolution.spec.ts` | Exists |

#### Policy Loading (`policyGet.ts`)

| Function | Layer | Test File | Status |
|----------|-------|-----------|--------|
| `policyRuleTargetsResolve` — rule with targets | Unit | `tests/policy.contract.spec.ts` | Exists (partial) |
| `policyRuleTargetsResolve` — rule with missing target key | Unit | — | Missing |
| `globPatternsGetMatchAny` — matching path | Unit | — | Missing |
| `globPatternsGetMatchAny` — non-matching path | Unit | — | Missing |
| `ruleTargetMatchesLanguage` — match and mismatch | Unit | — | Missing |
| `ruleMatchesGet` — files matching rules | Unit | — | Missing |
| `policyFileGetChecked` — file in scope vs out of scope | Unit | — | Missing |

#### Policy Tree Check (`policyTreeCheck.ts`)

| Function | Layer | Test File | Status |
|----------|-------|-----------|--------|
| `policyViolationsGetForFile` — plugin missing capability | Integration | `tests/core.plugins.spec.ts` | Exists |
| `policyViolationsGetForFile` — plugin wrong language | Integration | `tests/core.plugins.spec.ts` | Exists |
| `policyViolationsGetForFile` — missing logger config | Integration | `tests/core.error-handling.spec.ts` | Exists |
| `policyViolationsGetForFile` — valid check returns violations | Integration | — | Missing (only tested through `policyViolationsGetFromDir`) |
| `policyViolationsGetFromDir` — finds violations across files | Integration | `tests/treesitter.require-logger-enter-exit.spec.ts` | Exists |
| `policyViolationsGetFromDir` — respects exclude patterns | Integration | — | Missing |

#### Policy Check Runner (`policyCheck.ts`)

| Function | Layer | Test File | Status |
|----------|-------|-----------|--------|
| `policyCheck` — full pipeline | Integration | — | Missing |
| `policyViolationsGetOutputPretty` — formatting | Unit | — | Missing |

#### Parser and Languages (`parserInit.ts`, `parserLangs.ts`)

| Function | Layer | Test File | Status |
|----------|-------|-----------|--------|
| `langAdd` — register language | Unit | — | Missing (used in `beforeAll` of many tests but never tested directly) |
| `langsGet` — list registered languages | Unit | — | Missing |
| `parserInit` — initializes successfully | Integration | — | Missing (used but not asserted) |
| `parserGetForFile` — returns parser for known extension | Integration | — | Missing |
| `parserGetForFile` — returns undefined for unknown extension | Integration | — | Missing |
| Duplicate `langAdd` for same extension | Unit | — | Missing |

#### Config Discovery (`configDiscover.ts`)

| Function | Layer | Test File | Status |
|----------|-------|-----------|--------|
| `configFileDiscover` — finds `codepol.config.ts` | Integration | — | Missing |
| `configGetFromPath` — loads config from explicit path | Integration | — | Missing |
| `configGetFromPathSync` — sync variant | Integration | — | Missing |
| `configGet` — auto-discovers and loads | Integration | — | Missing |
| `configCacheClear` — clears cache | Unit | — | Missing |
| `defineConfig` — returns input unchanged (type helper) | Unit | — | Missing |

#### Tree Check Adapter (`treeCheckAdapter.ts`)

| Function | Layer | Test File | Status |
|----------|-------|-----------|--------|
| `violationToLintDiagnostic` — maps fields correctly | Unit | — | Missing |
| `violationsToLintDiagnostics` — maps array | Unit | — | Missing |

---

### 3.2 `@codepol/plugin`

#### Logger Tree Check Provider (`policyPluginLogger.ts`)

| Scenario | Layer | Test File | Status |
|----------|-------|-----------|--------|
| Detects missing logger in function declaration | Integration | `tests/treesitter.require-logger-enter-exit.spec.ts` | Exists |
| Detects missing logger in arrow function | Integration | `tests/treesitter.require-logger-enter-exit.spec.ts` | Exists |
| Skips already-instrumented functions | Integration | `tests/treesitter.require-logger-enter-exit.spec.ts` | Exists |
| Handles method definitions | Integration | — | Missing |
| Handles function expressions | Integration | — | Missing |
| Handles async functions | Integration | — | Missing |
| Handles generator functions | Integration | — | Missing |
| Empty function body | Integration | — | Missing |

#### Logger ESLint Rule (`loggerLintProvider`)

| Scenario | Layer | Test File | Status |
|----------|-------|-----------|--------|
| Valid: already instrumented function | Integration | `tests/eslint.require-logger-enter-exit.spec.ts` | Exists |
| Valid: excluded file pattern | Integration | `tests/eslint.require-logger-enter-exit.spec.ts` | Exists |
| Invalid: block function + autofix | Integration | `tests/eslint.require-logger-enter-exit.spec.ts` | Exists |
| Invalid: arrow expression + autofix | Integration | `tests/eslint.require-logger-enter-exit.spec.ts` | Exists |
| Invalid: reuses existing import + autofix | Integration | `tests/eslint.require-logger-enter-exit.spec.ts` | Exists |
| Multiple functions in one file | Integration | — | Missing |
| Nested functions | Integration | — | Missing |
| Class methods | Integration | — | Missing |

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
| `eslintPluginCreate` — assembles rules from `lintProviders` | Unit | — | Missing |
| `eslintPluginCreate` — adapts `treeCheckProvider`-only rules | Unit | — | Missing |
| `eslintPluginCreate` — handles CJS/ESM interop (`default` export) | Unit | — | Missing |
| `eslintAdapter.adapt` — valid code passes | Integration | `tests/eslint.tree-check-adapter.spec.ts` | Exists |
| `eslintAdapter.adapt` — invalid code reports `treeCheckViolation` | Integration | `tests/eslint.tree-check-adapter.spec.ts` | Exists |
| `eslintAdapter.adapt` — excluded file skipped | Integration | `tests/eslint.tree-check-adapter.spec.ts` | Exists |
| `eslintAdapter.adapt` — custom severity | Integration | `tests/eslint.tree-check-adapter.spec.ts` | Exists |
| `eslintAdapter.platform` identifier | Unit | `tests/eslint.tree-check-adapter.spec.ts` | Exists |
| `policyCacheClear` / `providerInitStateClear` | Unit | — | Missing (used in setup, not tested) |
| `projectIndexCacheClear` | Unit | — | Missing |
| Adapter with `requiresProjectIndex: true` | Integration | — | Missing |

---

### 3.4 `@codepol/esbuild-plugin`

| Scenario | Layer | Test File | Status |
|----------|-------|-----------|--------|
| Build fails when violations exist | E2E | `tests/esbuild.policy-plugin.spec.ts` | Exists |
| Build succeeds after fix | E2E | `tests/esbuild.policy-plugin.spec.ts` | Exists |
| `fix: true` applies autofixes | E2E | — | Missing |
| Config auto-discovery (no `configPath`) | E2E | — | Missing |
| No matching files — build passes | E2E | — | Missing |
| Multiple rules — all checked | E2E | — | Missing |

---

### 3.5 `@codepol/cli`

| Scenario | Layer | Test File | Status |
|----------|-------|-----------|--------|
| `--help` prints usage and exits 0 | E2E | — | Missing |
| `--version` prints version and exits 0 | E2E | — | Missing |
| `--check-plugins` validates config and exits | E2E | — | Missing |
| No violations — exits 0 | E2E | — | Missing |
| Violations present — exits non-zero | E2E | — | Missing |
| `--fix` applies fixes to disk | E2E | — | Missing |
| `--config <path>` uses explicit config | E2E | — | Missing |
| Config not found — exits with error | E2E | — | Missing |
| `--watch` mode starts and responds to changes | E2E | — | Missing |

---

### 3.6 Policy Contract (`codepol.config.ts` validation)

| Scenario | Layer | Test File | Status |
|----------|-------|-----------|--------|
| Rule IDs are unique | Unit | `tests/policy.contract.spec.ts` | Exists |
| Every rule has at least one target glob | Unit | `tests/policy.contract.spec.ts` | Exists |
| Invalid config shapes rejected | Unit | — | Missing |
| Unknown rule references rejected | Unit | — | Missing |
| Empty targets map rejected | Unit | — | Missing |

---

## 4. Gap Analysis: Current State

### Summary

| Category | Exists | Missing | Coverage |
|----------|--------|---------|----------|
| Result utilities | 0 | 8 | 0% |
| Module resolver | 0 | 9 | 0% |
| IndexStore | 0 | 14 | 0% |
| Index builder | 7 | 13 | 35% |
| Index query (ProjectIndex) | 8 | 7 | 53% |
| Policy loading | 1 | 6 | 14% |
| Policy tree check | 4 | 2 | 67% |
| Policy check runner | 0 | 2 | 0% |
| Parser/languages | 0 | 6 | 0% |
| Config discovery | 0 | 6 | 0% |
| Tree check adapter | 0 | 2 | 0% |
| Plugin: logger tree check | 3 | 5 | 38% |
| Plugin: logger ESLint rule | 5 | 3 | 63% |
| Plugin: unused exports | 26 | 0 | 100% |
| ESLint plugin | 5 | 5 | 50% |
| esbuild plugin | 2 | 4 | 33% |
| CLI | 0 | 9 | 0% |
| Policy contract | 2 | 3 | 40% |

### Priority order for closing gaps

1. **IndexStore unit tests** — foundation for everything; bugs here silently corrupt all higher layers
2. **moduleResolver unit tests** — path resolution bugs silently break cross-file analysis
3. **Result utility tests** — trivial to write, validates the error-handling contract
4. **Index builder edge cases** — empty files, parse errors, namespace/aliased/circular imports
5. **Policy loading tests** — glob matching, target resolution, language matching
6. **Config discovery tests** — auto-discovery, explicit path, missing config
7. **CLI E2E tests** — validates the user-facing interface end-to-end
8. **eslintPluginCreate unit tests** — validates plugin assembly correctness
9. **Parser/language registration** — edge cases around duplicate registration, unknown extensions
10. **esbuild plugin additional scenarios** — fix mode, auto-discovery, no-match pass-through

---

## 5. Conventions

### File naming

```
tests/unit.<domain>.<feature>.spec.ts      — Unit tests
tests/<domain>.<feature>.spec.ts           — Integration tests
tests/e2e.<domain>.<feature>.spec.ts       — End-to-end tests
packages/<pkg>/src/<module>.spec.ts        — Co-located unit tests (when tightly coupled to internals)
```

Domain names correspond to package or module names:
- `result`, `moduleResolver`, `indexStore`, `indexBuilder`, `indexQuery`
- `policy`, `config`, `parser`
- `eslint`, `esbuild`, `treesitter`
- `cli`

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
  ts/                   — TypeScript fixture files for tree-sitter tests
    already.ts          — Already-instrumented function (valid)
    missing.ts          — Missing logger instrumentation (violation)
    arrow.ts            — Arrow function without instrumentation (violation)
    logger.ts           — Logger mock module
  configs/              — Policy config fixtures (to be added)
    valid.config.ts     — Valid minimal config
    invalid-no-targets.config.ts
    invalid-duplicate-ids.config.ts
```

Use checked-in fixtures when:
- The fixture content is stable and worth reading as documentation
- Multiple tests share the same fixture
- The fixture represents a real-world pattern

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

---

## 7. Performance Benchmarks

### Goal

Detect performance regressions in indexing, cross-file resolution, and policy checking before they reach production.

### Benchmark tests

Location: `tests/bench/` (excluded from normal `pnpm test`, run via `pnpm bench`)

| Benchmark | What it measures | Target |
|-----------|-----------------|--------|
| Index 100 files | `projectIndexBuildSync` throughput | < 2s |
| Index 500 files | Scale behavior | < 8s |
| Cross-file resolve (100 files, 50 imports each) | Resolution throughput | < 500ms |
| `unusedExportsCheck` on 100-file index | Per-file check latency | < 50ms per file |
| `policyViolationsGetFromDir` (100 files) | Full pipeline | < 5s |

### Implementation

Use Vitest's `bench` mode (`vitest bench`) or a simple timer wrapper:

```typescript
import { describe, it, expect } from 'vitest';

describe('indexing performance', () => {
  it('indexes 100 files within 2 seconds', () => {
    const files = generateTestFiles(100);
    const start = performance.now();
    projectIndexBuildSync({ files, dir: testDir });
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(2000);
  });
});
```

### Vitest config for benchmarks

Add a separate config or extend the existing one:

```typescript
// vitest.config.ts — add to include
include: ['tests/**/*.spec.ts', 'packages/**/*.spec.ts'],
// Benchmarks run separately:
// pnpm vitest run --config vitest.bench.config.ts
```

---

## 8. CI Integration

### Pipeline stages

```
Stage 1: Typecheck
  pnpm typecheck
  Catches type errors before any tests run.

Stage 2: Unit Tests
  pnpm vitest run --reporter=verbose tests/unit.*.spec.ts packages/**/*.spec.ts
  Fast feedback (no tree-sitter WASM, no file I/O beyond temp dirs).
  Target: < 10 seconds.

Stage 3: Integration Tests
  pnpm vitest run --reporter=verbose tests/*.spec.ts
  Requires tree-sitter WASM files. Includes cross-file, policy, ESLint tests.
  Target: < 60 seconds.

Stage 4: E2E Tests
  pnpm vitest run --reporter=verbose tests/e2e.*.spec.ts
  CLI subprocess tests, esbuild builds.
  Target: < 120 seconds.

Stage 5: Benchmarks (optional, on main branch only)
  pnpm vitest bench
  Records timings. Fails if any benchmark exceeds 2x its target.
```

### Coverage

Enable coverage in CI (not locally by default):

```bash
pnpm vitest run --coverage
```

Coverage thresholds (to be enforced once gaps are closed):

| Package | Target |
|---------|--------|
| `@codepol/core` (result, moduleResolver, indexStore) | 90% |
| `@codepol/core` (indexBuilder, indexQuery) | 80% |
| `@codepol/core` (policy*, config*) | 80% |
| `@codepol/plugin` | 85% |
| `@codepol/eslint-plugin` | 75% |
| `@codepol/esbuild-plugin` | 70% |
| `@codepol/cli` | 70% |

### Required checks for PRs

- All unit and integration tests pass
- No new TypeScript errors
- Coverage does not decrease on touched files
- E2E tests pass (can be parallelized with integration)

---

## Appendix: Test File Inventory (Current)

| File | Layer | Domain |
|------|-------|--------|
| `tests/policy.contract.spec.ts` | Unit | Policy config validation |
| `tests/core.plugins.spec.ts` | Unit/Integration | Plugin capability validation |
| `tests/core.error-handling.spec.ts` | Integration | Error path for missing config |
| `tests/treesitter.require-logger-enter-exit.spec.ts` | Integration | Tree-sitter logger check |
| `tests/eslint.require-logger-enter-exit.spec.ts` | Integration | ESLint logger rule + autofix |
| `tests/eslint.tree-check-adapter.spec.ts` | Integration | ESLint tree-check adapter |
| `tests/index.cross-file-resolution.spec.ts` | Integration | Semantic index cross-file resolution |
| `tests/esbuild.policy-plugin.spec.ts` | E2E | esbuild build integration |
| `packages/plugin/src/unusedExportsCheck.spec.ts` | Integration | Unused exports check (co-located) |

| Fixture | Purpose |
|---------|---------|
| `tests/fixtures/ts/missing.ts` | Function without logger (violation) |
| `tests/fixtures/ts/arrow.ts` | Arrow function without logger (violation) |
| `tests/fixtures/ts/already.ts` | Already-instrumented function (valid) |
| `tests/fixtures/ts/logger.ts` | Logger mock module |
