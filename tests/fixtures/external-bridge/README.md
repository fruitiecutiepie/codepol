# external-bridge fixtures

Source files and tool configs used by `tests/external-bridge.integration.spec.ts`.
Each subdirectory matches the corresponding bridge rule and parallels the
content under `examples/<linter>/`.

These fixtures intentionally omit `codepol.toml` and the tool binary path —
the integration spec writes those inline because:

- The codepol policy is constructed in TypeScript via `CodepolConfig` literals
  rather than parsed from TOML.
- `args.biomeBin` / `args.ruffBin` point at mock binaries created at test time
  in the temporary project directory.

If you change a fixture file, run:

```bash
npx vitest run tests/external-bridge.integration.spec.ts
```
