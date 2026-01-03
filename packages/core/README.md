# @codepol/core

Core policy loading, web-tree-sitter (WASM) scanning, and enforcement for codepol.

## Installation

```bash
pnpm add @codepol/core
```

## Features

- Load and parse `policy.json` configuration files
- Scan TypeScript files using web-tree-sitter (WASM) for structural analysis
- No native dependencies - works across all platforms
- Detect missing logger instrumentation patterns
- Format violations for display

## Usage

### Initializing the Parser

Before scanning files, you must initialize the WASM parser:

```typescript
import { initParser } from '@codepol/core';

// Call once at application startup
await initParser();
```

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
import { initParser, loadPolicy, scanWithPolicy, formatTreeViolations } from '@codepol/core';

await initParser();

const policy = loadPolicy('./policy.json');
const violations = await scanWithPolicy(policy, process.cwd());

if (violations.length > 0) {
  console.log(formatTreeViolations(violations, process.cwd()));
  process.exit(1);
}
```

### Scanning a Single File

```typescript
import { initParser, scanFileForViolations } from '@codepol/core';

await initParser();

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
import { initParser, runPolicyChecks, formatTreeViolations } from '@codepol/core';

await initParser();

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
| `initParser()` | Initialize the WASM parser (must be called before scanning) |
| `isParserInitialized()` | Check if the parser has been initialized |
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
