# Policy Schema Reference

Complete reference for the `policy.json` configuration file.

## Schema

You can enable IDE autocompletion by adding the `$schema` property:

```json
{
  "$schema": "https://raw.githubusercontent.com/fruitiecutiepie/codepol/master/policy.schema.json"
}
```

## Top-Level Properties

| Property | Type | Required | Description |
| -------- | ---- | -------- | ----------- |
| `$schema` | string | No | JSON schema URL for IDE support |
| `plugins` | string[] | No | Module specifiers or local paths for policy plugins |
| `pluginConfig` | Record<string, unknown> | No | Plugin-level configuration map keyed by plugin type |
| `rules` | PolicyRule[] | Yes | Array of enforcement rules |
| `exclude` | string[] | No | Global file patterns to exclude |

## PolicyPlugins

Defines which plugins are available and how they are configured.

```json
{
  "plugins": ["@codepol/plugin-logger"],
  "pluginConfig": {
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
}
```

## PolicyRule

Defines which files to check and how.

```json
{
  "id": "function-logging",
  "description": "Ensure all functions have logger instrumentation",
  "language": "typescript",
  "files": ["src/**/*.ts"],
  "exclude": ["**/*.spec.ts"],
  "type": "logger",
  "config": {}
}
```

### PolicyRule Properties

| Property | Type | Required | Description |
| -------- | ---- | -------- | ----------- |
| `id` | string | Yes | Unique identifier for this rule |
| `description` | string | Yes | Human-readable description |
| `language` | `"typescript"` \| `"tsx"` | Yes | Target file type |
| `files` | string[] | Yes | Glob patterns for files to include |
| `exclude` | string[] | No | Glob patterns to exclude from this rule |
| `type` | string | Yes | Plugin type that evaluates the rule |
| `config` | Record<string, unknown> | Yes | Rule-specific configuration passed to the plugin |

### Language Values

- `typescript`: Matches `.ts` and `.tsx` files
- `tsx`: Matches only `.tsx` files

## LoggerConfig (example)

Example configuration for a logger plugin.

```json
{
  "identifier": "logger",
  "enterMethod": "enter",
  "exitMethod": "exit",
  "import": {
    "module": "@org/logger",
    "named": "logger"
  }
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

## Glob Patterns

Codepol uses [fast-glob](https://github.com/mrmlnc/fast-glob) for file matching.

### Examples

```json
{
  "files": [
    "src/**/*.ts",           // All .ts files in src
    "src/**/*.tsx",          // All .tsx files in src
    "lib/**/*.ts",           // All .ts files in lib
    "!**/*.d.ts"             // Exclude declaration files
  ],
  "exclude": [
    "**/*.spec.ts",          // Exclude test files
    "**/*.test.ts",          // Exclude test files
    "**/__mocks__/**",       // Exclude mock directories
    "**/__tests__/**",       // Exclude test directories
    "**/fixtures/**"         // Exclude fixture directories
  ]
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

```json
{
  "$schema": "https://raw.githubusercontent.com/fruitiecutiepie/codepol/master/policy.schema.json",
  "plugins": ["@codepol/plugin-logger"],
  "pluginConfig": {
    "logger": {
      "identifier": "logger",
      "enterMethod": "enter",
      "exitMethod": "exit",
      "import": {
        "module": "@myorg/observability",
        "named": "logger"
      }
    }
  },
  "rules": [
    {
      "id": "function-logging",
      "description": "Ensure all exported functions have logger instrumentation",
      "language": "typescript",
      "files": [
        "src/**/*.ts",
        "src/**/*.tsx"
      ],
      "exclude": [
        "**/*.spec.ts",
        "**/*.test.ts",
        "**/*.d.ts",
        "**/__mocks__/**",
        "**/__tests__/**"
      ],
      "type": "logger",
      "config": {}
    },
    {
      "id": "api-logging",
      "description": "Ensure API handlers have logging",
      "language": "typescript",
      "files": [
        "src/api/**/*.ts"
      ],
      "type": "logger",
      "config": {}
    }
  ],
  "exclude": [
    "dist/**",
    "node_modules/**",
    "**/*.config.ts",
    "**/*.config.js"
  ]
}
```

## Custom Logger Examples

### Winston

```json
{
  "pluginConfig": {
    "logger": {
      "identifier": "log",
      "enterMethod": "info",
      "exitMethod": "info",
      "import": {
        "module": "./logger",
        "named": "log"
      }
    }
  }
}
```

### Pino

```json
{
  "pluginConfig": {
    "logger": {
      "identifier": "pino",
      "enterMethod": "trace",
      "exitMethod": "trace",
      "import": {
        "module": "./pino-logger",
        "named": "pino"
      }
    }
  }
}
```

### OpenTelemetry Tracing

```json
{
  "pluginConfig": {
    "logger": {
      "identifier": "tracer",
      "enterMethod": "startSpan",
      "exitMethod": "endSpan",
      "import": {
        "module": "@opentelemetry/api",
        "named": "tracer"
      }
    }
  }
}
```

## Validation

The policy file is validated against the JSON schema. Common errors:

### Missing Required Fields

```text
Error: policy.json validation failed
- rules: is required
```

### Invalid Language

```text
Error: policy.json validation failed
- rules[0].language: must be equal to one of the allowed values (typescript, tsx)
```

### Empty Files Array

```text
Error: policy.json validation failed
- rules[0].files: must have at least 1 item
```

## TypeScript Types

The types are available from `@codepol/core`:

```typescript
import type {
  PolicyFile,
  PolicyPlugins,
  PolicyRule,
  LoggerConfig,
  LoggerImportConfig,
} from '@codepol/core';

const policy: PolicyFile = {
  rules: [...],
  plugins: ['@codepol/plugin-logger'],
  pluginConfig: {
    logger: {
      identifier: 'logger',
      enterMethod: 'enter',
      exitMethod: 'exit',
      import: { module: '@org/logger', named: 'logger' },
    },
  },
};
```
