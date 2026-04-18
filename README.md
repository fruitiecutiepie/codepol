# Codepol

**Policy-driven code enforcement for TypeScript projects.**

Codepol is a policy enforcement framework for TypeScript that combines ESLint rules, Tree-sitter structural checks, and build-time enforcement. Define custom rules once, enforce them everywhere.

## Architecture

```text
┌────────────────────────────────────────────┐
│             Consumer Codebase              │
│   ┌───────────────────┐  ┌─────────────┐   │
│   │  codepol.toml    │  │ src/**/*.ts │   │
│   └─────────┬─────────┘  └─────────────┘   │
└─────────────┼──────────────────────────────┘
              │
              ▼
┌────────────────────────────────────────────┐
│               @codepol/core                │
│   • Load and parse codepol.toml            │
│   • Tree-sitter structural analysis        │
│   • Violation detection and formatting     │
└─────────────────────┬──────────────────────┘
                      │
          ┌───────────┼───────────┐
          ▼           ▼           ▼
    ┌──────────┐ ┌──────────┐ ┌──────────┐
    │  ESLint  │ │ esbuild  │ │   CLI    │
    │  Plugin  │ │  Plugin  │ │          │
    └──────────┘ └──────────┘ └──────────┘
```

## Packages

| Package | Description |
| ------- | ----------- |
| [@codepol/core](./packages/core) | Core policy loading, Tree-sitter checks, and enforcement |
| [@codepol/plugin-eslint](./packages/plugin-eslint) | ESLint rule with autofix for logger instrumentation |
| [@codepol/plugin-esbuild](./packages/plugin-esbuild) | esbuild plugin for build-time enforcement |
| [@codepol/plugin](./packages/plugin/README.md) | Logger plugin with Tree-sitter + ESLint capabilities |
| [@codepol/cli](./apps/cli) | Command-line interface for running checks |

## Quick Start

### Installation

```bash
# Install the CLI (includes all dependencies)
pnpm add -D @codepol/cli

# Or install individual packages
pnpm add -D @codepol/core @codepol/plugin-eslint @codepol/plugin
```

### Choose Your Runtime

- **Node-capable projects (JS/TS toolchain available):** use `@codepol/cli` via `npx codepol`.
- **Non-Node projects:** use the standalone binary bundle (see "Use the Standalone Binary").

### Use Codepol in 3 Steps

1) Add a `codepol.toml` file in your project root.
2) If you run ESLint directly, assemble the `codepol` plugin from resolved rule plugins in `eslint.config.*`.
3) Run checks with:

```bash
# Run once
npx codepol

# Apply fixes
npx codepol --fix

# Watch mode
npx codepol --watch
```

Codepol auto-discovers `codepol.toml` from the current directory upward. Use `--config` if your config is elsewhere.

### Create a Config File

Create `codepol.toml` in your project root:

```toml
exclude = ["dist/**"]

[[plugins]]
id = "@codepol/plugin"
source = { kind = "builtin" }

[targets.typescript-src]
language = "typescript"
files = ["src/**/*.ts", "src/**/*.tsx"]
exclude = ["**/*.spec.ts", "**/*.test.ts"]

[[rules]]
id = "function-logging"
ruleId = "@codepol/plugin/require-logger-enter-exit"
description = "Ensure all functions have logger instrumentation"
targets = ["typescript-src"]

[rules.args.logger]
identifier = "logger"
enterMethod = "enter"
exitMethod = "exit"
import = { module = "@your-org/logger", named = "logger" }
```

### Configure ESLint

Add to your `eslint.config.js` if you want direct ESLint integration:

```javascript
import { eslintPluginCreate } from '@codepol/plugin-eslint';
import {
  pluginBuiltinRegister,
  policyPluginRulesGet,
  providerRulesConfigGet,
} from '@codepol/core';
import codepolBuiltin from '@codepol/plugin';

pluginBuiltinRegister('@codepol/plugin', codepolBuiltin);

const codepol = eslintPluginCreate(await policyPluginRulesGet());

export default [
  {
    plugins: {
      codepol,
    },
    rules: {
      ...await providerRulesConfigGet('eslint'),
    },
  },
];
```

### Plugin Loading

Codepol loads rule-level plugin capabilities from `codepol.toml` declarations. Built-in plugins resolve from an
in-process registry, while universal custom plugins can run through the subprocess protocol. The CLI uses the
enabled rule plugins to decide which fixes and adapted ESLint rules to run, while Tree-sitter checking continues to
use the policy rules and their associated tree check providers.

The `@codepol/plugin-eslint` package is a thin adapter that aggregates rules from capability plugins such as
`@codepol/plugin`. Use `eslintPluginCreate(pluginRules)` to assemble the ESLint adapter from any set of
`CodepolPluginRule` instances.

### Run Checks

```bash
# Using CLI
npx codepol

# With autofix
npx codepol --fix

# Watch mode
npx codepol --watch
```

### Use the Standalone Binary (Recommended for Non-Node Projects)

For non-Node projects, this is the recommended way to run codepol.
For Node-capable projects, you can use either this binary bundle or `npx codepol`.
Download binaries from [GitHub Releases](https://github.com/fruitiecutiepie/codepol/releases) (or CI artifacts) instead of committing `dist-binary` to your repo.

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

Run from your project root:

```bash
codepol
# or
codepol --config ./codepol.toml
```

## Runtime diagnostics

Codepol ships a runtime diagnostics runtime that is configured per environment, not per caller. Business code depends on a `Diagnostics` / `ExecutionContext` interface; what actually flows out to console, file, or OTEL is decided once at the process boundary.

The control knobs are named presets — pick the one that matches the job:

| Preset | Posture |
| ------ | ------- |
| `user` | Safe field posture (default). warn / strict redaction / stdout sink. |
| `dev` | Productive daily engineering. debug / console + file / cheap invariants. |
| `test` | Deterministic CI verification. warn / memory sink / no tracing. |
| `verbose` | Explicit investigation. trace / console + file / full invariants / profiling on. |

Control surfaces:

- **CLI**: `--env <preset>`, `--override <dim=value>` (repeatable), `--escalate <scope=level@ttlSec:reason>` (repeatable). Env var `CODEPOL_ENV` sets the preset without a flag; legacy `CODEPOL_DEBUG_PARSE` / `CODEPOL_DEBUG_PARSE_FILE` continue to work as overlays.
- **VSCode**: settings `codepol.diagnostics.environment`, `codepol.diagnostics.overrides`, `codepol.diagnostics.escalations`, commands `Codepol: Set Diagnostics Environment`, `Codepol: Add Diagnostics Escalation`, `Codepol: Clear Diagnostics Escalations`, `Codepol: Show Current Diagnostics Config`.
- **Daemon IPC / LSP**: `set_diagnostics_config`, `set_diagnostics_escalation`, `revoke_diagnostics_escalation`, `list_diagnostics_escalations`, plus LSP command `codepol.diagnostics.configure` and request `codepol/diagnosticsConfig`.
- **Programmatic API**: `diagnosticsRuntimeSetEnvironment`, `diagnosticsRuntimeSetOverrides`, `diagnosticsRuntimeSetConfig`, `diagnosticsRuntimeEscalate`, `diagnosticsRuntimeRevokeEscalation` exported from `@codepol/core`.

The canonical reference — model, resolution rules, escalation semantics, redaction pipeline, sink pipeline — lives at [packages/core/src/diagnostics/README.md](./packages/core/src/diagnostics/README.md).

## What It Enforces

Codepol enforces custom policy rules defined by plugins. For example, a `no-duplicate-exports` rule that prevents naming collisions across your codebase:

```toml
[[plugins]]
id = "@your-org/plugin"

[plugins.source]
kind = "process"
command = "python3"
args = ["./tools/your_codepol_plugin.py"]

[targets.src]
language = "typescript"
files = ["src/**/*.ts"]

[[rules]]
ruleId = "@your-org/plugin/no-duplicate-exports"
targets = ["src"]

[rules.args]
include = ["function", "class", "type"]
```

This rule uses Tree-sitter to scan all files for exported identifiers, then reports conflicts:

```
src/auth/UserService.ts:5 - Duplicate export 'UserService' (also in src/legacy/UserService.ts:12)
```

The built-in `@codepol/plugin` includes a `require-logger-enter-exit` rule, but you can create plugins for any structural pattern. See [Creating Custom Plugins](./docs/creating-custom-plugins.md).

## Documentation

- [Getting Started](./docs/getting-started.md) - Step-by-step setup guide
- [Creating Custom Plugins](./docs/creating-custom-plugins.md) - Build custom Codepol plugins
- [Policy Schema](./docs/policy-schema.md) - Complete configuration reference
- [API Reference](./docs/api-reference.md) - Programmatic usage guide

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Type check
pnpm typecheck
```

## License

MIT
