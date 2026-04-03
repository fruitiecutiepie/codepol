# API Reference

Programmatic API for integrating codepol into your tools and scripts.

## @codepol/core

The core package provides policy loading, checking, and formatting utilities.

### Installation

```bash
pnpm add @codepol/core
```

### Types

```typescript
import type {
  // Config types
  CodepolConfig,
  CodepolConfigOptions,
  ConfigFileResult,
  // Policy types
  PolicyFile,
  PolicyRule,
  PolicyRuleTarget,
  PolicyTargetMap,
  PolicyRuleTargetContext,
  LoggerConfig,
  LoggerImportConfig,
  LintSeverity,
  PolicyViolation,
  PolicyViolationFix,
  TreeCheckProvider,
  PolicyPluginCapabilities,
  PluginRuleConfig,
  CodepolPluginRule,
  PluginRule,
  PolicyPluginDeclaration,
  PolicyCheckContext,
  LintProvider,
  LintProviderContext,
  EslintProviderConfig,
  FixProvider,
  FixProviderContext,
  RuleMatch,
  PolicyCheckOptions,
  PolicyCheckResult,
  // Adapter types
  LintDiagnostic,
  TreeCheckAdapterOptions,
  TreeCheckLintAdapter,
  // Result
  Result,
  // Parser / Language
  Lang,
  // Plugin loading
  PolicyPluginsMap,
  // Semantic Index types
  SymbolId,
  ScopeId,
  SymbolKind,
  ScopeKind,
  ByteRange,
  SymbolRecord,
  ScopeRecord,
  RelationRecord,
  DefinesRelation,
  ContainsRelation,
  ReferencesRelation,
  ImportsRelation,
  CallsRelation,
  ImportBindingRelation,
  ExportsRelation,
  TypeRelation,
  SymbolFilter,
  IndexCapabilities,
  FlowNodeId,
  FlowNode,
  FlowEdge,
  FlowGraph,
  FlowNodeKind,
  // Module resolution
  ModuleResolveOptions,
  // Index query
  ProjectIndex,
  // Module graph
  ModuleGraph,
  // Index builder
  IndexBuildOptions,
  IndexBuildResult,
  // Index store
  FileIndexDelta,
} from '@codepol/core';
```

Policy rules split semantics (meaning) from language targets. `PolicyRule` defines the rule metadata and plugin reference (`ruleId`), while `PolicyRuleTarget` declares the language adapter or parser plus its file globs.
Rules reference targets by name via `rule.targets` (an array of strings), pointing to entries in the top-level `PolicyFile.targets` map.
This lets a single rule apply across multiple targets without duplicating configuration.

---

## Config Loading

Codepol uses a unified config file that is auto-discovered from your project root.

### defineConfig

Type-safe helper for building codepol config objects programmatically (e.g. in tests or advanced hosts). Runtime config is loaded from `codepol.toml`; this helper does **not** replace it.

```typescript
import { defineConfig } from '@codepol/core';

const config = defineConfig({
  eslintConfigPath: './eslint.config.ts',
  plugins: [
    { id: '@codepol/plugin', source: { kind: 'builtin' } },
  ],
  targets: { /* ... */ },
  rules: [ /* ... */ ],
});
```

---

### configGet

Discovers and loads the codepol config file by walking up from the current directory.

```typescript
async function configGet(cwd?: string): Promise<ConfigFileResult>
```

**Parameters:**

- `cwd`: Working directory to start search from (default: `process.cwd()`)

**Returns:** Object with `config` (CodepolConfig) and `configPath` (string)

**Throws:** If no config file is found

**Example:**

```typescript
import { configGet } from '@codepol/core';

const { config, configPath } = await configGet();
console.log(`Loaded config from: ${configPath}`);
console.log(`Rules: ${config.rules.length}`);
```

**Config file discovery order:**

1. `codepol.toml`

---

### configGetFromPath

Loads a config file from a specific path. Use this when you have an explicit path (e.g., from `--config` flag).

```typescript
async function configGetFromPath(configPath: string): Promise<ConfigFileResult>
```

**Parameters:**

- `configPath`: Path to the config file (absolute or relative)

**Returns:** Object with `config` (CodepolConfig) and `configPath` (string)

**Example:**

```typescript
import { configGetFromPath } from '@codepol/core';

const { config } = await configGetFromPath('./config/codepol.toml');
```

---

### configFileDiscover

Synchronously walks up from the starting directory to find a config file.

```typescript
function configFileDiscover(startDir: string): string | null
```

**Parameters:**

- `startDir`: Directory to start searching from

**Returns:** Absolute path to the config file, or `null` if not found

---

### configGetSync

Synchronous version of `configGet`. Used by the ESLint adapter, which requires sync execution.

```typescript
function configGetSync(cwd?: string): ConfigFileResult
```

**Parameters:**

- `cwd`: Working directory to start search from (default: `process.cwd()`)

**Returns:** Object with `config` (CodepolConfig) and `configPath` (string)

**Throws:** If no config file is found

**Example:**

```typescript
import { configGetSync } from '@codepol/core';

const { config, configPath } = configGetSync();
```

---

### configGetFromPathSync

Synchronous version of `configGetFromPath`. Used by the ESLint adapter, which requires sync execution.

```typescript
function configGetFromPathSync(configPath: string): ConfigFileResult
```

**Parameters:**

- `configPath`: Path to the config file (absolute or relative)

**Returns:** Object with `config` (CodepolConfig) and `configPath` (string)

**Throws:** If the config file does not exist

**Example:**

```typescript
import { configGetFromPathSync } from '@codepol/core';

const { config } = configGetFromPathSync('./config/codepol.toml');
```

---

### configCacheClear

Clears the in-memory config cache. Useful for testing or when config files change at runtime.

```typescript
function configCacheClear(): void
```

**Example:**

```typescript
import { configCacheClear } from '@codepol/core';

configCacheClear();
```

---

### CodepolConfig

Full codepol configuration type combining policy definition and runtime options.

```typescript
type CodepolConfig = PolicyFile & CodepolConfigOptions;

type CodepolConfigOptions = {
  /** Path to ESLint config (auto-detected if not specified) */
  eslintConfigPath?: string;
};
```

---

### policyFileGet (deprecated)

Loads and parses a JSON config file. **Deprecated:** Use `configGet()` or `configGetFromPath()` instead, which support TOML config files (`codepol.toml`).

```typescript
function policyFileGet(policyPath: string): PolicyFile
```

**Parameters:**

- `policyPath`: Path to the JSON config file (absolute or relative)

**Returns:** Parsed PolicyFile object

**Example:**

```typescript
// Prefer configGet() for new code:
import { configGet } from '@codepol/core';
const { config } = await configGet();

// Legacy JSON support:
import { policyFileGet } from '@codepol/core';
const policy = policyFileGet('./legacy-config.json');
```

---

### providerRulesConfigGet

Generates lint provider rules config from the codepol config. Users spread this into their lint config (e.g., eslint.config.js).

```typescript
async function providerRulesConfigGet(
  provider: 'eslint',
  configPath?: string
): Promise<Record<string, unknown>>
```

**Parameters:**

- `provider`: The lint provider platform (`'eslint'`)
- `configPath`: Path to config file (auto-discovered if not specified)

**Returns:** Rules config object for the lint provider

**Example:**

```javascript
// eslint.config.js
import { eslintPluginCreate } from '@codepol/plugin-eslint';
import {
  pluginBuiltinRegister,
  policyPluginRulesGet,
  providerRulesConfigGet,
} from '@codepol/core';
import codepolBuiltin from '@codepol/plugin';

pluginBuiltinRegister('@codepol/plugin', codepolBuiltin);

const codepol = eslintPluginCreate(await policyPluginRulesGet());

export default [{
  plugins: { codepol },
  rules: {
    ...await providerRulesConfigGet('eslint'),
    'no-console': 'warn',
  },
}];
```

Severity is read from the config per rule (default: `'error'`):

```toml
[[rules]]
ruleId = "@codepol/plugin/require-logger-enter-exit"
severity = "warn"
targets = ["typescript"]
```

#### Filtering by Provider

Use `providers` to control which providers a rule applies to:

```toml
[[rules]]
ruleId = "@codepol/plugin/require-logger-enter-exit"
providers = ["tree-sitter"]
targets = ["typescript"]
```

If `providers` is omitted or empty, the rule applies to all providers. This is useful when you want a rule to only run during `codepol check` (tree-sitter) but not in ESLint, or vice versa.

#### Manual ESLint Configuration

`providerRulesConfigGet` is a convenience helper, not a requirement. You can manually configure codepol rules in your ESLint config:

```javascript
// eslint.config.js
import codepol from '@codepol/plugin-eslint';

export default [{
  plugins: { codepol },
  rules: {
    'codepol/require-logger-enter-exit': ['error', { /* options */ }],
    'my-plugin/custom-rule': 'warn',
  },
}];
```

This works when running **ESLint directly** (`eslint .`).

::: warning codepol check CLI Override
When using `codepol check`, the CLI generates rules from your config and passes them via ESLint's `overrideConfig`, which has **highest precedence**. This means rules defined in `codepol.toml` will use severity from the config, overriding your eslint.config.js settings for those same rules.

If you want full control over ESLint configuration, run ESLint directly instead of using `codepol check`.
:::

---

## Parser and Language Registration

Tree-sitter WASM parsers must be initialized before any policy checking or index building.

### parserInit

Initializes the web-tree-sitter WASM runtime and loads registered language grammars. Must be called before any scanning or indexing operations. Safe to call multiple times (subsequent calls load newly registered languages only).

```typescript
async function parserInit(): Promise<void>
```

**Example:**

```typescript
import { parserInit, langAdd } from '@codepol/core';

langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
langAdd({ langId: 'tsx', fileExtensions: ['.tsx'] });
await parserInit();
```

---

### parserGetForFile

Creates a Tree-sitter parser configured for the given file's language.

```typescript
function parserGetForFile(filePath: string): Result<Parser, string>
```

**Parameters:**

- `filePath`: Absolute path to the file

**Returns:** `Ok(Parser)` on success, `Err(string)` if the parser is not initialized or no language is registered for the file extension

**Example:**

```typescript
import { parserGetForFile, isOk } from '@codepol/core';

const result = parserGetForFile('/path/to/file.ts');
if (isOk(result)) {
  const tree = result.Ok.parse(sourceCode);
}
```

---

### Lang

Language registration configuration.

```typescript
type Lang = {
  langId: string;
  /** Path to WASM file. If omitted, uses bundled wasm/tree-sitter-{langId}.wasm */
  wasmPath?: string;
  fileExtensions: string[];
};
```

---

### langAdd

Registers a language with its WASM grammar and file extensions. Merges extensions if the language is already registered. Must be called before `parserInit()`.

```typescript
function langAdd(lang: Lang): void
```

**Parameters:**

- `lang`: Language registration config

**Throws:** If `langId` is empty, no extensions are provided, an extension is already registered to a different language, or the language is re-registered with a different `wasmPath`

**Example:**

```typescript
import { langAdd } from '@codepol/core';

langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
langAdd({ langId: 'tsx', fileExtensions: ['.tsx'] });

// Custom WASM path
langAdd({
  langId: 'python',
  wasmPath: '/path/to/tree-sitter-python.wasm',
  fileExtensions: ['.py'],
});
```

---

### langsGet

Returns all registered languages.

```typescript
function langsGet(): Required<Lang>[]
```

**Returns:** Array of language registrations with all fields populated (including resolved `wasmPath`)

---

### wasmPathGet

Resolves the absolute path to a bundled WASM grammar file.

```typescript
function wasmPathGet(grammarName: string): string
```

**Parameters:**

- `grammarName`: Grammar name (e.g., `'tree-sitter-typescript'`)

**Returns:** Absolute path to the WASM file

---

### langIdGetForFile

Returns the registered language ID for a file based on its extension.

```typescript
function langIdGetForFile(filePath: string): string | null
```

**Parameters:**

- `filePath`: File path (can be relative or absolute)

**Returns:** Language ID (e.g., `'typescript'`) or `null` if the extension is not registered

---

### policyRuleTargetsResolve

Resolves the targets for a policy rule by looking up each target name in the policy's named targets map.

```typescript
function policyRuleTargetsResolve(
  rule: PolicyRule,
  policy: PolicyFile
): PolicyRuleTarget[]
```

**Parameters:**

- `rule`: The policy rule to resolve targets for
- `policy`: The policy file containing named targets

**Returns:** Array of resolved PolicyRuleTarget objects

**Throws:** If any target name in `rule.targets` doesn't exist in `policy.targets`

**Example:**

```typescript
import { configGet, policyRuleTargetsResolve } from '@codepol/core';

const { config } = await configGet();

for (const rule of config.rules) {
  const targets = policyRuleTargetsResolve(rule, config);
  console.log(`Rule ${rule.id} has ${targets.length} target(s)`);
  for (const target of targets) {
    console.log(`  - ${target.language}: ${target.files.join(', ')}`);
  }
}
```

---

### API naming note

`@codepol/core` exports `policyFileGet`-style names (`policyFileGet`, `ruleMatchesGet`,
`policyViolationsGetFromDir`, etc.). If you rely on `loadPolicy`-style names in existing code, update your imports
to the canonical API names listed below.

---

### ruleMatchesGet

Collects all files matching each policy rule.

```typescript
function ruleMatchesGet(
  policy: PolicyFile,
  cwd: string
): Promise<RuleMatch[]>
```

**Parameters:**

- `policy`: The loaded policy object
- `cwd`: Working directory for resolving glob patterns

**Returns:** Array of RuleMatch objects

**Example:**

```typescript
import { configGet, ruleMatchesGet } from '@codepol/core';

const { config } = await configGet();
const matches = await ruleMatchesGet(config, process.cwd());

for (const match of matches) {
  console.log(`Rule: ${match.rule.id}`);
  console.log(`Target language: ${match.target.language}`);
  console.log(`Files: ${match.files.length}`);
}
```

---

### policyFileGetChecked

Determines if a file should be checked against the policy.

```typescript
function policyFileGetChecked(
  policy: PolicyFile,
  filePath: string,
  cwd: string
): boolean
```

**Parameters:**

- `policy`: The loaded policy object
- `filePath`: Absolute path to the file
- `cwd`: Working directory for resolving glob patterns

**Returns:** `true` if the file should be checked

**Example:**

```typescript
import { configGet, policyFileGetChecked } from '@codepol/core';

const { config } = await configGet();
const covered = policyFileGetChecked(
  config,
  '/path/to/file.ts',
  process.cwd()
);
```

---

### globPatternsGetMatchAny

Checks if any glob pattern in the list matches the given file path. Used internally by policy matching and available for custom tooling.

```typescript
function globPatternsGetMatchAny(
  patterns: string[] | undefined,
  relativeFile: string
): boolean
```

**Parameters:**

- `patterns`: Array of glob patterns (returns `false` if undefined or empty)
- `relativeFile`: Relative file path to check

**Returns:** `true` if any pattern matches

**Example:**

```typescript
import { globPatternsGetMatchAny } from '@codepol/core';

globPatternsGetMatchAny(['src/**/*.ts', 'lib/**/*.ts'], 'src/utils.ts');
// true

globPatternsGetMatchAny(undefined, 'src/utils.ts');
// false
```

---

### ruleTargetMatchesLanguage

Checks if a file matches the language specified in a rule target.

```typescript
function ruleTargetMatchesLanguage(
  target: PolicyRuleTarget,
  filePath: string
): boolean
```

**Parameters:**

- `target`: The policy rule target containing the language
- `filePath`: File path to check (relative or absolute)

**Returns:** `true` if the file matches the target language

**Language matching rules:**

- `"tsx"` -- matches `.tsx` files only
- `"typescript"` -- matches `.ts` and `.tsx` files
- Any other language -- always returns `true` (no extension filtering)

---

### policyViolationsGetForFile

Checks a single file for policy violations using Tree-sitter.

```typescript
function policyViolationsGetForFile(
  filePath: string,
  rule: PolicyRule,
  target: PolicyRuleTarget,
  policy: PolicyFile,
  pluginsMap: PolicyPluginsMap,
  dir: string
): Result<PolicyViolation[], string>
```

**Parameters:**

- `filePath`: Absolute path to the file
- `rule`: The policy rule being checked
- `target`: The rule target (language/parser/glob configuration)
- `policy`: The loaded policy object
- `pluginsMap`: Loaded policy plugins (from `policyPluginsGet`)
- `dir`: Working directory for resolving paths and plugin context

**Returns:** Result containing violations or an error message

**Example:**

```typescript
import {
  configGet,
  policyPluginsGet,
  policyRuleTargetsResolve,
  policyViolationsGetForFile,
} from '@codepol/core';

const { config } = await configGet();
const pluginsResult = await policyPluginsGet(config, process.cwd());
if ('Err' in pluginsResult) {
  throw new Error(pluginsResult.Err);
}

const rule = config.rules[0];
const targets = policyRuleTargetsResolve(rule, config);
const target = targets[0];
const violationsResult = policyViolationsGetForFile(
  '/path/to/file.ts',
  rule,
  target,
  config,
  pluginsResult.Ok,
  process.cwd()
);

if ('Ok' in violationsResult) {
  console.log(violationsResult.Ok.length);
}
```

---

### policyViolationsGetFromDir

Checks all files matching the policy for violations.

```typescript
function policyViolationsGetFromDir(
  policy: PolicyFile,
  cwd: string
): Promise<Result<PolicyViolation[], string>>
```

**Parameters:**

- `policy`: The loaded policy object
- `cwd`: Working directory for resolving patterns

**Returns:** Result containing all violations or an error message

**Example:**

```typescript
import { configGet, policyViolationsGetFromDir } from '@codepol/core';

const { config } = await configGet();
const violationsResult = await policyViolationsGetFromDir(config, process.cwd());

if ('Ok' in violationsResult) {
  for (const v of violationsResult.Ok) {
    console.log(`${v.filePath}:${v.line}:${v.column} - ${v.message}`);
  }
}
```

---

### policyCheck

Runs complete policy checks (Tree-sitter checking).

```typescript
function policyCheck(
  options: PolicyCheckOptions
): Promise<Result<PolicyCheckResult, string>>
```

**Parameters:**

```typescript
type PolicyCheckOptions = {
  configPath?: string;  // Path to config file (auto-discovered if not specified)
  cwd?: string;
};
```

**Returns:** Result containing the check output or an error message.

The success payload uses:

```typescript
type PolicyCheckResult = {
  policy: PolicyFile;
  files: string[];
  treeViolations: PolicyViolation[];
};
```

**Example:**

```typescript
import { policyCheck, policyViolationsGetOutputPretty } from '@codepol/core';

// Auto-discovers config from current directory
const result = await policyCheck({});

// Or with explicit config path
const result2 = await policyCheck({
  configPath: './config/codepol.toml',
});

if ('Ok' in result) {
  console.log(`Checked ${result.Ok.files.length} files`);
  console.log(`Found ${result.Ok.treeViolations.length} violations`);

  if (result.Ok.treeViolations.length > 0) {
    console.log(
      policyViolationsGetOutputPretty(result.Ok.treeViolations, process.cwd())
    );
  }
}
```

---

### policyViolationsGetOutputPretty

Formats violations into a human-readable string.

```typescript
function policyViolationsGetOutputPretty(
  violations: PolicyViolation[],
  cwd: string
): string
```

**Parameters:**

- `violations`: Array of violations
- `cwd`: Working directory for relative paths

**Returns:** Formatted string (empty if no violations)

**Example:**

```typescript
import { policyViolationsGetOutputPretty } from '@codepol/core';

const output = policyViolationsGetOutputPretty(violations, process.cwd());
if (output) {
  console.log(output);
}
// Output:
// src/utils.ts:15:1 Function foo is missing logger.enter & logger.exit [function-logging]
```

---

## Plugin Loading

### PolicyPluginsMap

Map of loaded plugin rules, keyed by resolved (namespaced) rule ID.

```typescript
type PolicyPluginsMap = Map<string, PluginRule>;
```

---

### policyPluginsGet

Loads, validates, and namespaces all plugins declared in the policy. Built-in plugins are resolved from the in-process registry; process plugins are invoked as subprocesses via the JSON protocol. All policy rule references are validated against the loaded plugins.

```typescript
async function policyPluginsGet(
  policy: PolicyFile,
  cwd: string,
  options?: { configPath?: string }
): Promise<Result<PolicyPluginsMap, string>>
```

**Parameters:**

- `policy`: The loaded policy definition
- `cwd`: Working directory for resolving plugin module specifiers
- `options.configPath`: Path to the config file. Process plugins resolve relative `command` paths from this location; omitting it falls back to `cwd`.

**Returns:** `Ok(PolicyPluginsMap)` on success, `Err(string)` if a plugin fails to load, a rule references an unknown plugin, or language support validation fails

**Example:**

```typescript
import { configGet, policyPluginsGet, isErr } from '@codepol/core';

const { config } = await configGet();
const result = await policyPluginsGet(config, process.cwd());

if (isErr(result)) {
  console.error(result.Err);
  process.exit(1);
}

const pluginsMap = result.Ok;
console.log(`Loaded ${pluginsMap.size} rule(s)`);
```

---

### pluginGetForRule

Looks up a plugin by rule ID. Supports both fully-qualified IDs (`@scope/plugin/rule`) and short IDs (`rule`), matching by suffix.

```typescript
function pluginGetForRule(
  pluginsMap: PolicyPluginsMap,
  ruleId: string
): { plugin: PluginRule; resolvedId: string } | undefined
```

**Parameters:**

- `pluginsMap`: Loaded plugins map (from `policyPluginsGet`)
- `ruleId`: Rule ID (full or short)

**Returns:** The matched plugin and its resolved ID, or `undefined` if not found or ambiguous (multiple short-ID matches)

**Example:**

```typescript
import { pluginGetForRule } from '@codepol/core';

const lookup = pluginGetForRule(pluginsMap, 'require-logger-enter-exit');
if (lookup) {
  console.log(lookup.resolvedId);
  // '@codepol/plugin/require-logger-enter-exit'
}
```

---

### Tree-Check Adapter Types

The adapter layer enables converting `TreeCheckProvider` implementations into lint provider rules.
This is a provider-agnostic design: ESLint is the first supported platform, with Biome/Ruff/others
possible in the future.

#### LintDiagnostic

Platform-agnostic lint diagnostic that any lint provider can consume.

```typescript
type PolicyDiagnosticLocation = {
  filePath: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  message?: string;
};

type LintDiagnostic = {
  message: string;       // Human-readable message
  line: number;          // 1-based line number
  column: number;        // 1-based column number
  endLine?: number;      // Optional end line
  endColumn?: number;    // Optional end column
  ruleId: string;        // Rule ID that produced this diagnostic
  severity: 'error' | 'warning' | 'info';
  relatedLocations?: PolicyDiagnosticLocation[]; // Optional extra spans
};
```

#### TreeCheckAdapterOptions

Options for adapting a `TreeCheckProvider` to a lint provider rule.

```typescript
type TreeCheckAdapterOptions = {
  ruleName?: string;              // Rule name for the generated lint rule
  ruleUrl?: string;               // URL to rule documentation
  severity?: 'error' | 'warning'; // Default severity (default: 'error')
};
```

> **Note:** Config path is now auto-discovered via `configFileDiscover()`. Pass explicit paths through ESLint rule options if needed.

#### TreeCheckLintAdapter

Adapter contract for converting `TreeCheckProvider` to lint provider rules.

```typescript
type TreeCheckLintAdapter<TRule> = {
  platform: string;  // Platform identifier (e.g., 'eslint', 'biome')
  adapt: (provider: CodepolPluginRule, options?: TreeCheckAdapterOptions) => TRule;
};
```

---

### violationToLintDiagnostic

Converts a `PolicyViolation` to a platform-agnostic `LintDiagnostic`.

```typescript
function violationToLintDiagnostic(
  violation: PolicyViolation,
  severity?: 'error' | 'warning' | 'info'
): LintDiagnostic
```

**Parameters:**

- `violation`: The policy violation to convert
- `severity`: Severity level to assign (default: `'error'`)

**Returns:** A `LintDiagnostic` representing the violation

**Example:**

```typescript
import { violationToLintDiagnostic } from '@codepol/core';

const violation = {
  ruleId: 'require-logger',
  filePath: '/src/foo.ts',
  message: 'Missing logger.enter()',
  line: 10,
  column: 5,
};

const diagnostic = violationToLintDiagnostic(violation);
// { message: 'Missing logger.enter()', line: 10, column: 5, ruleId: 'require-logger', severity: 'error' }
```

---

### violationsToLintDiagnostics

Batch converts an array of `PolicyViolation` to `LintDiagnostic`.

```typescript
function violationsToLintDiagnostics(
  violations: PolicyViolation[],
  severity?: 'error' | 'warning' | 'info'
): LintDiagnostic[]
```

**Parameters:**

- `violations`: Array of policy violations to convert
- `severity`: Severity level to assign (default: `'error'`)

**Returns:** Array of `LintDiagnostic` objects

---

## Plugin Authoring

Primitives for creating codepol rule plugins.

### pluginRuleNew

Factory that validates and creates a `CodepolPluginRule`. This is the only way to create a rule plugin -- direct object literals will not type-check due to internal branding.

```typescript
function pluginRuleNew(config: PluginRuleConfig): CodepolPluginRule
```

**Parameters:**

- `config`: Rule plugin configuration (see `PluginRuleConfig`)

**Returns:** A branded `CodepolPluginRule`

**Throws:** If the rule ID contains `/` (reserved for namespacing)

**Example:**

```typescript
import { pluginRuleNew, treeCheckProviderNew } from '@codepol/core';

const myProvider = treeCheckProviderNew({
  languages: ['typescript', 'tsx'],
  check: (rule, context) => {
    const violations = [];
    // ... check logic ...
    return violations;
  },
});

export const myRule = pluginRuleNew({
  id: 'no-todo-comments',
  capabilities: {
    treeCheckProvider: myProvider,
  },
});

export default [myRule];
```

---

### PluginRuleConfig

Input configuration for creating a rule plugin.

```typescript
type PluginRuleConfig = {
  /** Must NOT contain '/' -- reserved for namespacing (e.g., "my-rule" becomes "@scope/plugin/my-rule") */
  id: string;
  /** Capability bundle for this rule */
  capabilities: PolicyPluginCapabilities;
};
```

---

### PolicyViolation

A single policy finding. Primary position uses `line` / `column`; optional `endLine` / `endColumn` close the range; `relatedLocations` lists additional spans (see `PolicyDiagnosticLocation` under Tree-Check Adapter Types).

```typescript
type PolicyViolation = {
  ruleId: string;
  filePath: string;
  message: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  relatedLocations?: PolicyDiagnosticLocation[];
  fix?: PolicyViolationFix;
};
```

### PolicyViolationFix

Fix data for an auto-fixable violation. Provides the byte range and replacement text for ESLint/IDE inline fixes.

```typescript
type PolicyViolationFix = {
  /** Byte offset range [start, end) in the source text to replace */
  byteRange: ByteRange;
  /** Replacement text (can be empty to delete the range) */
  text: string;
};
```

Violations with a `fix` field are auto-fixable when running through ESLint with `--fix` or via IDE quick-fix actions.

---

### FixProviderContext

Context passed to fix providers when applying fixes.

```typescript
type FixProviderContext = {
  cwd: string;
  policy: PolicyFile;
  configPath: string;
  files: string[];
  ruleTargets?: PolicyRuleTargetContext[];
};
```

---

### TreeCheckFn

Consumer-facing check function type. Returns a plain violations array; errors are thrown as exceptions (the `treeCheckProviderNew` factory wraps this with `resultFrom` to produce `Result`).

```typescript
type TreeCheckFn = (
  rule: PolicyRule,
  context: PolicyCheckContext
) => PolicyViolation[];
```

---

### treeCheckProviderNew

Factory for creating a `TreeCheckProvider` from a plain check function. Wraps the function with `resultFrom` so that thrown exceptions are converted to `Result.Err` instead of propagating.

```typescript
function treeCheckProviderNew(config: {
  languages: string[];
  check: TreeCheckFn;
}): TreeCheckProvider
```

**Parameters:**

- `config.languages`: Languages this provider supports (e.g., `['typescript', 'tsx']`)
- `config.check`: Check function that receives a rule and context, returns violations

**Returns:** A `TreeCheckProvider` suitable for use in `PluginRuleConfig.capabilities`

**Example:**

```typescript
import { treeCheckProviderNew } from '@codepol/core';

const provider = treeCheckProviderNew({
  languages: ['typescript', 'tsx'],
  check: (rule, context) => {
    const violations = [];
    // ... tree-sitter analysis ...
    return violations;
  },
});
```

---

### eslintProviderCreate

Factory for creating `LintProvider` objects with `platform: 'eslint'`.

```typescript
function eslintProviderCreate(config: {
  languages: string[];
  pluginName?: string;
  rules: Record<string, unknown>;
  configs?: Record<string, unknown>;
  ruleOptions?: (ctx: LintProviderContext) => unknown;
}): LintProvider
```

**Parameters:**

- `config.languages`: Languages this provider supports
- `config.pluginName`: ESLint plugin name (default: `'codepol'`)
- `config.rules`: ESLint rule implementations
- `config.configs`: Optional ESLint config presets
- `config.ruleOptions`: Optional function to derive rule options from the policy context

**Returns:** A `LintProvider` with `platform: 'eslint'`

---

### rulePluginLanguagesGet

Derives all supported languages from a plugin's lint providers and tree-check provider.

```typescript
function rulePluginLanguagesGet(plugin: CodepolPluginRule): string[]
```

**Parameters:**

- `plugin`: The rule plugin to inspect

**Returns:** Deduplicated array of language IDs

---

### ESLINT_PLUGIN_NAME_DEFAULT

Default ESLint plugin name used when none is specified in provider config.

```typescript
const ESLINT_PLUGIN_NAME_DEFAULT = 'codepol';
```

---

## Workspace Package Discovery

### workspacePackageMapDiscover

Discovers all workspace packages in a monorepo and maps each package name to the absolute path of its source entry-point file. Supports pnpm, npm, and yarn workspace layouts.

```typescript
function workspacePackageMapDiscover(rootDir: string): Map<string, string>
```

**Parameters:**

- `rootDir`: Absolute path to the monorepo root directory

**Returns:** Map of package name to absolute source entry-point file path

**Discovery order:**

1. `pnpm-workspace.yaml` (pnpm)
2. Root `package.json` `workspaces` field (npm / yarn)

**Entry-point resolution per package:**

1. Derive source path from `exports["."]` or `main` (`dist/` → `src/`, `.js` → `.ts`)
2. Fallback to `src/index.ts` next to the package's `package.json`

**Example:**

```typescript
import { workspacePackageMapDiscover } from '@codepol/core';

const packages = workspacePackageMapDiscover('/path/to/monorepo');

for (const [name, entryPoint] of packages) {
  console.log(`${name} → ${entryPoint}`);
}
// @codepol/core → /path/to/monorepo/packages/core/src/index.ts
// @codepol/plugin → /path/to/monorepo/packages/plugin/src/index.ts
```

This is used internally by the semantic index for monorepo-aware module resolution (resolving bare specifiers like `import { foo } from '@codepol/core'` to their source files).

---

## Result Utilities

Codepol uses a lightweight `Result` type instead of thrown exceptions for operations that can fail. This makes error handling explicit at the type level.

### Result

Discriminated union for success (`Ok`) or error (`Err`).

```typescript
type Result<T, E> = { Ok: T; Err?: never } | { Err: E; Ok?: never };
```

---

### Ok / Err

Constructors for creating `Result` values.

```typescript
function Ok<T>(value: T): Result<T, never>
function Err<E>(error: E): Result<never, E>
```

**Example:**

```typescript
import { Ok, Err, type Result } from '@codepol/core';

function divide(a: number, b: number): Result<number, string> {
  if (b === 0) return Err('Division by zero');
  return Ok(a / b);
}
```

---

### isOk / isErr

Type guards for narrowing `Result` values.

```typescript
function isOk<T, E>(result: Result<T, E>): result is { Ok: T; Err?: never }
function isErr<T, E>(result: Result<T, E>): result is { Err: E; Ok?: never }
```

**Example:**

```typescript
import { isOk, isErr } from '@codepol/core';

const result = await policyViolationsGetFromDir(config, cwd);

if (isOk(result)) {
  console.log(`${result.Ok.length} violations`);
}
if (isErr(result)) {
  console.error(result.Err);
}
```

---

### resultFrom / resFrom

Wraps a synchronous function, converting thrown exceptions to `Result.Err`. `resFrom` is an alias.

```typescript
function resultFrom<T, E>(fn: () => T): Result<T, E>
const resFrom = resultFrom;
```

**Example:**

```typescript
import { resultFrom } from '@codepol/core';

const result = resultFrom(() => JSON.parse(rawJson));
```

---

### resFromAsync

Async version of `resultFrom`. Wraps an async function, converting rejections to `Result.Err`.

```typescript
async function resFromAsync<T, E>(
  fn: () => Promise<T>
): Promise<Result<T, E>>
```

**Example:**

```typescript
import { resFromAsync } from '@codepol/core';

const result = await resFromAsync(() => fetch(url).then(r => r.json()));
```

---

## Semantic Index (Cross-File Analysis)

The semantic index provides project-wide cross-file analysis. It extracts symbols, scopes, and relations from source files using Tree-sitter, resolves cross-file imports/exports, and exposes a read-only query API for plugins.

### Core Types

#### SymbolId / ScopeId / FlowNodeId

Stable string identifiers for index entities. IDs are deterministic and stable across re-indexing when content is unchanged.

```typescript
type SymbolId = string;
type ScopeId = string;
type FlowNodeId = string;
```

---

#### ByteRange

Byte range within a file. Uses byte offsets (not line/column) for precision and performance.

```typescript
type ByteRange = {
  start: number;  // Inclusive
  end: number;    // Exclusive
};
```

---

#### SymbolKind

Language-agnostic symbol kinds. Adapters map language-specific node types to these canonical kinds.

```typescript
type SymbolKind =
  | 'module'
  | 'namespace'
  | 'class'
  | 'interface'
  | 'type'
  | 'function'
  | 'method'
  | 'variable'
  | 'const'
  | 'field'
  | 'parameter'
  | 'enum'
  | 'enumMember';
```

---

#### ScopeKind

Language-agnostic scope kinds. Scopes form a tree for name resolution and visibility.

```typescript
type ScopeKind =
  | 'file'
  | 'module'
  | 'type'
  | 'function'
  | 'block'
  | 'class'
  | 'namespace';
```

---

#### SymbolFlags

Symbol attribute flags as a bitset. Combine with bitwise OR.

```typescript
import { SymbolFlags } from '@codepol/core';

SymbolFlags.None        // 0
SymbolFlags.Exported    // 1
SymbolFlags.Async       // 2
SymbolFlags.Generator   // 4
SymbolFlags.Static      // 8
SymbolFlags.Abstract    // 16
SymbolFlags.Readonly    // 32
SymbolFlags.Optional    // 64
SymbolFlags.Private     // 128
SymbolFlags.Protected   // 256
SymbolFlags.Public      // 512
```

**Example:**

```typescript
import { SymbolFlags } from '@codepol/core';

const isExported = (symbol.flags & SymbolFlags.Exported) !== 0;
const isAsyncExport = (symbol.flags & (SymbolFlags.Exported | SymbolFlags.Async)) ===
  (SymbolFlags.Exported | SymbolFlags.Async);
```

---

#### SymbolRecord

A symbol (declaration) in the semantic index.

```typescript
type SymbolRecord = {
  id: SymbolId;
  kind: SymbolKind;
  name: string;          // Declared name (local, not qualified)
  file: string;          // Absolute file path
  byteRange: ByteRange;
  scopeId: ScopeId;      // Scope that contains this symbol
  qualName: string;       // Qualified name for disambiguation
  flags: number;          // SymbolFlags bitset
};
```

---

#### ScopeRecord

A scope (lexical/semantic boundary). Scopes form a tree via the `parent` field.

```typescript
type ScopeRecord = {
  id: ScopeId;
  kind: ScopeKind;
  file: string;
  byteRange: ByteRange;
  parent?: ScopeId;       // undefined for file scope
};
```

---

#### SymbolFilter

Filter options for symbol queries.

```typescript
type SymbolFilter = {
  file?: string;
  kind?: SymbolKind;
  name?: string;
  scopeId?: ScopeId;
};
```

---

#### IndexCapabilities

Declares what capabilities the index supports. Plugins should check this before attempting advanced queries.

```typescript
type IndexCapabilities = {
  crossFileResolution: boolean;
  callGraph: 'none' | 'heuristic' | 'precise';
  controlFlowGraph: boolean;
  supportedLanguages: string[];
};
```

---

### Relation Types

Relations are append-only facts extracted by language adapters. `RelationRecord` is a union of all 8 relation types.

#### DefinesRelation

A scope declares a symbol.

```typescript
type DefinesRelation = {
  kind: 'Defines';
  scopeId: ScopeId;
  symbolId: SymbolId;
};
```

#### ContainsRelation

A scope contains a child scope.

```typescript
type ContainsRelation = {
  kind: 'Contains';
  scopeId: ScopeId;
  childScopeId: ScopeId;
};
```

#### ReferencesRelation

An identifier refers to a symbol. `resolvedSymbolId` is populated during file-local resolution; `undefined` if resolution failed.

```typescript
type ReferencesRelation = {
  kind: 'References';
  scopeId: ScopeId;
  name: string;
  byteRange: ByteRange;
  resolvedSymbolId?: SymbolId;
};
```

#### ImportsRelation

A scope imports from a module specifier. `resolvedModulePath` is populated during cross-file resolution.

```typescript
type ImportsRelation = {
  kind: 'Imports';
  scopeId: ScopeId;
  spec: string;
  byteRange: ByteRange;
  resolvedModulePath?: string;
};
```

#### CallsRelation

A call expression within a scope. `resolvedSymbolId` is populated during resolution.

```typescript
type CallsRelation = {
  kind: 'Calls';
  scopeId: ScopeId;
  calleeName: string;
  byteRange: ByteRange;
  resolvedSymbolId?: SymbolId;
};
```

#### ImportBindingRelation

Links an imported name to its source module. This is the key relation for cross-file symbol resolution.

```typescript
type ImportBindingRelation = {
  kind: 'ImportBinding';
  localSymbolId: SymbolId;
  importedName: string;
  moduleSpec: string;
  resolvedModulePath?: string;
  resolvedExportId?: SymbolId;
  isDefault: boolean;
  isNamespace: boolean;
  byteRange: ByteRange;
};
```

#### ExportsRelation

Marks a symbol as exported from its module.

```typescript
type ExportsRelation = {
  kind: 'Exports';
  symbolId: SymbolId;
  exportedName: string;
  isDefault: boolean;
  sourceModule?: string;     // For re-exports
  sourceName?: string;       // For re-exports
  byteRange: ByteRange;
};
```

#### TypeRelation

Captures extends/implements relationships between classes and interfaces.

```typescript
type TypeRelation = {
  kind: 'TypeRelation';
  symbolId: SymbolId;
  targetName: string;
  relationKind: 'extends' | 'implements';
  byteRange: ByteRange;
  resolvedTargetId?: SymbolId;
};
```

---

### Control Flow Graph Types

#### FlowNodeKind

Language-agnostic control flow node kinds.

```typescript
type FlowNodeKind =
  | 'entry'      // Function entry point (exactly one per CFG)
  | 'exit'       // Function exit point (exactly one per CFG)
  | 'statement'  // Basic statement
  | 'branch'     // Decision point (if, loop condition)
  | 'merge'      // Where branches rejoin
  | 'loop'       // Loop header (back-edge target)
  | 'return'
  | 'throw';
```

#### FlowNode

A node in a control flow graph.

```typescript
type FlowNode = {
  id: FlowNodeId;
  kind: FlowNodeKind;
  byteRange?: ByteRange;    // undefined for synthetic entry/exit
  label?: string;
};
```

#### FlowEdge

An edge representing a possible transition between control flow points.

```typescript
type FlowEdge = {
  from: FlowNodeId;
  to: FlowNodeId;
  label?: 'true' | 'false' | 'loop-back' | 'unconditional'
    | 'break' | 'continue' | 'case' | 'default'
    | 'exception' | 'finally';
};
```

#### FlowGraph

A control flow graph for a single function/method scope. Contains exactly one entry node and one exit node.

```typescript
type FlowGraph = {
  scopeId: ScopeId;
  nodes: FlowNode[];
  edges: FlowEdge[];
};
```

---

### Module Resolution

#### ModuleResolveOptions

Options for module resolution.

```typescript
type ModuleResolveOptions = {
  baseDir: string;
  extensions: string[];
  pathAliases?: Record<string, string[]>;
  indexedFiles?: Set<string>;
  workspacePackages?: Map<string, string>;
};
```

---

#### moduleResolve

Resolves a module specifier to an absolute file path.

```typescript
function moduleResolve(
  specifier: string,
  fromFile: string,
  options: ModuleResolveOptions
): string | undefined
```

**Parameters:**

- `specifier`: The import specifier (e.g., `'./utils'`, `'lodash'`)
- `fromFile`: Absolute path of the importing file
- `options`: Resolution options

**Returns:** Absolute file path if resolved, `undefined` for external packages or unresolvable specifiers

**Resolution strategy:**

1. Workspace packages: check `workspacePackages` map first
2. External packages (`@org/pkg`, `lodash`): return `undefined`
3. Relative imports: resolve relative to importing file, try exact path, then extensions, then directory index
4. Path aliases: expand alias and resolve
5. Absolute paths: try extensions and directory index

---

#### isRelativeImport

```typescript
function isRelativeImport(specifier: string): boolean
```

Returns `true` if the specifier starts with `./` or `../`.

---

#### isExternalPackage

```typescript
function isExternalPackage(specifier: string): boolean
```

Returns `true` if the specifier is likely an external package (not relative, not absolute).

---

#### DEFAULT_EXTENSIONS

Default extensions tried when resolving modules.

```typescript
const DEFAULT_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx',
  '.mts', '.cts', '.mjs', '.cjs',
];
```

---

### Query API

#### ProjectIndex

Read-only query interface for the semantic index. This is the stable API exposed to plugins for cross-file analysis. All queries are total (return empty arrays, never null).

```typescript
type ProjectIndex = {
  // Symbol Queries
  symbolsGet(filter?: SymbolFilter): SymbolRecord[];
  symbolGet(id: SymbolId): SymbolRecord | undefined;
  symbolsInFileGet(file: string): SymbolRecord[];
  symbolsGetByName(name: string): SymbolRecord[];

  // Reference Queries
  referencesGet(symbolId: SymbolId): ReferencesRelation[];
  referencesInFileGet(file: string): ReferencesRelation[];

  // Call Graph Queries (heuristic)
  callersGet(symbolId: SymbolId): SymbolId[];
  calleesGet(symbolId: SymbolId): SymbolId[];

  // Scope Queries
  scopeGet(id: ScopeId): ScopeRecord | undefined;
  scopesInFileGet(file: string): ScopeRecord[];
  symbolsInScopeGet(scopeId: ScopeId): SymbolRecord[];

  // Import/Export Queries
  importsGet(file: string): ImportsRelation[];
  importBindingsGet(file: string): ImportBindingRelation[];
  importBindingGetForSymbol(symbolId: SymbolId): ImportBindingRelation | undefined;
  exportedSymbolsGet(filter?: { file?: string; name?: string }): SymbolRecord[];
  exportersGet(symbolName: string): SymbolRecord[];
  fileExportsGet(file: string): ExportsRelation[];
  exportLocationsGet(symbolId: SymbolId): { file: string; exportedName: string }[];
  importResolve(fromFile: string, specifier: string, name: string): SymbolId | undefined;

  // Type Relation Queries
  typeRelationsGet(symbolId: SymbolId): TypeRelation[];
  subTypesGet(symbolId: SymbolId): TypeRelation[];
  typeRelationsInFileGet(file: string): TypeRelation[];

  // Module Graph Queries
  moduleImportersGet(file: string): string[];
  moduleImporteesGet(file: string): string[];
  moduleDependencyOrderGet(): string[];
  moduleCyclesGet(): string[][];
  moduleEntryPointsGet(): string[];

  // Control Flow Graph Queries
  cfgGet(scopeId: ScopeId): FlowGraph | undefined;
  cyclomaticComplexityGet(symbolId: SymbolId): number | undefined;

  // Metadata
  readonly capabilities: IndexCapabilities;
  filesGet(): string[];
  statsGet(): { files: number; symbols: number; scopes: number; relations: number };
};
```

**Example:**

```typescript
import {
  parserInit,
  langAdd,
  projectIndexBuild,
  SymbolFlags,
} from '@codepol/core';

langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
langAdd({ langId: 'tsx', fileExtensions: ['.tsx'] });
await parserInit();

const { index, stats } = await projectIndexBuild({
  files: ['/src/index.ts', '/src/utils.ts'],
  dir: '/project',
});

console.log(`Indexed ${stats.filesIndexed} files`);

// Find all exported functions
const exported = index.symbolsGet({ kind: 'function' })
  .filter(s => (s.flags & SymbolFlags.Exported) !== 0);

// Check for circular dependencies
const cycles = index.moduleCyclesGet();
if (cycles.length > 0) {
  console.warn(`Found ${cycles.length} circular dependency cycle(s)`);
}

// Get cyclomatic complexity
const fn = index.symbolsGet({ name: 'processData', kind: 'function' })[0];
if (fn) {
  const complexity = index.cyclomaticComplexityGet(fn.id);
  console.log(`Complexity: ${complexity}`);
}
```

---

#### projectIndexCreate

Creates a `ProjectIndex` from an `IndexStore`. This wraps the store in a read-only query interface.

```typescript
function projectIndexCreate(
  store: IndexStore,
  capabilities: IndexCapabilities
): ProjectIndex
```

**Parameters:**

- `store`: The `IndexStore` containing indexed data
- `capabilities`: Capabilities descriptor for the index

**Returns:** A `ProjectIndex` instance

---

### Module Graph

#### ModuleGraph

Module-level dependency graph. All file paths are absolute, matching the paths in `IndexStore`.

```typescript
type ModuleGraph = {
  moduleGraphImportersGet(file: string): string[];
  moduleGraphImporteesGet(file: string): string[];
  moduleGraphDependencyOrderGet(): string[];
  moduleGraphCyclesGet(): string[][];
  moduleGraphEntryPointsGet(): string[];
};
```

**Methods:**

- `moduleGraphImportersGet(file)` -- files that import the given file (reverse edges)
- `moduleGraphImporteesGet(file)` -- files that the given file imports (forward edges)
- `moduleGraphDependencyOrderGet()` -- topological sort (dependencies first)
- `moduleGraphCyclesGet()` -- circular dependency cycles (Tarjan's SCC algorithm)
- `moduleGraphEntryPointsGet()` -- files with no importers (root files), sorted alphabetically

---

#### moduleGraphBuild

Builds a `ModuleGraph` from an `IndexStore`.

```typescript
function moduleGraphBuild(store: IndexStore): ModuleGraph
```

**Parameters:**

- `store`: The `IndexStore` containing indexed import/export data

**Returns:** A `ModuleGraph` instance

---

### Index Builder

#### IndexBuildOptions

Options for building a project index.

```typescript
type IndexBuildOptions = {
  files: string[];
  dir: string;
  languages?: string[];
  store?: IndexStore;
  crossFileResolution?: boolean;
  pathAliases?: Record<string, string[]>;
  workspacePackages?: Map<string, string>;
};
```

**Fields:**

- `files`: Files to index (absolute paths)
- `dir`: Working directory for relative paths and module resolution
- `languages`: Filter to specific languages (optional, indexes all supported languages if omitted)
- `store`: Existing index store to update (creates new if not provided)
- `crossFileResolution`: Enable cross-file symbol resolution (default: `true`)
- `pathAliases`: Path aliases from tsconfig (e.g., `{ "@/*": ["src/*"] }`)
- `workspacePackages`: Workspace package name to source entry file map

---

#### IndexBuildResult

Result of building a project index.

```typescript
type IndexBuildResult = {
  index: ProjectIndex;
  stats: {
    filesIndexed: number;
    filesSkipped: number;
    errors: string[];
  };
};
```

---

#### projectIndexBuild

Builds a project index from a list of files (async version).

```typescript
async function projectIndexBuild(
  options: IndexBuildOptions
): Promise<IndexBuildResult>
```

---

#### projectIndexBuildSync

Builds a project index from a list of files (sync version). Use this in ESLint rules where async is not supported.

```typescript
function projectIndexBuildSync(
  options: IndexBuildOptions
): IndexBuildResult
```

---

#### projectIndexUpdate

Incrementally updates the index for specific files. Only re-indexes files whose content has changed.

```typescript
async function projectIndexUpdate(
  store: IndexStore,
  files: string[]
): Promise<{ updated: number; skipped: number; errors: string[] }>
```

**Parameters:**

- `store`: The `IndexStore` to update
- `files`: Absolute file paths to update

**Returns:** Counts of updated/skipped files and any errors

---

#### projectIndexUpdateFileSync

Updates a single file in the index (synchronous).

```typescript
function projectIndexUpdateFileSync(
  store: IndexStore,
  file: string
): boolean
```

**Returns:** `true` if the file was re-indexed (content changed), `false` if unchanged

---

#### projectIndexUpdateFileFromSource

Updates a single file using provided source content instead of reading from disk. Important when the in-memory source (e.g., from ESLint) may differ from the on-disk version.

```typescript
function projectIndexUpdateFileFromSource(
  store: IndexStore,
  file: string,
  source: string
): boolean
```

**Returns:** `true` if the file was re-indexed (content changed), `false` if unchanged

---

#### projectIndexRemoveFiles

Removes files from the index.

```typescript
function projectIndexRemoveFiles(
  store: IndexStore,
  files: string[]
): void
```

---

#### crossFileResolveForFile

Re-resolves cross-file imports and exports for a single file. Call this after updating a file to refresh its import binding resolutions.

```typescript
function crossFileResolveForFile(
  store: IndexStore,
  file: string,
  resolveOptions: ModuleResolveOptions
): void
```

**Parameters:**

- `store`: The `IndexStore`
- `file`: The file that was updated
- `resolveOptions`: Module resolution options

---

#### adapterRegister

Registers a language adapter factory for indexing. Built-in adapters for TypeScript, TSX, and Python are registered automatically.

```typescript
function adapterRegister(
  languageId: string,
  factory: (language: Language) => IndexAdapter
): void
```

**Parameters:**

- `languageId`: Language identifier (e.g., `'typescript'`, `'python'`)
- `factory`: Function that creates an `IndexAdapter` from a Tree-sitter `Language`

---

### Index Store (Advanced Use)

The `IndexStore` is the mutable backing store for the semantic index. Most users should use the builder functions (`projectIndexBuild`, etc.) and query through `ProjectIndex`. Direct store access is for advanced use cases like custom adapters or incremental tooling.

#### FileIndexDelta

Result of indexing a single file. Produced by language adapters, consumed by `IndexStore`.

```typescript
type FileIndexDelta = {
  file: string;
  revision: string;
  symbols: SymbolRecord[];
  scopes: ScopeRecord[];
  relations: RelationRecord[];
  cfgs?: FlowGraph[];
};
```

---

#### IndexStore / indexStoreNew

In-memory store with secondary indexes for efficient lookups.

```typescript
class IndexStore {
  filePut(delta: FileIndexDelta): void;
  fileRemove(file: string): void;
  clear(): void;

  symbolGet(id: SymbolId): SymbolRecord | undefined;
  symbolsGet(filter?: SymbolFilter): SymbolRecord[];
  scopeGet(id: ScopeId): ScopeRecord | undefined;
  scopesInFileGet(file: string): ScopeRecord[];
  symbolsInScopeGet(scopeId: ScopeId): SymbolRecord[];

  referencesGet(symbolId: SymbolId): ReferencesRelation[];
  referencesInFileGet(file: string): ReferencesRelation[];
  callsInScopeGet(scopeId: ScopeId): CallsRelation[];
  callsGet(): CallsRelation[];

  importsInFileGet(file: string): ImportsRelation[];
  importBindingsInFileGet(file: string): ImportBindingRelation[];
  importBindingForSymbolGet(symbolId: SymbolId): ImportBindingRelation | undefined;
  importBindingsGet(): ImportBindingRelation[];

  exportsInFileGet(file: string): ExportsRelation[];
  exportsGet(): ExportsRelation[];
  exportMapBuild(): Map<string, Map<string, SymbolId>>;

  typeRelationsForSymbolGet(symbolId: SymbolId): TypeRelation[];
  typeRelationsInFileGet(file: string): TypeRelation[];

  relationUpdate<R extends RelationRecord>(oldRelation: R, newRelation: R): void;

  fileHasRevision(file: string, revision: string): boolean;
  filesGet(): string[];
  cfgGet(scopeId: string): FlowGraph | undefined;
  statsGet(): { files: number; symbols: number; scopes: number; relations: number };
}

function indexStoreNew(): IndexStore
```

**Example:**

```typescript
import { indexStoreNew, projectIndexCreate } from '@codepol/core';

const store = indexStoreNew();

// Use store with builder functions
const { index } = await projectIndexBuild({
  files: myFiles,
  dir: projectRoot,
  store,
});

// Later, incrementally update
await projectIndexUpdate(store, changedFiles);

// Rebuild query interface after updates
const updatedIndex = projectIndexCreate(store, index.capabilities);
```

---

## @codepol/plugin-eslint

### eslintPluginCreate

```typescript
import { eslintPluginCreate } from '@codepol/plugin-eslint';
import pluginRules from '@codepol/plugin';

const plugin = eslintPluginCreate(pluginRules);
// plugin.rules['require-logger-enter-exit']
```

The ESLint plugin is a thin adapter that aggregates rules from capability plugins like `@codepol/plugin`.

---

### eslintAdapter

Converts a `TreeCheckProvider` into an ESLint rule module. This enables tree-sitter based checks
to run within ESLint's infrastructure without duplicating the check logic.

```typescript
import { eslintAdapter } from '@codepol/plugin-eslint';

const eslintAdapter: TreeCheckLintAdapter<TSESLint.RuleModule<string, unknown[]>>
```

**Properties:**

- `platform`: `'eslint'`
- `adapt(provider, options?)`: Converts a `CodepolPluginRule` to an ESLint rule

**Example:**

```typescript
import { eslintAdapter } from '@codepol/plugin-eslint';
import { loggerEnterExitRule } from '@codepol/plugin';

// Convert tree-check provider to ESLint rule
const eslintRule = eslintAdapter.adapt(loggerEnterExitRule, {
  ruleName: 'require-logger-enter-exit',
});

// Use in ESLint flat config
export default [
  {
    plugins: {
      codepol: { rules: { 'require-logger-enter-exit': eslintRule } },
    },
    rules: {
      'codepol/require-logger-enter-exit': 'error',
    },
  },
];
```

---

### eslintAdapterInit

Pre-initializes a `TreeCheckProvider` for use with ESLint. Call this before running ESLint
to ensure async initialization completes (e.g., loading Tree-sitter WASM parsers).

```typescript
async function eslintAdapterInit(
  provider: CodepolPluginRule,
  policy: PolicyFile,
  cwd: string
): Promise<void>
```

**Parameters:**

- `provider`: The `CodepolPluginRule` to initialize
- `policy`: The loaded policy file
- `cwd`: Current working directory

**Example:**

```typescript
import { eslintAdapterInit, eslintAdapter } from '@codepol/plugin-eslint';
import { configGet, parserInit, langAdd } from '@codepol/core';
import { loggerEnterExitRule } from '@codepol/plugin';

// Initialize tree-sitter languages
langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
await parserInit();

// Initialize the provider
const { config } = await configGet();
await eslintAdapterInit(loggerEnterExitRule, config, process.cwd());

// Now the adapted rule will work without async init warnings
const rule = eslintAdapter.adapt(loggerEnterExitRule);
```

---

### policyCacheClear / providerInitStateClear

Utility functions for clearing cached state (useful for testing).

```typescript
import { policyCacheClear, providerInitStateClear } from '@codepol/plugin-eslint';

// Clear cached policy files
policyCacheClear();

// Clear provider initialization state
providerInitStateClear();
```

Note: The old names `clearPolicyCache` and `clearProviderInitState` are still available but deprecated.

---

## @codepol/plugin

### Rule Plugins

```typescript
import pluginRules, { loggerEnterExitRule, loggerLintProvider } from '@codepol/plugin';

// loggerEnterExitRule.id === '@codepol/plugin/require-logger-enter-exit'
// loggerEnterExitRule.capabilities.lintProviders contains loggerLintProvider
// loggerLintProvider.platform === 'eslint'
// loggerLintProvider.languages === ['typescript', 'tsx']
// pluginRules (array for convenience)
```

Use `(lintProvider.config as EslintProviderConfig).ruleOptions?.({ policy, configPath, cwd, ruleId, ruleArgs })`
to get the ESLint rule options. Severity is defined in `codepol.toml` per rule.

### policyCacheClear

Clears the policy file cache used by the logger plugin.

```typescript
import { policyCacheClear } from '@codepol/plugin';

policyCacheClear();
```

**Config file example:**

```toml
[[plugins]]
id = "@codepol/plugin"
source = { kind = "builtin" }

[targets.typescript-src]
language = "typescript"
files = ["src/**/*.ts"]

[[rules]]
ruleId = "@codepol/plugin/require-logger-enter-exit"
targets = ["typescript-src"]

[rules.args.logger]
identifier = "logger"
enterMethod = "enter"
exitMethod = "exit"
import = { module = "@org/logger", named = "logger" }
```

---

## @codepol/plugin-esbuild

### esbuildPluginCreate

Creates an esbuild plugin for policy enforcement.

```typescript
function esbuildPluginCreate(options?: PolicyPluginOptions): Plugin
```

**Parameters:**

```typescript
type PolicyPluginOptions = {
  configPath?: string;       // Path to config file (auto-discovered if not specified)
  eslintConfigPath?: string; // Path to ESLint config (uses config value or auto-detects)
  fix?: boolean;             // Default: false
  cwd?: string;              // Default: esbuild's absWorkingDir or cwd
};
```

**Returns:** esbuild Plugin

**Example (zero-config):**

```typescript
import { build } from 'esbuild';
import { esbuildPluginCreate } from '@codepol/plugin-esbuild';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  outdir: 'dist',
  plugins: [
    // Auto-discovers codepol.toml from project root
    esbuildPluginCreate(),
  ],
});
```

**Example (with explicit config):**

```typescript
plugins: [
  esbuildPluginCreate({
    configPath: './config/codepol.toml',
    fix: true,
  }),
]
```

---

## Complete Example

Custom policy checker script:

```typescript
// scripts/check-policy.ts
import {
  parserInit,
  configGet,
  configGetFromPath,
  policyViolationsGetFromDir,
  policyViolationsGetOutputPretty,
  type PolicyViolation,
} from '@codepol/core';

async function main() {
  const configPath = process.argv[2];
  
  // Load config: explicit path or auto-discover
  const { config } = configPath
    ? await configGetFromPath(configPath)
    : await configGet();

  await parserInit();

  console.log(`Checking policy: ${config.rules.map(r => r.id).join(', ')}`);

  const violationsResult = await policyViolationsGetFromDir(
    config,
    process.cwd()
  );

  if ('Err' in violationsResult) {
    console.error(violationsResult.Err);
    process.exit(1);
  }

  if (violationsResult.Ok.length === 0) {
    console.log('✔ All checks passed!');
    return;
  }

  console.log(`\n✖ Found ${violationsResult.Ok.length} violation(s):\n`);
  console.log(
    policyViolationsGetOutputPretty(violationsResult.Ok, process.cwd())
  );

  // Group by rule
  const byRule = violationsResult.Ok.reduce((acc, v) => {
    acc[v.ruleId] = acc[v.ruleId] || [];
    acc[v.ruleId].push(v);
    return acc;
  }, {} as Record<string, PolicyViolation[]>);

  console.log('\nSummary:');
  for (const [ruleId, ruleViolations] of Object.entries(byRule)) {
    console.log(`  ${ruleId}: ${ruleViolations.length} violation(s)`);
  }

  process.exit(1);
}

main().catch(console.error);
```

Run with:

```bash
# Auto-discovers codepol.toml
npx ts-node scripts/check-policy.ts

# Or with explicit config path
npx ts-node scripts/check-policy.ts ./config/codepol.toml
```
