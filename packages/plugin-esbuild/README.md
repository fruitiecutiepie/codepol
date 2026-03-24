# @codepol/plugin-esbuild

esbuild plugin for enforcing codepol policies during builds.

## Installation

```bash
pnpm add -D @codepol/plugin-esbuild @codepol/core @codepol/plugin-eslint esbuild eslint
```

## Features

- Runs policy checks during esbuild builds
- Fails the build if violations are found
- Optional auto-fix support
- Integrates both ESLint and Tree-sitter checks

## Usage

### Basic Setup

```typescript
import { build } from 'esbuild';
import { policyPlugin } from '@codepol/plugin-esbuild';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  outfile: 'dist/bundle.js',
  plugins: [policyPlugin()],
});
```

### With Options

```typescript
import { esbuildPluginCreate } from '@codepol/plugin-esbuild';

plugins: [
  esbuildPluginCreate({
    configPath: './config/codepol.toml',
    eslintConfigPath: './config/eslint.config.js',
    fix: false,
    cwd: process.cwd(),
  }),
]
```

### In Build Script

```typescript
// build.ts
import { build } from 'esbuild';
import { policyPlugin } from '@codepol/plugin-esbuild';

async function main() {
  try {
    await build({
      entryPoints: ['src/index.ts'],
      bundle: true,
      outdir: 'dist',
      plugins: [
        policyPlugin({
          fix: process.argv.includes('--fix'),
        }),
      ],
    });
    console.log('Build succeeded!');
  } catch (error) {
    console.error('Build failed due to policy violations');
    process.exit(1);
  }
}

main();
```

## Options

```typescript
type PolicyPluginOptions = {
  /** Path to config file (auto-discovered if not specified) */
  configPath?: string;

  /** Path to ESLint config file (uses config value or auto-detects) */
  eslintConfigPath?: string;

  /** Whether to apply ESLint fixes (default: false) */
  fix?: boolean;

  /** Working directory (default: esbuild's absWorkingDir or cwd) */
  cwd?: string;
};
```

## How It Works

1. The plugin runs during esbuild's `onStart` phase
2. It loads your `codepol.toml` configuration (auto-discovers or uses explicit path)
3. Collects all files matching the policy rules
4. Runs ESLint checks with the codepol ESLint rule
5. Runs Tree-sitter structural analysis
6. If violations are found:
   - Throws an error with detailed violation messages
   - esbuild fails the build
7. If `fix: true` is set:
   - ESLint auto-fixes are applied first
   - The check runs again to verify

## Example Output

When violations are found, the build fails with output like:

```text
✘ [ERROR] Policy enforcement failed

  src/utils.ts:15:1 Function processData is missing logger.enter & logger.exit [function-logging]
  src/api.ts:42:1 Function fetchUser is missing logger.enter & logger.exit [function-logging]

  Tree-sitter policy violations:
  src/helpers.ts:8:1 Function transform is missing logger.enter & logger.exit [function-logging]
```

## Integration with CI/CD

Add to your build script in `package.json`:

```json
{
  "scripts": {
    "build": "tsx build.ts",
    "build:fix": "tsx build.ts --fix"
  }
}
```

In CI:

```yaml
- name: Build
  run: pnpm build
```

## License

MIT
