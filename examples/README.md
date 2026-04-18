# Examples

Minimal end-to-end example workspaces showing how to enable external linters
through codepol's bridge rules. Each subdirectory is a self-contained project:
a `codepol.toml`, the matching tool config, one source file with a deliberate
violation, and a README explaining what to expect.

| Example | Bridge rule | Demonstrates |
| ------- | ----------- | ------------ |
| [eslint](./eslint) | `@codepol/plugin/eslint` | Triggering ESLint on JS/TS files via the bridge rule |
| [biome](./biome) | `@codepol/plugin/biome` | Triggering Biome on JS/TS files with `biome.json` selecting the rule |
| [ruff](./ruff) | `@codepol/plugin/ruff` | Triggering Ruff on Python files with `select`/`ignore` driven from `args` |

## Running an example

Each example assumes you can invoke `codepol` from the example directory:

```bash
cd examples/<linter>
codepol --config ./codepol.toml
```

You also need the matching tool installed and resolvable on your `PATH`
(`eslint` is included via this repo's dev dependencies; `biome` and `ruff`
must be installed separately for their respective examples).

## Bridge rule shape

All three examples use the same `args.configPath` shape on the bridge rule.
ESLint requires `args.configPath`; Biome and Ruff treat it as optional and
fall back to their own config discovery when omitted.

```toml
[[rules]]
ruleId = "@codepol/plugin/<eslint|biome|ruff>"
targets = ["<target-name>"]
args.configPath = "./<tool-config-file>"
```

A bridge rule may be declared more than once with different `args` (e.g. a
second `@codepol/plugin/eslint` entry pointing at a different `configPath`, or
a second `@codepol/plugin/ruff` entry with different `select`/`ignore`).
Each distinct resolved config runs as its own subprocess invocation over the
files matched by its policy rule's targets; entries that resolve to identical
configs are merged into a single invocation.

See [docs/policy-schema.md](../docs/policy-schema.md) for the complete bridge
rule reference, including Ruff's `select` / `ignore` / `fixable` args and
Biome's `biomeBin` / `extraArgs` args.
