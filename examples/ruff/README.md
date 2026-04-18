# Ruff bridge example

Demonstrates enabling Ruff through codepol's `@codepol/plugin/ruff` bridge
rule. Rule selection lives in policy `args` (mirroring Ruff's CLI flags) and
in `pyproject.toml`; codepol decides when Ruff runs and which files it sees.

## Files

- [codepol.toml](./codepol.toml) — declares `@codepol/plugin/ruff` with `args.select`/`args.ignore`.
- [pyproject.toml](./pyproject.toml) — Ruff base configuration.
- [src/app.py](./src/app.py) — contains an unused import that triggers `F401`.

## Prerequisites

[Install Ruff](https://docs.astral.sh/ruff/installation/) so `ruff` is on
your `PATH`. Alternatively, set `args.ruffBin` on the bridge rule to an
absolute path.

## Running

```bash
cd examples/ruff
codepol --config ./codepol.toml
```

Expected output: one Ruff diagnostic on `src/app.py` for `F401` (unused
import). The `E501` (line too long) rule is enabled in `select` but ignored
via `ignore`, so any long lines are silently passed.

## How it wires together

1. `codepol.toml` declares `targets.python-src` matching `src/**/*.py`.
2. The bridge rule `@codepol/plugin/ruff` is bound to `python-src` with
   `args.select = ["E", "F", "I"]` and `args.ignore = ["E501"]`. The ruff
   analyzer maps these to `--select=E,F,I` and `--ignore=E501` flags.
3. Ruff reads `pyproject.toml` for any unset options and runs against the
   matched files, emitting JSON diagnostics on stdout.
4. codepol normalizes those diagnostics into `WorkspaceDiagnostic` objects.

The bridge rule's `args` mirror `RuffProviderConfig`: `ruffBin`, `select`,
`ignore`, `fixable`, `configPath`, and `extraArgs`. CLI-flag overrides win
over `pyproject.toml`, matching Ruff's own precedence.
