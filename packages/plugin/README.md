# @codepol/plugin

## Purpose

`@codepol/plugin` is the default Codepol plugin package. It ships multiple built-in rules (logger
instrumentation, unused exports, naming conventions, duplicate exports, mixed default/named export
style, Python dead code via vulture, and more). Many rules support both Tree-sitter checks and ESLint adapters where
applicable.

## Installation

```bash
pnpm add -D @codepol/plugin
```

## Exports

- **Default export**: an array of all built-in rule plugins (see `src/index.ts`).
- Named exports include individual rules, for example `loggerEnterExitRule`, `enforceCasingRule`,
  `forbiddenDeclarationsRule`, `unusedExportsRule`, etc.

### forbidden-declarations

Rule id: `@codepol/plugin/forbidden-declarations`. Reports configured declaration categories such
as `class`, `interface`, `var`, or import bindings in JS/TS files. See
[docs/rules/forbidden-declarations.md](../../docs/rules/forbidden-declarations.md).

### enforce-casing

Rule id: `@codepol/plugin/enforce-casing`. Enforces allowed casing styles for indexed symbols
and/or file and directory path segments. See [docs/rules/enforce-casing.md](../../docs/rules/enforce-casing.md).

### no-mixed-exports

Rule id: `@codepol/plugin/no-mixed-exports`. Flags files that combine `export default` with named
or re-export statements. See [docs/rules/no-mixed-exports.md](../../docs/rules/no-mixed-exports.md).

## Basic Configuration

Create `codepol.toml` in your project root:

```toml
[[plugins]]
id = "@codepol/plugin"
source = { kind = "builtin" }

[targets.typescript]
language = "typescript"
files = ["src/**/*.ts", "src/**/*.tsx"]
exclude = ["**/*.spec.ts", "**/*.test.ts"]

[[rules]]
id = "function-logging"
ruleId = "@codepol/plugin/require-logger-enter-exit"
description = "Ensure functions log enter/exit"
targets = ["typescript"]

[rules.args.logger]
identifier = "logger"
enterMethod = "enter"
exitMethod = "exit"
import = { module = "@org/logger", named = "logger" }
```
