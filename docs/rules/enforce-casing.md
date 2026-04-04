# enforce-casing

Built-in rule: `@codepol/plugin/enforce-casing`

Enforces configurable naming conventions for **declaration symbols** (via the semantic `ProjectIndex`) and/or **file and directory path segments** (relative to the policy working directory).

## When to use

- Team-wide conventions for `camelCase` / `PascalCase` / `snake_case` / `SCREAMING_SNAKE_CASE` / `kebab-case` on classes, functions, variables, etc.
- Consistent `kebab-case` (or other styles) for file and folder names in the repo.

## Configuration

Add the rule under `[[rules]]` and set `[rules.args.symbols]` and/or `[rules.args.paths]`.

### Symbol kinds

Keys match indexed `SymbolKind` values. Only listed kinds are checked; each value is an array of allowed styles (a name may match any listed style).

Supported keys: `class`, `interface`, `type`, `function`, `method`, `variable`, `const`, `field`, `parameter`, `enum`, `enumMember`.

**`type`** applies to **type alias** declarations (`type UserId = string`) and to explicit local aliases in **`import type { … as … }`** statements.

**`variable`** applies to `let`/`var` bindings and other non-import locals.

Plain imports are not checked in consumer files. `import { foo }`, `import type { Foo }`, default imports, and namespace imports are exempt.

Explicit local import aliases are checked by the imported symbol's semantic kind when resolution is available. For example, `import { goodName as bad_alias }` uses the resolved export kind (`function`, `const`, `class`, …), while `import type { Foo as bad_alias }` uses **`symbols.type`**. Unresolved aliases are skipped.

Supported styles: `camelCase`, `snake_case`, `PascalCase`, `SCREAMING_SNAKE_CASE`, `kebab-case`.

Leading underscores are stripped before checking (e.g. `_foo` is validated as `foo`).

### Fixes and suggestions (symbols only)

For **symbol** violations, Codepol can suggest renames that match your allowed styles:

- If **only one** allowed style applies to a given symbol kind, a single **auto-fix** is produced (replace the identifier span in source).
- If **multiple** allowed styles are listed (e.g. `const = ["camelCase", "SCREAMING_SNAKE_CASE"]`), **suggestions** are produced (one per distinct valid rename). In ESLint, these appear as quick-fix suggestions; use the one that matches your intent.

**Path** rules (`[rules.args.paths]`) are report-only: they do not rename files or directories on disk.

### Paths

- `file` — allowed styles for the **basename without extension** when `ignoreExtensions` is true (default), or the full last path segment when `ignoreExtensions` is false.
- `directory` — allowed styles for each **directory** segment under the project root.
- `ignoreExtensions` — default `true`; when `false`, the file segment includes the extension (e.g. `foo.ts`).
- `checkFiles` / `checkDirectories` — default `true`; set to `false` to skip file-only or directory-only checks.

Path violations are reported at line 1, column 1 (path-level, not tied to source text).

### Example

```toml
[[plugins]]
id = "@codepol/plugin"
source = { kind = "builtin" }

[targets.app]
language = "typescript"
files = ["src/**/*.ts"]

[[rules]]
ruleId = "@codepol/plugin/enforce-casing"
targets = ["app"]

[rules.args.symbols]
function = ["camelCase"]
class = ["PascalCase"]
const = ["camelCase", "SCREAMING_SNAKE_CASE"]

[rules.args.paths]
file = ["kebab-case"]
directory = ["kebab-case"]
```

## Requirements

This rule sets `requiresProjectIndex: true` so the semantic index is built for matched files. Symbol checks use `ProjectIndex.symbolsInFileGet`; languages follow built-in indexing (TypeScript/TSX/JS/JSX and Python).

## See also

- [Policy schema](../policy-schema.md)
- [Cross-file analysis](../cross-file-analysis.md)
