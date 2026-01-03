# @codepol/core

Core policy loading, Tree-sitter scanning, and enforcement for codepol.

## Installation

```bash
pnpm add @codepol/core tree-sitter tree-sitter-typescript
```

## Features

- Load and parse `policy.json` configuration files
- Scan TypeScript files using Tree-sitter for structural analysis
- Detect missing logger instrumentation patterns
- Format violations for display

## Usage

### Loading a Policy

```typescript
import { loadPolicy, collectRuleMatches } from '@codepol/core';

// Load the policy file
const policy = loadPolicy('./policy.json');

// Get files matching each rule
const matches = await collectRuleMatches(policy, process.cwd());
for (const match of matches) {
  console.log(`Rule ${match.rule.id}: ${match.files.length} files`);
}
```

### Scanning for Violations

```typescript
import { loadPolicy, scanWithPolicy, formatTreeViolations } from '@codepol/core';

const policy = loadPolicy('./policy.json');
const violations = await scanWithPolicy(policy, process.cwd());

if (violations.length > 0) {
  console.log(formatTreeViolations(violations, process.cwd()));
  process.exit(1);
}
```

### Scanning a Single File

```typescript
import { scanFileForViolations } from '@codepol/core';

const violations = scanFileForViolations(
  '/path/to/file.ts',
  {
    id: 'my-rule',
    description: 'My rule',
    language: 'typescript',
    files: ['src/**/*.ts'],
  },
  {
    identifier: 'logger',
    enterMethod: 'enter',
    exitMethod: 'exit',
    import: { module: '@org/logger', named: 'logger' },
  }
);
```

### Running Full Policy Checks

```typescript
import { runPolicyChecks, formatTreeViolations } from '@codepol/core';

const result = await runPolicyChecks({
  policyPath: './policy.json',
  cwd: process.cwd(),
});

console.log(`Checked ${result.files.length} files`);
console.log(`Found ${result.treeViolations.length} violations`);
```

## API Reference

### Types

```typescript
interface LoggerImportConfig {
  module: string;  // e.g., '@org/logger'
  named: string;   // e.g., 'logger'
}

interface LoggerConfig {
  identifier: string;   // e.g., 'logger'
  enterMethod: string;  // e.g., 'enter'
  exitMethod: string;   // e.g., 'exit'
  import: LoggerImportConfig;
}

interface PolicyRule {
  id: string;
  description: string;
  language: 'typescript' | 'tsx';
  files: string[];
  exclude?: string[];
}

interface PolicyFile {
  $schema?: string;
  rules: PolicyRule[];
  exclude?: string[];
  logger: LoggerConfig;
}

interface PolicyViolation {
  ruleId: string;
  filePath: string;
  message: string;
  line: number;
  column: number;
}
```

### Functions

| Function | Description |
| -------- | ----------- |
| `loadPolicy(path)` | Load and parse a policy.json file |
| `clearPolicyCache()` | Clear the internal policy cache |
| `collectRuleMatches(policy, cwd)` | Get files matching each rule |
| `isFileCovered(policy, filePath, cwd)` | Check if a file is covered by the policy |
| `scanFileForViolations(file, rule, logger)` | Scan a single file |
| `scanWithPolicy(policy, cwd)` | Scan all matching files |
| `runPolicyChecks(options)` | Run complete policy checks |
| `formatTreeViolations(violations, cwd)` | Format violations as string |

## License

MIT
