# @codepol/plugin-logger

## Purpose

`@codepol/plugin-logger` provides the logger enforcement rule plugin for Codepol. It supplies both
Tree-sitter scanning and ESLint rule integration to ensure functions are instrumented with logger
enter/exit calls.

## Installation

```bash
pnpm add -D @codepol/plugin-logger
```

## Exports

- `loggerEnterExitRule`: the rule plugin definition for `require-logger-enter-exit`.
- `rulePlugins`: an array of rule plugins exported by this package (currently `loggerEnterExitRule`).

## Basic policy configuration

Use `semantics` and `targets` in your policy rules, then wire the logger rule plugin under
`plugins`:

```json
{
  "$schema": "https://raw.githubusercontent.com/fruitiecutiepie/codepol/master/policy.schema.json",
  "plugins": [
    {
      "module": "@codepol/plugin-logger",
      "rules": [
        {
          "id": "require-logger-enter-exit",
          "enabled": true,
          "options": {
            "policyPath": "./policy.json"
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
