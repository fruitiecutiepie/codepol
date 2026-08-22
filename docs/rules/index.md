# Rule Catalog

Every rule built into `@codepol/plugin`. Enable a rule by adding a `[[rules]]`
entry that references its `ruleId` and one or more targets:

```toml
[[rules]]
ruleId = "@codepol/plugin/no-cycles"
targets = ["src"]
```

See [Policy Schema](../policy-schema.md) for the shared rule fields
(`id`, `severity`, `providers`, `fix`, `args`).

## How rules are grouped

Codepol rules come in three flavors, which affects when they run and what
they can see:

| Flavor | Sees | Runs |
| ------ | ---- | ---- |
| **Per-file** | one file's syntax tree | once per matched file |
| **Cross-file** | the whole [project index](../semantic-index.md) | once per matched file, with `context.projectIndex` |
| **Architecture** | the module graph | once per rule, over the whole workspace |

Architecture rules require the semantic index, so they force an index build.
See [Architecture Analysis](../architecture-analysis.md).

---

## Naming and style

### `forbidden-words`

Flags identifiers containing any configured word. Language-agnostic — applies
to every target it is attached to.

```toml
[[rules]]
ruleId = "@codepol/plugin/forbidden-words"
targets = ["src"]
args.words = ["handle", "process", "util", "helper", "tmp"]
```

| Arg | Type | Description |
| --- | ---- | ----------- |
| `words` | string[] | Words that may not appear in an identifier |

### `forbidden-path-words`

Same word list, applied to file and directory path segments instead of
identifiers. Language-agnostic.

```toml
[[rules]]
ruleId = "@codepol/plugin/forbidden-path-words"
targets = ["src"]
args.words = ["util", "helper", "misc"]
```

### `no-verb-function-name`

Disallows function names that begin with a configured verb, pushing toward
noun-first naming (`userFetch` over `fetchUser`).

Languages: `typescript`, `tsx`, `python`.

```toml
[[rules]]
ruleId = "@codepol/plugin/no-verb-function-name"
targets = ["src"]
args.verbs = ["get", "set", "create", "fetch", "build", "run"]
```

### `enforce-casing`

Enforces naming conventions per symbol kind and per path segment. Supports
autofix, including project-wide renames that rewrite references, import
bindings, and re-export specifiers across files.

Languages: `typescript`, `tsx`, `javascript`, `jsx`, `python`.

Full documentation: [enforce-casing](./enforce-casing.md).

```toml
[[rules]]
ruleId = "@codepol/plugin/enforce-casing"
targets = ["src"]
fix = "on-save"

[rules.args.symbols]
function = ["camelCase"]
class = ["PascalCase"]
type = ["PascalCase"]
const = ["camelCase", "SCREAMING_SNAKE_CASE"]

[rules.args.paths]
file = ["kebab-case"]
directory = ["kebab-case"]
ignoreExtensions = true
```

### `no-interface`

Bans `interface` declarations in favor of `type` aliases. Has an autofix that
rewrites the declaration in place.

Languages: `typescript`, `tsx`.

```toml
[[rules]]
ruleId = "@codepol/plugin/no-interface"
targets = ["src"]
```

### `forbidden-declarations`

Bans whole declaration families. Report-only.

Languages: `typescript`, `tsx`, `javascript`, `jsx`.

Full documentation: [forbidden-declarations](./forbidden-declarations.md).

```toml
[[rules]]
ruleId = "@codepol/plugin/forbidden-declarations"
targets = ["src"]
args.symbols = ["class", "interface"]
args.bindings = ["import"]
args.syntax = ["var"]
```

| Arg | Type | Description |
| --- | ---- | ----------- |
| `symbols` | string[] | Symbol declaration kinds to ban (`class`, `interface`, `type`, …) |
| `bindings` | string[] | Binding kinds to ban (`import`, `catch`, …) |
| `syntax` | string[] | Syntax forms to ban (`var`, `generator-function`, …) |

---

## Module hygiene

These are cross-file rules: they read the project index to reason about what
other files import.

### `no-unused-exports`

Reports exported symbols that no other file in the workspace imports. Has a
fix that removes the export.

Languages: `typescript`, `tsx`, `javascript`, `jsx`.

```toml
[[rules]]
ruleId = "@codepol/plugin/no-unused-exports"
targets = ["src"]
args.ignorePackageEntryPoints = true
```

| Arg | Type | Description |
| --- | ---- | ----------- |
| `ignorePackageEntryPoints` | boolean | Skip files that are a workspace package's declared entry point |

### `no-unused-vars`

Reports unused local variables. Ships both a native tree-check and an ESLint
lint provider — when run through ESLint the rule surfaces under the name
`no-unused-vars`.

Languages: `typescript`, `tsx`, `javascript`, `jsx`.

```toml
[[rules]]
ruleId = "@codepol/plugin/no-unused-vars"
targets = ["src"]
```

::: tip
Any ESLint-backed rule requires a `[tools.eslint]` run in your policy, or the
ESLint analyzer cannot resolve a config. See [Policy Schema → External Tool
Runs](../policy-schema.md#external-tool-runs).
:::

### `no-duplicate-exports`

Reports the same identifier being exported from more than one file. Because it
needs every file at once, it is implemented purely as a fix provider — there is
no per-file check phase.

```toml
[[rules]]
ruleId = "@codepol/plugin/no-duplicate-exports"
targets = ["src"]
args.identifierTypes = ["function", "variable", "type"]
args.includeReexports = true
```

| Arg | Type | Description |
| --- | ---- | ----------- |
| `identifierTypes` | string[] | Which export kinds to compare |
| `includeReexports` | boolean | Count `export … from` re-exports as exports |

### `no-mixed-exports`

Disallows mixing default and named exports in one module. The autofix is
cross-file: it rewrites importing files too.

Languages: `typescript`, `tsx`, `javascript`, `jsx`.

Full documentation: [no-mixed-exports](./no-mixed-exports.md).

```toml
[[rules]]
ruleId = "@codepol/plugin/no-mixed-exports"
targets = ["src"]
args.preferredStyle = "named"
```

| Arg | Type | Description |
| --- | ---- | ----------- |
| `preferredStyle` | `"named"` \| `"default"` | Which side of a mixed module wins |

### `no-star-export-collisions`

Detects `export *` re-exports whose names collide with each other or with local
exports.

Languages: `typescript`, `tsx`.

```toml
[[rules]]
ruleId = "@codepol/plugin/no-star-export-collisions"
targets = ["src"]
args.includeLocalExports = true
```

| Arg | Type | Description |
| --- | ---- | ----------- |
| `includeLocalExports` | boolean | Also detect collisions against the file's own exports |

---

## Architecture

Whole-graph rules. Each runs once over the workspace module graph rather than
per file. See [Architecture Analysis](../architecture-analysis.md) for the
graph model and the matching `codepol graph` commands.

### `no-cycles`

Forbids circular imports.

```toml
[[rules]]
ruleId = "@codepol/plugin/no-cycles"
targets = ["src"]
args.maxCycles = 50
args.minSize = 2
```

| Arg | Type | Description |
| --- | ---- | ----------- |
| `maxCycles` | number | Cap on cycles reported per run (default `50`) |
| `minSize` | number | Ignore cycles smaller than this |

The default cap exists so that a large legacy codebase — where cycle detection
can return thousands of SCCs — still produces readable output.

### `max-cycle-size`

Caps how large any single cycle may be. Pair it with a relaxed `no-cycles` for
gradual rollout: stop cycles from growing before you require zero.

```toml
[[rules]]
ruleId = "@codepol/plugin/max-cycle-size"
targets = ["src"]
args.max = 4
args.ignore = ["legacy/**"]
```

| Arg | Type | Description |
| --- | ---- | ----------- |
| `max` | number | **Required.** Maximum members in one cycle |
| `ignore` | string[] | Globs exempt from the budget |

### `dead-module`

Reports modules unreachable from the declared entry points.

```toml
[[rules]]
ruleId = "@codepol/plugin/dead-module"
targets = ["src"]
args.entries = ["src/index.ts", "bin/**"]
args.ignore = ["**/*.spec.ts"]
```

| Arg | Type | Description |
| --- | ---- | ----------- |
| `entries` | string[] | Entry points, as literal paths or globs. Defaults to natural entry points (files with no importers) |
| `ignore` | string[] | Globs exempt from the check |

### `no-layer-violation`

Enforces allowed import direction between named layers.

```toml
[[rules]]
ruleId = "@codepol/plugin/no-layer-violation"
targets = ["src"]

[rules.args.layers.domain]
files = ["src/domain/**"]
denies = ["infra"]

[rules.args.layers.infra]
files = ["src/infra/**"]
allows = ["domain"]
```

Each layer takes:

| Field | Type | Description |
| ----- | ---- | ----------- |
| `files` | string[] | **Required.** Globs owned by this layer |
| `allows` | string[] | Layers this one may import |
| `denies` | string[] | Layers this one may not import |

### `no-cross-package-internal-import`

In a monorepo, forbids reaching into another workspace package's internals
instead of importing its declared entry point.

```toml
[[rules]]
ruleId = "@codepol/plugin/no-cross-package-internal-import"
targets = ["src"]
args.allow = ["@myorg/testing/**"]
args.ignorePackages = ["@myorg/legacy"]
```

| Arg | Type | Description |
| --- | ---- | ----------- |
| `allow` | string[] | Deep-import specifiers that stay permitted |
| `ignorePackages` | string[] | Packages exempt from the check |

### `max-fan-in` / `max-fan-out`

Budget how many importers (`max-fan-in`) or importees (`max-fan-out`) a file
may have. High fan-in flags accidental hubs; high fan-out flags modules that
know too much.

```toml
[[rules]]
ruleId = "@codepol/plugin/max-fan-out"
targets = ["src"]
args.max = 15
args.files = ["src/**"]
args.ignore = ["src/index.ts"]
```

| Arg | Type | Description |
| --- | ---- | ----------- |
| `max` | number | **Required.** Counts strictly greater than this violate |
| `files` | string[] | Limit which files are budgeted (default: all indexed files) |
| `ignore` | string[] | Globs exempt from the budget |

### `entry-point-allowlist`

Only files matching the allowlist may have zero importers. Everything else with
no importers is an unintended orphan.

```toml
[[rules]]
ruleId = "@codepol/plugin/entry-point-allowlist"
targets = ["src"]
args.entries = ["src/index.ts", "bin/**"]
```

| Arg | Type | Description |
| --- | ---- | ----------- |
| `entries` | string[] | **Required.** Globs permitted to be entry points |
| `ignore` | string[] | Globs exempt from the check |

### `no-undeclared-implementer`

Flags classes that structurally satisfy an interface without declaring
`implements`. Keeps intentional contracts explicit.

```toml
[[rules]]
ruleId = "@codepol/plugin/no-undeclared-implementer"
targets = ["src"]
args.interfaces = ["*Repository", "*Service"]
```

| Arg | Type | Description |
| --- | ---- | ----------- |
| `interfaces` | string[] | Name globs of interfaces to enforce |
| `ignore` | string[] | File globs exempt from the check |
| `ignoreImplementers` | string[] | Class-name globs exempt from the check |

---

## Instrumentation

### `require-logger-enter-exit`

Requires every function to call `logger.enter()` and `logger.exit()`, with the
exit call in a `finally`. Identifier, method names, and import are all
configurable.

Languages: `typescript`, `tsx`.

Full documentation: [require-logger-enter-exit](./require-logger-enter-exit.md).

```toml
[[rules]]
ruleId = "@codepol/plugin/require-logger-enter-exit"
targets = ["src"]

[rules.args.logger]
identifier = "logger"
enterMethod = "enter"
exitMethod = "exit"
import = { module = "@your-org/logger", named = "logger" }
```

---

## Python

### `python-dead-code`

Detects unused Python functions, classes, variables, and imports by delegating
to [Vulture](https://github.com/jendrikseipp/vulture), then mapping its findings
back onto the syntax tree so a fix can remove them.

Requires `vulture` on `PATH`. Provided by `@codepol/plugin-vulture` and
re-exported from `@codepol/plugin`.

```toml
[[rules]]
ruleId = "@codepol/plugin/python-dead-code"
targets = ["python-src"]
providers = ["tree-sitter"]
```

For general Python linting, configure a Ruff run instead — see
[Policy Schema → External Tool Runs](../policy-schema.md#external-tool-runs).
