# Codepol Logging Policy Tooling

Codepol provides a policy-driven enforcement pipeline that ensures functions are wrapped with
`logger.enter` and `logger.exit` calls using both structural ESLint rules and Tree-sitter scanning.
The policy acts as the single source of truth for rule metadata, targets, and exclusions.

## Repository layout

- `policy.schema.json` / `policy.json`: schema + policy definitions for rules and targets.
- `tools/policy-scan.ts`: Tree-sitter scanner for structural policy validation.
- `tools/eslint-plugin-org/`: local ESLint rule enforcing logging instrumentation with autofix.
- `tools/policy-check.ts`: CLI that runs ESLint and Tree-sitter checks together.
- `tools/esbuild-plugin-policy.ts`: esbuild plugin that enforces the same policy during builds.
- `tests/`: contract, ESLint rule, Tree-sitter, and integration tests with fixtures.

## Core workflows

Run the policy checks (CI-friendly):

```sh
pnpm run policy:check
```

Apply autofixes:

```sh
pnpm run policy:fix
```

Watch mode:

```sh
pnpm run policy:watch
```

Run tests:

```sh
pnpm test
```
