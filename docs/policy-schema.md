# Configuration Reference

Complete reference for `codepol.toml`.

## Overview

Codepol uses a TOML config file so the policy stays language-agnostic and easy to author in any repo. The config is pure data:

- `targets` define which files belong to a named scope.
- `rules` define what to enforce against those targets.
- `plugins` declare where rule capabilities come from.
- `tools` declare when external analyzers should run.

External linters (ESLint, Biome, Ruff) are configured under top-level
`tools.<tool>.runs`. Codepol rules still live under `[[rules]]`.

## Complete Example

```toml
exclude = ["dist/**", "node_modules/**"]

[[plugins]]
id = "@codepol/plugin"
source = { kind = "builtin" }

[[plugins]]
id = "@your-org/custom-plugin"

[plugins.source]
kind = "process"
command = "python3"
args = ["./tools/codepol_plugin.py"]
timeoutMs = 5000

[targets.typescript-src]
language = "typescript"
files = ["src/**/*.ts", "src/**/*.tsx"]
exclude = ["**/*.spec.ts", "**/*.test.ts"]

[tools.eslint]
[[tools.eslint.runs]]
targets = ["typescript-src"]
configPath = "./eslint.config.mjs"

[[rules]]
id = "function-logging"
ruleId = "@codepol/plugin/require-logger-enter-exit"
severity = "error"
targets = ["typescript-src"]

[rules.args.logger]
identifier = "logger"
enterMethod = "enter"
exitMethod = "exit"
import = { module = "@your-org/logger", named = "logger" }

[[rules]]
ruleId = "@your-org/custom-plugin/no-duplicate-exports"
severity = "warn"
targets = ["typescript-src"]
```

## Top-Level Properties

| Property | Type | Required | Description |
| -------- | ---- | -------- | ----------- |
| `targets` | table | Yes | Named target definitions referenced by rules |
| `rules` | array of tables | Yes | Enforcement rules |
| `plugins` | array of tables | No | Built-in or subprocess plugin declarations |
| `tools` | table | No | External analyzer executions grouped by tool |
| `exclude` | string array | No | Global file patterns to exclude |

### External Tool Runs

Codepol ships first-class tool-run configuration for external analyzers. Each
run decides which targets the tool sees and which tool-specific config should
be applied. The tool's own config file still decides which native rules fire;
Codepol decides when/where the tool runs and normalizes the resulting
diagnostics.

| Tool | Run fields |
| ---- | ---------- |
| `tools.eslint.runs` | `targets`, `configPath` |
| `tools.biome.runs` | `targets`, `biomeBin`, `configPath`, `extraArgs` |
| `tools.ruff.runs` | `targets`, `ruffBin`, `select`, `ignore`, `fixable`, `configPath`, `extraArgs` |

```toml
[tools.ruff]
[[tools.ruff.runs]]
targets = ["python-src"]
select = ["E", "F", "I"]
ignore = ["E501"]

[tools.biome]
[[tools.biome.runs]]
targets = ["ts-src"]
configPath = "./biome.json"

[tools.eslint]
[[tools.eslint.runs]]
targets = ["ts-src"]
configPath = "./eslint.config.mjs"
```

An ESLint run is required whenever any ESLint-backed rule appears in the policy
(for example `@codepol/plugin/no-unused-vars`); without it, the ESLint analyzer
cannot resolve a config and fails at load time.

## Targets

Targets live under the top-level `targets` table and are referenced by name from rules.

```toml
[targets.typescript-src]
language = "typescript"
files = ["src/**/*.ts", "src/**/*.tsx"]
exclude = ["**/*.spec.ts", "**/*.test.ts"]

[targets.python-src]
language = "python"
files = ["src/**/*.py"]
```

### Target Fields

| Field | Type | Required | Description |
| ----- | ---- | -------- | ----------- |
| `language` | string | Yes | Language identifier |
| `files` | string array | Yes | Include globs |
| `exclude` | string array | No | Exclude globs |
| `parser` | string | No | Optional parser override |

## Rules

Rules are array items under `[[rules]]`.

```toml
[[rules]]
id = "function-logging"
ruleId = "@codepol/plugin/require-logger-enter-exit"
description = "Ensure functions are instrumented"
severity = "error"
providers = ["eslint", "tree-sitter"]
targets = ["typescript-src"]
```

### Rule Fields

| Field | Type | Required | Description |
| ----- | ---- | -------- | ----------- |
| `ruleId` | string | Yes | Namespaced rule identifier, for example `@scope/plugin/rule-name` |
| `targets` | string array | Yes | Names of target entries to apply the rule to |
| `id` | string | No | User-defined identifier for reporting |
| `description` | string | No | Human-readable summary |
| `severity` | `"error" \| "warn" \| "off"` | No | Default is `error` |
| `providers` | string array | No | Optional provider filter |
| `args` | table | No | Rule-specific arguments |
| `fix` | `"on-save" \| "manual" \| "never"` | No | How autofixes for this rule are surfaced. Default is `manual`. |

### Fix Application (`fix`)

Controls how autofixes for this rule are surfaced across editor and CLI
flows:

- `manual` (default): fixes are exposed as per-diagnostic quickfixes
  through the lightbulb / Quick Fix menu. Nothing runs automatically.
- `on-save`: the rule participates in the LSP `source.fixAll.codepol`
  code action. Editors that include `source.fixAll.codepol` in their
  `editor.codeActionsOnSave` setting will apply these fixes on save.
- `never`: the rule is hidden from every fix surface — no quickfix, no
  on-save participation, no `codepol --fix` pass.

Precedence rules:

- `severity = "off"` forces `fix = "never"` regardless of the declared
  value.
- A rule whose plugin declares neither a `fixProvider` nor a
  `treeCheckProvider` is silently treated as `"never"` at runtime —
  there is no edit the engine can produce.

```toml
[[rules]]
ruleId = "@codepol/plugin/enforce-casing"
targets = ["typescript-src"]
fix = "on-save"
```

### Rule Args

Rule arguments are plugin-defined. For the built-in logger rule:

```toml
[[rules]]
ruleId = "@codepol/plugin/require-logger-enter-exit"
targets = ["typescript-src"]

[rules.args.logger]
identifier = "logger"
enterMethod = "enter"
exitMethod = "exit"
import = { module = "@your-org/logger", named = "logger" }
```

For the built-in `enforce-casing` rule, configure symbol kinds and/or path segments. Supported styles per name: `camelCase`, `snake_case`, `PascalCase`, `SCREAMING_SNAKE_CASE`, `kebab-case`. Omitted symbol kinds are not checked. Path checks apply to each directory segment and the file basename (see [enforce-casing](/rules/enforce-casing) for details).

```toml
[[rules]]
ruleId = "@codepol/plugin/enforce-casing"
targets = ["typescript-src"]

[rules.args.symbols]
function = ["camelCase"]
class = ["PascalCase"]
interface = ["PascalCase"]
type = ["PascalCase"]
variable = ["camelCase"]
const = ["camelCase", "SCREAMING_SNAKE_CASE"]

[rules.args.paths]
file = ["kebab-case"]
directory = ["kebab-case"]
ignoreExtensions = true
```

The built-in `no-mixed-exports` rule applies to JavaScript and TypeScript targets matched by the rule (see [no-mixed-exports](/rules/no-mixed-exports)). It accepts an optional `args.preferredStyle = "named" | "default"` to control which side of a mixed module is treated as the preferred export style in diagnostics.

```toml
[[rules]]
ruleId = "@codepol/plugin/no-mixed-exports"
targets = ["typescript-src"]
args.preferredStyle = "named"
```

The built-in `forbidden-declarations` rule bans configured declaration categories in JS/TS files. Use `args.symbols`, `args.bindings`, and `args.syntax` to choose which declaration families to report (see [forbidden-declarations](/rules/forbidden-declarations)).

```toml
[[rules]]
ruleId = "@codepol/plugin/forbidden-declarations"
targets = ["typescript-src"]
args.symbols = ["class", "interface", "type"]
args.bindings = ["import"]
args.syntax = ["var"]
```

## Plugin Declarations

Codepol no longer resolves plugins as Node module imports from the config file. Policies declare a stable plugin `id` plus a transport-specific `source`.

### Built-In Plugin

```toml
[[plugins]]
id = "@codepol/plugin"
source = { kind = "builtin" }
```

Use this for plugins that are registered by the host process, for example the CLI or an ESLint config that calls `pluginBuiltinRegister()`.

### Subprocess Plugin

```toml
[[plugins]]
id = "@your-org/custom-plugin"

[plugins.source]
kind = "process"
command = "python3"
args = ["./tools/codepol_plugin.py"]
cwd = "."
timeoutMs = 5000
```

### Plugin Fields

| Field | Type | Required | Description |
| ----- | ---- | -------- | ----------- |
| `id` | string | Yes | Stable plugin namespace used in `ruleId` |
| `source.kind` | `"builtin" \| "process"` | Yes | Plugin transport |
| `source.command` | string | Process only | Executable or script to launch |
| `source.args` | string array | No | Process arguments |
| `source.cwd` | string | No | Working directory for process plugins |
| `source.env` | table | No | Extra environment variables |
| `source.timeoutMs` | integer | No | Request timeout in milliseconds |

## Provider Filtering

Use `providers` when you want a rule to apply only on specific hosts:

```toml
[[rules]]
ruleId = "@codepol/plugin/require-logger-enter-exit"
providers = ["tree-sitter"]
targets = ["typescript-src"]
```

Common provider values:

- `eslint`
- `biome`
- `tree-sitter`
- `ruff`

If omitted, the rule applies everywhere the host can adapt it.

`biome` providers are executed by the CLI via `biome lint` on JS/TS files that match **that run's** targets (and only when the rule selects the `biome` provider, if `providers` is set). Biome’s own config discovery still applies unless the run supplies an explicit `configPath`. Multiple distinct tool-run configurations result in multiple subprocess runs (one per normalized config group), and each group only sees the files actually matched by its configured targets. The same grouping model applies to `tools.eslint.runs` and `tools.ruff.runs` — declaring the same tool multiple times with different config fields (for example `configPath`, `extraArgs`, or Ruff `select` / `ignore`) fans out into one subprocess invocation per distinct resolved config. Policy `severity` does not currently alter Biome diagnostics; configure rule behavior in Biome’s config instead.

## Notes

- `codepol.toml` is the only discovered config format.
- Built-in rule IDs keep their namespaced form, for example `@codepol/plugin/no-interface`, `@codepol/plugin/forbidden-declarations`, or `@codepol/plugin/enforce-casing`.
- Direct ESLint usage should combine `providerParserRuntimeInit('eslint')`, `policyPluginRulesGet()`, and `providerRulesConfigGet('eslint')`.
