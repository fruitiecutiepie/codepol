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

## See also

- [Policy schema](../policy-schema.md)
