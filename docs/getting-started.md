# Getting Started with Codepol

This guide walks you through setting up codepol in your TypeScript project.

## Prerequisites

- Node.js 18 or later
- A TypeScript project
- pnpm, npm, or yarn

## Step 1: Install Packages

Choose the packages you need:

### Full Setup (Recommended)

```bash
# Install CLI (includes core)
pnpm add -D @codepol/cli

# For ESLint integration
pnpm add -D @codepol/eslint-plugin @typescript-eslint/utils

# For esbuild integration
pnpm add -D @codepol/esbuild-plugin esbuild
```

### Minimal Setup (ESLint only)

```bash
pnpm add -D @codepol/eslint-plugin @codepol/core
```

## Step 2: Create a Policy File

Create `policy.json` in your project root:

```json
{
  "$schema": "https://raw.githubusercontent.com/fruitiecutiepie/codepol/master/policy.schema.json",
  "rules": [
    {
      "id": "function-logging",
      "semantics": {
        "description": "Ensure all functions have logger.enter/exit instrumentation",
        "type": "logger"
      },
      "targets": [
        {
          "language": "typescript",
          "files": ["src/**/*.ts", "src/**/*.tsx"],
          "exclude": [
            "**/*.spec.ts",
            "**/*.test.ts",
            "**/__mocks__/**",
            "**/__tests__/**"
          ]
        }
      ]
    }
  ],
  "exclude": [
    "dist/**",
    "node_modules/**",
    "*.config.ts"
  ],
  "logger": {
    "identifier": "logger",
    "enterMethod": "enter",
    "exitMethod": "exit",
    "import": {
      "module": "@your-org/logger",
      "named": "logger"
    }
  }
}
```

## Step 3: Configure ESLint

### Flat Config (eslint.config.js) - Recommended

```javascript
import codepolPlugin from '@codepol/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      codepol: codepolPlugin,
    },
    rules: {
      'codepol/require-logger-enter-exit': 'error',
    },
  },
];
```

### Legacy Config (.eslintrc.cjs)

```javascript
module.exports = {
  parser: '@typescript-eslint/parser',
  plugins: ['@codepol/eslint-plugin'],
  rules: {
    'codepol/require-logger-enter-exit': 'error',
  },
};
```

Rule keys use the ESLint plugin name `codepol` (for example, `codepol/require-logger-enter-exit`) even when the package is scoped.

## Step 4: Create Your Logger

Create a logger module that matches your policy configuration:

```typescript
// src/logger.ts
export const logger = {
  enter(context?: Record<string, unknown>) {
    console.log('[ENTER]', context);
  },
  exit(context?: Record<string, unknown>) {
    console.log('[EXIT]', context);
  },
};
```

Update your `policy.json` to reference it:

```json
{
  "logger": {
    "identifier": "logger",
    "enterMethod": "enter",
    "exitMethod": "exit",
    "import": {
      "module": "./logger",
      "named": "logger"
    }
  }
}
```

## Step 5: Add NPM Scripts

Add to your `package.json`:

```json
{
  "scripts": {
    "lint:policy": "codepol",
    "lint:policy:fix": "codepol --fix",
    "lint:policy:watch": "codepol --watch"
  }
}
```

## Step 6: Run Your First Check

```bash
pnpm lint:policy
```

If you have functions without instrumentation, you'll see:

```text
src/utils.ts
  15:1  error  Functions must invoke logger.enter and logger.exit  codepol/require-logger-enter-exit

✖ 1 problem (1 error, 0 warnings)
```

## Step 7: Auto-Fix Violations

Run with `--fix` to automatically add instrumentation:

```bash
pnpm lint:policy:fix
```

Before:

```typescript
export function processData(data: Data) {
  validate(data);
  return transform(data);
}
```

After:

```typescript
import { logger } from './logger';

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

## Optional: esbuild Integration

If you use esbuild, add build-time enforcement:

```typescript
// build.ts
import { build } from 'esbuild';
import { policyPlugin } from '@codepol/esbuild-plugin';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  outdir: 'dist',
  plugins: [
    policyPlugin({
      policyPath: './policy.json',
    }),
  ],
});
```

## Optional: CI Integration

### GitHub Actions

```yaml
name: Policy Check
on: [push, pull_request]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'
      - run: pnpm install
      - run: pnpm lint:policy
```

### Pre-commit Hook

Using husky:

```bash
pnpm add -D husky
npx husky init
echo "pnpm lint:policy" > .husky/pre-commit
```

## Next Steps

- Read the [Policy Schema Reference](./policy-schema.md) for all configuration options
- Check the [API Reference](./api-reference.md) for programmatic usage
- Explore individual package READMEs for detailed documentation
