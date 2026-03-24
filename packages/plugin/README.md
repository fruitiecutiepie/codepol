# @codepol/plugin

## Purpose

`@codepol/plugin` provides the logger enforcement rule plugin for Codepol. It supplies both
Tree-sitter checking and ESLint rule integration to ensure functions are instrumented with logger
enter/exit calls.

## Installation

```bash
pnpm add -D @codepol/plugin
```

## Exports

- **Default export**: an array of rule plugins (currently `[loggerEnterExitRule]`).
- `loggerEnterExitRule`: the rule plugin definition for `require-logger-enter-exit`.

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
