# Codepol LSP Rename Model

This companion note expands the `Prepare rename and rename for Codepol-owned namespaces` section in `TODO_CODEPOL_LSP.md`.

Keep the main TODO focused on architecture, rollout, and decision summaries. Use this file for MVP rename eligibility, namespace rules, `prepare rename`, preview, collision handling, apply behavior, and failure semantics.

This note defines rename behavior and safety rules. MVP keeps rename-specific prepare, preview, and apply semantics as an outer contract, but the planned workspace edits themselves should stay centered on the shared `EditPlan` model with richer preview and execution metadata rather than a separate parallel plan type.

## When To Read This

Read this note when you are:

- implementing Codepol `prepare rename`, rename preview, or rename apply flows
- defining renameable semantic classes, namespaces, or naming policies
- deciding collision rules, stale-preview handling, or all-or-nothing apply behavior
- determining which semantic anchors are canonical rename targets versus excluded text matches
- wiring rename preview and apply into the later `WorkspaceEditPlan` integration work

## Decision

- Codepol rename exists in MVP, but only for closed-world Codepol-owned namespaces
- the only renameable semantic classes in MVP are:
  - `domain_entity`
  - `config_component`
- `architecture_node`, `generated_artifact`, `relation_anchor`, and ordinary language symbols are not renameable through Codepol in MVP
- Codepol rename is command- or panel-only for the whole MVP
- do not integrate the normal editor rename shortcut in MVP, even when a token already carries explicit Codepol identity
- `prepare rename` is required
- rename preview is required
- collision checks run on normalized name within namespace
- case-only rename is globally disallowed by default unless a namespace explicitly proves it is safe
- apply is snapshot-bound and all-or-nothing at the Codepol logical edit-plan level
- stale previews, incomplete reference sets, cross-owner edits, and ambiguous targets fail closed
- rename updates only canonical semantic anchors and verified semantic references, not arbitrary text matches
- MVP keeps rename-specific validation and preview as a separate outer contract, but rename still executes through the shared planned-edit model rather than a separate root plan type

## Why This Boundary Matters

- rename is one of the highest-trust editor operations, so partial or ambiguous behavior will immediately feel broken
- keeping MVP rename inside closed-world namespaces prevents Codepol from competing with `tsserver`, `Pylance`, or `Pyright` on ordinary symbols
- mandatory `prepare rename` plus preview creates an auditable trust boundary before any workspace edits are proposed

## Renameable Semantic Classes

### `domain_entity`

Rename is acceptable when the entity has:

- a stable canonical identity
- a canonical declaration
- a bounded set of semantic references
- a known naming policy

Examples:

- workflow name
- event or topic name in a project registry
- service identifier in a domain registry
- schema entity name when Codepol owns the registry surface

### `config_component`

Rename is acceptable when the component is declared and consumed through Codepol-indexed config or project metadata.

Examples:

- route id
- task or build target id
- plugin or component registration name
- feature flag key when Codepol owns all supported declaration and usage forms

### Not Renameable In MVP

- `architecture_node`
- `generated_artifact`
- `relation_anchor`
- ordinary language symbols

Why these stay out:

- `architecture_node` rename often implies file, folder, package, or module rewrites across multiple ownership domains
- `generated_artifact` should usually be renamed via the upstream source input, generator config, or owning domain object
- `relation_anchor` is not a stable rename namespace
- ordinary language symbol rename remains owned by existing language servers

## Hard Eligibility Rules

An entity is renameable only if all of the following are true:

1. its semantic class is `domain_entity` or `config_component`
2. Codepol can enumerate a closed-world set of affected declarations and semantic references within the supported workspace scope
3. the target resolves to one stable canonical identity
4. a naming validator and normalization policy exist for that namespace
5. no required edit falls into standard language-server ownership outside Codepol-owned anchors
6. no unresolved collision exists after normalization

If any condition fails:

- `prepare rename` fails
- no rename preview is produced

## Renameable Namespaces

Each renameable class must define an explicit namespace. Collision checks depend on that namespace boundary.

### `domain_entity` namespaces

Possible shapes:

- per project
- per domain or module
- per registry or type family

Examples:

- workflow names unique within `payments`
- event names unique project-wide
- service ids unique within one deployment scope

### `config_component` namespaces

Possible shapes:

- per config file family
- per registry
- per build-system scope
- per plugin family

This must be schema-driven or otherwise explicit. Rename cannot proceed if the namespace boundary is unknown.

## `prepare rename` Behavior

`prepare rename` is required. There is no direct rename without successful prepare.

At minimum:

```ts
type PrepareCodepolRenameRequest = {
  targetId: string;
  semanticClass: 'domain_entity' | 'config_component';
  workspaceId: string;
  clientSessionId?: string;
};
```

Cursor-based prepare is acceptable only for explicit Codepol rename commands on a known target. MVP does not hook the normal editor rename shortcut.

`prepare rename` must:

1. resolve target identity
2. confirm the target class is renameable
3. load namespace policy
4. validate that the target is not derived-only, read-only, or generated-only
5. enumerate impacted sites
6. compute the rename range for the canonical declaration when one exists
7. return the current normalized name plus rename metadata

Success shape:

```ts
type PrepareCodepolRenameSuccess = {
  ok: true;
  targetId: string;
  semanticClass: 'domain_entity' | 'config_component';
  displayName: string;
  currentName: string;
  normalizedCurrentName: string;
  namespaceId: string;
  declarationLocation?: Location;
  placeholderRange?: SourceRange;
  impactedSiteCount: number;
  requiresPreview: true;
  namingRules: {
    minLength?: number;
    maxLength?: number;
    patternDescription?: string;
    casePolicy?: 'preserve' | 'kebab' | 'snake' | 'camel' | 'pascal';
    reservedNames?: string[];
  };
};
```

Failure shape:

```ts
type PrepareCodepolRenameFailureCode =
  | 'not_codepol_owned'
  | 'not_renameable_class'
  | 'ambiguous_target'
  | 'read_only_target'
  | 'generated_only_target'
  | 'namespace_unknown'
  | 'reference_set_incomplete'
  | 'cross_owner_edits_required'
  | 'declaration_missing'
  | 'unsupported_context';

type PrepareCodepolRenameFailure = {
  ok: false;
  code: PrepareCodepolRenameFailureCode;
  message: string;
};
```

Failure meanings:

- `not_codepol_owned`: target belongs to standard language-server ownership or unknown ownership; defer to the default language server instead
- `not_renameable_class`: recognized Codepol entity, but not renameable in MVP
- `ambiguous_target`: cursor or anchor maps to multiple entities or no stable identity
- `read_only_target`: entity comes from a locked, generated, or external registry that Codepol must not rewrite
- `generated_only_target`: entity has no canonical upstream rename point
- `namespace_unknown`: Codepol cannot determine the collision domain
- `reference_set_incomplete`: Codepol cannot guarantee a closed-world affected set
- `cross_owner_edits_required`: rename would require normal language-symbol edits outside Codepol-owned anchors
- `declaration_missing`: no canonical declaration anchor exists where rename should attach
- `unsupported_context`: rename was invoked from an unsupported or stale surface

## Name Validation Semantics

All renameable classes must define:

- raw input acceptance rules
- normalized comparison rules
- display-name policy
- reserved words
- illegal characters
- empty or whitespace handling
- case-sensitivity policy

Validation stages:

1. syntactic validation
2. normalization
3. semantic validation

Suggested failure codes:

```ts
type RenameValidationFailureCode =
  | 'empty_name'
  | 'invalid_format'
  | 'reserved_name'
  | 'name_too_long'
  | 'name_too_short'
  | 'unchanged_after_normalization'
  | 'collision';
```

## Rename Preview Is Mandatory

Actual rename must always be preceded by a preview in MVP.

No silent direct apply.

This is the trust boundary for a rename that may span config, metadata, code-backed anchors, generated mappings, and registries.

## Preview Structure

Preview should be structured and grouped, not only a flat raw edit list.

```ts
type CodepolRenameEditKind =
  | 'declaration'
  | 'reference'
  | 'derived_metadata'
  | 'config_key'
  | 'display_label';

type CodepolRenameEdit = {
  uri: string;
  range: SourceRange;
  oldText: string;
  newText: string;
  kind: CodepolRenameEditKind;
  semanticClass: 'domain_entity' | 'config_component';
  targetId: string;
};

type CodepolRenamePreviewGroup = {
  group:
    | 'declarations'
    | 'references'
    | 'config'
    | 'metadata'
    | 'labels';
  edits: CodepolRenameEdit[];
};

type CodepolRenamePreview = {
  targetId: string;
  semanticClass: 'domain_entity' | 'config_component';
  oldName: string;
  newName: string;
  normalizedNewName: string;
  namespaceId: string;
  groups: CodepolRenamePreviewGroup[];
  totalEdits: number;
  warnings: CodepolRenameWarning[];
  blockingIssues: CodepolRenameBlockingIssue[];
  canApply: boolean;
};
```

Preview must show:

- target identity
- old and proposed new name
- namespace
- grouped edits
- total edit count
- warnings
- blocking issues
- whether apply is currently allowed

## Preview Warnings

Warnings do not block apply, but must be shown.

```ts
type CodepolRenameWarningCode =
  | 'display_label_not_canonical'
  | 'case_only_change'
  | 'generated_outputs_will_update_on_regen'
  | 'partial_nonsemantic_mentions_not_updated'
  | 'external_docs_not_updated'
  | 'large_edit_set';

type CodepolRenameWarning = {
  code: CodepolRenameWarningCode;
  message: string;
};
```

Warning meanings:

- `display_label_not_canonical`: some UI labels or comments remain unchanged because they are not canonical semantic anchors
- `case_only_change`: especially relevant for case-insensitive namespaces or filesystems
- `generated_outputs_will_update_on_regen`: Codepol edits the source of truth rather than all generated files directly
- `partial_nonsemantic_mentions_not_updated`: free text and comments are intentionally excluded
- `external_docs_not_updated`: docs outside the supported workspace are not rewritten
- `large_edit_set`: the rename touches many locations and the preview should emphasize scope

## Preview Blocking Issues

Blocking issues mean preview may still be shown, but `canApply` must be `false`.

```ts
type CodepolRenameBlockingIssueCode =
  | 'collision'
  | 'namespace_unresolved'
  | 'incomplete_reference_set'
  | 'cross_owner_edit_required'
  | 'stale_snapshot'
  | 'write_conflict'
  | 'read_only_path';

type CodepolRenameBlockingIssue = {
  code: CodepolRenameBlockingIssueCode;
  message: string;
};
```

Blocking issue meanings:

- `collision`: target name conflicts with another entity after normalization
- `namespace_unresolved`: Codepol cannot prove the namespace boundary
- `incomplete_reference_set`: analysis cannot guarantee a safe closed-world rename
- `cross_owner_edit_required`: required edits would cross into standard language-server ownership
- `stale_snapshot`: preview no longer matches the current workspace snapshot
- `write_conflict`: at least one target file changed or overlay diverged since preview generation
- `read_only_path`: a required edit path is not writable

## Collision Semantics

Collisions are checked on normalized name within namespace.

A collision exists when:

- another live entity in the same namespace resolves to the same normalized name
- the rename would create an alias conflict defined by entity-class policy

Rename logic must distinguish:

- hard collision
- self-noop
- case-only permitted rename

For MVP, the global default is:

- disallow case-only rename unless namespace policy explicitly proves all of the following are safe:
  - the namespace is case-sensitive
  - affected storage and editor semantics support case-only updates safely
  - all impacted targets can apply case-only changes without platform ambiguity
  - no normalization collision occurs
  - no filesystem or path-level ambiguity is introduced

## Apply Behavior

Rename apply must be snapshot-bound and all-or-nothing at the Codepol logical edit-plan level.

That means:

- preview is generated against a snapshot
- apply rechecks the same snapshot preconditions
- apply aborts if those preconditions fail
- no partial apply is attempted

At minimum:

```ts
type ApplyCodepolRenameRequest = {
  targetId: string;
  semanticClass: 'domain_entity' | 'config_component';
  oldName: string;
  newName: string;
  previewSnapshotId: string;
  workspaceId: string;
};
```

Apply must:

1. revalidate target identity
2. revalidate the proposed new name
3. recheck collisions
4. recheck snapshot and write preconditions
5. ensure no new blocking issue exists
6. produce the final workspace edit set
7. submit one logical all-or-nothing apply through the editor workspace edit path or fail

## Atomicity Semantics

For MVP:

- rename is atomic at the workspace-edit submission level
- if the workspace edit cannot be applied fully, treat the entire rename as a failure
- do not continue with a best-effort partial apply

If the host editor cannot guarantee a true atomic disk commit, Codepol still treats the operation as one logical transaction and one apply result.

## Apply Failure Semantics

```ts
type ApplyCodepolRenameFailureCode =
  | 'prepare_required'
  | 'preview_required'
  | 'stale_preview'
  | 'validation_failed'
  | 'collision'
  | 'reference_set_incomplete'
  | 'cross_owner_edit_required'
  | 'read_only_path'
  | 'apply_rejected'
  | 'workspace_changed'
  | 'internal_error';
```

Failure meanings:

- `prepare_required`: no successful prepare was done
- `preview_required`: apply was attempted without a valid preview
- `stale_preview`: preview snapshot no longer matches current workspace state
- `validation_failed`: the proposed new name fails current validation rules
- `collision`: a new or existing collision blocks apply
- `reference_set_incomplete`: Codepol can no longer guarantee a closed-world rename
- `cross_owner_edit_required`: a newly discovered dependency would require standard language-server-owned edits
- `read_only_path`: a required file is not writable
- `apply_rejected`: the editor or workspace rejected the edit set
- `workspace_changed`: one or more affected files changed since preview
- `internal_error`: unexpected failure; rename must not partially apply

## Preview Staleness

Preview is bound to:

- workspace instance
- entity identity
- old name
- snapshot or generation ids for affected files

If any affected file changes, overlay state diverges, or the target resolves differently:

- preview becomes stale
- apply must fail with `stale_preview` or `workspace_changed`

No silent rebase in MVP. The user must rerun preview.

## What Rename Updates

Included:

- canonical declaration keys or names
- verified semantic reference sites
- config keys or values that are semantically bound
- metadata entries with stable binding
- labels only when class policy marks them canonical

Excluded:

- comments
- arbitrary strings
- documentation prose
- unrelated text matches
- ordinary language symbols unless they are themselves Codepol-owned anchored fields

Rename is not search-and-replace.

## Preview Presentation

Preview should group edits by meaning, not only by file.

Recommended group order:

1. declarations
2. references
3. config
4. metadata
5. labels

Each group should show:

- file
- old to new text
- semantic reason or edit kind

This keeps rename auditable.

## Relation To `WorkspaceEditPlan`

MVP keeps rename-specific prepare, preview, and apply semantics as a separate outer contract, but not a separate parallel plan type.

Why:

- rename has stronger prepare, preview, collision, and staleness requirements than generic edit application
- forcing early convergence into generic edit machinery would muddy the MVP contract
- rename needs user-visible grouped preview semantics that are stronger than ordinary edit submission

Later direction:

- keep rename-specific validation and preview as the outer contract
- represent the validated rename as the shared `EditPlan` enriched with preview and execution metadata needed for rename semantics
- share the generic transaction and apply machinery underneath once that layer is stable

## Default LSP Versus Codepol Rename

Default language-server rename is used for:

- ordinary code symbols
- anything not Codepol-owned
- ambiguous targets

Codepol rename is used only when:

- the target resolves to `domain_entity` or `config_component`
- `prepare rename` succeeds
- rename preview succeeds
- no blocking issues remain

Hard routing rule:

- Codepol does not intercept generic rename on arbitrary editor tokens in MVP
- Codepol does not intercept the normal editor rename shortcut in MVP, even when a token already carries explicit Codepol identity

Preferred entry points:

- `Codepol: Rename entity`
- rename action from a Codepol tree or details panel
- CodeLens or decorations for explicitly identified Codepol entities

Normal editor rename shortcut integration is out of scope for MVP. Consider it only after the explicit Codepol rename contract and edit-plan convergence layer are both proven.

## Non-Goals For MVP

Codepol rename does not do the following in MVP:

- rename `architecture_node`, `generated_artifact`, or `relation_anchor`
- rename ordinary language symbols
- behave like generic search and replace
- hook the normal editor rename shortcut
- silently proceed without successful `prepare rename`
- silently apply without preview
- silently rebase stale previews onto newer workspace state
- partially apply required edits after a blocking failure
