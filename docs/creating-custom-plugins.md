# Creating Custom Plugins

This guide shows how to create a custom codepol plugin. You'll write one check function that works with both the CLI and ESLint.

## Overview

A codepol plugin has two parts:

1. **TreeCheckProvider** - The check logic (runs via CLI with Tree-sitter)
2. **ESLint rule** - Generated automatically using the adapter

The recommended approach uses `eslintAdapter` to convert your TreeCheckProvider into an ESLint rule, so you write the check logic once.

## Quick Start

### 1. Create the Package

```bash
mkdir codepol-plugin-no-todo
cd codepol-plugin-no-todo
pnpm init
pnpm add -D @codepol/core @codepol/eslint-plugin typescript
```

### 2. Write the Plugin

Create `src/index.ts`:

```ts
import type {
  PolicyCheckContext,
  PolicyPlugin,
  PolicyRule,
  PolicyViolation,
  CodepolRulePlugin,
  LintProvider,
  EslintProviderConfig,
  TreeCheckProvider,
  Result,
} from '@codepol/core';
import { Ok, parserInit } from '@codepol/core';
import { eslintAdapter } from '@codepol/eslint-plugin';

// Define the check logic once
function noTodoCheck(rule: PolicyRule, context: PolicyCheckContext): Result<PolicyViolation[], string> {
  const violations: PolicyViolation[] = [];
  const lines = context.source.split('\n');

  lines.forEach((line, index) => {
    const todoIndex = line.indexOf('TODO');
    if (todoIndex !== -1) {
      violations.push({
        ruleId: rule.id,
        filePath: context.filePath,
        message: 'TODO comments are not allowed',
        line: index + 1,
        column: todoIndex + 1,
      });
    }
  });

  return Ok(violations);
}

// Create the TreeCheckProvider
export const noTodoTreeCheckProvider: TreeCheckProvider = {
  languages: ['typescript', 'tsx'],
  check: noTodoCheck,
};

// Create the PolicyPlugin container
export const noTodoPlugin: PolicyPlugin = {
  id: 'no-todo',
  version: '1.0.0',
  init: parserInit,
  capabilities: {
    treeCheckProvider: noTodoTreeCheckProvider,
  },
};

// Adapt to ESLint (no need to rewrite the logic)
const eslintRule = eslintAdapter.adapt(noTodoTreeCheckProvider, {
  ruleName: 'no-todo-comments',
});

const eslintConfig: EslintProviderConfig = {
  pluginName: 'codepol',
  rules: { 'no-todo-comments': eslintRule },
  rulesConfigGet: () => ({ 'codepol/no-todo-comments': 'error' }),
};

const lintProvider: LintProvider = {
  platform: 'eslint',
  languages: ['typescript', 'tsx'],
  config: eslintConfig,
};

// Export the rule plugin
export const noTodoRulePlugin: CodepolRulePlugin = {
  id: 'no-todo-comments',
  capabilities: {
    lintProviders: [lintProvider],
    treeCheckProvider: noTodoTreeCheckProvider,
  },
};

export const rulePlugins = [noTodoRulePlugin];
export const plugin = noTodoPlugin;
export default noTodoPlugin;
```

### 3. Configure policy.json

```json
{
  "plugins": [
    {
      "module": "./path/to/codepol-plugin-no-todo",
      "export": "rulePlugins",
      "rules": [{ "id": "no-todo-comments" }]
    }
  ],
  "rules": [
    {
      "id": "no-todo-comments",
      "semantics": {
        "description": "Disallow TODO comments",
        "type": "no-todo"
      },
      "targets": [
        {
          "language": "typescript",
          "files": ["src/**/*.ts"]
        }
      ]
    }
  ]
}
```

The `semantics.type` must match the plugin's `id` (`no-todo`).

### 4. Test It

```bash
pnpm codepol --policy ./policy.json
```

## Policy Configuration

### Plugin Declaration

Register your plugin in `policy.json`:

```json
{
  "plugins": [
    {
      "module": "@your-org/codepol-plugin-foo",
      "export": "rulePlugins",
      "rules": [
        { "id": "rule-one" },
        { "id": "rule-two", "enabled": false }
      ]
    }
  ]
}
```

### Rule Definition

Each rule needs a matching entry in `rules`:

```json
{
  "rules": [
    {
      "id": "rule-one",
      "semantics": {
        "description": "What this rule enforces",
        "type": "plugin-id"
      },
      "targets": [
        {
          "language": "typescript",
          "files": ["src/**/*.ts"],
          "exclude": ["**/*.test.ts"]
        }
      ]
    }
  ]
}
```

## Advanced: Manual ESLint Rules

If you need full control over the ESLint rule (e.g., for auto-fix support), you can write it manually instead of using the adapter:

```ts
import type { CodepolRulePlugin, LintProvider, EslintProviderConfig } from '@codepol/core';
