# Biome tool-run example

Demonstrates enabling Biome through `tools.biome.runs`. Biome's own
`biome.json` decides which rules fire; codepol decides when Biome runs and
which files it sees.

## Files

- [codepol.toml](./codepol.toml) — declares `tools.biome.runs` with `configPath`.
- [biome.json](./biome.json) — Biome config enabling `noDoubleEquals`.
- [src/app.ts](./src/app.ts) — uses `==` instead of `===` to trigger the rule.

## Prerequisites

[Install Biome](https://biomejs.dev/guides/getting-started/) so `biome` is on
your `PATH`. Alternatively, set `biomeBin` on the tool run to an
absolute path.

## Running

```bash
cd examples/biome
codepol --config ./codepol.toml
```

Expected output: one Biome diagnostic on `src/app.ts` for
`lint/suspicious/noDoubleEquals`.

## How it wires together

1. `codepol.toml` declares `targets.ts-src` matching `src/**/*.ts`.
2. `tools.biome.runs` binds `ts-src` to `configPath = "./biome.json"`. The
   biome analyzer forwards this as
   `--config-path=...` when invoking the `biome` subprocess.
3. Biome reads `biome.json`, runs its own ruleset against the matched files,
   and emits diagnostics on stdout in `rdjson` format.
4. codepol normalizes those diagnostics into `WorkspaceDiagnostic` objects.

The tool run fields mirror `BiomeProviderConfig`: `configPath`, `biomeBin`,
and `extraArgs`. Policy `severity` and `args.rules` do **not**
alter Biome's behavior; rule enablement lives in `biome.json`.
