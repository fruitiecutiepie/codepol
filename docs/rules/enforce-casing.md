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

Supported styles: `camelCase`, `snake_case`, `PascalCase`, `SCREAMING_SNAKE_CASE`, `kebab-case`.

Leading underscores are stripped before checking (e.g. `_foo` is validated as `foo`).

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
