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
pnpm add -D @codepol/plugin-eslint @codepol/plugin @typescript-eslint/utils

# For esbuild integration
pnpm add -D @codepol/plugin-esbuild esbuild
```

### Minimal Setup (ESLint only)

```bash
pnpm add -D @codepol/plugin-eslint @codepol/core @codepol/plugin
```

## Step 2: Create a Config File

Create `codepol.config.ts` in your project root:

```typescript
// codepol.config.ts
import { defineConfig } from '@codepol/core';

export default defineConfig({
  // Optional: specify ESLint config path (auto-detected if not specified)
  // eslintConfigPath: './eslint.config.ts',

  plugins: ['@codepol/plugin'],
  targets: {
    'typescript-src': {
      language: 'typescript',
      files: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        '**/*.spec.ts',
        '**/*.test.ts',
        '**/__mocks__/**',
        '**/__tests__/**',
      ],
    },
  },
  rules: [
    {
      id: 'function-logging',
      ruleId: '@codepol/plugin/require-logger-enter-exit',
      description: 'Ensure all functions have logger.enter/exit instrumentation',
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
      targets: ['typescript-src'],
    },
  ],
  exclude: ['dist/**', 'node_modules/**', '*.config.ts'],
});
```

The config file is auto-discovered from your project root. Supported formats:
- `codepol.config.ts` (recommended)
- `codepol.config.js`, `.mjs`, `.cjs`

> **Tip:** Using TypeScript config gives you autocomplete and type checking via `defineConfig()`.

> **Tip:** Multiple rules can reference the same target. See [Policy Schema Reference](./policy-schema.md) for more details.

## Step 3: Configure ESLint

### Flat Config (eslint.config.js) - Recommended

```javascript
import { eslintPluginCreate } from '@codepol/plugin-eslint';
import codepolPlugin from '@codepol/plugin';
import tseslint from 'typescript-eslint';

export default [
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      codepol: eslintPluginCreate(codepolPlugin),
    },
    rules: {
      'codepol/require-logger-enter-exit': 'error',
      eqeqeq: 'error',
    },
  },
];
```

### Legacy Config (.eslintrc.cjs)

```javascript
const { eslintPluginCreate } = require('@codepol/plugin-eslint');
const codepolPlugin = require('@codepol/plugin').default;
const tseslint = require('typescript-eslint');

module.exports = {
  parser: tseslint.parser,
  plugins: {
    codepol: eslintPluginCreate(codepolPlugin),
  },
  rules: {
    'codepol/require-logger-enter-exit': 'error',
    eqeqeq: 'error',
  },
};
```

Rule keys use the ESLint plugin name `codepol` (for example, `codepol/require-logger-enter-exit`) even when the package is scoped.

::: tip Severity Precedence
When running ESLint directly (`eslint .`), your eslint.config.js rules apply.

When running `codepol check`, severity is read from `codepol.config.ts` and passed via ESLint's `overrideConfig`, which takes precedence over your eslint.config.js for codepol rules.
:::

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

Update your `codepol.config.ts` to reference it:

```typescript
import { defineConfig } from '@codepol/core';

export default defineConfig({
  plugins: ['@codepol/plugin'],
  targets: {
    src: { language: 'typescript', files: ['src/**/*.ts'] },
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
            module: './logger',
            named: 'logger',
          },
        },
      },
      targets: ['src'],
    },
  ],
});
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
import { esbuildPluginCreate } from '@codepol/plugin-esbuild';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  outdir: 'dist',
  plugins: [
    // Zero-config: auto-discovers codepol.config.ts
    esbuildPluginCreate(),
  ],
});
```

Or with explicit config path:

```typescript
plugins: [
  esbuildPluginCreate({
    configPath: './config/codepol.config.ts',
  }),
]
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

- [Policy Schema Reference](./policy-schema.md) - All configuration options
- [Creating Custom Plugins](./creating-custom-plugins.md) - Build your own rule plugins
- [API Reference](./api-reference.md) - Programmatic usage and type definitions
