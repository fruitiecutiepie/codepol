# Python Rule Follow-Ups

This document tracks the next steps for Python rule support after making tree-check `languages` optional by default.

## Current Intent

- `no-interface` stays explicitly restricted to `typescript` / `tsx`.
- `no-star-export-collisions` stays explicitly restricted to `typescript` / `tsx`.
- `require-logger-enter-exit` should also stay explicitly restricted to `typescript` / `tsx` for now.
- `forbidden-path-words` is language-agnostic and can rely on default-all behavior.
- `no-verb-function-name` now supports Python (tree-sitter-based extraction, see Section 2).
- `no-unused-exports` should not be stretched directly into Python without a separate design for Python dead-code detection.

## 1. Python Dead Code

### Recommendation

Do not extend the current `no-unused-exports` implementation to Python as-is.

`packages/plugin/src/unusedExportsCheck.ts` is built around JS/TS export and import semantics:

- it resolves relative modules using JS/TS extensions
- it reasons about `export`, re-exports, and `export *`
- it relies on the current project index model for TS/JS module graphs

That makes it a poor direct fit for Python dead-code detection.

For Python, a separate adapter or wrapper around a Python-native dead-code tool is the better path.

### Preferred Direction

Wrap `vulture` behind a codepol-owned adapter layer instead of calling it directly from business logic.

Likely shape:

- new package such as `packages/plugin-vulture/`, or
- a more generic subprocess lint wrapper if we expect multiple Python-only tools

Use the existing Ruff wrapper pattern as the reference shape:

- `packages/plugin-ruff/src/ruffRunner.ts`
- `packages/plugin-ruff/src/ruffAdapter.ts`

### Why Vulture Looks Reasonable

Based on current tool research:

- Vulture is purpose-built for unused Python code
- it supports confidence thresholds
- it supports exclusions and whitelists
- it can be configured from `pyproject.toml`

Open question:

- I did not confirm a stable JSON output contract, so we may need either:
  - a text-output parser in a wrapper, or
  - a subprocess/plugin boundary that normalizes Vulture results into `PolicyViolation`

### Proposed Tasks

- [x] 2026-03-28 Define the public interface first: a `vultureCheck(files, config)` style wrapper returning `Result<PolicyViolation[], string>`.
- [x] 2026-03-28 Decide package boundary: dedicated `plugin-vulture` package vs generic subprocess helper. Decision: dedicated `packages/plugin-vulture/` package, mirroring `@codepol/plugin-ruff`.
- [x] 2026-03-28 Model config options:
  - `vultureBin`
  - `configPath`
  - `minConfidence`
  - `exclude`
  - `ignoreNames`
  - whitelist file support
- [x] 2026-03-28 Normalize Vulture findings into codepol diagnostics with stable `ruleId`, `filePath`, `message`, `line`, and `column`. Vulture has no JSON output; a text-output parser (`vultureOutputParse`) parses the `filename:line: unused type 'name' (confidence% confidence)` format. Column defaults to `1`.
- [x] 2026-03-28 Add tests for:
  - dead function
  - dead class
  - unused import
  - whitelist suppression
  - confidence filtering
  - subprocess failure / missing binary handling
- [x] 2026-03-28 Decide how Python dead-code rules should be exposed in policy: new rule ID `python-dead-code`, separate from `no-unused-exports` (which is JS/TS-specific). Invoked directly by CLI via `vultureCheck`, not through the ESLint adapter.

## 2. Python `no-verb-function-name` (done)

Python support for `no-verb-function-name` has been implemented via a language-aware extraction boundary.

### What was done

- Renamed `extractFunctions` to `extractFunctionsTypeScript` (no logic changes).
- Added `extractFunctionsPython` — initially regex-based, now tree-sitter-based (see below).
- Added `extractFunctions(source, filePath)` as a router dispatching by `.py` extension.
- Updated `noVerbFunctionNameCheck` to pass `context.filePath` to the router.
- Set explicit `languages: ['typescript', 'tsx', 'python']` on the rule provider.
- Added `"python-src"` to the `no-verb-function-name` rule targets in `codepol.toml`.
- Replaced regex extractor with tree-sitter AST walk for correctness.

### Design decisions

- **Dunder exclusion:** `__init__`, `__str__`, `__getitem__`, etc. are skipped by the Python extractor since they are language-mandated names and would false-positive on verbs like `init`, `get`, `set`.
- **Tree-sitter extraction:** `extractFunctionsPython` uses `parserGetForFile` from `@codepol/core` to parse Python source via tree-sitter, then walks `function_definition` nodes. This correctly ignores `def` inside string literals, comments, and multiline strings. Requires `langAdd` + `parserInit()` to have been called before use (same requirement as `policyPluginLogger.ts`).

### Completed tasks

- [x] Add tests for Python function extraction and verb checking.
- [x] Keep current TS extraction behavior unchanged while introducing the extractor boundary.
- [x] Add Python extraction and route by file extension.
- [x] Set explicit rule languages to `['typescript', 'tsx', 'python']`.
- [x] Add integration test in `tests/core.plugins.spec.ts` for Python verb-name violations.
- [x] Replace regex extractor with tree-sitter-based extraction for correctness (handles `def` inside strings/comments).

### Remaining

- [x] 2026-03-28 Add Ruff adapter coverage for Python rule execution if we want the rule to run through Ruff workflows. Added 7 tests in `tests/ruff.tree-check-adapter.spec.ts` and unskipped the placeholder in `tests/core.plugins.spec.ts`.

## 3. Suggested Order

1. Keep `require-logger-enter-exit`, `no-interface`, and `no-star-export-collisions` explicitly TS-only.
2. Do Python dead-code detection as a separate rule/tooling track, not as a quick extension of `no-unused-exports`.
3. ~~Extend `no-verb-function-name` to Python through an extractor boundary.~~ Done.

