# Codepol LSP Capability Ownership Matrix

This companion note expands the `Capability ownership matrix by language` section in `TODO_CODEPOL_LSP.md`.

Keep the main TODO focused on architecture, rollout, and decision summaries. Use this file for the language-by-language capability matrix, scope boundaries, and implementation guardrails around coexistence with existing language servers.

## When To Read This

Read this note when you are:

- deciding whether a new LSP capability belongs in phase 1
- implementing `definition`, `references`, `hover`, `rename`, or `workspace/symbol`
- deciding whether Codepol should publish results in the default editor flow or behind explicit commands
- labeling Codepol-specific results and avoiding duplicate or competing language-server behavior

## Decision

- for TypeScript/JavaScript and Python, Codepol does not replace `tsserver`, `Pylance`, or `Pyright` in phase 1
- existing language servers remain the source of truth for core language intelligence and standard language-semantic features
- Codepol may only act as a supplemental provider for Codepol-owned semantic classes:
  - project or domain entities
  - architecture or policy objects
  - generated artifacts
  - config-derived navigation and symbols
- define ownership by semantic class, not only by feature name
- when coexistence is ambiguous, prefer explicit Codepol commands, views, or clearly labeled alternate results over competing default handlers

## Why It Matters

- without an explicit matrix, implementation will drift into duplicate UI entries, inconsistent jump targets, conflicting rename scopes, and user confusion about which result is authoritative
- an underspecified phase-1 boundary creates pressure to "just implement the missing 20%" until Codepol accidentally becomes a second language server

## Phase 1 Ownership Matrix

### TypeScript / JavaScript

| Feature                                                   | Existing language server    | Codepol role          |
| --------------------------------------------------------- | --------------------------- | --------------------- |
| diagnostics (language, type, import, module correctness)  | `tsserver` / TypeScript LS  | not implemented yet   |
| diagnostics (policy, architecture, domain, config)        | not implemented             | source of truth       |
| definition (standard code symbols)                        | `tsserver`                  | not implemented yet   |
| definition (domain, graph, generated, config-backed)      | partial or none             | supplemental provider |
| references (standard code symbols)                        | `tsserver`                  | not implemented yet   |
| references (project, domain, graph, generated relations)  | partial or none             | supplemental provider |
| hover (standard code symbols)                             | `tsserver`                  | not implemented yet   |
| hover (Codepol-owned semantic summary)                    | partial or none             | supplemental provider |
| rename (standard code symbols)                            | `tsserver`                  | not implemented yet   |
| rename (Codepol-owned entity namespaces)                  | partial or none             | supplemental provider |
| workspace symbols (standard code symbols)                 | `tsserver` / editor default | not implemented yet   |
| workspace symbols (domain, project, architecture symbols) | partial or none             | supplemental provider |

### Python

| Feature                                                   | Existing language server                 | Codepol role          |
| --------------------------------------------------------- | ---------------------------------------- | --------------------- |
| diagnostics (language, type, import, module correctness)  | `Pylance` / `Pyright`                    | not implemented yet   |
| diagnostics (policy, architecture, domain, config)        | not implemented                          | source of truth       |
| definition (standard code symbols)                        | `Pylance` / `Pyright`                    | not implemented yet   |
| definition (domain, graph, generated, config-backed)      | partial or none                          | supplemental provider |
| references (standard code symbols)                        | `Pylance` / `Pyright`                    | not implemented yet   |
| references (project, domain, graph, generated relations)  | partial or none                          | supplemental provider |
| hover (standard code symbols)                             | `Pylance` / `Pyright`                    | not implemented yet   |
| hover (Codepol-owned semantic summary)                    | partial or none                          | supplemental provider |
| rename (standard code symbols)                            | `Pylance` / `Pyright`                    | not implemented yet   |
| rename (Codepol-owned entity namespaces)                  | partial or none                          | supplemental provider |
| workspace symbols (standard code symbols)                 | `Pylance` / `Pyright` or editor default  | not implemented yet   |
| workspace symbols (domain, project, architecture symbols) | partial or none                          | supplemental provider |

## Implementation Guardrails

- do not implement competing phase-1 handlers for standard hover, standard rename, or standard language correctness diagnostics
- definition and references may only return Codepol-owned semantics; they must not compete on normal function, class, module, import, type, or member navigation
- hover may only return compact Codepol-owned summary payloads for explicitly identified targets; there is no fallback or merged hover in the ordinary editor flow
- rename may only operate on `domain_entity` and `config_component` namespaces with successful prepare, mandatory preview, closed-world reference coverage, and no cross-owner edits
- workspace symbols are the safest shared surface in phase 1; Codepol contributions must be visibly labeled as Codepol-specific results
- if definition or references are ambiguous in the default editor flow, expose them through explicit commands such as `Go to Codepol relation` or `Find Codepol relations`
- if rename is ambiguous or would spill into ordinary language-symbol ownership, fail closed and defer to explicit Codepol commands rather than intercepting generic editor rename
- every Codepol result must carry provenance and semantic-class metadata so adapters can label and filter it consistently
