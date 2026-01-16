# @codepol/plugin

## Purpose

`@codepol/plugin` provides the logger enforcement rule plugin for Codepol. It supplies both
Tree-sitter checking and ESLint rule integration to ensure functions are instrumented with logger
enter/exit calls.

## Installation

```bash
pnpm add -D @codepol/plugin
```

## Exports

- **Default export**: an array of rule plugins (currently `[loggerEnterExitRule]`).
- `loggerEnterExitRule`: the rule plugin definition for `require-logger-enter-exit`.

## Basic policy configuration

Use `semantics` and `targets` in your policy rules, then wire the logger rule plugin under
`plugins`:

```json
{
  "$schema": "https://raw.githubusercontent.com/fruitiecutiepie/codepol/master/policy.schema.json",
  "plugins": [
    {
      "module": "@codepol/plugin",
      "config": {
        "identifier": "logger",
        "enterMethod": "enter",
        "exitMethod": "exit",
        "import": {
          "module": "@org/logger",
          "named": "logger"
        }
      },
      "rules": [
        {
          "id": "require-logger-enter-exit",
          "enabled": true,
          "args": {
            "policyPath": "./policy.json",
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
      ]
    }
  ],
  "rules": [
    {
      "id": "function-logging",
      "semantics": {
        "description": "Ensure functions log enter/exit",
        "type": "logger"
      },
      "targets": [
        {
          "language": "typescript",
          "files": ["src/**/*.ts", "src/**/*.tsx"],
          "exclude": ["**/*.spec.ts", "**/*.test.ts"]
        }
      ]
    }
  ]
}
```
