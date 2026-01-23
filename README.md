# Codepol

**Policy-driven code enforcement for TypeScript projects.**

Codepol provides a comprehensive enforcement pipeline that ensures functions are wrapped with configurable logger instrumentation using ESLint rules, Tree-sitter structural checks, and build-time enforcement.

## Architecture

```text
┌───────────────────────────────────────────┐
│            Consumer Codebase              │
│  ┌──────────────────┐  ┌─────────────┐    │
│  │ codepol.config.ts│  │ src/**/*.ts │    │
│  └────────┬─────────┘  └─────────────┘    │
└───────────┼───────────────────────────────┘
            │
            ▼
┌────────────────────────────────────────────┐
│               @codepol/core                │
│  • Load and parse codepol.config.ts        │
│  • Tree-sitter structural analysis         │
│  • Violation detection and formatting      │
└─────────────────────┬──────────────────────┘
                      │
          ┌───────────┼──────────┐
          ▼           ▼          ▼
    ┌──────────┐ ┌──────────┐ ┌──────────┐
    │ ESLint   │ │ esbuild  │ │   CLI    │
    │ Plugin   │ │ Plugin   │ │          │
    └──────────┘ └──────────┘ └──────────┘
```

## Packages

| Package | Description |
| ------- | ----------- |
| [@codepol/core](./packages/core) | Core policy loading, Tree-sitter checks, and enforcement |
| [@codepol/eslint-plugin](./packages/eslint-plugin) | ESLint rule with autofix for logger instrumentation |
| [@codepol/esbuild-plugin](./packages/esbuild-plugin) | esbuild plugin for build-time enforcement |
| [@codepol/plugin](./packages/plugin/README.md) | Logger plugin with Tree-sitter + ESLint capabilities |
| [@codepol/cli](./apps/cli) | Command-line interface for running checks |

## Quick Start

### Installation

```bash
# Install the CLI (includes all dependencies)
pnpm add -D @codepol/cli

# Or install individual packages
pnpm add -D @codepol/core @codepol/eslint-plugin @codepol/plugin
```

### Create a Config File

Create `codepol.config.ts` in your project root:

```typescript
import { defineConfig } from '@codepol/core';

export default defineConfig({
  plugins: ['@codepol/plugin'],
  targets: {
    'typescript-src': {
      language: 'typescript',
      files: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['**/*.spec.ts', '**/*.test.ts'],
    },
  },
  rules: [
    {
      id: 'function-logging',
      ruleId: '@codepol/plugin/require-logger-enter-exit',
      description: 'Ensure all functions have logger instrumentation',
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
  exclude: ['dist/**'],
});
```

### Semantics vs. Language Targets

Each policy rule carries a shared semantic meaning (what you want to enforce) and one or more language targets
(which files and adapters to apply). The `semantics` block describes the rule intent and plugin type, while each
entry in `targets` specifies the language adapter or parser plus file globs. This lets contributors add new
languages without redefining rule meaning or rule ids.

### Configure ESLint

Add to your `eslint.config.js`:

```javascript
import { eslintPluginCreate } from '@codepol/eslint-plugin';
import pluginRules from '@codepol/plugin';

export default [
  {
    plugins: {
      codepol: eslintPluginCreate(pluginRules),
    },
    rules: {
      'codepol/require-logger-enter-exit': 'error',
    },
  },
];
```

### Plugin Loading

Codepol loads rule-level plugin capabilities from `codepol.config.ts` declarations. The CLI uses the enabled rule plugins
to decide which ESLint rules and fix providers to run, while Tree-sitter checking continues to use the policy rules
and their associated tree check providers.

The `@codepol/eslint-plugin` package is a thin adapter that aggregates rules from capability plugins such as
`@codepol/plugin`. Use `eslintPluginCreate(pluginRules)` to assemble the ESLint adapter from any set of
`CodepolPluginRule` instances.

### Run Checks

```bash
# Using CLI
npx codepol

# With autofix
npx codepol --fix

# Watch mode
npx codepol --watch
```

## What It Enforces

Codepol ensures all functions follow this pattern:

```typescript
import { logger } from '@your-org/logger';

export function myFunction(args) {
  logger.enter();  // ← Required as first statement
  try {
    // ... function body ...
  } finally {
    logger.exit();  // ← Required in finally block
  }
}
```

The ESLint plugin can automatically transform functions to add this instrumentation.

## Documentation

- [Getting Started](./docs/getting-started.md) - Step-by-step setup guide
- [Creating Custom Plugins](./docs/creating-custom-plugins.md) - Build custom Codepol plugins
- [Policy Schema](./docs/policy-schema.md) - Complete configuration reference
- [API Reference](./docs/api-reference.md) - Programmatic usage guide

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Type check
pnpm typecheck
```

## License

MIT
