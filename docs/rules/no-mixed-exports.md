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

No rule-specific arguments. Add a `[[rules]]` entry with `ruleId = "@codepol/plugin/no-mixed-exports"` and matching `targets`.

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
```

## Reporting

Violations are reported at line 1, column 1 (file-level).

## See also

- [Policy schema](../policy-schema.md)
