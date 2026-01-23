# @codepol/cli

Command-line interface for running codepol policy checks.

## Installation

```bash
# Global installation
pnpm add -g @codepol/cli

# Or as dev dependency
pnpm add -D @codepol/cli
```

## Usage

### Basic Check

```bash
codepol
```

Runs policy checks once and exits with code 1 if violations are found.

### Auto-Fix

```bash
codepol --fix
```

Applies ESLint auto-fixes to add missing logger instrumentation.

### Watch Mode

```bash
codepol --watch
```

Watches for file changes and re-runs checks automatically.

### Custom Config Path

```bash
codepol --config ./config/codepol.config.ts
```

### Custom ESLint Config

```bash
codepol --eslint-config ./config/eslint.config.js
```

## Options

| Option | Description | Default |
| ------ | ----------- | ------- |
| `--fix` | Apply ESLint fixes where possible | `false` |
| `--watch` | Run in watch mode | `false` |
| `--config` | Path to config file | auto-discovered |
| `--eslint-config` | Path to ESLint config | auto-detected |
| `--check-plugins` | Validate plugins and exit | `false` |
| `--help` | Show help | |
| `--version` | Show version | |

## Examples

```bash
# Run checks (auto-discovers codepol.config.ts)
codepol

# Fix violations and watch for changes
codepol --fix --watch

# Use custom configuration
codepol --config ./config/codepol.config.ts --eslint-config ./eslint.config.js

# Validate plugins
codepol --check-plugins

# Show help
codepol --help
```

## Output

### Passing

```text
✔ Policy checks passed
```

### Failing

```text
/path/to/file.ts
  15:1  error  Functions must invoke logger.enter and logger.exit  codepol/require-logger-enter-exit

Tree-sitter policy violations:
src/utils.ts:23:1 Function helper is missing logger.enter & logger.exit [function-logging]
```

## NPM Scripts Integration

Add to your `package.json`:

```json
{
  "scripts": {
    "lint:policy": "codepol",
    "lint:policy:fix": "codepol --fix",
    "lint:policy:watch": "codepol --watch"
  }
}
```

## CI Integration

```yaml
# GitHub Actions
- name: Check Policy
  run: npx codepol

# GitLab CI
policy-check:
  script:
    - npx codepol
```

## Exit Codes

| Code | Meaning                              |
| ---- | ------------------------------------ |
| 0    | All checks passed                    |
| 1    | Violations found or error occurred   |

## License

MIT
