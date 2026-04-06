# Codepol LSP Definition and References Model

This companion note expands the `Definition and references for Codepol-owned semantic classes` section in `TODO_CODEPOL_LSP.md`.

Keep the main TODO focused on architecture, rollout, and decision summaries. Use this file for the MVP routing policy, owned semantic classes, classifier behavior, result shapes, and UI presentation rules for `definition` and `references`.

## When To Read This

Read this note when you are:

- implementing Codepol `definition` or `references` services or adapters
- defining Codepol semantic-class enums, classifier outputs, or provenance labels
- deciding whether navigation belongs in default LSP handlers or explicit Codepol commands or views
- modeling grouped or graph-shaped reference results instead of flat `Location[]` lists

## Decision

- default LSP handlers remain authoritative for ordinary language symbols
- Codepol participates only for Codepol-owned semantic classes:
  - `domain_entity`
  - `architecture_node`
  - `config_component`
  - `generated_artifact`
  - `relation_anchor`
- prefer explicit Codepol commands and Codepol-owned views over intercepting global `F12` / `Shift+F12`
- do not ship direct LSP `textDocument/definition` or `textDocument/references` handlers from editor text in MVP
- from editor text, Codepol navigation is available only through explicit Codepol commands; default editor and language-server handlers remain the only standard `F12` / `Shift+F12` path
- ambiguous or unknown targets defer entirely to the default language server
- Codepol `definition` returns the canonical origin for the semantic object, not necessarily the nearest textual declaration
- Codepol `references` returns semantic/project references, not raw lexical matches
- the cheap classifier may consult the warmed Codepol index only through strictly local, latency-bounded in-memory reads
- `details_view` and `graph_focus` are surfaced through `workspace/executeCommand` plus extension-owned `codepol/*` RPC and views, not as direct LSP result payloads from editor text
- semantic references use deterministic ordering, fixed group priority, and explicit truncation policy in MVP
- do not merge normal LSP symbol results with Codepol semantic results in MVP

For MVP, the boundary is:

- normal code symbol -> default LSP
- Codepol semantic object from editor text -> explicit Codepol command or view only
- Codepol semantic object from a Codepol-owned surface -> Codepol navigation is allowed
- ambiguous case -> default LSP only

## Why This Boundary Matters

- it keeps Codepol aligned with `tsserver`, `Pylance`, and `Pyright` rather than competing with them on ordinary code navigation
- project, config, generated, and relation-backed navigation often have richer semantics than plain LSP `Location[]` results
- without a conservative routing rule, implementation will drift into duplicate jumps, noisy generated-file targets, and mixed-provenance result sets that are hard to explain

## Shared Ownership Rules

### `definition`

Codepol may answer `definition` only when the current target is confidently classified as one of the Codepol-owned semantic classes.

Otherwise:

- do not invoke Codepol `definition`
- defer entirely to the default language server

For MVP, `definition` means the canonical origin for the semantic object:

- source declaration when that is genuinely authoritative
- source-of-generation when the visible artifact is generated
- canonical config, schema, or registration anchor when the object is config-backed
- a Codepol details view or graph focus when there is no honest single file location

### `references`

Codepol may answer `references` only for Codepol-owned semantic classes.

Otherwise:

- do not invoke Codepol `references`
- defer entirely to the default language server

For MVP, `references` means semantic or project references:

- registrations
- consumers
- graph edges
- config links
- generated mappings
- relation evidence

It does not mean:

- raw text search
- unverified string matches
- unlabeled mixtures of ordinary symbol references and Codepol semantic references

## Codepol-Owned Semantic Classes

These classes should be first-class internal enum values, not ad hoc strings scattered through adapters.

```ts
type CodepolOwnedSemanticClass =
  | 'domain_entity'
  | 'architecture_node'
  | 'config_component'
  | 'generated_artifact'
  | 'relation_anchor';
```

### `domain_entity`

A business or domain concept that Codepol models explicitly, possibly declared in code, config, schema, or metadata.

Examples:

- service name in a registry
- workflow or state-machine node
- model or entity name derived from config or schema
- message, topic, or contract object with project-level meaning

Definition intent:

- open the canonical declaration or primary source of truth for the entity

References intent:

- show usages, bindings, mappings, handlers, and semantically verified mentions of that entity

### `architecture_node`

A component in a project or system graph.

Examples:

- module boundary
- package or subsystem node
- service boundary
- data pipeline stage
- dependency graph node

Definition intent:

- open the node declaration or owning module, config, or source anchor

References intent:

- show all incoming and outgoing graph edges and evidence sites

### `config_component`

A thing declared primarily in config or project metadata.

Examples:

- route declaration
- DI or container registration
- build target
- task definition
- feature flag declaration
- plugin registration

Definition intent:

- open the canonical config declaration or registration site

References intent:

- show consumers, dependents, and semantically linked config or code sites

### `generated_artifact`

A symbol or file relation produced by generation.

Examples:

- generated client or server bindings
- schema-generated types
- migration-linked models
- compiled artifacts mapped back to source generator inputs

Definition intent:

- go upstream to the source-of-generation rather than the generated output by default

References intent:

- show upstream mappings, generated outputs, and downstream consumers

### `relation_anchor`

A non-symbol anchor representing a semantic relationship rather than a normal code symbol.

Examples:

- module A depends on module B
- service X publishes topic Y
- workflow step references handler Z
- entity maps to table T

Definition intent:

- open the most canonical origin or evidence anchor for the relation, or a relation details view when there is no honest single location

References intent:

- show evidence sites, endpoints, and related relation participants

This class matters because many Codepol navigation cases are about relationships, not normal language-symbol ownership.

## Exact Behavior By Semantic Class

### `domain_entity`

Definition behavior:

1. open an explicit schema, config, or domain declaration when present
2. otherwise open the authoritative declaration in code
3. otherwise open the source-of-generation if the entity is derived
4. otherwise open an entity details view if there is no single authoritative location

References behavior:

- include registrations, consumers, mappings, handler bindings, route or topic usages, workflow usages, and semantically meaningful generation links
- exclude plain string matches, fuzzy mentions, and unverified lexical matches

Preferred UI routing:

- `Codepol: Go to semantic definition`
- `Codepol: Find semantic references`
- entity details view with definition, references, and related-entity tabs

### `architecture_node`

Definition behavior:

- open the node's owning manifest, boundary declaration, package metadata, architecture mapping file, or representative source root
- if no single file is genuinely authoritative, open a Codepol node details view instead of pretending there is one precise source location

References behavior:

- show dependency edges, cross-boundary imports, registrations, consumers, integration points, and policy-violation evidence involving the node
- support incoming and outgoing views even if the MVP default presentation is a combined grouped result

Preferred UI routing:

- `Codepol: Show architecture links`
- node details view
- graph panel with clickable edges

Do not treat architecture-node references as a plain unstructured symbol list if the result is fundamentally graph-shaped.

### `config_component`

Definition behavior:

- open the canonical config declaration or registration point
- if there are multiple layered declarations, open the primary declaration and expose alternates in a quick pick or Codepol panel

References behavior:

- show consumers, dependent config and code sites, and derived or generated links when they are semantically relevant

Preferred UI routing:

- direct Codepol definition command
- Codepol references panel
- details view when the component carries richer metadata

### `generated_artifact`

Definition behavior:

1. prefer the source schema, spec, config, or other input
2. otherwise open the generator declaration
3. otherwise open a generation mapping record
4. only use the generated file as the default fallback or an alternate target

References behavior:

- show consumers of the generated artifact
- show source-to-generated mapping sites
- show downstream usages
- optionally expose upstream generation chain context when the presentation supports it

Preferred UI routing:

- explicit Codepol command
- generated-artifact details view
- grouped or graph-oriented results when the chain is multi-hop

### `relation_anchor`

Definition behavior:

- open the most canonical origin or evidence anchor for the relation
- if the relation has no honest single definition site, open a relation details view instead

References behavior:

- show supporting evidence sites
- show endpoint declarations
- show derived or transitive evidence only when it is clearly labeled as such

Preferred UI routing:

- relation details view
- graph panel
- grouped evidence panel

Avoid binding relation-anchor results to ordinary `Shift+F12` behavior in MVP.

## Routing Policy

| Current target                                                                                | Default editor action | Codepol MVP behavior                                          |
| --------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------- |
| ordinary code symbol                                                                          | `F12` / `Shift+F12`   | default LSP only                                              |
| clearly recognized Codepol entity in editor text                                              | `F12` / `Shift+F12`   | default LSP unchanged; Codepol available via explicit command |
| Codepol item selected in a Codepol tree, view, or panel                                      | open or reveal        | Codepol definition or details view                            |
| Codepol item selected in a Codepol references panel                                           | click item            | Codepol navigation                                            |
| ambiguous token                                                                               | `F12` / `Shift+F12`   | default LSP only                                              |
| generated, config, or relation anchor reached through Codepol decoration, CodeLens, or view | Codepol command       | Codepol definition or references                              |

Hard MVP rule:

- do not hijack normal `F12` or `Shift+F12` globally
- keep default editor semantics predictable
- treat explicit Codepol commands and Codepol-owned views as the primary entry points
- do not register direct `textDocument/definition` or `textDocument/references` handlers from editor text in MVP

## Cheap Local Classifier

If Codepol is ever invoked from editor text selection, it must first run a cheap local classifier to decide whether the target is Codepol-owned.

Possible inputs:

- local AST or token context
- Codepol decoration, CodeLens, or inline-marker context
- already-materialized per-document facts
- warmed in-memory index lookups
- cached entity-id mappings
- surrounding config or schema context
- URI or file type
- nearby recognized registration or generation constructs

Not allowed on the classifier hot path:

- triggering fresh indexing
- blocking on graph rebuild or background analysis
- multi-hop graph expansion
- disk or network work

Latency contract:

- classifier reads must stay hot in-memory only
- perform one bounded lookup attempt per invocation
- if the needed facts are missing or the latency budget is exceeded, return `unknown` or `ambiguous`

Suggested internal shape:

```ts
type CodepolTargetClassification =
  | { kind: 'ordinary_language_symbol' }
  | { kind: 'codepol_owned'; semanticClass: CodepolOwnedSemanticClass }
  | { kind: 'ambiguous' }
  | { kind: 'unknown' };
```

Routing:

- `ordinary_language_symbol` -> default LSP
- `ambiguous` -> default LSP
- `unknown` -> default LSP
- `codepol_owned` -> enable Codepol commands and Codepol-owned results

This conservative classifier is the guardrail that prevents overlap with ordinary language-server navigation. In MVP it is used only to enable explicit Codepol commands or Codepol-owned surfaces, not to hijack standard editor navigation.

## Result Shapes

Do not force every Codepol navigation answer into bare LSP `Location[]`.

### Definition result

```ts
type CodepolDefinitionResult =
  | { kind: 'single_location'; location: Location }
  | {
      kind: 'multi_location';
      locations: Location[];
      primaryIndex: number;
    }
  | { kind: 'details_view'; entityId: string }
  | { kind: 'graph_focus'; nodeId: string };
```

This allows `definition` to mean canonical origin rather than only textual declaration.

In MVP, `single_location` and `multi_location` are the only LSP-shaped outcomes. `details_view` and `graph_focus` remain service-level result kinds that are routed through extension commands and Codepol-owned views rather than direct LSP `textDocument/definition` replies from editor text.

### References result

```ts
type CodepolReferenceGroup =
  | 'declarations'
  | 'consumers'
  | 'incoming'
  | 'outgoing'
  | 'generated'
  | 'upstream'
  | 'downstream'
  | 'evidence'
  | 'policy';

type CodepolReferenceItem = {
  location: Location;
  label: string;
  stableId?: string;
  semanticClass: CodepolOwnedSemanticClass;
  relationKind?: string;
};

type CodepolReferenceResultGroup = {
  group: CodepolReferenceGroup;
  totalCount: number;
  truncated: boolean;
  items: CodepolReferenceItem[];
};

type CodepolReferencesResult = {
  presentation: 'list' | 'grouped_list' | 'graph';
  totalItems: number;
  totalAvailableItems: number;
  truncated: boolean;
  groups: CodepolReferenceResultGroup[];
};
```

This better matches Codepol semantics for config, generated, architecture, and relation-backed navigation.

## References Ordering, Grouping, And Caps

Semantic references must be deterministic.

Default group priority:

1. `declarations`
2. `consumers`
3. `incoming`
4. `outgoing`
5. `upstream`
6. `downstream`
7. `generated`
8. `evidence`
9. `policy`

Within a group, sort by:

1. canonical file priority
2. source location
3. stable label or `stableId` as a tie-breaker

Suggested file priority:

- canonical declaration files first
- then workspace source files
- then config files
- then generated files
- then derived or evidence-only anchors

Within one file:

- by path
- then line
- then column

Default MVP cap policy:

- hard cap of 200 total items per query
- soft cap of 50 items per group
- always return group counts even when truncated
- truncated results should offer `show more` or `open graph/details view`

Without fixed ordering and caps, large semantic reference sets will flicker between runs and become hard to trust.

## Transport And Surfacing

Use standard LSP result shapes only for LSP-shaped outcomes.

For MVP:

- editor text -> explicit Codepol command only
- command trigger -> `workspace/executeCommand`
- extension command -> existing `codepol/*` RPC
- extension-owned UI opens details or graph views when the result is `details_view` or `graph_focus`

Do not tunnel details or graph UI through fake LSP result payloads.

## Editor UX

Recommended MVP commands:

- `Codepol: Go to semantic definition`
- `Codepol: Find semantic references`
- `Codepol: Show related entities`
- `Codepol: Show architecture links`
- `Codepol: Open semantic details`

Recommended MVP views:

- entity details
- semantic references
- architecture links
- graph panel

Use dedicated Codepol panels or views whenever the result is fundamentally relation- or graph-shaped. Do not flatten that structure into an unlabeled ordinary references list.

## Non-Goals For MVP

Codepol `definition` and `references` do not do the following in MVP:

- replace `tsserver`, `Pylance`, or `Pyright` for ordinary symbols
- merge standard symbol references with Codepol semantic references
- hijack default `F12` or `Shift+F12` globally
- register direct `textDocument/definition` or `textDocument/references` handlers from editor text
- provide fuzzy text search disguised as semantic references
- return unverified string matches
- expose unlabeled mixed-provenance result lists
