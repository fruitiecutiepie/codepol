# Policy Schema Reference

Complete reference for the `policy.json` configuration file.

## Schema

You can enable IDE autocompletion by adding the `$schema` property:

```json
{
  "$schema": "https://raw.githubusercontent.com/codepol/codepol/main/policy.schema.json"
}
```

## Top-Level Properties

| Property | Type | Required | Description |
| -------- | ---- | -------- | ----------- |
| `$schema` | string | No | JSON schema URL for IDE support |
| `rules` | PolicyRule[] | Yes | Array of enforcement rules |
| `exclude` | string[] | No | Global file patterns to exclude |
| `logger` | LoggerConfig | Yes | Logger configuration |

## PolicyRule

Defines which files to check and how.

```json
{
  "id": "function-logging",
  "description": "Ensure all functions have logger instrumentation",
  "language": "typescript",
  "files": ["src/**/*.ts"],
  "exclude": ["**/*.spec.ts"]
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

### Language Values

- `typescript`: Matches `.ts` and `.tsx` files
- `tsx`: Matches only `.tsx` files

## LoggerConfig

Configures the logger instrumentation pattern.

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
  "$schema": "https://raw.githubusercontent.com/codepol/codepol/main/policy.schema.json",
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
      ]
    },
    {
      "id": "api-logging",
      "description": "Ensure API handlers have logging",
      "language": "typescript",
      "files": [
        "src/api/**/*.ts"
      ]
    }
  ],
  "exclude": [
    "dist/**",
    "node_modules/**",
    "**/*.config.ts",
    "**/*.config.js"
  ],
  "logger": {
    "identifier": "logger",
    "enterMethod": "enter",
    "exitMethod": "exit",
    "import": {
      "module": "@myorg/observability",
      "named": "logger"
    }
  }
}
```

## Custom Logger Examples

### Winston

```json
{
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
```

### Pino

```json
{
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
```

### OpenTelemetry Tracing

```json
{
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
```

## Validation

The policy file is validated against the JSON schema. Common errors:

### Missing Required Fields

```text
Error: policy.json validation failed
- rules: is required
- logger: is required
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
  PolicyRule,
  LoggerConfig,
  LoggerImportConfig,
} from '@codepol/core';

const policy: PolicyFile = {
  rules: [...],
  logger: {...},
};
```
