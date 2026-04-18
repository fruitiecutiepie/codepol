# @codepol/core

Core policy loading, web-tree-sitter (WASM) checking, and enforcement for codepol.

## Installation

```bash
pnpm add @codepol/core
```

## Features

- Load and parse codepol config files (`codepol.toml`)
- Check TypeScript files using web-tree-sitter (WASM) for structural analysis
- No native dependencies - works across all platforms
- Detect missing logger instrumentation patterns
- Format violations for display
- Extensible language registration system

## Usage

### Registering Languages and Initializing the Parser

Before checking files, you must register languages and initialize the WASM parser:

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

### Loading Config

```typescript
import { configGet, ruleMatchesGet } from '@codepol/core';

// Load the config file (auto-discovers codepol.toml)
const { config } = await configGet();

// Get files matching each rule
const matches = await ruleMatchesGet(config, process.cwd());
for (const match of matches) {
  console.log(`Rule ${match.rule.id}: ${match.files.length} files`);
}
```

### Checking for Violations

```typescript
import {
  langAdd,
  parserInit,
  configGet,
  policyViolationsGetFromDir,
  policyViolationsGetOutputPretty,
} from '@codepol/core';

langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
langAdd({ langId: 'tsx', fileExtensions: ['.tsx'] });
await parserInit();

const { config } = await configGet();
const result = await policyViolationsGetFromDir(config, process.cwd());

if ('Err' in result) {
  console.error(result.Err);
  process.exit(1);
}

if (result.Ok.length > 0) {
  console.log(policyViolationsGetOutputPretty(result.Ok, process.cwd()));
  process.exit(1);
}
```

### Runtime diagnostics

Business code in `@codepol/core` depends on a `Diagnostics` / `ExecutionContext`
interface, never on an environment name. The runtime singleton resolves the
effective policy per call from the active preset (`user` / `dev` / `test` /
`verbose`), layered overrides, and any active escalations.

Typical injection pattern when writing a parser / adapter:

```typescript
import {
  executionContextCreate,
  parserGetForFile,
  parserParseTrace,
} from '@codepol/core';

const parserResult = parserGetForFile(filePath);
if ('Err' in parserResult) {
  throw new Error(parserResult.Err);
}

const ctx = executionContextCreate('parser.myAdapter');
const tree = parserParseTrace(parserResult.Ok, source, ctx.diag, {
  filePath,
  callSite: 'myAdapter',
});
```

Application wiring (CLI / LSP / daemon / tests) picks the environment once and
layers overrides or time-bounded escalations on top:

```typescript
import {
  diagnosticsRuntimeSetConfig,
  diagnosticsRuntimeEscalate,
} from '@codepol/core';

diagnosticsRuntimeSetConfig({
  environment: 'dev',
  overrides: { sinks: ['console', 'file'], logFilePath: '/tmp/codepol.log' },
});

const escalation = diagnosticsRuntimeEscalate({
  scope: { kind: 'scope', scope: 'parser' },
  level: 'trace',
  ttlMs: 10 * 60 * 1000,
  reason: 'reproduce_wasm_abort',
  actor: 'spec',
});
// ... later ...
escalation.revoke();
```

See [src/diagnostics/README.md](./src/diagnostics/README.md) for the full
model (shipped capabilities, policy resolution order, redaction pipeline,
sink pipeline) and [api-reference.md](../../docs/api-reference.md#runtime-diagnostics)
for the typed API surface.

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

// Auto-discovers codepol.toml
const result = await policyCheck({});

// Or with explicit config path
// const result = await policyCheck({ configPath: './config/codepol.toml' });

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
| `parserGetForFile(filePath)` | Return a `Parser` configured for `filePath`'s registered language |
| `parserParseTrace(parser, source, diag, context)` | `parser.parse(source)` wrapped with structured diagnostics events |
| `configGet(cwd?)` | Auto-discover and load codepol.toml |
| `configGetFromPath(path)` | Load config from explicit path |
| `policyFileGet(path)` | (deprecated) Load JSON config file |
| `policyFileGetChecked(policy, filePath, cwd)` | Check if a file is covered by the policy |
| `ruleMatchesGet(policy, cwd)` | Get files matching each rule |
| `globPatternsGetMatchAny(patterns, path)` | Check if path matches any glob pattern |
| `policyViolationsGetForFile(filePath, rule, target, policy, pluginsMap, dir)` | Check a single file for violations |
| `policyViolationsGetFromDir(policy, cwd)` | Check all matching files in a directory |
| `policyCheck(options)` | Run complete policy checks |
| `policyViolationsGetOutputPretty(violations, cwd)` | Format violations as string |

### Runtime diagnostics functions

| Function | Description |
| -------- | ----------- |
| `diagnosticsGet(scope, opts?)` | Acquire a `Diagnostics` handle bound to the current effective policy |
| `executionContextCreate(scope, opts?)` | Build an `ExecutionContext` with `{ diag, clock, checks, requestId, workspaceId? }` |
| `diagnosticsRuntimeGet()` | Access the process-wide `DiagnosticsRuntime` singleton |
| `diagnosticsRuntimeGetConfig()` | Read the current stored `DiagnosticsConfig` (environment, overrides, escalations) |
| `diagnosticsRuntimeGetEffectivePolicy(opts?)` | Resolve the effective policy for a given scope / requestId / workspaceId |
| `diagnosticsRuntimeSetEnvironment(name)` | Switch to a preset (`user` / `dev` / `test` / `verbose`) |
| `diagnosticsRuntimeSetOverrides(patch)` | Overlay a `DiagnosticsOverridePatch` on the current preset |
| `diagnosticsRuntimeSetConfig(patch)` | Apply environment + overrides + escalations atomically |
| `diagnosticsRuntimeEscalate(rule)` | Add a time-bounded `EscalationRule`; returns `{ id, expiresAtUnixMs, revoke() }` |
| `diagnosticsRuntimeRevokeEscalation(id)` | Revoke an escalation by id |
| `diagnosticsRuntimeListEscalations()` | List active (non-expired) escalations |

### Runtime diagnostics types

`Diagnostics`, `ExecutionContext`, `EnvironmentName`, `EnvironmentPreset`,
`RuntimeDiagnosticsPolicy`, `DiagnosticsOverridePatch`, `DiagnosticsConfig`,
`DiagnosticsConfigPatch`, `EffectiveDiagnosticsPolicy`,
`ShippedDebugCapabilities`, `EscalationRule`, `EscalationScope`,
`EscalationHandle`, `EscalationRuleInput`, `TracingPolicy`, `MetricsPolicy`,
`SnapshotsPolicy`, `ChecksPolicy`, `RedactionPolicy`, `DiagnosticSinkKind`,
`LogLevel`. See
[docs/api-reference.md#runtime-diagnostics](../../docs/api-reference.md#runtime-diagnostics)
for shapes and [src/diagnostics/README.md](./src/diagnostics/README.md) for
the architectural model.

## License

MIT
