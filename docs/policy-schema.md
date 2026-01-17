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
| `targets` | PolicyTargetMap | No | Named target definitions that rules can reference |
| `rules` | PolicyRule[] | Yes | Array of enforcement rules |
| `exclude` | string[] | No | Global file patterns to exclude |
| `plugins` | PolicyPluginDeclaration[] | No | Plugins available to policy rules |

## Named Targets

Named targets let you define file patterns once and reference them across multiple rules. This reduces repetition when several rules apply to the same files.

### Defining Named Targets

Define targets at the top level using `targets` (an object mapping names to target definitions):

```json
{
  "targets": {
    "typescript-src": {
      "language": "typescript",
      "files": ["src/**/*.ts", "src/**/*.tsx"],
      "exclude": ["**/*.spec.ts", "**/*.test.ts"]
    },
    "api-handlers": {
      "language": "typescript",
      "files": ["src/api/**/*.ts"]
    }
  }
}
```

### Referencing Named Targets

Rules can reference a named target using the `target` property:

```json
{
  "rules": [
    { "ruleId": "no-console", "target": "typescript-src" },
    { "ruleId": "require-auth", "target": "api-handlers" }
  ]
}
```

### Inline Targets (Alternative)

Rules can also define targets inline using the `targets` array (useful for one-off configurations):

```json
{
  "rules": [
    {
      "ruleId": "special-rule",
      "targets": [{ "language": "typescript", "files": ["scripts/**/*.ts"] }]
    }
  ]
}
```

Each rule must specify either `target` (reference) or `targets` (inline), but not both.

## PolicyRule

Defines which files to check, how, and with what configuration.

### Using Named Target Reference

```json
{
  "id": "function-logging",
  "ruleId": "@codepol/plugin/require-logger-enter-exit",
  "description": "Ensure all functions have logger instrumentation",
  "args": {
    "logger": {
      "identifier": "logger",
      "enterMethod": "enter",
      "exitMethod": "exit",
      "import": { "module": "@org/logger", "named": "logger" }
    }
  },
  "target": "typescript-src"
}
```

### Using Inline Targets

```json
{
  "id": "function-logging",
  "ruleId": "@codepol/plugin/require-logger-enter-exit",
  "description": "Ensure all functions have logger instrumentation",
  "args": {
    "logger": {
      "identifier": "logger",
      "enterMethod": "enter",
      "exitMethod": "exit",
      "import": { "module": "@org/logger", "named": "logger" }
    }
  },
  "targets": [
    {
      "language": "typescript",
      "files": ["src/**/*.ts"],
      "exclude": ["**/*.spec.ts"]
    }
  ]
}
```

### PolicyRule Properties

| Property | Type | Required | Description |
| -------- | ---- | -------- | ----------- |
| `id` | string | No | Unique identifier for this rule (defaults to `ruleId`) |
| `ruleId` | string | Yes | The plugin rule identifier (namespaced, e.g. `@org/plugin/rule-name`) |
| `description` | string | No | Human-readable description |
| `args` | object | No | Rule-specific arguments passed to the plugin |
| `target` | string | * | Reference to a named target (mutually exclusive with `targets`) |
| `targets` | PolicyRuleTarget[] | * | Inline target definitions (mutually exclusive with `target`) |

*One of `target` or `targets` is required.

### PolicyRuleTarget Properties

| Property | Type | Required | Description |
| -------- | ---- | -------- | ----------- |
| `language` | string | Yes | Language adapter or parser identifier |
| `parser` | string | No | Optional parser override |
| `files` | string[] | Yes | Glob patterns for files to include |
| `exclude` | string[] | No | Glob patterns to exclude from this target |

### Language Values

- `typescript`: Matches `.ts` and `.tsx` files
- `tsx`: Matches only `.tsx` files

## LoggerConfig

Configures the logger instrumentation pattern. Provide this under
`rules[].args.logger` for the logger rule.

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

## PolicyPluginDeclaration

Declares a plugin module that provides rule capabilities. Accepts either a string (module specifier) or an object with a `module` property.

### String Format (Recommended)

```json
{
  "plugins": ["@codepol/plugin", "./plugins/custom-plugin.js"]
}
```

### Object Format

```json
{
  "plugins": [
    { "module": "@codepol/plugin" },
    { "module": "./plugins/custom-plugin.js" }
  ]
}
```

### PolicyPluginDeclaration Type

| Format | Type | Description |
| ------ | ---- | ----------- |
| String | `string` | Module specifier or path to import |
| Object | `{ module: string }` | Object with module specifier |

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

This example uses named targets to avoid repeating file patterns:

```json
{
  "$schema": "https://raw.githubusercontent.com/fruitiecutiepie/codepol/master/policy.schema.json",
  "plugins": ["@codepol/plugin"],
  "targets": {
    "typescript-src": {
      "language": "typescript",
      "files": ["src/**/*.ts", "src/**/*.tsx"],
      "exclude": [
        "**/*.spec.ts",
        "**/*.test.ts",
        "**/*.d.ts",
        "**/__mocks__/**",
        "**/__tests__/**"
      ]
    },
    "api-handlers": {
      "language": "typescript",
      "files": ["src/api/**/*.ts"]
    }
  },
  "rules": [
    {
      "id": "function-logging",
      "ruleId": "@codepol/plugin/require-logger-enter-exit",
      "description": "Ensure all exported functions have logger instrumentation",
      "args": {
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
      "target": "typescript-src"
    },
    {
      "id": "api-logging",
      "ruleId": "@codepol/plugin/require-logger-enter-exit",
      "description": "Ensure API handlers have logging",
      "args": {
        "logger": {
          "identifier": "apiLogger",
          "enterMethod": "enter",
          "exitMethod": "exit",
          "import": {
            "module": "@myorg/observability",
            "named": "apiLogger"
          }
        }
      },
      "target": "api-handlers"
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

### Inline Targets Example

You can also use inline targets directly on rules (useful when a target is only used once):

```json
{
  "$schema": "https://raw.githubusercontent.com/fruitiecutiepie/codepol/master/policy.schema.json",
  "plugins": ["@codepol/plugin"],
  "rules": [
    {
      "id": "function-logging",
      "ruleId": "@codepol/plugin/require-logger-enter-exit",
      "description": "Ensure all exported functions have logger instrumentation",
      "args": {
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
      "targets": [
        {
          "language": "typescript",
          "files": ["src/**/*.ts", "src/**/*.tsx"],
          "exclude": [
            "**/*.spec.ts",
            "**/*.test.ts",
            "**/*.d.ts",
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
    "**/*.config.ts",
    "**/*.config.js"
  ]
}
```

## Custom Logger Examples

### Winston

```json
{
  "plugins": ["@codepol/plugin"],
  "rules": [
    {
      "ruleId": "@codepol/plugin/require-logger-enter-exit",
      "args": {
        "logger": {
          "identifier": "log",
          "enterMethod": "info",
          "exitMethod": "info",
          "import": { "module": "./logger", "named": "log" }
        }
      },
      "targets": [{ "language": "typescript", "files": ["src/**/*.ts"] }]
    }
  ]
}
```

### Pino

```json
{
  "plugins": ["@codepol/plugin"],
  "rules": [
    {
      "ruleId": "@codepol/plugin/require-logger-enter-exit",
      "args": {
        "logger": {
          "identifier": "pino",
          "enterMethod": "trace",
          "exitMethod": "trace",
          "import": { "module": "./pino-logger", "named": "pino" }
        }
      },
      "targets": [{ "language": "typescript", "files": ["src/**/*.ts"] }]
    }
  ]
}
```

### OpenTelemetry Tracing

```json
{
  "plugins": ["@codepol/plugin"],
  "rules": [
    {
      "ruleId": "@codepol/plugin/require-logger-enter-exit",
      "args": {
        "logger": {
          "identifier": "tracer",
          "enterMethod": "startSpan",
          "exitMethod": "endSpan",
          "import": { "module": "@opentelemetry/api", "named": "tracer" }
        }
      },
      "targets": [{ "language": "typescript", "files": ["src/**/*.ts"] }]
    }
  ]
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
  PolicyRule,
  PolicyRuleTarget,
  PolicyTargetMap,
  CodepolPluginRule,
  PolicyPluginDeclaration,
  LoggerConfig,
  LoggerImportConfig,
} from '@codepol/core';

// Using named targets
const policyWithNamedTargets: PolicyFile = {
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
      target: 'typescript-src',
    },
  ],
};

// Using inline targets
const policyWithInlineTargets: PolicyFile = {
  plugins: ['@codepol/plugin'],
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
      targets: [{ language: 'typescript', files: ['src/**/*.ts'] }],
    },
  ],
};
```
