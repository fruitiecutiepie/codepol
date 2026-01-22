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
  TreeCheckProvider,
  PolicyPluginCapabilities,
  CodepolPluginRule,
  PluginRule,
  PolicyPluginDeclaration,
  PolicyPluginRuleDeclaration,
  PolicyCheckContext,
  LintProvider,
  LintProviderContext,
  EslintProviderConfig,
  FixProvider,
  RuleMatch,
  PolicyCheckOptions,
  PolicyCheckResult,
  // Adapter types
  LintDiagnostic,
  TreeCheckAdapterOptions,
  TreeCheckLintAdapter,
  // Result
  Result,
} from '@codepol/core';
```

Policy rules split semantics (meaning) from language targets. `PolicyRule` defines the rule metadata and plugin reference (`ruleId`), while `PolicyRuleTarget` declares the language adapter or parser plus its file globs.
Rules reference targets by name via `rule.targets` (an array of strings), pointing to entries in the top-level `PolicyFile.targets` map.
This lets a single rule apply across multiple targets without duplicating configuration.

---

## Config Loading

Codepol uses a unified config file that is auto-discovered from your project root.

### defineConfig

Type-safe helper for creating codepol configurations with autocomplete.

```typescript
import { defineConfig } from '@codepol/core';

export default defineConfig({
  eslintConfigPath: './eslint.config.ts',
  plugins: ['@codepol/plugin'],
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

1. `codepol.config.ts`
2. `codepol.config.mts`
3. `codepol.config.js`
4. `codepol.config.mjs`
5. `codepol.config.cjs`
6. `policy.json` (backward compatibility)

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

const { config } = await configGetFromPath('./config/codepol.config.ts');
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

### policyFileGet

Loads and parses a policy.json file. For new code, prefer `configGet()` which supports both JSON and TypeScript configs.

```typescript
function policyFileGet(policyPath: string): PolicyFile
```

**Parameters:**

- `policyPath`: Path to the policy.json file (absolute or relative)

**Returns:** Parsed PolicyFile object

**Example:**

```typescript
import { policyFileGet } from '@codepol/core';

const policy = policyFileGet('./policy.json');
console.log(policy.rules.length);
console.log(policy.plugins?.length ?? 0);
```

---

### providerRulesConfigGet

Generates lint provider rules config from policy.json. Users spread this into their lint config (e.g., eslint.config.js).

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
import { providerRulesConfigGet } from '@codepol/core';
import codepol from '@codepol/eslint-plugin';

export default [{
  plugins: { codepol },
  rules: {
    ...await providerRulesConfigGet('eslint'),
    // Your additional rules
    'no-console': 'warn',
  },
}];
```

Severity is read from `policy.json` per rule (default: `'error'`):

```json
{
  "rules": [
    {
      "ruleId": "@codepol/plugin/require-logger-enter-exit",
      "severity": "warn",
      "targets": ["typescript"]
    }
  ]
}
```

#### Filtering by Provider

Use `providers` to control which providers a rule applies to:

```json
{
  "rules": [
    {
      "ruleId": "@codepol/plugin/require-logger-enter-exit",
      "providers": ["tree-sitter"],
      "targets": ["typescript"]
    }
  ]
}
```

If `providers` is omitted or empty, the rule applies to all providers. This is useful when you want a rule to only run during `codepol check` (tree-sitter) but not in ESLint, or vice versa.

#### Manual ESLint Configuration

`providerRulesConfigGet` is a convenience helper, not a requirement. You can manually configure codepol rules in your ESLint config:

```javascript
// eslint.config.js
import codepol from '@codepol/eslint-plugin';

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
When using `codepol check`, the CLI generates rules from `policy.json` and passes them via ESLint's `overrideConfig`, which has **highest precedence**. This means rules defined in `policy.json` will use severity from `policy.json`, overriding your eslint.config.js settings for those same rules.

If you want full control over ESLint configuration, run ESLint directly instead of using `codepol check`.
:::

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
import { policyFileGet, policyRuleTargetsResolve } from '@codepol/core';

const policy = policyFileGet('./policy.json');

for (const rule of policy.rules) {
  const targets = policyRuleTargetsResolve(rule, policy);
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
import { policyFileGet, ruleMatchesGet } from '@codepol/core';

const policy = policyFileGet('./policy.json');
const matches = await ruleMatchesGet(policy, process.cwd());

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
import { policyFileGet, policyFileGetChecked } from '@codepol/core';

const policy = policyFileGet('./policy.json');
const covered = policyFileGetChecked(
  policy,
  '/path/to/file.ts',
  process.cwd()
);
```

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
  policyFileGet,
  policyPluginsGet,
  policyRuleTargetsResolve,
  policyViolationsGetForFile,
} from '@codepol/core';

const policy = policyFileGet('./policy.json');
const pluginsResult = await policyPluginsGet(policy, process.cwd());
if ('Err' in pluginsResult) {
  throw new Error(pluginsResult.Err);
}

const rule = policy.rules[0];
const targets = policyRuleTargetsResolve(rule, policy);
const target = targets[0];
const violationsResult = policyViolationsGetForFile(
  '/path/to/file.ts',
  rule,
  target,
  policy,
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
import { policyFileGet, policyViolationsGetFromDir } from '@codepol/core';

const policy = policyFileGet('./policy.json');
const violationsResult = await policyViolationsGetFromDir(policy, process.cwd());

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
  configPath: './config/codepol.config.ts',
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

### Tree-Check Adapter Types

The adapter layer enables converting `TreeCheckProvider` implementations into lint provider rules.
This is a provider-agnostic design: ESLint is the first supported platform, with Biome/Ruff/others
possible in the future.

#### LintDiagnostic

Platform-agnostic lint diagnostic that any lint provider can consume.

```typescript
type LintDiagnostic = {
  message: string;       // Human-readable message
  line: number;          // 1-based line number
  column: number;        // 1-based column number
  endLine?: number;      // Optional end line
  endColumn?: number;    // Optional end column
  ruleId: string;        // Rule ID that produced this diagnostic
  severity: 'error' | 'warning' | 'info';
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

## @codepol/eslint-plugin

### eslintPluginCreate

```typescript
import { eslintPluginCreate } from '@codepol/eslint-plugin';
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
import { eslintAdapter } from '@codepol/eslint-plugin';

const eslintAdapter: TreeCheckLintAdapter<TSESLint.RuleModule<string, unknown[]>>
```

**Properties:**

- `platform`: `'eslint'`
- `adapt(provider, options?)`: Converts a `CodepolPluginRule` to an ESLint rule

**Example:**

```typescript
import { eslintAdapter } from '@codepol/eslint-plugin';
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
import { eslintAdapterInit, eslintAdapter } from '@codepol/eslint-plugin';
import { policyFileGet, parserInit, langAdd } from '@codepol/core';
import { loggerEnterExitRule } from '@codepol/plugin';

// Initialize tree-sitter languages
langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
await parserInit();

// Initialize the provider
const policy = policyFileGet('./policy.json');
await eslintAdapterInit(loggerEnterExitRule, policy, process.cwd());

// Now the adapted rule will work without async init warnings
const rule = eslintAdapter.adapt(loggerEnterExitRule);
```

---

### policyCacheClear / providerInitStateClear

Utility functions for clearing cached state (useful for testing).

```typescript
import { policyCacheClear, providerInitStateClear } from '@codepol/eslint-plugin';

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
to get the ESLint rule options. Severity is defined in the config file per rule.

### policyCacheClear

Clears the policy file cache used by the logger plugin.

```typescript
import { policyCacheClear } from '@codepol/plugin';

policyCacheClear();
```

**Config file example:**

```typescript
// codepol.config.ts
import { defineConfig } from '@codepol/core';

export default defineConfig({
  plugins: ['@codepol/plugin'],
  targets: {
    'typescript-src': {
      language: 'typescript',
      files: ['src/**/*.ts'],
    },
  },
  rules: [
    {
      ruleId: '@codepol/plugin/require-logger-enter-exit',
      args: {
        logger: {
          identifier: 'logger',
          enterMethod: 'enter',
          exitMethod: 'exit',
          import: {
            module: '@org/logger',
            named: 'logger',
          },
        },
      },
      targets: ['typescript-src'],
    },
  ],
});
```

---

## @codepol/esbuild-plugin

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
import { esbuildPluginCreate } from '@codepol/esbuild-plugin';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  outdir: 'dist',
  plugins: [
    // Auto-discovers codepol.config.ts from project root
    esbuildPluginCreate(),
  ],
});
```

**Example (with explicit config):**

```typescript
plugins: [
  esbuildPluginCreate({
    configPath: './config/codepol.config.ts',
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
  policyFileGet,
  policyViolationsGetFromDir,
  policyViolationsGetOutputPretty,
  type PolicyViolation,
} from '@codepol/core';

async function main() {
  const policyPath = process.argv[2] || './policy.json';
  const policy = policyFileGet(policyPath);

  await parserInit();

  console.log(`Checking policy: ${policy.rules.map(r => r.id).join(', ')}`);

  const violationsResult = await policyViolationsGetFromDir(
    policy,
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
npx ts-node scripts/check-policy.ts ./policy.json
```
