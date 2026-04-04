# no-mixed-exports

Built-in rule: `@codepol/plugin/no-mixed-exports`

Reports modules that mix **default** exports with **named** exports (including re-exports like `export { x } from './m'` or `export * from './m'`).

## When to use

- Teams that want a single, consistent export style per file (either all named or a single default).
- Reducing confusion when consumers import from the same module using different patterns.

## What counts as mixed

- **Default export**: `export default …`, including `export default function …` / `export default class …` (with or without a name).
- **Named export**: any other export form in the same file, such as `export const`, `export function`, `export type`, `export { … }`, `export { … } from '…'`, or `export * from '…'` / `export * as ns from '…'`.

Files that use only named exports or only a default export are allowed.

## Configuration

This rule accepts an optional `args.preferredStyle` setting:

- `"named"`: when a file mixes styles, anchor the primary violation on the default export.
- `"default"`: when a file mixes styles, anchor the primary violation on the first named export.

If omitted, the rule keeps its default behavior and anchors the violation on the statement that first makes the module mixed.

### Example

```toml
[[plugins]]
id = "@codepol/plugin"
source = { kind = "builtin" }

[targets.app]
language = "typescript"
files = ["src/**/*.ts", "src/**/*.tsx"]

[[rules]]
ruleId = "@codepol/plugin/no-mixed-exports"
targets = ["app"]
args.preferredStyle = "named"
```

## Reporting

Without `args.preferredStyle`, the primary violation is anchored on the **first top-level statement** that makes the module mixed (the statement that introduces the second export style). Any **further export statements** after that line are listed as related locations.

With `args.preferredStyle`, the primary violation is anchored on the **first export statement that uses the non-preferred style**, and the other export statements in the file are listed as related locations. In ESLint, related locations appear as additional diagnostics for the same rule.

## Autofix

Autofix is only available when `args.preferredStyle` is set and a project-wide semantic index is available (this rule enables `requiresProjectIndex` so the index is built for policy checks).

- **`preferredStyle = "named"`**: Rewrites supported default-export forms (for example `export default function Name…` / `export default class Name…`, or `export default Name` when a matching named export already exists) and updates **default** imports from other files to **named** imports when the index resolves them.
- **`preferredStyle = "default"` (safe cases only)**: Applies only when the file has a **single** local named export (for example one `export function` / `export const` / `export class` / `export type` / `export interface` / `export enum`) and a default export of the form `export default <identifier>` referencing that same binding. It removes `export` from the named declaration and may rewrite **named** imports in importers to **default** imports when the index resolves them. Modules with multiple named exports, re-export-only named forms, or other ambiguous shapes are reported without a fix.

Fixes may span multiple files via `fix.edits`. **ESLint** only applies fixes that stay within the current file; use the Codepol CLI `--fix`, workspace integrations, or other consumers that apply full workspace edits for multi-file fixes.

## See also

- [Policy schema](../policy-schema.md)
