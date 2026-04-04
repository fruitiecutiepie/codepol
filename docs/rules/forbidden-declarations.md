# forbidden-declarations

Built-in rule: `@codepol/plugin/forbidden-declarations`

Reports configured declaration categories in JavaScript and TypeScript files using a TypeScript AST walk. This rule is report-only and is intended for teams that want to ban specific declaration forms such as `class`, `interface`, `var`, or import bindings.

## When to use

- Teams that want to ban entire declaration categories instead of only checking names.
- Policies that need syntax-precise bans such as `var`, `let`, `abstract class`, or `function*`.
- Codebases that still want `no-interface` as a separate fixable migration rule.

## Configuration

Add the rule under `[[rules]]` and set any combination of `args.symbols`, `args.bindings`, and `args.syntax`.

### Symbol categories

Supported `args.symbols` values:

- `namespace`
- `class`
- `interface`
- `type`
- `function`
- `method`
- `field`
- `const`
- `variable`
- `parameter`
- `enum`
- `enumMember`

`variable` applies to local `let` and `var` bindings only. It does not include imports or catch bindings.

### Binding categories

Supported `args.bindings` values:

- `import` for default, named, and namespace imports
- `catch` for catch clause bindings
- `function-expression-name` for inner names such as `const x = function y() {}`

### Syntax categories

Supported `args.syntax` values:

- `var`
- `let`
- `abstract-class`
- `generator-function`

If both a broad category and a narrower syntax category match the same declaration, the rule emits a single diagnostic and uses the narrower syntax label.

### Example

```toml
[[plugins]]
id = "@codepol/plugin"
source = { kind = "builtin" }

[targets.app]
language = "typescript"
files = ["src/**/*.ts", "src/**/*.tsx"]

[[rules]]
ruleId = "@codepol/plugin/forbidden-declarations"
targets = ["app"]
args.symbols = ["class", "interface", "type", "enum"]
args.bindings = ["import"]
args.syntax = ["var"]
```

## Reporting

Diagnostics use the format `Forbidden declaration '<name>' (<label>).`

- Primary diagnostics highlight the **banned keyword** when the grammar has one (for example `interface`, `class`, `type`, `function`, `enum`, `namespace`, `import`, `catch`, `const`, `let`, `var`). That keeps squiggles on the keyword (for example only `interface` on an `interface` declaration), not across the whole body block.
- Forms without a dedicated keyword use the **name** span only: method and field names, parameter and enum-member identifiers, and inner names on function expressions.
- `abstract class` syntax bans highlight the `abstract` keyword; `function*` generator syntax bans highlight `function` through `*`.
- Import bindings in the same statement share the single `import` keyword span. Multiple `var`/`let` bindings in one list each report with the same `var`/`let` keyword span.
- When both a broad symbol category and a narrower syntax category match, the narrower syntax label is used and the span follows that syntax rule (for example `abstract` for `abstract-class`).
- Anonymous default `class` and `function` exports are reported as `default`.

## Current coverage

This v1 rule supports the declaration categories listed above for `typescript`, `tsx`, `javascript`, and `jsx` targets. It does not promise exhaustive TypeScript declaration coverage for constructors, accessors, class expressions, named class-expression names, type parameters, or overload signatures.

## See also

- [Policy schema](../policy-schema.md)
- [no-mixed-exports](./no-mixed-exports.md)
