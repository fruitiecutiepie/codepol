# API Reference

Programmatic API for integrating codepol into your tools and scripts.

## @codepol/core

The core package provides policy loading, scanning, and formatting utilities.

### Installation

```bash
pnpm add @codepol/core
```

### Types

```typescript
import type {
  PolicyFile,
  PolicyRule,
  PolicyRuleSemantics,
  PolicyRuleTarget,
  PolicyRuleTargetContext,
  LoggerConfig,
  LoggerImportConfig,
  PolicyViolation,
  TreeScanProvider,
  PolicyPluginCapabilities,
  CodepolRulePlugin,
  CodepolPlugin,
  PolicyPluginsMap,
  EslintRuleProvider,
  FixProvider,
  RuleMatch,
  PolicyCheckOptions,
  PolicyCheckResult,
  PolicyPluginRuleDeclaration,
} from '@codepol/core';
```

Policy rules split semantics (meaning) from language targets. `PolicyRuleSemantics` defines the shared intent
(description and plugin type), while `PolicyRuleTarget` declares the language adapter or parser plus its file globs.
This lets a single rule id apply across multiple languages without duplicating the rule meaning.

---

### policyFileGet

Loads and parses a policy.json file.

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
console.log(policy.logger.identifier);
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

Scans a single file for policy violations using Tree-sitter.

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
  policyViolationsGetForFile,
} from '@codepol/core';

const policy = policyFileGet('./policy.json');
const pluginsResult = await policyPluginsGet(policy, process.cwd());
if ('Err' in pluginsResult) {
  throw new Error(pluginsResult.Err);
}

const rule = policy.rules[0];
const target = rule.targets[0];
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

Scans all files matching the policy for violations.

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

Runs complete policy checks (Tree-sitter scanning).

```typescript
function policyCheck(
  options: PolicyCheckOptions
): Promise<Result<PolicyCheckResult, string>>
```

**Parameters:**

```typescript
type PolicyCheckOptions = {
  policyPath: string;
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

const result = await policyCheck({
  policyPath: './policy.json',
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

## @codepol/eslint-plugin

### Plugin Object

```typescript
import plugin from '@codepol/eslint-plugin';

// plugin.rules['require-logger-enter-exit']
```

The ESLint plugin is a thin adapter that re-exports rules from capability plugins like `@codepol/plugin-logger`.

---

## @codepol/plugin-logger

### Rule Plugins

```typescript
import { loggerEnterExitRule, rulePlugins } from '@codepol/plugin-logger';

// loggerEnterExitRule.id === 'require-logger-enter-exit'
// loggerEnterExitRule.capabilities?.eslintRuleProvider
// rulePlugins (array for convenience)
```

Use `eslintRuleProvider.rulesConfigGet({ policy, policyPath, cwd, ruleId, ruleOptions })` to build ESLint rule
configurations that match your policy file and per-rule options.

**Policy configuration example:**

```json
{
  "plugins": [
    {
      "module": "@codepol/plugin-logger",
      "rules": [
        {
          "id": "require-logger-enter-exit",
          "enabled": true,
          "options": { "policyPath": "./policy.json" }
        }
      ]
    }
  ]
}
```

### clearPolicyCache (ESLint Plugin)

Clears the ESLint plugin's policy cache.

```typescript
import { clearPolicyCache } from '@codepol/eslint-plugin';

clearPolicyCache();
```

---

## @codepol/esbuild-plugin

### policyPlugin

Creates an esbuild plugin for policy enforcement.

```typescript
function policyPlugin(options?: PolicyPluginOptions): Plugin
```

**Parameters:**

```typescript
type PolicyPluginOptions = {
  policyPath?: string;       // Default: './policy.json'
  eslintConfigPath?: string; // Default: './.eslintrc.cjs'
  fix?: boolean;             // Default: false
  cwd?: string;              // Default: esbuild's absWorkingDir or cwd
};
```

**Returns:** esbuild Plugin

**Example:**

```typescript
import { build } from 'esbuild';
import { policyPlugin } from '@codepol/esbuild-plugin';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  outdir: 'dist',
  plugins: [
    policyPlugin({
      policyPath: './policy.json',
      fix: false,
    }),
  ],
});
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
