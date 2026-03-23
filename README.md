# Codepol

**Policy-driven code enforcement for TypeScript projects.**

Codepol is a policy enforcement framework for TypeScript that combines ESLint rules, Tree-sitter structural checks, and build-time enforcement. Define custom rules once, enforce them everywhere.

## Architecture

```text
┌────────────────────────────────────────────┐
│             Consumer Codebase              │
│   ┌───────────────────┐  ┌─────────────┐   │
│   │ codepol.config.ts │  │ src/**/*.ts │   │
│   └─────────┬─────────┘  └─────────────┘   │
└─────────────┼──────────────────────────────┘
              │
              ▼
┌────────────────────────────────────────────┐
│               @codepol/core                │
│   • Load and parse codepol.config.ts       │
│   • Tree-sitter structural analysis        │
│   • Violation detection and formatting     │
└─────────────────────┬──────────────────────┘
                      │
          ┌───────────┼───────────┐
          ▼           ▼           ▼
    ┌──────────┐ ┌──────────┐ ┌──────────┐
    │  ESLint  │ │ esbuild  │ │   CLI    │
    │  Plugin  │ │  Plugin  │ │          │
    └──────────┘ └──────────┘ └──────────┘
```

## Packages

| Package | Description |
| ------- | ----------- |
| [@codepol/core](./packages/core) | Core policy loading, Tree-sitter checks, and enforcement |
| [@codepol/plugin-eslint](./packages/plugin-eslint) | ESLint rule with autofix for logger instrumentation |
| [@codepol/plugin-esbuild](./packages/plugin-esbuild) | esbuild plugin for build-time enforcement |
| [@codepol/plugin](./packages/plugin/README.md) | Logger plugin with Tree-sitter + ESLint capabilities |
| [@codepol/cli](./apps/cli) | Command-line interface for running checks |

## Quick Start

### Installation

```bash
# Install the CLI (includes all dependencies)
pnpm add -D @codepol/cli

# Or install individual packages
pnpm add -D @codepol/core @codepol/plugin-eslint @codepol/plugin
```

### Choose Your Runtime

- **Node-capable projects (JS/TS toolchain available):** use `@codepol/cli` via `npx codepol`.
- **Non-Node projects:** use the standalone binary bundle (see "Use the Standalone Binary").

### Use Codepol in 3 Steps

1) Add a `codepol.config.ts` file in your project root.
2) Register the `codepol` ESLint plugin in `eslint.config.*`.
3) Run checks with:

```bash
# Run once
npx codepol

# Apply fixes
npx codepol --fix

# Watch mode
npx codepol --watch
```

Codepol auto-discovers `codepol.config.ts` from the current directory upward. Use `--config` if your config is elsewhere.

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

### Configure ESLint

Add to your `eslint.config.js`:

```javascript
import { eslintPluginCreate } from '@codepol/plugin-eslint';
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

The `@codepol/plugin-eslint` package is a thin adapter that aggregates rules from capability plugins such as
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

### Use the Standalone Binary (Recommended for Non-Node Projects)

For non-Node projects, this is the recommended way to run codepol.
For Node-capable projects, you can use either this binary bundle or `npx codepol`.
Download binaries from [GitHub Releases](https://github.com/fruitiecutiepie/codepol/releases) (or CI artifacts) instead of committing `dist-binary` to your repo.

Download and extract a release bundle, then keep these files in the same directory:

- `codepol`
- `tree-sitter.wasm`
- `tree-sitter-typescript.wasm`
- `tree-sitter-tsx.wasm`
- `tree-sitter-python.wasm`
- `codepol-core-stub.cjs`

Example download flow:

```bash
# Pick a release tag, for example v1.2.3
TAG=v1.2.3

# Download published release bundle (update filename to your release asset name)
curl -fL -o codepol-binary.tar.gz \
  "https://github.com/fruitiecutiepie/codepol/releases/download/${TAG}/codepol-binary-${TAG}-linux-x64.tar.gz"

# Extract bundle
tar -xzf codepol-binary.tar.gz

# Alternative: download from a workflow artifact (requires gh auth)
# gh run download <run-id> --name codepol-binary --dir ./codepol-binary
```

Run from your project root:

```bash
/path/to/codepol
# or
/path/to/codepol --config ./codepol.config.ts
```

## What It Enforces

Codepol enforces custom policy rules defined by plugins. For example, a `no-duplicate-exports` rule that prevents naming collisions across your codebase:

```typescript
// codepol.config.ts
export default defineConfig({
  plugins: ['@your-org/plugin'],
  targets: {
    src: { language: 'typescript', files: ['src/**/*.ts'] },
  },
  rules: [
    {
      ruleId: '@your-org/plugin/no-duplicate-exports',
      args: {
        // Opt-in: which export kinds to check
        include: ['function', 'class', 'type'],
      },
      targets: ['src'],
    },
  ],
});
```

This rule uses Tree-sitter to scan all files for exported identifiers, then reports conflicts:

```
src/auth/UserService.ts:5 - Duplicate export 'UserService' (also in src/legacy/UserService.ts:12)
```

The built-in `@codepol/plugin` includes a `require-logger-enter-exit` rule, but you can create plugins for any structural pattern. See [Creating Custom Plugins](./docs/creating-custom-plugins.md).

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
