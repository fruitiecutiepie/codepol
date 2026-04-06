# Codepol LSP Hover Model

This companion note expands the `Hover for Codepol-owned semantic classes` section in `TODO_CODEPOL_LSP.md`.

Keep the main TODO focused on architecture, rollout, and decision summaries. Use this file for the MVP routing policy, covered semantic classes, payload shape, and UI presentation rules for `hover`.

## When To Read This

Read this note when you are:

- implementing Codepol `hover` services or adapters
- defining hover precedence, explicit Codepol identity, or semantic-class filtering
- deciding how the core hover payload renders in editor hover versus Codepol-owned views
- setting size limits, actions, or escalation paths from hover into richer details surfaces

## Decision

- Codepol `hover` exists in MVP, but only as a narrow Codepol-owned hover
- Codepol `hover` may cover only these semantic classes:
  - `domain_entity`
  - `architecture_node`
  - `config_component`
  - `generated_artifact`
- exclude `relation_anchor` from MVP hover
- existing language servers remain authoritative for ordinary language hover on TypeScript/JavaScript and Python symbols
- Codepol `hover` appears only in Codepol-owned interaction contexts or for editor targets that already carry explicit Codepol identity
- on editor text, explicit Codepol identity means extension-owned marker state on that exact range, not plain semantic tokens, generic LSP metadata, or warmed-index inference alone
- do not use Codepol `hover` as a fallback when the standard language server has no answer
- do not merge standard language-server hover content with Codepol hover content in MVP
- hover actions are optional adapter sugar, not required for MVP correctness
- hover may consult the warmed Codepol index only through tight, hot-path, in-memory reads
- if explicit Codepol identity exists but rich hover data is not ready, return a minimal Codepol card instead of blocking; if identity is absent or broken, show no Codepol hover
- return a compact structured semantic summary payload rather than arbitrary editor-specific markdown from the core

## Why This Boundary Matters

- it keeps Codepol from becoming a second general hover provider for ordinary code symbols
- hover is a compact, high-frequency UI surface, so relation and evidence-heavy semantics become noisy quickly when forced into that shape
- a structured payload lets adapters render consistent summary cards in hover while preserving richer presentations in Codepol-owned panels and views

## Invocation Rule

Codepol `hover` should appear only when all of the following are true:

1. the target is confidently classified as one of the supported Codepol-owned semantic classes
2. the request comes from a Codepol-owned surface or from editor text with explicit Codepol identity already attached
3. the payload is compact and high-signal
4. the content is non-overlapping with standard language-server hover

If any of those conditions fail:

- do not show Codepol `hover`
- leave default language-server hover as the only hover

## Allowed Contexts

Codepol `hover` is allowed on:

- Codepol tree items
- Codepol symbol or search results
- Codepol graph nodes
- Codepol-specific CodeLens, decorations, or inline markers
- editor text only when the token already has explicit Codepol identity attached by Codepol

Codepol `hover` is not allowed on:

- arbitrary source tokens in the normal editor flow
- fallback hover when the standard language server returns no result
- generic hover stacking on all tokens

This conservative routing rule is important. MVP should not infer "if `tsserver` has nothing, show Codepol instead."

Normal mouse hover on a decorated token is enough to show Codepol hover. Mouse hover on undecorated editor text is not enough.

## Explicit Codepol Identity

On editor text, explicit Codepol identity means extension-owned marker state on the hovered range.

Counts as explicit Codepol identity:

- Codepol decoration metadata attached to the text range
- Codepol CodeLens attached to the text range
- Codepol inlay or inline marker attached to the text range
- command or context invocation from a Codepol-owned view that resolves back to one text range and one entity id

Does not count in MVP:

- plain semantic tokens
- generic LSP semantic-token metadata
- document symbols
- syntax kind alone
- cursor position alone
- warmed index hits alone without an explicit marker on the text range

This keeps Codepol hover visibly opt-in instead of inferred opportunistically from background analysis.

## Covered Semantic Classes

Use a first-class internal enum rather than ad hoc string values in adapters.

```ts
type CodepolHoverSemanticClass =
  | 'domain_entity'
  | 'architecture_node'
  | 'config_component'
  | 'generated_artifact';
```

### `domain_entity`

Hover purpose:

- give a compact semantic summary of the entity and how it fits into the project model

Payload should include:

- display name
- entity kind
- canonical source or declaration label
- short summary
- key attributes
- counts of related usages
- quick links or actions when available

Do not include:

- full reference lists
- long prose documentation
- raw graph dumps

### `architecture_node`

Hover purpose:

- show what the node is and its immediate role in the architecture graph

Payload should include:

- node name
- node type
- owning module, package, or service
- short role description
- inbound and outbound edge counts
- policy status summary when relevant

Do not include:

- the full dependency graph
- transitive closure
- detailed evidence lines

### `config_component`

Hover purpose:

- show what the config-declared component is, where it is defined, and what consumes it

Payload should include:

- component name
- component kind
- source config file
- resolved target or owner
- short status summary
- consumer count

### `generated_artifact`

Hover purpose:

- explain provenance clearly

Payload should include:

- artifact name
- artifact kind
- generated-from source
- generator or source-mapping summary
- downstream usage count
- freshness or status when available

Key rule:

- emphasize where the artifact came from, whether it is generated, and what owns it

### Why `relation_anchor` Is Excluded

`relation_anchor` is not covered in MVP.

Reason:

- relation semantics are often multi-ended and evidence-based
- the useful presentation usually needs grouped source, target, evidence, and policy state
- that is a poor fit for hover size and discoverability

Use instead:

- details panel
- graph panel
- `show relation evidence` or equivalent explicit command

## Payload Model

Codepol `hover` should return a compact structured card payload, not arbitrary markdown blobs from the core.

```ts
type CodepolHoverField = {
  label: string;
  value: string;
};

type CodepolHoverAction =
  | 'go_to_definition'
  | 'find_references'
  | 'open_details'
  | 'show_graph';

type CodepolHoverPayload = {
  semanticClass: CodepolHoverSemanticClass;
  title: string;
  subtitle?: string;
  summary?: string;
  statusText?: string;
  fields: CodepolHoverField[];
  tags?: string[];
  actions?: CodepolHoverAction[];
  canonicalLocationLabel?: string;
};
```

Adapters can then render that payload:

- as markdown in editor hover
- as richer cards in Codepol views
- as quick actions where the client supports them

This keeps editor-specific formatting out of the core.

Hover actions are optional. Adapters may expose them when the client supports that UI, but correctness must not depend on their presence.

## Data Source And Latency Budget

Hover is a high-frequency interaction and must stay on a tight hot path.

Allowed on the hover path:

- explicit marker metadata on the text range
- hot in-memory entity records
- hot in-memory canonical labels, source labels, and already-computed counts
- hot in-memory status summaries already present in the warmed index

Not allowed on the hover path:

- triggering fresh indexing
- waiting for graph rebuild
- expensive reference expansion
- blocking on cold data loading
- multi-hop recomputation

If the required rich data is not already available inside the hover latency budget, do not wait for it.

## Size Constraints

Hover should stay small.

Hard MVP limits:

- max 1 summary sentence
- max 5 fields
- max 3 tags
- max 3 actions
- no nested sections
- no long reference lists
- no stack traces, evidence dumps, or graph expansions

If the content would exceed those limits:

- return only the compact summary
- include `open_details` when available

## Minimal Versus Rich Cards

When explicit Codepol identity exists but rich hover data is stale or not ready, return a minimal Codepol hover card instead of failing all the way to no hover.

Minimal card:

- title
- semantic class or kind
- canonical label or source label if already cached
- optional `statusText` such as `Details not ready`

Do not include on a minimal card:

- reference counts
- dependency counts
- freshness stats
- policy rollups
- graph summaries

Rich card:

- optional summary
- up to 5 fields
- optional tags
- optional actions when supported by the adapter

Stale or not-ready behavior:

- explicit identity plus stale or not-ready rich data -> return a minimal card
- no explicit identity -> return no Codepol hover
- explicit marker but broken entity resolution -> return no Codepol hover

## Precedence Rules

For ordinary editor hover:

- the existing language server wins

For Codepol-owned surfaces:

- Codepol `hover` is allowed and preferred

For editor text with explicit Codepol identity:

- Codepol `hover` may appear, but only if the token is already recognized as Codepol-owned

Do not combine `tsserver`, `Pylance`, or `Pyright` hover with Codepol hover in MVP.

## Routing Table

| Context                                     | Hover behavior                     |
| ------------------------------------------- | ---------------------------------- |
| ordinary code token in TS/JS/Python editor  | default language-server hover only |
| Codepol tree, search, or graph item         | Codepol hover                      |
| editor token with explicit Codepol identity | Codepol hover allowed              |
| ambiguous token                             | no Codepol hover                   |
| relation edge or `relation_anchor`          | no hover; use details or graph UI  |

## Acceptance Criteria

Codepol `hover` is acceptable in MVP only if:

- it never duplicates standard type or doc hover for ordinary symbols
- it appears only for the supported Codepol-owned semantic classes
- it stays compact
- it points users toward richer Codepol surfaces when needed
- it can fall back to a minimal card for explicit marker-backed identity without blocking on cold data
- disabling Codepol `hover` does not break normal editor hover behavior

## Non-Goals For MVP

Codepol `hover` does not do the following in MVP:

- replace standard language hover for functions, classes, variables, methods, imports, types, or inferred types
- provide docstring, type, or signature help for ordinary language symbols
- appear as a generic fallback when the standard language server returns nothing
- merge ordinary language-server hover and Codepol hover into one composite card
- infer editor-text hover eligibility from warmed index hits alone without an explicit extension-owned marker
- compress `relation_anchor` evidence into a noisy hover instead of using richer details or graph views
