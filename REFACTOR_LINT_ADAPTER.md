# Refactor: Decouple Rule Definitions from Platform Adapters

## Goal

Rules should be pure data (what to check). Platform adapters should be stateless transforms
(how to run the check on a given platform). Rules must never import adapter packages.

After this refactor, `@codepol/plugin` will have zero dependency on `@codepol/plugin-eslint`
(or any future adapter like `@codepol/plugin-ruff`). Adding a new platform adapter will
require zero changes to rule files.

## Summary of changes

1. Strip ESLint adapter wiring from all 6 rule files in `packages/plugin/src/`
2. Remove `@codepol/plugin-eslint`, `@typescript-eslint/utils`, and `eslint` from `packages/plugin/package.json`
3. Remove `lintProviders` from the logger rule in `packages/plugin/src/index.ts`
4. Ensure `eslintPluginCreate` auto-adapt path handles `ruleOptions` passthrough
5. Clean up dead code in `packages/plugin-eslint/src/eslintAdapter.ts`
6. Update tests that depend on explicit `lintProviders`
7. Verify all existing tests still pass

---

## 1. Simplify rule files (6 files)

Each of these files currently imports `eslintAdapter` from `@codepol/plugin-eslint` and
manually creates `ruleBase`, `eslintRule`, `eslintConfig`, `lintProvider`. Replace each
with a minimal definition that only uses `@codepol/core`.

### `packages/plugin/src/forbiddenWordsRule.ts`

Replace the entire file with:

```typescript
import type { CodepolPluginRule } from '@codepol/core';
import { pluginRuleNew, treeCheckProviderNew } from '@codepol/core';
import { forbiddenWordsCheck } from './forbiddenWordsCheck';

export const forbiddenWordsRule: CodepolPluginRule = pluginRuleNew({
  id: 'forbidden-words',
  capabilities: {
    treeCheckProvider: treeCheckProviderNew({
      languages: ['typescript', 'tsx', 'python'],
      check: forbiddenWordsCheck,
    }),
  },
});
```

### `packages/plugin/src/forbiddenPathWordsRule.ts`

Replace the entire file with:

```typescript
import type { CodepolPluginRule } from '@codepol/core';
import { pluginRuleNew, treeCheckProviderNew } from '@codepol/core';
import { forbiddenPathWordsCheck } from './forbiddenPathWordsCheck';

export const forbiddenPathWordsRule: CodepolPluginRule = pluginRuleNew({
  id: 'forbidden-path-words',
  capabilities: {
    treeCheckProvider: treeCheckProviderNew({
      languages: ['typescript', 'tsx'],
      check: forbiddenPathWordsCheck,
    }),
  },
});
```

### `packages/plugin/src/noInterfaceRule.ts`

Replace with (keep fixProvider):

```typescript
import type { CodepolPluginRule, FixProvider, FixProviderContext } from '@codepol/core';
import { pluginRuleNew, treeCheckProviderNew } from '@codepol/core';
import { noInterfaceCheck } from './noInterfaceCheck';
import { noInterfaceFix } from './noInterfaceFix';
import { readFileSync, writeFileSync } from 'node:fs';

const noInterfaceFixProvider: FixProvider = {
  apply: (context: FixProviderContext) => {
    for (const filePath of context.files) {
      const source = readFileSync(filePath, 'utf8');
      const fixed = noInterfaceFix(source);
      if (fixed !== source) {
        writeFileSync(filePath, fixed);
      }
    }
  },
};

export const noInterfaceRule: CodepolPluginRule = pluginRuleNew({
  id: 'no-interface',
  capabilities: {
    treeCheckProvider: treeCheckProviderNew({
      languages: ['typescript', 'tsx'],
      check: noInterfaceCheck,
    }),
    fixProvider: noInterfaceFixProvider,
  },
});
```

### `packages/plugin/src/noVerbFunctionNameRule.ts`

Replace the entire file with:

```typescript
import type { CodepolPluginRule } from '@codepol/core';
import { pluginRuleNew, treeCheckProviderNew } from '@codepol/core';
import { noVerbFunctionNameCheck } from './noVerbFunctionNameCheck';

export const noVerbFunctionNameRule: CodepolPluginRule = pluginRuleNew({
  id: 'no-verb-function-name',
  capabilities: {
    treeCheckProvider: treeCheckProviderNew({
      languages: ['typescript', 'tsx'],
      check: noVerbFunctionNameCheck,
    }),
  },
});
```

### `packages/plugin/src/unusedExportsRule.ts`

Replace with (keep fixProvider and requiresProjectIndex):

```typescript
import type { CodepolPluginRule, FixProvider, FixProviderContext } from '@codepol/core';
import { pluginRuleNew, treeCheckProviderNew } from '@codepol/core';
import { unusedExportsCheck } from './unusedExportsCheck';
import { unusedExportsFix } from './unusedExportsFix';
import { readFileSync, writeFileSync } from 'node:fs';

const unusedExportsFixProvider: FixProvider = {
  apply: (context: FixProviderContext) => {
    const fileSources = context.files.map(filePath => ({
      filePath,
      source: readFileSync(filePath, 'utf8'),
    }));
    for (const [filePath, fixed] of unusedExportsFix(fileSources, context.cwd)) {
      writeFileSync(filePath, fixed);
    }
  },
};

export const unusedExportsRule: CodepolPluginRule = pluginRuleNew({
  id: 'no-unused-exports',
  capabilities: {
    treeCheckProvider: treeCheckProviderNew({
      languages: ['typescript', 'tsx'],
      check: unusedExportsCheck,
    }),
    fixProvider: unusedExportsFixProvider,
    requiresProjectIndex: true,
  },
});
```

### `packages/plugin/src/noStarExportCollisionsRule.ts`

Replace the entire file with:

```typescript
import type { CodepolPluginRule } from '@codepol/core';
import { pluginRuleNew, treeCheckProviderNew } from '@codepol/core';
import { noStarExportCollisionsCheck } from './noStarExportCollisionsCheck';

export const noStarExportCollisionsRule: CodepolPluginRule = pluginRuleNew({
  id: 'no-star-export-collisions',
  capabilities: {
    treeCheckProvider: treeCheckProviderNew({
      languages: ['typescript', 'tsx'],
      check: noStarExportCollisionsCheck,
    }),
    requiresProjectIndex: true,
  },
});
```

### `packages/plugin/src/noDuplicateExportsRule.ts`

This file already has no ESLint adapter dependency (it only uses `fixProvider`).
No changes needed.

---

## 2. Remove ESLint wiring from `packages/plugin/src/index.ts`

This is the most complex file. The logger rule has a hand-written ESLint rule (~400 lines)
plus the ESLint imports and boilerplate.

### Strategy

The logger rule already has a `loggerTreeCheckProvider` in `policyPluginLogger.ts` that
does the same check via tree-sitter. The hand-written ESLint rule duplicates this.

**Option A (recommended):** Remove the hand-written ESLint rule entirely. The logger rule
becomes tree-sitter-only like every other rule. The ESLint adapter auto-adapts it.
The only loss is the ESLint autofix (the tree-sitter version doesn't produce `fix` data).
If autofix is needed, add `fix` to the `PolicyViolation` in `policyPluginLogger.ts`.

**Option B (conservative):** Keep the hand-written ESLint rule but move it to
`@codepol/plugin-eslint` as a "native ESLint rule" that the adapter package owns.
`@codepol/plugin` still exports only the tree-sitter provider.

Regardless of option, the `packages/plugin/src/index.ts` should become:

```typescript
import type { CodepolPluginRule } from '@codepol/core';
import { pluginRuleNew } from '@codepol/core';
import { loggerTreeCheckProvider } from './policyPluginLogger';
import { unusedExportsRule } from './unusedExportsRule';
import { unusedExportsCheck } from './unusedExportsCheck';
import { forbiddenWordsRule } from './forbiddenWordsRule';
import { forbiddenPathWordsRule } from './forbiddenPathWordsRule';
import { noInterfaceRule } from './noInterfaceRule';
import { noVerbFunctionNameRule } from './noVerbFunctionNameRule';
import { noDuplicateExportsRule } from './noDuplicateExportsRule';
import { noStarExportCollisionsRule } from './noStarExportCollisionsRule';

export { unusedExportsRule };
export { unusedExportsCheck };

export const loggerEnterExitRule: CodepolPluginRule = pluginRuleNew({
  id: 'require-logger-enter-exit',
  capabilities: {
    treeCheckProvider: loggerTreeCheckProvider,
  },
});

export default [
  loggerEnterExitRule,
  unusedExportsRule,
  forbiddenWordsRule,
  forbiddenPathWordsRule,
  noVerbFunctionNameRule,
  noInterfaceRule,
  noDuplicateExportsRule,
  noStarExportCollisionsRule,
];
```

Remove all ESLint-specific imports (`ESLintUtils`, `TSESLint`, `TSESTree`,
`@typescript-eslint/utils`), the `requireLoggerRule` definition, the `loggerLintProvider`,
the duplicated helper functions (`policyRuleTargetsGet`, `policyFileGetMatch`,
`loggerIsMemberExpression`, etc.), and the `Options` / `MessageIds` types.

---

## 3. Update `packages/plugin/package.json`

Remove these peer and dev dependencies:

```diff
  "peerDependencies": {
    "@codepol/core": "^1.0.0",
-   "@codepol/plugin-eslint": "^1.0.0",
-   "@typescript-eslint/utils": "^8.53.0",
-   "eslint": "^9.0.0"
  },
  "devDependencies": {
    "@codepol/core": "workspace:*",
-   "@codepol/plugin-eslint": "workspace:*",
-   "@typescript-eslint/utils": "^8.53.0",
-   "eslint": "^9.39.2",
    "typescript": "^5.9.3"
  },
```

---

## 4. Ensure `eslintPluginCreate` auto-adapt path handles `ruleOptions`

In `packages/plugin-eslint/src/index.ts`, the auto-adapt path in `collectRules` currently
calls `eslintAdapter.adapt(pluginRule)` without `ruleOptions`. The ESLint adapter's
`createAdaptedRule` already handles `ruleOptions` via the `AdaptedRuleOptions` schema
(configPath, ruleTargets, policyExclude are passed as ESLint rule options by the CLI).

Verify the CLI's `eslintConfigGet` function in `apps/cli/src/index.ts` still correctly
passes options to auto-adapted rules. Currently it reads `eslintConfig.ruleOptions` from
the provider -- but auto-adapted rules won't have an `EslintProviderConfig`. The CLI needs
to handle auto-adapted rules (those without explicit `lintProviders`) by generating default
options.

### Fix in `apps/cli/src/index.ts`

The `eslintConfigGet` function processes only `lintProviderEntries` with
`platform === 'eslint'`. After this refactor, most rules won't have explicit
`lintProviders`. The CLI should detect tree-check-only rules and generate ESLint config
for them using the auto-adapt path. The simplest approach:

The CLI already calls `policyViolationsGetFromDir` which runs tree-checks directly.
For ESLint integration, `eslintPluginCreate` handles auto-adaptation. The CLI's
`eslintConfigGet` should generate rule entries for every rule that `eslintPluginCreate`
would auto-adapt, using a default `ruleOptions` function:

```typescript
function defaultRuleOptions(ctx: LintProviderContext) {
  return {
    configPath: ctx.configPath,
    ruleTargets: ctx.ruleTargets,
    policyExclude: ctx.policy.exclude,
    ...(ctx.ruleArgs && typeof ctx.ruleArgs === 'object' ? ctx.ruleArgs : {}),
  };
}
```

This ensures the ESLint rules receive policy context even without explicit providers.

---

## 5. Clean up dead code in `packages/plugin-eslint/src/eslintAdapter.ts`

Remove the following dead code:

- `providerInitState` Map (line 144)
- `ensureProviderInit` function (lines 307-341) -- comments acknowledge it's vestigial
- `eslintAdapterInit` function (lines 540-546) -- calls the dead `ensureProviderInit`
- `providerInitStateClear` function (lines 552-554) -- clears the dead Map
- Lines 476-479 in `createAdaptedRule` -- dead `providerInitState` usage

Update exports in `packages/plugin-eslint/src/index.ts`:

```diff
  import {
    eslintAdapter,
-   eslintAdapterInit,
    policyCacheClear,
-   providerInitStateClear,
    projectIndexCacheClear,
  } from './eslintAdapter';

  export {
    eslintAdapter,
-   eslintAdapterInit,
    policyCacheClear,
-   providerInitStateClear,
    projectIndexCacheClear,
  };
```

---

## 6. Update tests

### `tests/eslint.tree-check-adapter.spec.ts`

This test imports `loggerEnterExitRule` from `@codepol/plugin` and calls
`eslintAdapter.adapt(loggerEnterExitRule)`. After refactor, `loggerEnterExitRule` still
has `treeCheckProvider`, so `eslintAdapter.adapt()` still works. No changes needed unless
the test imports `providerInitStateClear` -- remove that import if so.

```diff
- import { eslintAdapter, policyCacheClear, providerInitStateClear } from '@codepol/plugin-eslint';
+ import { eslintAdapter, policyCacheClear } from '@codepol/plugin-eslint';
```

And in `beforeAll`:

```diff
  policyCacheClear();
- providerInitStateClear();
```

### `packages/plugin-eslint/src/eslintAdapter.spec.ts`

Remove the `providerInitStateClear` test cases since the function is deleted.

### `packages/plugin-eslint/src/eslintPluginCreate.spec.ts`

Tests for auto-adapt path already exist and should still pass. Tests for explicit
`lintProviders` still work too since the type remains (just unused by built-in rules).

---

## 7. Verification

After all changes, run:

```bash
pnpm install
pnpm -r build
pnpm test
```

All existing tests should pass. The key invariant is that `eslintPluginCreate` auto-adapts
rules with `treeCheckProvider` but no `lintProviders`, which is already tested in
`eslintPluginCreate.spec.ts`.

---

## Files changed summary

| File | Action |
|------|--------|
| `packages/plugin/src/forbiddenWordsRule.ts` | Rewrite (51 -> ~12 lines) |
| `packages/plugin/src/forbiddenPathWordsRule.ts` | Rewrite (51 -> ~12 lines) |
| `packages/plugin/src/noInterfaceRule.ts` | Rewrite (67 -> ~25 lines) |
| `packages/plugin/src/noVerbFunctionNameRule.ts` | Rewrite (51 -> ~12 lines) |
| `packages/plugin/src/unusedExportsRule.ts` | Rewrite (116 -> ~30 lines) |
| `packages/plugin/src/noStarExportCollisionsRule.ts` | Rewrite (97 -> ~15 lines) |
| `packages/plugin/src/index.ts` | Major rewrite (~540 -> ~30 lines) |
| `packages/plugin/package.json` | Remove eslint-related deps |
| `packages/plugin-eslint/src/eslintAdapter.ts` | Remove dead code (~40 lines) |
| `packages/plugin-eslint/src/index.ts` | Remove dead exports |
| `packages/plugin-eslint/src/eslintAdapter.spec.ts` | Remove dead tests |
| `tests/eslint.tree-check-adapter.spec.ts` | Remove `providerInitStateClear` |
| `apps/cli/src/index.ts` | Add default ruleOptions for auto-adapted rules |
