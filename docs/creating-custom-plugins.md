# Authoring Codepol Plugins

This guide explains how to add a custom plugin to Codepol. Plugins can provide Tree-sitter checks, ESLint rules,
fixers, or any combination of those capabilities.

## Plugin Types at a Glance

Codepol has two related plugin shapes:

- **Policy plugin (`PolicyPlugin`)**: Implements Tree-sitter checks for policy rules. These are loaded by
  `policy.json` and used by the CLI when it checks files directly.
- **Rule plugin (`CodepolRulePlugin`)**: A rule-level capability bundle that can expose ESLint rules, fixers,
  and/or Tree-sitter checks. The CLI loads these from `policy.json` to decide which ESLint rules and fixers to run.

A single package can export both. The built-in `@codepol/plugin` package does this: it exports a policy plugin
and a rule plugin bundle.

## Step 1: Create a Plugin Package

Create a new package that depends on `@codepol/core`:

```bash
pnpm add -D @codepol/core
```

A minimal `package.json` might look like:

```json
{
  "name": "@your-org/codepol-plugin-foo",
  "version": "0.1.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts"
}
```

## Step 2: Implement a Policy Plugin (Tree-sitter Check)

A policy plugin provides a `check` function and declares which languages it supports. The simplest
implementation can check raw source without Tree-sitter, but most rule plugins call into the parser.

```ts
// src/index.ts
import type { PolicyCheckContext, PolicyPlugin, PolicyRule, PolicyViolation } from '@codepol/core';

function todoCheck(rule: PolicyRule, context: PolicyCheckContext): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  const lines = context.source.split('\n');

  lines.forEach((line, index) => {
    if (line.includes('TODO')) {
      violations.push({
        ruleId: rule.id,
        filePath: context.filePath,
        message: 'TODO comments are not allowed',
        line: index + 1,
        column: line.indexOf('TODO') + 1,
      });
    }
  });

  return violations;
}

export const todoPolicyPlugin: PolicyPlugin = {
  id: 'todo',
  version: '1.0.0',
  languages: ['typescript', 'tsx'],
  check: todoCheck,
};

export const plugin = todoPolicyPlugin;
export default todoPolicyPlugin;
```

### Policy Configuration

Once published (or linked), declare it in `policy.json` and route a rule to its type:

```json
{
  "plugins": [
    {
      "module": "@your-org/codepol-plugin-foo"
    }
  ],
  "rules": [
    {
      "id": "no-todo-comments",
      "semantics": {
        "description": "Disallow TODO comments",
        "type": "todo"
      },
      "targets": [
        {
          "language": "typescript",
          "files": ["src/**/*.ts", "src/**/*.tsx"]
        }
      ]
    }
  ]
}
```

The `semantics.type` must match the policy plugin `id` (`todo` in this example).

## Step 3: Add Rule-Level Capabilities (Optional)

To integrate with ESLint or provide fixes, export a `CodepolRulePlugin` with the capabilities you need.
The CLI accepts any of these exports:

- `rulePlugins` (array)
- `default` export
- `plugin` export

```ts
import type { CodepolRulePlugin, EslintRuleProvider } from '@codepol/core';

const eslintRuleProvider: EslintRuleProvider = {
  pluginName: 'codepol',
  rules: {
    'no-todo-comments': {
      meta: { type: 'problem', schema: [] },
      create(context) {
        return {
          Program() {
            const sourceCode = context.getSourceCode();
            const text = sourceCode.getText();
            if (text.includes('TODO')) {
              context.report({ node: sourceCode.ast, message: 'TODO comments are not allowed' });
            }
          },
        };
      },
    },
  },
  rulesConfigGet() {
    return {
      'codepol/no-todo-comments': 'error',
    };
  },
};

export const todoRulePlugin: CodepolRulePlugin = {
  id: 'no-todo-comments',
  languages: ['typescript', 'tsx'],
  eslintRuleProvider,
};

export const rulePlugins = [todoRulePlugin];
```

### Rule Plugin Configuration

Reference rule plugins in the policy declaration so the CLI can enable the matching ESLint rule:

```json
{
  "plugins": [
    {
      "module": "@your-org/codepol-plugin-foo",
      "rules": [
        {
          "id": "no-todo-comments"
        }
      ]
    }
  ]
}
```

## Step 4: Validate Your Plugin

- Ensure the plugin exports are loadable from the module entry point.
- Check that each rule plugin has a unique `id` and declares `languages`.
- Confirm policy rules route to the correct plugin type via `semantics.type`.

You can also validate plugin wiring directly from the CLI:

```bash
pnpm codepol --check-plugins --policy ./policy.json
```

This loads the policy plugins and rule plugins, then reports the resolved plugin ids.

With those steps, you can ship new rule logic as a standalone package while still plugging into
Codepol’s policy-driven workflow.
