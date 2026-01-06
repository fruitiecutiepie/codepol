# @codepol/eslint-plugin

ESLint plugin for enforcing logger instrumentation with autofix support.

## Installation

```bash
pnpm add -D @codepol/eslint-plugin @codepol/core eslint @typescript-eslint/utils
```

## Features

- Detects functions missing `logger.enter()` and `logger.exit()` calls
- Automatic fix transforms functions to add proper instrumentation
- Adds missing logger imports automatically
- Respects policy file exclusion patterns
- Works with TypeScript and TSX files

## Configuration

### ESLint Flat Config (eslint.config.js)

```javascript
import codepolPlugin from '@codepol/eslint-plugin';

export default [
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: {
      codepol: codepolPlugin,
    },
    rules: {
      'codepol/require-logger-enter-exit': 'error',
    },
  },
];
```

### With Custom Policy Path

```javascript
export default [
  {
    plugins: {
      codepol: codepolPlugin,
    },
    rules: {
      'codepol/require-logger-enter-exit': ['error', {
        policyPath: './config/policy.json',
      }],
    },
  },
];
```

### Legacy Config (.eslintrc.cjs)

```javascript
module.exports = {
  plugins: ['@codepol/eslint-plugin'],
  rules: {
    'codepol/require-logger-enter-exit': 'error',
  },
};
```

## Rule: `require-logger-enter-exit`

Ensures all functions have proper logger instrumentation.

### What It Checks

1. `logger.enter()` must be the first statement in the function body
2. The function body must be wrapped in a `try/finally` block
3. `logger.exit()` must be called in the `finally` block

### Before (Invalid)

```typescript
export function processData(data: Data) {
  validate(data);
  return transform(data);
}
```

### After (Valid)

```typescript
import { logger } from '@org/logger';

export function processData(data: Data) {
  logger.enter();
  try {
    validate(data);
    return transform(data);
  } finally {
    logger.exit();
  }
}
```

### Auto-Fix

Run ESLint with `--fix` to automatically add the instrumentation:

```bash
eslint --fix src/**/*.ts
```

The auto-fix will:

1. Wrap the function body in `try/finally`
2. Add `logger.enter()` before the try block
3. Add `logger.exit()` in the finally block
4. Add the logger import if not present

### Rule Options

```typescript
type RuleOptions = {
  /** Path to the policy.json file (default: './policy.json') */
  policyPath?: string;
};
```

## Policy Integration

The rule reads your `policy.json` to determine:

- Which files to check (via `files` patterns)
- Which files to exclude (via `exclude` patterns)
- Logger configuration (identifier, methods, import)

Example `policy.json`:

```json
{
  "rules": [
    {
      "id": "function-logging",
      "semantics": {
        "description": "Ensure functions have logger instrumentation",
        "type": "logger"
      },
      "targets": [
        {
          "language": "typescript",
          "files": ["src/**/*.ts"],
          "exclude": ["**/*.spec.ts"]
        }
      ]
    }
  ],
  "logger": {
    "identifier": "logger",
    "enterMethod": "enter",
    "exitMethod": "exit",
    "import": {
      "module": "@org/logger",
      "named": "logger"
    }
  }
}
```

## License

MIT
