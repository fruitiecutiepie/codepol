# CLI Reference

The `codepol` binary runs policy checks and answers architecture queries.

```bash
codepol [options]
codepol graph <subcommand> [options]
```

Config is auto-discovered by walking up from the current directory looking for
`codepol.toml`. Pass `--config` to point at one explicitly.

## `codepol` — policy checks

```bash
codepol                 # check
codepol --fix           # check and apply fixes
codepol --watch         # re-check on change
```

| Option | Type | Description |
| ------ | ---- | ----------- |
| `--fix` | boolean | Apply available fixes where possible |
| `--watch` | boolean | Re-run checks when the config or any matched file changes |
| `--config <path>` | string | Path to `codepol.toml` (auto-discovered when omitted) |
| `--check-plugins` | boolean | Validate the policy and its rule plugins, print resolved rule ids, then exit without analyzing |
| `--env <name>` | string | Diagnostics environment preset: `user`, `dev`, `test`, `verbose` |
| `--override <dim=value>` | repeatable | Patch one diagnostics dimension |
| `--escalate <scope=level@ttl:reason>` | repeatable | Time-bounded diagnostics escalation |

Exit code is `1` when any violation is reported, otherwise `0`.

### `--check-plugins`

Use this to debug policy wiring without paying for analysis. It resolves every
`[[plugins]]` declaration and validates that each `[[rules]]` entry's `ruleId`
maps to a registered plugin rule that supports the target's language.

```bash
codepol --check-plugins
```

### Diagnostics options

`--override` accepts one `dimension=value` pair per flag:

| Dimension | Example |
| --------- | ------- |
| `level` | `--override level=debug` |
| `scopes.<name>` | `--override scopes.parser=trace` |
| `tracing.enabled`, `tracing.sampleRate` | `--override tracing.enabled=true` |
| `metrics.enabled` | `--override metrics.enabled=true` |
| `snapshots.enabled`, `snapshots.maxBytes` | `--override snapshots.enabled=true` |
| `checks.invariants` | `--override checks.invariants=full` |
| `redaction.mode` | `--override redaction.mode=strict` |
| `sinks` | `--override sinks=console,file` |
| `logFilePath` | `--override logFilePath=/tmp/codepol.log` |
| `otelEndpoint` | `--override otelEndpoint=http://localhost:4318` |

`--escalate` raises verbosity for a bounded window, then rolls back
automatically. Scope is `global`, `scope:<dotted.name>`, `request:<id>`, or
`workspace:<id>`:

```bash
codepol --escalate scope:parser=trace@600:reproduce_wasm_abort
```

See [Getting Started → Tuning diagnostics](./getting-started.md#tuning-diagnostics)
for the preset model.

## `codepol graph` — architecture queries

Every graph subcommand builds the semantic index, then answers one question
about the module graph. All accept `--config`; most accept
`--format json|text` (default `json`).

See [Architecture Analysis](./architecture-analysis.md) for what the graph
contains and how to adopt these in CI.

### `export`

Emit the full dependency graph.

```bash
codepol graph export --format mermaid
```

| Option | Description |
| ------ | ----------- |
| `--format` | `json`, `text`, `dot`, `mermaid`, `graphml` |

`json` and `text` are summaries; `dot`, `mermaid`, and `graphml` are graph
descriptions you can paste into Graphviz, Mermaid, or Gephi.

### `cycles`

List dependency cycles. **Exits non-zero when any cycle exists**, which makes it
usable as a CI gate on its own.

```bash
codepol graph cycles --format text --max 20
```

| Option | Description |
| ------ | ----------- |
| `--max` | Maximum cycles to report (default: unbounded) |

### `path <from> <to>`

Enumerate simple dependency paths between two files — the "how does this end up
importing that?" query.

```bash
codepol graph path src/domain/user.ts src/infra/db.ts
```

| Option | Description |
| ------ | ----------- |
| `--max-paths` | Cap path enumeration (default: 5) |

### `dead`

List modules unreachable from entry points.

```bash
codepol graph dead --entry src/index.ts --entry "bin/**"
```

| Option | Description |
| ------ | ----------- |
| `--entry` | Repeatable. Literal path or glob. Defaults to natural entry points |

### `fan-in [file]` / `fan-out [file]`

Rank files by importer count (`fan-in`) or importee count (`fan-out`). Pass a
file to report just that one.

```bash
codepol graph fan-in --top 10
codepol graph fan-out src/core/index.ts
```

| Option | Description |
| ------ | ----------- |
| `--top` | Report only the top N entries (default `20`, ignored when a file is given) |

### `impact <file>`

Emit the neighborhood of a file — what a change here could affect.

```bash
codepol graph impact src/core/index.ts --direction downstream --depth 3
```

| Option | Description |
| ------ | ----------- |
| `--direction` | `upstream`, `downstream`, `both` (default `both`) |
| `--depth` | Maximum hop distance (default: bounded to 2) |

### `snapshot`

Capture the current graph as a labeled baseline under
`.codepol/graph-snapshots/`.

```bash
codepol graph snapshot --label main
```

| Option | Description |
| ------ | ----------- |
| `--label` | Baseline label to write |

### `diff [baselineLabel]`

Diff the live graph against a stored baseline. This is the "did this PR make the
architecture worse?" query.

```bash
codepol graph diff main --fail-on-new-cycle
```

| Option | Description |
| ------ | ----------- |
| `--baseline-label` | Baseline label to compare against |
| `--baseline-file` | Compare against a snapshot file directly |
| `--fail-on-new-cycle` | Exit `1` when the diff introduces a new cycle |

### `metrics`

Report graph health: instability, longest dependency chain, cycle/SCC size
distribution, and complexity hotspots.

```bash
codepol graph metrics --fail-on-cycle --top 15
```

| Option | Description |
| ------ | ----------- |
| `--top` | How many hotspot entries to report |
| `--fail-on-cycle` | Exit non-zero when the workspace has any cycle |

### `flow <symbolId>`

Find "function passed as an argument" flow sites for a symbol — the callback
sites a plain call graph misses.

```bash
codepol graph flow <symbolId> --direction incoming
```

| Option | Description |
| ------ | ----------- |
| `--direction` | `outgoing` (default) or `incoming` |

### `hierarchy <symbolId>`

Emit the type hierarchy around a class or interface symbol.

```bash
codepol graph hierarchy <symbolId> --direction subtypes --include-structural
```

| Option | Description |
| ------ | ----------- |
| `--direction` | `supertypes`, `subtypes`, `both` (default `both`) |
| `--depth` | Maximum hop distance (default: unbounded) |
| `--include-structural` | Include structural-shape matches, not just declared ones |
| `--min-confidence` | `declared`, `structural-shape`, `type-aware` |
| `--require-type-aware` | Fail rather than fall back to heuristic edges |

Symbol ids come from the index — get them via `codepol graph export`, or from
the editor commands in [Editor Integration](./editor-integration.md).

## Environment variables

| Variable | Effect |
| -------- | ------ |
| `CODEPOL_ENV` | Selects the diagnostics preset at startup (same values as `--env`) |
| `CODEPOL_WORKSPACE_SERVICE_MODE` | `in_process` runs analysis in the calling process instead of the daemon |
| `CODEPOL_DAEMON_RUNTIME_DIR` | Where the daemon writes its socket, lock, and descriptor |
| `CODEPOL_DAEMON_CACHE_DIR` | Where the daemon persists its warm cache |
| `CODEPOL_DEBUG_PARSE`, `CODEPOL_DEBUG_PARSE_FILE` | Legacy parse logging; applied as overrides on the active preset |
| `CODEPOL_PYRIGHT_BIN`, `CODEPOL_GOPLS_BIN`, `CODEPOL_RUST_ANALYZER_BIN` | Override the binary for a type-aware backend |
| `CODEPOL_TYPE_AWARE_BRIDGE_PROVIDER` | Path to a host module supplying a type-aware transport |

## CI usage

```yaml
- run: npx codepol                                    # policy violations
- run: npx codepol graph cycles                       # no new cycles at all
- run: npx codepol graph diff main --fail-on-new-cycle # no regressions vs baseline
- run: npx codepol graph metrics --fail-on-cycle
```

For repos without a Node toolchain, use the standalone binary — see
[Getting Started → Use the Standalone Binary](./getting-started.md#use-the-standalone-binary-recommended-for-non-node-projects).
