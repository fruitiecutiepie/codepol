# Language Support

Codepol supports two languages for structural analysis, and bridges to real
language servers for type-aware enrichment in four.

## Support matrix

| Language | Structural index | Native rules | External tools | Type-aware bridge |
| -------- | ---------------- | ------------ | -------------- | ----------------- |
| TypeScript / TSX | full | all | ESLint, Biome | tsserver |
| JavaScript / JSX | full | most | ESLint, Biome | tsserver |
| Python | full | subset | Ruff, Vulture | Pyright |
| Go | — | — | — | gopls |
| Rust | — | — | — | rust-analyzer |

The three columns measure different things, and they do not move together:

- **Structural index** — tree-sitter parsing into symbols, scopes, references,
  imports/exports, call sites, type relations, and control flow. This is what
  cross-file and architecture rules read.
- **Native rules** — rules implemented against that index.
- **Type-aware bridge** — a real language server refining call-graph and
  type-hierarchy results. Deliberately broader than the index, because the
  [seam](./architecture-analysis.md#type-aware-enrichment) is language-agnostic.

Go and Rust have bridges but no rules: the enrichment plumbing landed ahead of
structural support for those languages.

## TypeScript and JavaScript

The primary target. Grammars: `tree-sitter-typescript` and `tree-sitter-tsx`.

Everything works here — all per-file rules, all cross-file rules, all
architecture rules, the full module graph, symbol-level call graphs and type
hierarchies, and every editor surface. Module resolution understands relative
imports, path aliases, and monorepo workspace package entry points.

`javascript` and `jsx` are accepted as target languages and share the
TypeScript grammar. Rules that are inherently TypeScript-only —
`no-interface`, `no-star-export-collisions` — declare only `typescript` and
`tsx`.

## Python

Real support, not a stub. Grammar: `tree-sitter-python`, with query packs
mirroring the TypeScript ones (symbols, scopes, references, imports, exports,
calls, type relations, symbol flow, member shape).

Rules available on Python targets:

| Rule | Notes |
| ---- | ----- |
| `enforce-casing` | Full symbol and path casing support |
| `no-verb-function-name` | |
| `forbidden-words` | Language-agnostic |
| `forbidden-path-words` | Language-agnostic |
| `python-dead-code` | Vulture-backed, with fix |

The TypeScript-specific module-hygiene rules — `no-unused-vars`,
`no-unused-exports`, `no-interface`, `no-mixed-exports`,
`no-duplicate-exports`, `no-star-export-collisions`,
`forbidden-declarations` — have no Python equivalent, because they encode
ES-module semantics that do not map onto Python's import model.

For general Python linting, delegate to Ruff rather than expecting native
equivalents:

```toml
[targets.python-src]
language = "python"
files = ["**/*.py"]
exclude = ["**/.venv/**"]

[tools.ruff]
[[tools.ruff.runs]]
targets = ["python-src"]
select = ["E", "F", "I"]
ignore = ["E501"]

[[rules]]
ruleId = "@codepol/plugin/enforce-casing"
targets = ["python-src"]

[rules.args.symbols]
function = ["snake_case"]
class = ["PascalCase"]
```

`python-dead-code` requires `vulture` on `PATH`; Ruff runs require `ruff`.

## Adding a language

Two independent extension points, depending on what you need:

**Structural support** — write a tree-sitter language adapter: a grammar, query
packs, and kind mappings. The extraction engine is language-agnostic, so an
adapter is configuration plus queries rather than new traversal logic. See
[Creating Language Adapters](./creating-language-adapters.md).

**Type-aware support only** — supply a transport to an existing language server
via `CODEPOL_TYPE_AWARE_BRIDGE_PROVIDER`. Codepol never spawns language servers
itself; the host owns their lifecycle. This is how Go and Rust are supported
today.

## Rule support by language

| Rule | TS/TSX | JS/JSX | Python |
| ---- | :----: | :----: | :----: |
| `enforce-casing` | ● | ● | ● |
| `forbidden-words` | ● | ● | ● |
| `forbidden-path-words` | ● | ● | ● |
| `no-verb-function-name` | ● | | ● |
| `forbidden-declarations` | ● | ● | |
| `no-unused-exports` | ● | ● | |
| `no-unused-vars` | ● | ● | |
| `no-mixed-exports` | ● | ● | |
| `no-interface` | ● | | |
| `no-star-export-collisions` | ● | | |
| `no-duplicate-exports` | ● | ● | |
| `require-logger-enter-exit` | ● | | |
| `python-dead-code` | | | ● |
| Architecture rules | ● | ● | ● |

Architecture rules operate on the module graph rather than on syntax, so they
apply wherever the index resolved imports.

`no-duplicate-exports` declares no language restriction — it is implemented as a
fix provider over the project index rather than a per-file syntax check — but it
encodes ES-module export semantics, so it is only meaningful on JS/TS targets.
