# Python Rule Follow-Ups

This document tracks the next steps for Python rule support after making tree-check `languages` optional by default.

## Current Intent

- `no-interface` stays explicitly restricted to `typescript` / `tsx`.
- `no-star-export-collisions` stays explicitly restricted to `typescript` / `tsx`.
- `require-logger-enter-exit` should also stay explicitly restricted to `typescript` / `tsx` for now.
- `forbidden-path-words` is language-agnostic and can rely on default-all behavior.
- `no-verb-function-name` is intended to grow Python support.
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

- [ ] Define the public interface first: a `vultureCheck(files, config)` style wrapper returning `Result<PolicyViolation[], string>`.
- [ ] Decide package boundary: dedicated `plugin-vulture` package vs generic subprocess helper.
- [ ] Model config options:
  - `vultureBin`
  - `configPath`
  - `minConfidence`
  - `exclude`
  - `ignoreNames`
  - whitelist file support
- [ ] Normalize Vulture findings into codepol diagnostics with stable `ruleId`, `filePath`, `message`, `line`, and `column`.
- [ ] Add tests for:
  - dead function
  - dead class
  - unused import
  - whitelist suppression
  - confidence filtering
  - subprocess failure / missing binary handling
- [ ] Decide how Python dead-code rules should be exposed in policy:
  - a new rule id, or
  - a Python-specific sibling to `no-unused-exports`

## 2. Python `no-verb-function-name`

### Recommendation

Extend `no-verb-function-name` to Python, but do it through a language-aware extraction boundary instead of mixing Python logic directly into the current TS-only extractor.

Current state:

- `packages/plugin/src/noVerbFunctionNameCheck.ts` uses the TypeScript compiler API
- function extraction is currently TS-shaped even though the rule intent is language-level naming policy

### Proposed Design

Refactor the rule into:

- a language-neutral top-level check
- per-language function-name extractors

Suggested shape:

- `functionNamesExtract(context: PolicyCheckContext): FunctionMatch[]`
- `functionNamesExtractTypeScript(source: string): FunctionMatch[]`
- `functionNamesExtractPython(source: string, filePath: string): FunctionMatch[]`

### Python Implementation Options

Preferred:

- use the existing Python parser infrastructure for correctness

Fallback:

- regex extraction for `def` / `async def` if we want a smaller first step

If we use regex first, make it explicit that it is a compatibility step and keep the extraction function isolated so it can be replaced later.

### Proposed Tasks

- [ ] Add failing tests in `packages/plugin/src/noVerbFunctionNameCheck.spec.ts` for Python:
  - `def get_data():`
  - `async def fetch_items():`
  - method inside a class
  - non-verb names that should pass
- [ ] Keep current TS extraction behavior unchanged while introducing the extractor boundary.
- [ ] Add Python extraction and route by file extension or target language.
- [ ] Restore explicit rule languages to `['typescript', 'tsx', 'python']` once Python support is real.
- [ ] Add Ruff adapter coverage for Python rule execution if we want the rule to run through Ruff workflows.

## 3. Suggested Order

1. Keep `require-logger-enter-exit`, `no-interface`, and `no-star-export-collisions` explicitly TS-only.
2. Do Python dead-code detection as a separate rule/tooling track, not as a quick extension of `no-unused-exports`.
3. Extend `no-verb-function-name` to Python through an extractor boundary.

