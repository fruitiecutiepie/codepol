# Configuration Reference

Complete reference for the `codepol.config.ts` configuration file.

## Overview

Codepol uses TypeScript configuration files for type-safe policy definitions. The `defineConfig()` helper provides autocomplete and compile-time validation.

```typescript
import { defineConfig } from '@codepol/core';

export default defineConfig({
  plugins: ['@codepol/plugin'],
  targets: { /* ... */ },
  rules: [ /* ... */ ],
  exclude: ['dist/**'],
});
```

## Top-Level Properties

| Property | Type | Required | Description |
| -------- | ---- | -------- | ----------- |
| `targets` | PolicyTargetMap | Yes | Named target definitions that rules reference |
| `rules` | PolicyRule[] | Yes | Array of enforcement rules |
| `exclude` | string[] | No | Global file patterns to exclude |
| `plugins` | PolicyPluginDeclaration[] | No | Plugins available to policy rules |
| `eslintConfigPath` | string | No | Path to ESLint config file (auto-detected if not specified) |

## Targets

Targets define which files to check. They are defined at the top level and referenced by name in rules.

### Defining Targets

Define targets using `targets` (an object mapping names to target definitions):

```typescript
export default defineConfig({
  targets: {
    'typescript-src': {
      language: 'typescript',
      files: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['**/*.spec.ts', '**/*.test.ts'],
    },
    'api-handlers': {
      language: 'typescript',
      files: ['src/api/**/*.ts'],
    },
  },
  rules: [],
});
```

### Target Properties

| Property | Type | Required | Description |
| -------- | ---- | -------- | ----------- |
| `language` | string | Yes | Language adapter or parser identifier |
| `parser` | string | No | Optional parser override |
| `files` | string[] | Yes | Glob patterns for files to include |
| `exclude` | string[] | No | Glob patterns to exclude from this target |

### Language Values

- `typescript`: Matches `.ts` and `.tsx` files
- `tsx`: Matches only `.tsx` files

## PolicyRule

Rules define what to check and reference which targets to apply to.

```typescript
{
  id: 'function-logging',
  ruleId: '@codepol/plugin/require-logger-enter-exit',
  description: 'Ensure all functions have logger instrumentation',
  args: {
    logger: {
      identifier: 'logger',
      enterMethod: 'enter',
      exitMethod: 'exit',
      import: { module: '@org/logger', named: 'logger' },
    },
  },
  targets: ['typescript-src'],
}
```

### PolicyRule Properties

| Property | Type | Required | Description |
| -------- | ---- | -------- | ----------- |
| `id` | string | No | Unique identifier for this rule (defaults to `ruleId`) |
| `ruleId` | string | Yes | The plugin rule identifier (namespaced, e.g. `@org/plugin/rule-name`) |
| `description` | string | No | Human-readable description |
| `severity` | 'error' \| 'warn' \| 'off' | No | Lint severity level (default: 'error') |
| `providers` | string[] | No | Providers to apply this rule to (default: all) |
| `args` | object | No | Rule-specific arguments passed to the plugin |
| `targets` | string[] | Yes | Array of target names referencing entries in top-level `targets` |

### Applying a Rule to Multiple Targets

A rule can reference multiple targets:

```typescript
export default defineConfig({
  targets: {
    frontend: { language: 'typescript', files: ['src/frontend/**/*.ts'] },
    backend: { language: 'typescript', files: ['src/backend/**/*.ts'] },
  },
  rules: [
    {
      ruleId: 'require-logger-enter-exit',
      targets: ['frontend', 'backend'],
    },
  ],
});
```

## LoggerConfig

Configures the logger instrumentation pattern. Provide this under
`rules[].args.logger` for the logger rule.

```typescript
{
  logger: {
    identifier: 'logger',
    enterMethod: 'enter',
    exitMethod: 'exit',
    import: {
      module: '@org/logger',
      named: 'logger',
    },
  },
}
```

### LoggerConfig Properties

| Property | Type | Required | Description |
| -------- | ---- | -------- | ----------- |
| `identifier` | string | Yes | Variable name used in code (e.g., `logger`) |
| `enterMethod` | string | Yes | Method name for function entry (e.g., `enter`) |
| `exitMethod` | string | Yes | Method name for function exit (e.g., `exit`) |
| `import` | LoggerImportConfig | Yes | Import configuration |

#### LoggerImportConfig

| Property | Type | Required | Description |
| -------- | ---- | -------- | ----------- |
| `module` | string | Yes | Module specifier to import from |
| `named` | string | Yes | Named export to import |

## PolicyPluginDeclaration

Declares a plugin module that provides rule capabilities. Accepts either a string (module specifier) or an object with a `module` property.

### String Format (Recommended)

```typescript
export default defineConfig({
  plugins: ['@codepol/plugin', './plugins/custom-plugin.js'],
  // ...
});
```

### Object Format

```typescript
export default defineConfig({
  plugins: [
    { module: '@codepol/plugin' },
    { module: './plugins/custom-plugin.js' },
  ],
  // ...
});
```

### PolicyPluginDeclaration Type

| Format | Type | Description |
| ------ | ---- | ----------- |
| String | `string` | Module specifier or path to import |
| Object | `{ module: string }` | Object with module specifier |

## Glob Patterns

Codepol uses [fast-glob](https://github.com/mrmlnc/fast-glob) for file matching.

### Examples

```typescript
{
  files: [
    'src/**/*.ts',           // All .ts files in src
    'src/**/*.tsx',          // All .tsx files in src
    'lib/**/*.ts',           // All .ts files in lib
    '!**/*.d.ts',            // Exclude declaration files
  ],
  exclude: [
    '**/*.spec.ts',          // Exclude test files
    '**/*.test.ts',          // Exclude test files
    '**/__mocks__/**',       // Exclude mock directories
    '**/__tests__/**',       // Exclude test directories
    '**/fixtures/**',        // Exclude fixture directories
  ],
}
```

### Pattern Syntax

| Pattern | Matches |
| ------- | ------- |
| `*` | Any characters except path separator |
| `**` | Any number of directories |
| `?` | Single character |
| `[abc]` | Any character in brackets |
| `!pattern` | Negates the pattern |

## Complete Example

```typescript
import { defineConfig } from '@codepol/core';

export default defineConfig({
  plugins: ['@codepol/plugin'],
  targets: {
    'typescript-src': {
      language: 'typescript',
      files: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        '**/*.spec.ts',
        '**/*.test.ts',
        '**/*.d.ts',
        '**/__mocks__/**',
        '**/__tests__/**',
      ],
    },
    'api-handlers': {
      language: 'typescript',
      files: ['src/api/**/*.ts'],
    },
  },
  rules: [
    {
      id: 'function-logging',
      ruleId: '@codepol/plugin/require-logger-enter-exit',
      description: 'Ensure all exported functions have logger instrumentation',
      args: {
        logger: {
          identifier: 'logger',
          enterMethod: 'enter',
          exitMethod: 'exit',
          import: {
            module: '@myorg/observability',
            named: 'logger',
          },
        },
      },
      targets: ['typescript-src'],
    },
    {
      id: 'api-logging',
      ruleId: '@codepol/plugin/require-logger-enter-exit',
      description: 'Ensure API handlers have logging',
      args: {
        logger: {
          identifier: 'apiLogger',
          enterMethod: 'enter',
          exitMethod: 'exit',
          import: {
            module: '@myorg/observability',
            named: 'apiLogger',
          },
        },
      },
      targets: ['api-handlers'],
    },
  ],
  exclude: [
    'dist/**',
    'node_modules/**',
    '**/*.config.ts',
    '**/*.config.js',
  ],
});
```

## Custom Logger Examples

### Winston

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
          identifier: 'log',
          enterMethod: 'info',
          exitMethod: 'info',
          import: { module: './logger', named: 'log' },
        },
      },
      targets: ['src'],
    },
  ],
});
```

### Pino

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
          identifier: 'pino',
          enterMethod: 'trace',
          exitMethod: 'trace',
          import: { module: './pino-logger', named: 'pino' },
        },
      },
      targets: ['src'],
    },
  ],
});
```

### OpenTelemetry Tracing

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
          identifier: 'tracer',
          enterMethod: 'startSpan',
          exitMethod: 'endSpan',
          import: { module: '@opentelemetry/api', named: 'tracer' },
        },
      },
      targets: ['src'],
    },
  ],
});
```

## Validation

TypeScript provides compile-time validation through the `defineConfig()` helper.

### Common Errors

#### Missing Required Fields

TypeScript will report errors for missing required properties:

```text
Property 'targets' is missing in type '{ rules: never[]; }'
```

#### Invalid Target Reference

Runtime error when a rule references a non-existent target:

```text
Error: Rule "function-logging" references target "unknown-target" which is not defined in policy.targets
```

#### Empty Targets Array

TypeScript will catch this at compile time, and runtime validation will report:

```text
Error: rules[0].targets: must have at least 1 item
```

## TypeScript Types

The types are available from `@codepol/core`:

```typescript
import type {
  CodepolConfig,
  PolicyFile,
  PolicyRule,
  PolicyRuleTarget,
  PolicyTargetMap,
  CodepolPluginRule,
  PolicyPluginDeclaration,
  LoggerConfig,
  LoggerImportConfig,
} from '@codepol/core';

import { defineConfig } from '@codepol/core';

// Using defineConfig for type-safe configuration
export default defineConfig({
  plugins: ['@codepol/plugin'],
  targets: {
    'typescript-src': { language: 'typescript', files: ['src/**/*.ts'] },
  },
  rules: [
    {
      ruleId: '@codepol/plugin/require-logger-enter-exit',
      args: {
        logger: {
          identifier: 'logger',
          enterMethod: 'enter',
          exitMethod: 'exit',
          import: { module: '@org/logger', named: 'logger' },
        },
      },
      targets: ['typescript-src'],
    },
  ],
});
```
