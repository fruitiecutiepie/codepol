---
layout: home

hero:
  name: Codepol
  text: Policy-driven code enforcement and architecture analysis
  tagline: Enforce coding standards and architectural constraints from one declarative policy file — in CI and in your editor
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started
    - theme: alt
      text: Rule Catalog
      link: /rules/
    - theme: alt
      text: View on GitHub
      link: https://github.com/fruitiecutiepie/codepol

features:
  - title: Declarative policies
    details: Define coding standards as readable TOML your whole team can review. Style, module hygiene, and architecture in one place.
    link: /policy-schema
  - title: Architecture enforcement
    details: Circular imports, layering violations, fan-in/fan-out budgets, dead modules. Gate on regressions with baseline diffing instead of demanding a clean slate.
    link: /architecture-analysis
  - title: Semantic index
    details: Tree-sitter parsing into symbols, scopes, imports, call graphs, and control flow — the substrate for cross-file rules.
    link: /semantic-index
  - title: Editor integration
    details: Diagnostics, fix-on-save, cross-file rename with preview, dependency-graph panels, and architecture peek — backed by a shared daemon.
    link: /editor-integration
  - title: Works with your tools
    details: Adapts Codepol rules into ESLint, and delegates to Biome, Ruff, and Vulture where they already do the job well.
    link: /adding-a-lint-provider
  - title: Runtime observability
    details: Scoped environment presets, time-bounded escalations, and strict redaction by default. Dial up the noise only when you need to.
    link: /getting-started#tuning-diagnostics
---
