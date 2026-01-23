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

This rule requires configuration in `codepol.config.ts` to specify the logger module and method names.

### Example

```typescript
// codepol.config.ts
import { defineConfig } from '@codepol/core';

export default defineConfig({
  plugins: ['@codepol/plugin'],
  targets: {
    typescript: {
      language: 'typescript',
      files: ['src/**/*.ts'],
    },
  },
  rules: [
    {
      ruleId: '@codepol/plugin/require-logger-enter-exit',
      args: {
        logger: {
          identifier: 'logger',
          enterMethod: 'enter',
          exitMethod: 'exit',
          import: {
            module: '@your-org/logger',
            named: 'logger',
          },
        },
      },
      targets: ['typescript'],
    },
  ],
});
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

This rule supports auto-fixing via ESLint (`--fix`). It will:
1. Add the import statement for the logger if missing.
2. Wrap the function body in a `try/finally` block.
3. Insert the `enter` and `exit` calls.
