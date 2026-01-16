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
  PolicyRule,
  PolicyViolation,
  CodepolRulePlugin,
  LintProvider,
  EslintProviderConfig,
  TreeCheckProvider,
  Result,
} from '@codepol/core';
import { Ok } from '@codepol/core';
import { eslintAdapter } from '@codepol/eslint-plugin';

// Define the check logic once
function noTodoCheck(rule: PolicyRule, context: PolicyCheckContext): Result<PolicyViolation[], string> {
  const violations: PolicyViolation[] = [];
  const lines = context.source.split('\n');

  // Resolved args from policy.json are available in context.ruleArgs
  // const args = context.ruleArgs; 

  lines.forEach((line, index) => {
    const todoIndex = line.indexOf('TODO');
    if (todoIndex !== -1) {
      violations.push({
        ruleId: rule.id || rule.ruleId,
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

// Adapt to ESLint (no need to rewrite the logic)
// The rule name must match the plugin's ID structure
// NOTE: Rule ID should be descriptive. If not namespaced (no '/'), codepol will prepend the package name.
const ruleId = 'no-todo-comments';

// Create rule plugin capability structure
const rulePluginBase: CodepolRulePlugin = {
  id: ruleId,
  capabilities: {
    treeCheckProvider: noTodoTreeCheckProvider,
  }
};

const eslintRule = eslintAdapter.adapt(rulePluginBase, {
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
  id: ruleId,
  capabilities: {
    lintProviders: [lintProvider],
    treeCheckProvider: noTodoTreeCheckProvider,
  },
};

// Default export is required for codepol to load the plugin
export default [noTodoRulePlugin];
```

### 3. Configure policy.json

```json
{
  "plugins": [
    { "module": "./path/to/codepol-plugin-no-todo" }
  ],
  "rules": [
    {
      "id": "no-todo-comments",
      "ruleId": "codepol-plugin-no-todo/no-todo-comments",
      "description": "Disallow TODO comments",
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

Codepol automatically resolves the `ruleId` by combining the module name and the exported rule ID: `codepol-plugin-no-todo/no-todo-comments`.

### 4. Test It

```bash
pnpm codepol --policy ./policy.json
```

## Exporting Your Plugin

Plugins must use a **default export** containing an array of `CodepolRulePlugin` objects. This is the only export convention codepol uses—consumers never need to specify an export name.

```typescript
// src/index.ts
export const myRule: CodepolRulePlugin = { /* ... */ };
export const anotherRule: CodepolRulePlugin = { /* ... */ };

// Default export is required for codepol to load the plugin
export default [myRule, anotherRule];
```

Consumers reference your plugin by module path only:

```json
{ "module": "@your-org/codepol-plugin-foo" }
```

### Multiple Plugin Collections

For packages with multiple distinct plugin collections, use Node.js subpath exports in your `package.json`:

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./security": "./dist/security.js",
    "./logging": "./dist/logging.js"
  }
}
```

Each subpath module should have its own default export:

```typescript
// src/security.ts
export default [xssRule, csrfRule];

// src/logging.ts
export default [loggerRule, auditRule];
```

Consumers reference specific collections via the subpath:

```json
{ "module": "@your-org/plugin/security" }
{ "module": "@your-org/plugin/logging" }
```

## Policy Configuration

### Plugin Declaration

Register your plugin in `policy.json`. Plugins are simple module declarations:

```json
{
  "plugins": [
    { "module": "@your-org/codepol-plugin-foo" }
  ]
}
```

### Rule Definition

Each rule needs a matching entry in `rules`. The `ruleId` must match the resolved ID (module name + rule ID). Rule-specific arguments are passed via `args`.

```json
{
  "rules": [
    {
      "id": "rule-one",
      "ruleId": "@your-org/codepol-plugin-foo/rule-one",
      "description": "What this rule enforces",
      "args": {
        "option1": "value1"
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
```
