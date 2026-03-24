# require-logger-enter-exit

Enforces that all functions are wrapped with `logger.enter()` and `logger.exit()` calls.

## Rule ID

`@codepol/plugin/require-logger-enter-exit`

## Description

This rule ensures that every function execution is traced by logging its entry and exit. This is critical for observability and debugging in production environments.

The rule checks for:
1. A call to `logger.enter()` at the start of the function body.
2. A `try/finally` block wrapping the function logic.
3. A call to `logger.exit()` in the `finally` block.

## Configuration

This rule requires configuration in `codepol.toml` to specify the logger module and method names.

### Example

```toml
[[plugins]]
id = "@codepol/plugin"
source = { kind = "builtin" }

[targets.typescript]
language = "typescript"
files = ["src/**/*.ts"]

[[rules]]
ruleId = "@codepol/plugin/require-logger-enter-exit"
targets = ["typescript"]

[rules.args.logger]
identifier = "logger"
enterMethod = "enter"
exitMethod = "exit"
import = { module = "@your-org/logger", named = "logger" }
```

## Valid Code

```typescript
import { logger } from '@your-org/logger';

export function doSomething() {
  logger.enter();
  try {
    // Function logic...
    return 42;
  } finally {
    logger.exit();
  }
}
```

## Invalid Code

```typescript
export function doSomething() {
  // Missing logger.enter()
  // Missing try/finally
  // Missing logger.exit()
  return 42;
}
```

## Auto-Fix

This rule is currently diagnostic-only. It can be adapted into ESLint for inline reporting, but it does not ship a built-in automatic fix.
