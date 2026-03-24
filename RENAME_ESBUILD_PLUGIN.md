# Rename: `esbuild-plugin` to `plugin-esbuild`

## Goal

Rename `packages/esbuild-plugin` (`@codepol/esbuild-plugin`) to `packages/plugin-esbuild`
(`@codepol/plugin-esbuild`) for naming consistency with `packages/plugin-eslint`
(`@codepol/plugin-eslint`) and `packages/plugin-ruff` (`@codepol/plugin-ruff`).

This is a purely mechanical rename -- no logic changes.

---

## Steps

### 1. Move the directory

```bash
git mv packages/esbuild-plugin packages/plugin-esbuild
```

### 2. Update `packages/plugin-esbuild/package.json`

```diff
-  "name": "@codepol/esbuild-plugin",
+  "name": "@codepol/plugin-esbuild",
```

```diff
-    "directory": "packages/esbuild-plugin"
+    "directory": "packages/plugin-esbuild"
```

### 3. Update `packages/plugin-esbuild/src/index.ts`

Doc comments and examples (3 occurrences):

```diff
- * @codepol/esbuild-plugin - esbuild plugin for enforcing codepol policies.
+ * @codepol/plugin-esbuild - esbuild plugin for enforcing codepol policies.
```

```diff
- * import { esbuildPluginCreate } from '@codepol/esbuild-plugin';
+ * import { esbuildPluginCreate } from '@codepol/plugin-esbuild';
```

(The second `@example` import on line 265 is the same substitution.)

### 4. Update `packages/plugin-esbuild/README.md`

Replace all 5 occurrences of `@codepol/esbuild-plugin` with `@codepol/plugin-esbuild`.

### 5. Update root `tsconfig.json`

```diff
-      "@codepol/esbuild-plugin": ["./packages/esbuild-plugin/src/index.ts"],
+      "@codepol/plugin-esbuild": ["./packages/plugin-esbuild/src/index.ts"],
```

```diff
-    { "path": "./packages/esbuild-plugin" },
+    { "path": "./packages/plugin-esbuild" },
```

### 6. Update root `package.json`

```diff
-    "@codepol/esbuild-plugin": "workspace:*",
+    "@codepol/plugin-esbuild": "workspace:*",
```

### 7. Update `tests/esbuild.policy-plugin.spec.ts`

```diff
-import { esbuildPluginCreate } from '@codepol/esbuild-plugin';
+import { esbuildPluginCreate } from '@codepol/plugin-esbuild';
```

### 8. Update docs (3 files)

**`docs/getting-started.md`** -- 2 occurrences

```diff
-pnpm add -D @codepol/esbuild-plugin esbuild
+pnpm add -D @codepol/plugin-esbuild esbuild
```

```diff
-import { esbuildPluginCreate } from '@codepol/esbuild-plugin';
+import { esbuildPluginCreate } from '@codepol/plugin-esbuild';
```

**`docs/creating-custom-plugins.md`** -- 1 occurrence

```diff
-import { esbuildPluginCreate } from '@codepol/esbuild-plugin';
+import { esbuildPluginCreate } from '@codepol/plugin-esbuild';
```

**`docs/api-reference.md`** -- 2 occurrences

```diff
-## @codepol/esbuild-plugin
+## @codepol/plugin-esbuild
```

```diff
-import { esbuildPluginCreate } from '@codepol/esbuild-plugin';
+import { esbuildPluginCreate } from '@codepol/plugin-esbuild';
```

### 9. Update `README.md`

Replace 1 occurrence of `@codepol/esbuild-plugin` and update the directory link:

```diff
-| [@codepol/esbuild-plugin](./packages/esbuild-plugin) | esbuild plugin for build-time enforcement |
+| [@codepol/plugin-esbuild](./packages/plugin-esbuild) | esbuild plugin for build-time enforcement |
```

### 10. Update `TEST_PLAN.md`

Replace 2 occurrences of `@codepol/esbuild-plugin` with `@codepol/plugin-esbuild`.

### 11. Update `RENAME_ESLINT_PLUGIN.md`

Replace all references to `packages/esbuild-plugin` with `packages/plugin-esbuild`
(8 occurrences of the directory path in the steps and summary table).

### 12. Reinstall and build

```bash
pnpm install --no-frozen-lockfile
pnpm -r build
```

### 13. Run tests

```bash
pnpm test
```

---

## Files changed summary

| File | Change |
|------|--------|
| `packages/esbuild-plugin/` | Directory renamed to `packages/plugin-esbuild/` |
| `packages/plugin-esbuild/package.json` | name + directory |
| `packages/plugin-esbuild/src/index.ts` | Doc comments + examples (3 occurrences) |
| `packages/plugin-esbuild/README.md` | 5 occurrences |
| `tsconfig.json` | Paths + references |
| `package.json` | devDependencies |
| `tests/esbuild.policy-plugin.spec.ts` | Import |
| `docs/getting-started.md` | 2 occurrences |
| `docs/creating-custom-plugins.md` | 1 occurrence |
| `docs/api-reference.md` | 2 occurrences |
| `README.md` | 1 occurrence + directory link |
| `TEST_PLAN.md` | 2 occurrences |
| `RENAME_ESLINT_PLUGIN.md` | 8 occurrences (directory paths) |
| `pnpm-lock.yaml` | Auto-regenerated |

**Total: 14 files, ~30 string replacements, zero logic changes.**
