# @codepol/plugin-eslint

ESLint adapter for Codepol rule plugins.

## Installation

```bash
pnpm add -D @codepol/plugin-eslint @codepol/core @codepol/plugin eslint
```

## What It Does

- Converts `CodepolPluginRule` tree checks into ESLint rules.
- Reads targeting and rule options from `codepol.toml`.
- Works with resolved built-in plugins and subprocess plugins.
- Lets you run Codepol rules directly inside ESLint.

## Usage

```javascript
import { eslintPluginCreate } from '@codepol/plugin-eslint';
import {
  pluginBuiltinRegister,
  providerParserRuntimeInit,
  policyPluginRulesGet,
  providerRulesConfigGet,
} from '@codepol/core';
import codepolBuiltin from '@codepol/plugin';

await providerParserRuntimeInit('eslint');

pluginBuiltinRegister('@codepol/plugin', codepolBuiltin);

const codepol = eslintPluginCreate(await policyPluginRulesGet());

export default [
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: {
      codepol,
    },
    rules: {
      ...await providerRulesConfigGet('eslint'),
    },
  },
];
```

If your policy file lives somewhere else, pass `configPath` to both helpers:

```javascript
await providerParserRuntimeInit('eslint');

const codepol = eslintPluginCreate(
  await policyPluginRulesGet('./config/codepol.toml')
);

export default [
  {
    plugins: { codepol },
    rules: {
      ...await providerRulesConfigGet('eslint', './config/codepol.toml'),
    },
  },
];
```

## Notes

- `providerParserRuntimeInit('eslint')` explicitly initializes the parser/runtime dependencies for adapted tree-check rules.
- `providerRulesConfigGet('eslint')` returns rule severity and options from `codepol.toml`.
- `policyPluginRulesGet()` resolves the configured built-in and subprocess plugins into concrete ESLint-adaptable rules.
- If you only use the CLI or the esbuild plugin, you do not need to set this up manually because those hosts inject the ESLint adapter themselves.

## License

MIT
