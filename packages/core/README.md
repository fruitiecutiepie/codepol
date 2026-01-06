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
- Extensible language registration system

## Usage

### Registering Languages and Initializing the Parser

Before scanning files, you must register languages and initialize the WASM parser:

```typescript
import { langAdd, parserInit } from '@codepol/core';

// Register languages (uses bundled WASM by default)
langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
langAdd({ langId: 'tsx', fileExtensions: ['.tsx'] });

// Initialize the parser (call once at application startup)
await parserInit();
```

You can also provide a custom WASM path:

```typescript
import { langAdd, wasmPathGet, parserInit } from '@codepol/core';

// Use bundled WASM with custom grammar name
langAdd({
  langId: 'javascript',
  wasmPath: wasmPathGet('tree-sitter-javascript'),
  fileExtensions: ['.js', '.mjs'],
});

// Or use a completely custom path
langAdd({
  langId: 'python',
  wasmPath: '/path/to/tree-sitter-python.wasm',
  fileExtensions: ['.py'],
});

await parserInit();
```

### Loading a Policy

```typescript
import { policyFileGet, ruleMatchesGet } from '@codepol/core';

// Load the policy file
const policy = policyFileGet('./policy.json');

// Get files matching each rule
const matches = await ruleMatchesGet(policy, process.cwd());
for (const match of matches) {
  console.log(`Rule ${match.rule.id}: ${match.files.length} files`);
}
```

### Scanning for Violations

```typescript
import {
  langAdd,
  parserInit,
  policyFileGet,
  policyViolationsGetFromDir,
  policyViolationsGetOutputPretty,
} from '@codepol/core';

langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
langAdd({ langId: 'tsx', fileExtensions: ['.tsx'] });
await parserInit();

const policy = policyFileGet('./policy.json');
const result = await policyViolationsGetFromDir(policy, process.cwd());

if ('Err' in result) {
  console.error(result.Err);
  process.exit(1);
}

if (result.Ok.length > 0) {
  console.log(policyViolationsGetOutputPretty(result.Ok, process.cwd()));
  process.exit(1);
}
```

### Running Full Policy Checks

```typescript
import {
  langAdd,
  parserInit,
  policyCheck,
  policyViolationsGetOutputPretty,
} from '@codepol/core';

langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
langAdd({ langId: 'tsx', fileExtensions: ['.tsx'] });
await parserInit();

const result = await policyCheck({
  policyPath: './policy.json',
  cwd: process.cwd(),
});

if ('Err' in result) {
  console.error(result.Err);
  process.exit(1);
}

console.log(`Checked ${result.Ok.files.length} files`);
console.log(`Found ${result.Ok.treeViolations.length} violations`);

if (result.Ok.treeViolations.length > 0) {
  console.log(
    policyViolationsGetOutputPretty(result.Ok.treeViolations, process.cwd())
  );
}
```

## API Reference

### API naming note

`@codepol/core` exports `policyFileGet`-style names (`policyFileGet`, `ruleMatchesGet`,
`policyViolationsGetFromDir`, etc.). If you rely on `loadPolicy`-style names in existing code, update your imports
to the canonical names listed below.

### Types

```typescript
type Lang = {
  langId: string;
  wasmPath?: string;  // Uses bundled wasm/tree-sitter-{langId}.wasm if omitted
  fileExtensions: string[];
};

type LoggerImportConfig = {
  module: string;  // e.g., '@org/logger'
  named: string;   // e.g., 'logger'
};

type LoggerConfig = {
  identifier: string;   // e.g., 'logger'
  enterMethod: string;  // e.g., 'enter'
  exitMethod: string;   // e.g., 'exit'
  import: LoggerImportConfig;
};

type PolicyRule = {
  id: string;
  semantics: PolicyRuleSemantics;
  targets: PolicyRuleTarget[];
};

type PolicyRuleSemantics = {
  description: string;
  type?: string;
};

type PolicyRuleTarget = {
  language: string;
  parser?: string;
  files: string[];
  exclude?: string[];
};

type PolicyFile = {
  $schema?: string;
  rules: PolicyRule[];
  exclude?: string[];
  plugins?: PolicyPluginDeclaration[];
};

type PolicyViolation = {
  ruleId: string;
  filePath: string;
  message: string;
  line: number;
  column: number;
};
```

### Functions

| Function | Description |
| -------- | ----------- |
| `langAdd(registration)` | Register a language for parsing |
| `langsGet()` | Get all registered languages |
| `wasmPathGet(grammarName)` | Get path to bundled WASM file |
| `parserInit()` | Initialize the WASM parser (must be called after registering languages) |
| `policyFileGet(path)` | Load and parse a policy.json file |
| `policyFileGetChecked(policy, filePath, cwd)` | Check if a file is covered by the policy |
| `ruleMatchesGet(policy, cwd)` | Get files matching each rule |
| `globPatternsGetMatchAny(patterns, path)` | Check if path matches any glob pattern |
| `policyViolationsGetForFile(filePath, rule, target, policy, pluginsMap, dir)` | Scan a single file for violations |
| `policyViolationsGetFromDir(policy, cwd)` | Scan all matching files in a directory |
| `policyCheck(options)` | Run complete policy checks |
| `policyViolationsGetOutputPretty(violations, cwd)` | Format violations as string |

## License

MIT
