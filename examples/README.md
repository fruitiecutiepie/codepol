# Examples

Minimal end-to-end example workspaces showing how to enable external linters
through `tools.<tool>.runs`. Each subdirectory is a self-contained project:
a `codepol.toml`, the matching tool config, one source file with a deliberate
violation, and a README explaining what to expect.

| Example | Tool run | Demonstrates |
| ------- | -------- | ------------ |
| [eslint](./eslint) | `tools.eslint.runs` | Triggering ESLint on JS/TS files via explicit ESLint runs |
| [biome](./biome) | `tools.biome.runs` | Triggering Biome on JS/TS files with `biome.json` selecting the rule |
| [ruff](./ruff) | `tools.ruff.runs` | Triggering Ruff on Python files with `select`/`ignore` driven from run config |

## Running an example

Each example assumes you can invoke `codepol` from the example directory:

```bash
cd examples/<linter>
codepol --config ./codepol.toml
```

You also need the matching tool installed and resolvable on your `PATH`
(`eslint` is included via this repo's dev dependencies; `biome` and `ruff`
must be installed separately for their respective examples).

## Tool run shape

All three examples use top-level tool runs. ESLint requires `configPath`;
Biome and Ruff treat it as optional and fall back to their own config
discovery when omitted.

```toml
[tools.<eslint|biome|ruff>]
[[tools.<eslint|biome|ruff>.runs]]
targets = ["<target-name>"]
configPath = "./<tool-config-file>"
```

A tool may be declared more than once with different run config (for example,
a second `tools.eslint.runs` entry pointing at a different `configPath`, or a
second `tools.ruff.runs` entry with different `select` / `ignore`).
Each distinct resolved config runs as its own subprocess invocation over the
files matched by that run's targets; entries that resolve to identical
configs are merged into a single invocation.

See [docs/policy-schema.md](../docs/policy-schema.md) for the complete tool-run
reference, including Ruff's `select` / `ignore` / `fixable` fields and
Biome's `biomeBin` / `extraArgs` fields.
