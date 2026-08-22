# Codepol

**Policy-driven code enforcement and architecture analysis.**

Codepol enforces coding standards *and* architectural constraints from a single
declarative policy file. It builds a semantic index of your codebase with
tree-sitter, uses it to answer cross-file and whole-graph questions, and
surfaces the results through a CLI, a language server, and an editor UI.

Define rules once in `codepol.toml`, enforce them in CI, and navigate them in
your editor.

```bash
npx codepol                             # check policy
npx codepol graph cycles                # find circular dependencies
npx codepol graph diff main --fail-on-new-cycle
```

## What it does

**Style and naming** — casing conventions per symbol kind and per path segment,
banned words, banned declaration families, verb-prefixed function names.
Cross-file autofix, including project-wide renames.

**Module hygiene** — unused exports, unused variables, duplicate exports across
files, mixed default/named exports, star-export collisions.

**Architecture** — circular imports, layering violations, fan-in/fan-out
budgets, dead modules, cross-package internal imports, entry-point allowlists,
undeclared interface implementers.

**Architecture queries** — dependency paths, impact radius, dead-module
detection, graph health metrics, and baseline diffing so you can gate on
*regressions* rather than requiring a clean slate.

**Editor integration** — diagnostics, quickfixes and fix-on-save, cross-file
rename with preview, dependency-graph and call-graph panels, cycle gutter
decorations, importer-count CodeLens, and architecture peek.

Languages: TypeScript/JS and Python for structural analysis; type-aware
enrichment additionally bridges to gopls and rust-analyzer. See
[language support](./docs/language-support.md).

## Architecture

```text
codepol.toml
     │
     ▼
┌──────────────────────────────────────────────────────────┐
│  @codepol/core                                           │
│  tree-sitter adapters · semantic index · module graph    │
│  policy engine · plugin registry                         │
└────────────────────────┬─────────────────────────────────┘
                         ▼
┌──────────────────────────────────────────────────────────┐
│  @codepol/workspace-service                              │
│  sessions · overlays · warm cache · analyzer scheduling  │
└──┬──────────────┬────────────────┬───────────────────────┘
   ▼              ▼                ▼
┌──────┐   ┌────────────┐   ┌─────────────┐   ┌───────────────┐
│ CLI  │   │ LSP server │   │   daemon    │   │ ESLint/Biome/ │
│      │   │            │   │             │   │  Ruff/esbuild │
└──────┘   └─────┬──────┘   └─────────────┘   └───────────────┘
                 ▼
         ┌───────────────┐
         │ VS Code ext.  │
         └───────────────┘
```

Both the CLI and the language server talk to a shared `WorkspaceService`
interface, implemented either in-process or by the daemon over a socket. The
daemon owns the expensive state — parsers, semantic index, file watchers, unsaved
buffer overlays — so a cold index build is paid once and reused across editor
sessions and CLI invocations.

## Packages

**Core**

| Package | Description |
| ------- | ----------- |
| [@codepol/core](./packages/core) | Policy engine, tree-sitter adapters, semantic index, module graph |
| [@codepol/workspace-service](./packages/workspace-service) | Shared analysis engine: sessions, overlays, caching, scheduling |

**Runtimes**

| Package | Description |
| ------- | ----------- |
| [@codepol/cli](./apps/cli) | `codepol` — policy checks and `codepol graph` queries |
| [@codepol/lsp](./apps/lsp) | Language server |
| [@codepol/daemon](./apps/daemon) | Background analysis daemon |
| [extension-vscode](./extension-vscode) | VS Code client |

**Rules and tool adapters**

| Package | Description |
| ------- | ----------- |
| [@codepol/plugin](./packages/plugin) | All built-in rules |
| [@codepol/plugin-eslint](./packages/plugin-eslint) | Runs Codepol rules as ESLint rules |
| [@codepol/plugin-biome](./packages/plugin-biome) | Biome integration |
| [@codepol/plugin-ruff](./packages/plugin-ruff) | Ruff integration (Python) |
| [@codepol/plugin-vulture](./packages/plugin-vulture) | Vulture dead-code detection (Python) |
| [@codepol/plugin-esbuild](./packages/plugin-esbuild) | Build-time enforcement |

**Type-aware bridges**

| Package | Description |
| ------- | ----------- |
| [@codepol/type-aware-provider](./packages/type-aware-provider) | Editor-native or subprocess backends: Pyright, gopls, rust-analyzer |
| [@codepol/typescript-language-bridge](./packages/typescript-language-bridge) | tsserver-backed call graph and type hierarchy |
| [@codepol/python-language-bridge](./packages/python-language-bridge) | Pyright/Pylance-backed call graph and type hierarchy |

The bridge packages never spawn a language server themselves — the host supplies
the transport.

## Quick start

```bash
pnpm add -D @codepol/cli
```

Create `codepol.toml` in your project root:

```toml
exclude = ["dist/**", "node_modules/**"]

[[plugins]]
id = "@codepol/plugin"
source = { kind = "builtin" }

[targets.src]
language = "typescript"
files = ["src/**/*.ts", "src/**/*.tsx"]
exclude = ["**/*.spec.ts"]

# Style
[[rules]]
ruleId = "@codepol/plugin/enforce-casing"
targets = ["src"]
fix = "on-save"

[rules.args.symbols]
function = ["camelCase"]
class = ["PascalCase"]
type = ["PascalCase"]

# Module hygiene
[[rules]]
ruleId = "@codepol/plugin/no-unused-exports"
targets = ["src"]
args.ignorePackageEntryPoints = true

# Architecture
[[rules]]
ruleId = "@codepol/plugin/no-cycles"
severity = "error"
targets = ["src"]
```

Then run:

```bash
npx codepol            # check
npx codepol --fix      # apply fixes
npx codepol --watch    # watch mode
```

Config is auto-discovered by walking up from the current directory. Use
`--config` if it lives elsewhere.

For projects without a Node toolchain, use the standalone binary — see
[Getting Started](./docs/getting-started.md#use-the-standalone-binary-recommended-for-non-node-projects).

## Editor setup

Install the VS Code extension. It activates when your workspace contains
`codepol.toml`.

```jsonc
// .vscode/settings.json
{
  "codepol.architecture.baselineLabel": "main",
  "editor.codeActionsOnSave": {
    "source.fixAll.codepol": "explicit"
  }
}
```

Rules tagged `fix = "on-save"` then apply automatically on save; everything else
stays available as a quickfix. See
[Editor Integration](./docs/editor-integration.md).

## ESLint integration

To run Codepol rules inside an existing ESLint setup:

```javascript
// eslint.config.mjs
import { eslintPluginCreate } from '@codepol/plugin-eslint';
import {
  pluginBuiltinRegister,
  providerParserRuntimeInit,
  policyPluginRulesGet,
  providerRulesConfigGet,
} from '@codepol/core';
import codepolBuiltin from '@codepol/plugin';

function codepolUnwrap(result, label) {
  if ('Err' in result) {
    console.error(`[eslint.config] ${label}: ${result.Err?.message ?? result.Err}`);
    process.exit(1);
  }
  return result.Ok;
}

await providerParserRuntimeInit('eslint');
pluginBuiltinRegister('@codepol/plugin', codepolBuiltin);

const codepol = eslintPluginCreate(
  codepolUnwrap(await policyPluginRulesGet(), 'policyPluginRulesGet'),
);

export default [
  {
    plugins: { codepol },
    rules: {
      ...codepolUnwrap(await providerRulesConfigGet('eslint'), 'providerRulesConfigGet'),
    },
  },
];
```

These loader functions return a `Result`, so unwrap before use — see
[API Reference](./docs/api-reference.md#providerrulesconfigget).

`@codepol/plugin-eslint` is a thin adapter: any rule with a tree-check provider
is auto-adapted into an ESLint rule. Cross-file fixes that touch other files are
dropped in this path, since ESLint can only edit the current file — run the CLI
or use the editor to apply those in full.

## CI

```yaml
- run: npx codepol
- run: npx codepol graph cycles
- run: npx codepol graph diff main --fail-on-new-cycle
```

Baseline diffing is the recommended way to adopt architecture rules on an
existing codebase: block new problems while you work the existing ones down. See
[Architecture Analysis](./docs/architecture-analysis.md#baselines-and-diffing).

## Documentation

| Guide | Contents |
| ----- | -------- |
| [Getting Started](./docs/getting-started.md) | Install, configure, first check |
| [Rule Catalog](./docs/rules/index.md) | Every built-in rule and its arguments |
| [Policy Schema](./docs/policy-schema.md) | Complete `codepol.toml` reference |
| [CLI Reference](./docs/cli-reference.md) | All commands and flags |
| [Architecture Analysis](./docs/architecture-analysis.md) | Module graph, architecture rules, baselines |
| [Editor Integration](./docs/editor-integration.md) | LSP, daemon, VS Code extension |
| [Language Support](./docs/language-support.md) | What works where |
| [Semantic Index](./docs/semantic-index.md) | How the index is built |
| [ProjectIndex API](./docs/project-index-api.md) | Query API for rule authors |
| [Creating Custom Plugins](./docs/creating-custom-plugins.md) | Write your own rules |
| [Cross-File Analysis](./docs/cross-file-analysis.md) | Rules that read the index |
| [Creating Language Adapters](./docs/creating-language-adapters.md) | Add a language |
| [Adding a Lint Provider](./docs/adding-a-lint-provider.md) | Add a tool integration |
| [API Reference](./docs/api-reference.md) | Programmatic surface |

Run the docs site locally with `pnpm docs:dev`.

## Development

```bash
pnpm install
pnpm build            # build WASM grammars, then all packages
pnpm test             # unit + integration
pnpm test:unit
pnpm test:integration
pnpm typecheck
pnpm lint
```

Codepol enforces its own policy on itself — see [`codepol.toml`](./codepol.toml).
That config is intentionally strict and idiosyncratic (`snake_case` functions,
no `interface`, no `class`, no `var`), which explains the naming style throughout
this repo. It is a dogfooding config, not a recommendation.

## License

MIT
