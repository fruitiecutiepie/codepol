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
  LoggerConfig,
  LoggerImportConfig,
  PolicyViolation,
  TreeScanProvider,
  PolicyPluginCapabilities,
  CodepolPlugin,
  EslintRuleProvider,
  FixProvider,
  RuleMatch,
  PolicyCheckOptions,
  PolicyCheckResult,
} from '@codepol/core';
```

---

### loadPolicy

Loads and parses a policy.json file.

```typescript
function loadPolicy(policyPath: string): PolicyFile
```

**Parameters:**

- `policyPath`: Path to the policy.json file (absolute or relative)

**Returns:** Parsed PolicyFile object

**Example:**

```typescript
import { loadPolicy } from '@codepol/core';

const policy = loadPolicy('./policy.json');
console.log(policy.rules.length);
console.log(policy.logger.identifier);
```

---

### clearPolicyCache (Core)

Clears the internal policy cache. Useful for testing or when policy files change.

```typescript
function clearPolicyCache(): void
```

**Example:**

```typescript
import { clearPolicyCache } from '@codepol/core';

clearPolicyCache();
```

---

### collectRuleMatches

Collects all files matching each policy rule.

```typescript
function collectRuleMatches(
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
import { loadPolicy, collectRuleMatches } from '@codepol/core';

const policy = loadPolicy('./policy.json');
const matches = await collectRuleMatches(policy, process.cwd());

for (const match of matches) {
  console.log(`Rule: ${match.rule.id}`);
  console.log(`Files: ${match.files.length}`);
}
```

---

### isFileCovered

Determines if a file should be checked against the policy.

```typescript
function isFileCovered(
  policy: PolicyFile,
  filePath: string,
  cwd?: string
): boolean
```

**Parameters:**

- `policy`: The loaded policy object
- `filePath`: Absolute path to the file
- `cwd`: Working directory (default: `process.cwd()`)

**Returns:** `true` if the file should be checked

**Example:**

```typescript
import { loadPolicy, isFileCovered } from '@codepol/core';

const policy = loadPolicy('./policy.json');
const covered = isFileCovered(policy, '/path/to/file.ts');
```

---

### scanFileForViolations

Scans a single file for policy violations using Tree-sitter.

```typescript
function scanFileForViolations(
  filePath: string,
  rule: PolicyRule,
  logger: LoggerConfig
): PolicyViolation[]
```

**Parameters:**

- `filePath`: Absolute path to the file
- `rule`: The policy rule being checked
- `logger`: Logger configuration from the policy

**Returns:** Array of violations found

**Example:**

```typescript
import { scanFileForViolations } from '@codepol/core';

const violations = scanFileForViolations(
  '/path/to/file.ts',
  {
    id: 'my-rule',
    description: 'My rule',
    language: 'typescript',
    files: ['**/*.ts'],
  },
  {
    identifier: 'logger',
    enterMethod: 'enter',
    exitMethod: 'exit',
    import: { module: '@org/logger', named: 'logger' },
  }
);
```

---

### scanWithPolicy

Scans all files matching the policy for violations.

```typescript
function scanWithPolicy(
  policy: PolicyFile,
  cwd: string
): Promise<PolicyViolation[]>
```

**Parameters:**

- `policy`: The loaded policy object
- `cwd`: Working directory for resolving patterns

**Returns:** Array of all violations found

**Example:**

```typescript
import { loadPolicy, scanWithPolicy } from '@codepol/core';

const policy = loadPolicy('./policy.json');
const violations = await scanWithPolicy(policy, process.cwd());

for (const v of violations) {
  console.log(`${v.filePath}:${v.line}:${v.column} - ${v.message}`);
}
```

---

### runPolicyChecks

Runs complete policy checks (Tree-sitter scanning).

```typescript
function runPolicyChecks(
  options?: PolicyCheckOptions
): Promise<PolicyCheckResult>
```

**Parameters:**

```typescript
type PolicyCheckOptions = {
  policyPath?: string;  // Default: './policy.json'
  cwd?: string;         // Default: process.cwd()
};
```

**Returns:**

```typescript
type PolicyCheckResult = {
  policy: PolicyFile;
  files: string[];
  treeViolations: PolicyViolation[];
};
```

**Example:**

```typescript
import { runPolicyChecks, formatTreeViolations } from '@codepol/core';

const result = await runPolicyChecks({
  policyPath: './policy.json',
});

console.log(`Checked ${result.files.length} files`);
console.log(`Found ${result.treeViolations.length} violations`);

if (result.treeViolations.length > 0) {
  console.log(formatTreeViolations(result.treeViolations, process.cwd()));
}
```

---

### formatTreeViolations

Formats violations into a human-readable string.

```typescript
function formatTreeViolations(
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
import { formatTreeViolations } from '@codepol/core';

const output = formatTreeViolations(violations, process.cwd());
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

### Plugin Capabilities

```typescript
import plugin, { eslintRuleProvider } from '@codepol/plugin-logger';

// plugin.capabilities.treeScanProvider
// plugin.capabilities.eslintRuleProvider
```

Use `eslintRuleProvider.rulesConfigGet({ policy, policyPath, cwd })` to build ESLint rule configurations that
match your policy file.

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
  loadPolicy,
  scanWithPolicy,
  formatTreeViolations,
  type PolicyViolation,
} from '@codepol/core';

async function main() {
  const policyPath = process.argv[2] || './policy.json';
  const policy = loadPolicy(policyPath);

  console.log(`Checking policy: ${policy.rules.map(r => r.id).join(', ')}`);

  const violations = await scanWithPolicy(policy, process.cwd());

  if (violations.length === 0) {
    console.log('✔ All checks passed!');
    return;
  }

  console.log(`\n✖ Found ${violations.length} violation(s):\n`);
  console.log(formatTreeViolations(violations, process.cwd()));

  // Group by rule
  const byRule = violations.reduce((acc, v) => {
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
