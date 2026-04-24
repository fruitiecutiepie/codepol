# ESLint tool-run example

Demonstrates enabling ESLint through `tools.eslint.runs`. The user's
`eslint.config.mjs` decides which ESLint rules fire; codepol decides when
ESLint runs and which files it sees.

## Files

- [codepol.toml](./codepol.toml) — declares `tools.eslint.runs` with `configPath`.
- [eslint.config.mjs](./eslint.config.mjs) — flat ESLint config enabling `no-debugger`.
- [src/app.ts](./src/app.ts) — contains a `debugger` statement that violates the rule.

## Running

```bash
cd examples/eslint
codepol --config ./codepol.toml
```

Expected output: one ESLint diagnostic on `src/app.ts` for `no-debugger`.

## How it wires together

1. `codepol.toml` declares `targets.ts-src` matching `src/**/*.ts`.
2. `tools.eslint.runs` binds `ts-src` to `configPath = "./eslint.config.mjs"`.
3. When codepol runs, the workspace-service's eslint analyzer reads that tool
   run, constructs an `ESLint` instance with `overrideConfigFile` pointing at
   `eslint.config.mjs`, and lints the matched files.
4. ESLint's flat config decides what fires; `no-debugger: 'error'` on
   `**/*.ts` flags the `debugger` statement in `app.ts`.

The tool run itself contributes no rules to ESLint's override config — it
exists purely to make the analyzer fire. Authoring or disabling actual ESLint
rules still happens in `eslint.config.mjs`.
