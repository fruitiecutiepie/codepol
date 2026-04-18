# Getting Started with Codepol

This guide walks you through setting up codepol in your project.

## Prerequisites

- A project with source code you want to enforce policy on
- For package-based usage (`@codepol/cli`): Node.js 18+ and pnpm/npm/yarn
- For standalone binary usage: no Node.js runtime is required in the target project

## Choose a Usage Path

- **Node-capable projects (recommended):** install `@codepol/cli` and run `codepol`/`npx codepol`.
- **Non-Node projects:** use the standalone binary bundle.

## Step 1: Install Packages

Choose the packages you need:

### Full Setup (Recommended)

```bash
# Install CLI (includes core)
pnpm add -D @codepol/cli

# For ESLint integration
pnpm add -D @codepol/plugin-eslint @codepol/plugin @typescript-eslint/utils

# For Biome-backed policy providers
pnpm add -D @codepol/plugin-biome

# For esbuild integration
pnpm add -D @codepol/plugin-esbuild esbuild
```

### Minimal Setup (ESLint only)

```bash
pnpm add -D @codepol/plugin-eslint @codepol/core @codepol/plugin
```

## Step 2: Create a Config File

Create `codepol.toml` in your project root:

```toml
exclude = ["dist/**", "node_modules/**", "*.config.ts"]

[[plugins]]
id = "@codepol/plugin"
source = { kind = "builtin" }

[targets.typescript-src]
language = "typescript"
files = ["src/**/*.ts", "src/**/*.tsx"]
exclude = [
  "**/*.spec.ts",
  "**/*.test.ts",
  "**/__mocks__/**",
  "**/__tests__/**",
]

# Enable ESLint on the typescript-src target; required for any ESLint-backed
# rule (including @codepol/plugin/no-unused-vars) to run.
[[rules]]
ruleId = "@codepol/plugin/eslint"
targets = ["typescript-src"]
args.configPath = "./eslint.config.mjs"

[[rules]]
id = "function-logging"
ruleId = "@codepol/plugin/require-logger-enter-exit"
description = "Ensure all functions have logger.enter/exit instrumentation"
targets = ["typescript-src"]

[rules.args.logger]
identifier = "logger"
enterMethod = "enter"
exitMethod = "exit"
import = { module = "@your-org/logger", named = "logger" }
```

The config file is auto-discovered from your project root. Supported format:
- `codepol.toml`

> **Tip:** Multiple rules can reference the same target. See [Policy Schema Reference](./policy-schema.md) for more details.

> **Tip:** Multiple rules can reference the same target. See [Policy Schema Reference](./policy-schema.md) for more details.

## Step 3: Configure ESLint

### Flat Config (eslint.config.js) - Recommended

```javascript
import { eslintPluginCreate } from '@codepol/plugin-eslint';
import {
  pluginBuiltinRegister,
  policyPluginRulesGet,
  providerRulesConfigGet,
} from '@codepol/core';
import codepolBuiltin from '@codepol/plugin';
import tseslint from 'typescript-eslint';

pluginBuiltinRegister('@codepol/plugin', codepolBuiltin);

const codepol = eslintPluginCreate(await policyPluginRulesGet());

export default [
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      codepol,
    },
    rules: {
      ...await providerRulesConfigGet('eslint'),
      eqeqeq: 'error',
    },
  },
];
```

### Legacy Config (.eslintrc.cjs)

```javascript
const { eslintPluginCreate } = require('@codepol/plugin-eslint');
const codepolPlugin = require('@codepol/plugin').default;
const tseslint = require('typescript-eslint');

module.exports = {
  parser: tseslint.parser,
  plugins: {
    codepol: eslintPluginCreate(codepolPlugin),
  },
  rules: {
    'codepol/require-logger-enter-exit': 'error',
    eqeqeq: 'error',
  },
};
```

Rule keys use the ESLint plugin name `codepol` (for example, `codepol/require-logger-enter-exit`) even when the package is scoped.

::: tip Severity Precedence
When running ESLint directly (`eslint .`), your eslint.config.js rules apply.

When running `codepol`, severity is read from `codepol.toml` and passed via ESLint's `overrideConfig`, which takes precedence over your eslint.config.js for codepol rules.
:::

### Optional: Biome-backed providers

If a loaded rule exposes a `platform = "biome"` lint provider, `codepol` **delegates** to the Biome CLI: it runs `biome lint` on the JS/TS files matched by **that policy rule’s targets** (not every JS/TS file in the repo) and merges Biome’s diagnostics into the normal CLI output. `codepol --fix` runs `biome lint --write` for those same scoped files.

Rules:

- The provider selects how to invoke Biome (`biomeBin`, optional `configPath`, optional `extraArgs`). It does **not** register custom rules inside Biome; enforcement comes from Biome’s own configuration.
- Distinct provider configs are run as **separate** `biome lint` invocations (grouped by normalized config). Declaring the same bridge rule multiple times with different `args` is supported: each distinct resolved config runs once over the files matched by its policy rule. The same grouping applies to `@codepol/plugin/eslint` and `@codepol/plugin/ruff`.
- Policy `severity` and `args` do **not** currently change Biome’s behavior (unlike ESLint, where severity is passed through `overrideConfig`). Configure severity in `biome.json` / Biome CLI options instead.

## Step 4: Create Your Logger

Create a logger module that matches your policy configuration:

```typescript
// src/logger.ts
export const logger = {
  enter(context?: Record<string, unknown>) {
    console.log('[ENTER]', context);
  },
  exit(context?: Record<string, unknown>) {
    console.log('[EXIT]', context);
  },
};
```

Update your `codepol.toml` to reference it:

```toml
[[plugins]]
id = "@codepol/plugin"
source = { kind = "builtin" }

[targets.src]
language = "typescript"
files = ["src/**/*.ts"]

[[rules]]
ruleId = "@codepol/plugin/require-logger-enter-exit"
targets = ["src"]

[rules.args.logger]
identifier = "logger"
enterMethod = "enter"
exitMethod = "exit"
import = { module = "./logger", named = "logger" }
```

## Step 5: Add NPM Scripts

Add to your `package.json`:

```json
{
  "scripts": {
    "lint:policy": "codepol",
    "lint:policy:fix": "codepol --fix",
    "lint:policy:watch": "codepol --watch"
  }
}
```

## Step 6: Run Your First Check

```bash
pnpm lint:policy
```

If you have functions without instrumentation, you'll see:

```text
src/utils.ts
  15:1  error  Functions must invoke logger.enter and logger.exit  codepol/require-logger-enter-exit

✖ 1 problem (1 error, 0 warnings)
```

## Step 7: Auto-Fix Violations

Run with `--fix` to apply any fixes provided by enabled rules:

```bash
pnpm lint:policy:fix
```

Before:

```typescript
export interface User {
  name: string;
}
```

After:

```typescript
export type User = {
  name: string;
};
```

### Fix on save (VS Code)

Tag rules whose fixes should run automatically with `fix = "on-save"`
and let VS Code apply them through the standard
`editor.codeActionsOnSave` hook:

```toml
[[rules]]
ruleId = "@codepol/plugin/enforce-casing"
targets = ["typescript-src"]
fix = "on-save"
```

```jsonc
// .vscode/settings.json
"editor.codeActionsOnSave": {
  "source.fixAll.codepol": "explicit"
}
```

`fix = "manual"` keeps the rule's fix available as a quickfix but never
runs on save. `fix = "never"` (or `severity = "off"`) hides the rule
from every autofix surface.

## Optional: esbuild Integration

If you use esbuild, add build-time enforcement:

```typescript
// build.ts
import { build } from 'esbuild';
import { esbuildPluginCreate } from '@codepol/plugin-esbuild';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  outdir: 'dist',
  plugins: [
    // Zero-config: auto-discovers codepol.toml
    esbuildPluginCreate(),
  ],
});
```

Or with explicit config path:

```typescript
plugins: [
  esbuildPluginCreate({
    configPath: './config/codepol.toml',
  }),
]
```

## Optional: CI Integration

### GitHub Actions

```yaml
name: Policy Check
on: [push, pull_request]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'
      - run: pnpm install
      - run: pnpm lint:policy
```

### Pre-commit Hook

Using husky:

```bash
pnpm add -D husky
npx husky init
echo "pnpm lint:policy" > .husky/pre-commit
```

## Use the Standalone Binary (Recommended for Non-Node Projects)

For projects that do not use a JS/TS toolchain, use the standalone binary bundle.
This is the recommended path for non-Node repositories.
Download binaries from [GitHub Releases](https://github.com/fruitiecutiepie/codepol/releases) (or CI artifacts) rather than committing `dist-binary`.

The release bundle contains the binary and required WASM files (must stay in the same directory):

- `codepol`
- `tree-sitter.wasm`
- `tree-sitter-typescript.wasm`
- `tree-sitter-tsx.wasm`
- `tree-sitter-python.wasm`

Install to `~/.local/bin` so `codepol` is available on PATH:

```bash
# Pick a release tag, for example v1.2.3
TAG=v1.2.3

# Download and install to ~/.local/bin
curl -fL "https://github.com/fruitiecutiepie/codepol/releases/download/${TAG}/codepol-binary-${TAG}-linux-x64.tar.gz" \
  | tar -xz -C ~/.local/bin

# Alternative: download from a workflow artifact (requires gh auth)
# gh run download <run-id> --name codepol-binary --dir ~/.local/bin
```

Make sure `~/.local/bin` is on your PATH (most systems include it by default).

Then in the consumer project:

```bash
# Run from project root (auto-discovers codepol.toml)
codepol

# Or pass an explicit policy config path
codepol --config ./codepol.toml
```

The ESLint config path is declared on the `@codepol/plugin/eslint` rule via
`args.configPath`; there is no CLI override for it.

## Tuning diagnostics

Codepol's diagnostics runtime is driven by named environment presets:

- `user` (default) — safe field posture: warn level, strict redaction, stdout sink.
- `dev` — productive daily engineering: debug level, console + file sink, cheap invariants.
- `test` — deterministic CI: warn level, memory sink, tracing off.
- `verbose` — explicit investigation: trace level, snapshots + profiling on, full invariants.

Pick one and layer overrides or time-bounded escalations on top. The same
configuration flows through the CLI, the daemon, and the LSP.

**CLI:**

```bash
# Switch preset for a single run.
codepol --env dev

# Dev preset with a file sink added.
codepol --env dev --override sinks=console,file --override logFilePath=/tmp/codepol.log

# Time-bounded escalation of the parser scope (10 minutes, then automatic rollback).
codepol --escalate scope:parser=trace@600:reproduce_wasm_abort

# Or pick the preset via env var — handy for npm scripts and CI.
CODEPOL_ENV=verbose codepol
```

**VSCode:** set `codepol.diagnostics.environment` to `dev` (or `verbose`) in your
workspace settings. For finer control add `codepol.diagnostics.overrides`
(e.g. `{ "sinks": ["console", "file"], "logFilePath": "/tmp/codepol.log" }`) or
a standing escalation in `codepol.diagnostics.escalations`. The commands
`Codepol: Set Diagnostics Environment`, `Codepol: Add Diagnostics Escalation`,
`Codepol: Clear Diagnostics Escalations`, and `Codepol: Show Current
Diagnostics Config` are available from the command palette.

**Env vars:** `CODEPOL_ENV` selects the preset at startup. Legacy
`CODEPOL_DEBUG_PARSE=1` and `CODEPOL_DEBUG_PARSE_FILE=/tmp/x.log` are still
honored — they seed the runtime as overrides on top of whichever preset is
active.

See [packages/core/src/diagnostics/README.md](https://github.com/fruitiecutiepie/codepol/blob/master/packages/core/src/diagnostics/README.md)
for the full model and [API Reference → Runtime diagnostics](./api-reference.md#runtime-diagnostics)
for the programmatic surface.

## Next Steps

- [Policy Schema Reference](./policy-schema.md) - All configuration options
- [Creating Custom Plugins](./creating-custom-plugins.md) - Build your own rule plugins
- [API Reference](./api-reference.md) - Programmatic usage and type definitions
