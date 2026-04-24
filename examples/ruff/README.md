# Ruff tool-run example

Demonstrates enabling Ruff through `tools.ruff.runs`. Rule selection lives in
the run config (mirroring Ruff's CLI flags) and in `pyproject.toml`; codepol
decides when Ruff runs and which files it sees.

## Files

- [codepol.toml](./codepol.toml) — declares `tools.ruff.runs` with `select` / `ignore`.
- [pyproject.toml](./pyproject.toml) — Ruff base configuration.
- [src/app.py](./src/app.py) — contains an unused import that triggers `F401`.

## Prerequisites

[Install Ruff](https://docs.astral.sh/ruff/installation/) so `ruff` is on
your `PATH`. Alternatively, set `ruffBin` on the tool run to an
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
2. `tools.ruff.runs` binds `python-src` with `select = ["E", "F", "I"]` and
   `ignore = ["E501"]`. The ruff analyzer maps these to `--select=E,F,I` and
   `--ignore=E501` flags.
3. Ruff reads `pyproject.toml` for any unset options and runs against the
   matched files, emitting JSON diagnostics on stdout.
4. codepol normalizes those diagnostics into `WorkspaceDiagnostic` objects.

The tool run fields mirror `RuffProviderConfig`: `ruffBin`, `select`,
`ignore`, `fixable`, `configPath`, and `extraArgs`. CLI-flag overrides win
over `pyproject.toml`, matching Ruff's own precedence.
