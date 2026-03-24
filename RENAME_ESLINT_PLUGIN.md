# Rename: `eslint-plugin` to `plugin-eslint`

## Goal

Rename `packages/eslint-plugin` (`@codepol/eslint-plugin`) to `packages/plugin-eslint`
(`@codepol/plugin-eslint`) for naming consistency with `packages/plugin-ruff`
(`@codepol/plugin-ruff`).

This is a purely mechanical rename -- no logic changes.

---

## Steps

### 1. Move the directory

```bash
git mv packages/eslint-plugin packages/plugin-eslint
```

### 2. Update `packages/plugin-eslint/package.json`

```diff
-  "name": "@codepol/eslint-plugin",
+  "name": "@codepol/plugin-eslint",
```

```diff
-    "directory": "packages/eslint-plugin"
+    "directory": "packages/plugin-eslint"
```

### 3. Update `packages/plugin-eslint/src/eslintAdapter.ts`

Doc comment only:

```diff
- * @codepol/eslint-plugin - ESLint adapter for TreeCheckProvider.
+ * @codepol/plugin-eslint - ESLint adapter for TreeCheckProvider.
```

### 4. Update `packages/plugin-eslint/src/index.ts`

Doc comments and example:

```diff
- * @codepol/eslint-plugin - ESLint plugin adapter for codepol plugins.
+ * @codepol/plugin-eslint - ESLint plugin adapter for codepol plugins.
```

```diff
- * import { eslintPluginCreate } from '@codepol/eslint-plugin';
+ * import { eslintPluginCreate } from '@codepol/plugin-eslint';
```

### 5. Update `packages/plugin-eslint/README.md`

Replace all 5 occurrences of `@codepol/eslint-plugin` with `@codepol/plugin-eslint`.

### 6. Update root `tsconfig.json`

```diff
-      "@codepol/eslint-plugin": ["./packages/eslint-plugin/src/index.ts"],
+      "@codepol/plugin-eslint": ["./packages/plugin-eslint/src/index.ts"],
```

```diff
-    { "path": "./packages/eslint-plugin" },
+    { "path": "./packages/plugin-eslint" },
```

### 7. Update root `package.json`

```diff
-    "@codepol/eslint-plugin": "workspace:*",
+    "@codepol/plugin-eslint": "workspace:*",
```

### 8. Update `eslint.config.mjs`

```diff
-import { eslintPluginCreate } from '@codepol/eslint-plugin';
+import { eslintPluginCreate } from '@codepol/plugin-eslint';
```

### 9. Update `packages/plugin-esbuild/package.json`

```diff
-    "@codepol/eslint-plugin": "^1.0.0",
+    "@codepol/plugin-eslint": "^1.0.0",
```

```diff
-    "@codepol/eslint-plugin": "workspace:*",
+    "@codepol/plugin-eslint": "workspace:*",
```

### 10. Update `packages/plugin-esbuild/tsconfig.json`

```diff
-    { "path": "../eslint-plugin" },
+    { "path": "../plugin-eslint" },
```

### 11. Update `packages/plugin-esbuild/src/index.ts`

```diff
-import { eslintPluginCreate } from '@codepol/eslint-plugin';
+import { eslintPluginCreate } from '@codepol/plugin-eslint';
```

### 12. Update test files (3 files)

**`tests/eslint.tree-check-adapter.spec.ts`**

```diff
-import { eslintAdapter, policyCacheClear } from '@codepol/eslint-plugin';
+import { eslintAdapter, policyCacheClear } from '@codepol/plugin-eslint';
```

**`tests/eslint.unused-exports-adapter.spec.ts`**

```diff
-import { ... } from '@codepol/eslint-plugin';
+import { ... } from '@codepol/plugin-eslint';
```

**`tests/eslint.require-logger-enter-exit.spec.ts`**

```diff
-import { ... } from '@codepol/eslint-plugin';
+import { ... } from '@codepol/plugin-eslint';
```

### 13. Update `tests/e2e.cli.spec.ts`

```diff
-`import { eslintPluginCreate } from '@codepol/eslint-plugin';
+`import { eslintPluginCreate } from '@codepol/plugin-eslint';
```

Also update the comment on line 9.

### 14. Update docs (4 files)

**`docs/getting-started.md`** -- 4 occurrences
**`docs/creating-custom-plugins.md`** -- 7 occurrences
**`docs/api-reference.md`** -- 8 occurrences
**`packages/plugin-esbuild/README.md`** -- 1 occurrence
**`README.md`** -- 4 occurrences

Replace all occurrences of `@codepol/eslint-plugin` with `@codepol/plugin-eslint`.

### 15. Update `REFACTOR_LINT_ADAPTER.md`

Replace 8 occurrences of `@codepol/eslint-plugin` with `@codepol/plugin-eslint`.

### 16. Update `TEST_PLAN.md`

Replace 2 occurrences of `@codepol/eslint-plugin` with `@codepol/plugin-eslint`.

### 17. Reinstall and build

```bash
pnpm install --no-frozen-lockfile
pnpm -r build
```

### 18. Run tests

```bash
pnpm test
```

---

## Files changed summary

| File | Change |
|------|--------|
| `packages/eslint-plugin/` | Directory renamed to `packages/plugin-eslint/` |
| `packages/plugin-eslint/package.json` | name + directory |
| `packages/plugin-eslint/src/eslintAdapter.ts` | Doc comment |
| `packages/plugin-eslint/src/index.ts` | Doc comments + example |
| `packages/plugin-eslint/README.md` | 5 occurrences |
| `tsconfig.json` | Paths + references |
| `package.json` | devDependencies |
| `eslint.config.mjs` | Import |
| `packages/plugin-esbuild/package.json` | peer + dev deps |
| `packages/plugin-esbuild/tsconfig.json` | Reference path |
| `packages/plugin-esbuild/src/index.ts` | Import |
| `tests/eslint.tree-check-adapter.spec.ts` | Import |
| `tests/eslint.unused-exports-adapter.spec.ts` | Import |
| `tests/eslint.require-logger-enter-exit.spec.ts` | Import |
| `tests/e2e.cli.spec.ts` | Import + comment |
| `docs/getting-started.md` | 4 occurrences |
| `docs/creating-custom-plugins.md` | 7 occurrences |
| `docs/api-reference.md` | 8 occurrences |
| `packages/plugin-esbuild/README.md` | 1 occurrence |
| `README.md` | 4 occurrences |
| `REFACTOR_LINT_ADAPTER.md` | 8 occurrences |
| `TEST_PLAN.md` | 2 occurrences |
| `pnpm-lock.yaml` | Auto-regenerated |

**Total: 22 files, ~55 string replacements, zero logic changes.**
