#!/usr/bin/env node
/**
 * @packageDocumentation
 * @codepol/cli - Command-line interface for codepol policy enforcement.
 *
 * Usage:
 *   codepol [options]
 *
 * Options:
 *   --fix          Apply ESLint fixes where possible
 *   --watch        Run policy checks in watch mode
 *   --policy       Path to the policy file (default: ./policy.json)
 *   --eslint-config Path to the ESLint config file
 *   --help         Show help
 *   --version      Show version
 */

import path from 'node:path';
import chokidar from 'chokidar';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { ESLint } from 'eslint';
import {
  parserInit,
  policyFileGet,
  ruleMatchesGet,
  policyViolationsGetFromDir,
  policyViolationsGetOutputPretty,
  type PolicyFile,
  type PolicyViolation,
} from '@codepol/core';

type CliOptions = {
  fix: boolean;
  watch: boolean;
  policy: string;
  eslintConfig: string;
};

type PolicyCheckResult = {
  policy: PolicyFile;
  files: string[];
  eslintOutput: string;
  eslintHasErrors: boolean;
  violations: PolicyViolation[];
};

async function policyCheck(options: {
  policyPath: string;
  eslintConfigPath: string;
  fix: boolean;
  cwd: string;
}): Promise<PolicyCheckResult> {
  const { policyPath, eslintConfigPath, fix, cwd } = options;

  const policy = policyFileGet(policyPath);
  const matches = await ruleMatchesGet(policy, cwd);
  const files = Array.from(new Set(matches.flatMap(match => match.files)));

  const eslint = new ESLint({
    overrideConfigFile: eslintConfigPath,
    fix,
    cwd,
  });

  const lintResults = files.length > 0 ? await eslint.lintFiles(files) : [];
  if (fix) {
    await ESLint.outputFixes(lintResults);
  }
  const formatter = await eslint.loadFormatter('stylish');
  const eslintOutput = lintResults.length > 0 ? (await formatter.format(lintResults)).trim() : '';
  const eslintHasErrors = lintResults.some(result => result.errorCount > 0);

  const violationsResult = await policyViolationsGetFromDir(policy, cwd);

  if ('Err' in violationsResult) {
    // Error already logged in core
    throw new Error(violationsResult.Err);
  }

  return {
    policy,
    files,
    eslintOutput,
    eslintHasErrors,
    violations: violationsResult.Ok!,
  };
}

async function policyCheckAndPrintOutput(options: CliOptions): Promise<boolean> {
  const cwd = process.cwd();
  const result = await policyCheck({
    policyPath: options.policy,
    eslintConfigPath: options.eslintConfig,
    fix: options.fix,
    cwd,
  });

  const outputs: string[] = [];
  if (result.eslintOutput.length > 0) {
    outputs.push(result.eslintOutput);
  }
  const treeOutput = policyViolationsGetOutputPretty(result.violations, cwd);
  if (treeOutput) {
    outputs.push('Tree-sitter policy violations:');
    outputs.push(treeOutput);
  }

  if (outputs.length > 0) {
    console.log(outputs.join('\n\n'));
  } else {
    console.log('✔ Policy checks passed');
  }

  return !result.eslintHasErrors && result.violations.length === 0;
}

function fsSubNew(options: CliOptions, files: string[], patterns: string[]): void {
  const watchItems = new Set<string>([options.policy]);
  for (const file of files) {
    watchItems.add(file);
  }
  for (const pattern of patterns) {
    watchItems.add(path.resolve(pattern));
  }

  const watcher = chokidar.watch(Array.from(watchItems), {
    ignoreInitial: true,
  });

  let running = false;
  let pending = false;

  const policyChecksRunOnces = async () => {
    if (running) {
      pending = true;
      return;
    }
    running = true;
    console.log('\nRunning policy checks...');
    await policyCheckAndPrintOutput(options);
    running = false;
    if (pending) {
      pending = false;
      void policyChecksRunOnces();
    }
  };

  watcher.on('all', () => {
    void policyChecksRunOnces();
  });

  console.log('Watching for changes...');
  void policyChecksRunOnces();
}

async function main(): Promise<void> {
  await parserInit();

  const argv = await yargs(hideBin(process.argv))
    .scriptName('codepol')
    .usage('$0 [options]')
    .option('fix', {
      type: 'boolean',
      default: false,
      describe: 'Apply ESLint fixes where possible',
    })
    .option('watch', {
      type: 'boolean',
      default: false,
      describe: 'Run policy checks in watch mode',
    })
    .option('policy', {
      type: 'string',
      default: path.resolve('policy.json'),
      describe: 'Path to the policy file',
    })
    .option('eslint-config', {
      type: 'string',
      default: path.resolve('eslint.config.js'),
      describe: 'Path to the ESLint config file',
    })
    .example('$0', 'Run policy checks once')
    .example('$0 --fix', 'Run checks and apply fixes')
    .example('$0 --watch', 'Watch for changes and re-run checks')
    .example('$0 --policy ./config/policy.json', 'Use custom policy file')
    .help()
    .version()
    .parseAsync();

  const options: CliOptions = {
    fix: argv.fix ?? false,
    watch: argv.watch ?? false,
    policy: path.resolve(argv.policy as string),
    eslintConfig: path.resolve(argv['eslint-config'] as string),
  };

  const policy = policyFileGet(options.policy);
  const matches = await ruleMatchesGet(policy, process.cwd());
  const files = Array.from(new Set(matches.flatMap(match => match.files)));
  const patterns = Array.from(new Set(policy.rules.flatMap(rule => rule.files)));

  if (options.watch) {
    fsSubNew(options, files, patterns);
  } else {
    const success = await policyCheckAndPrintOutput(options);
    if (!success) {
      process.exitCode = 1;
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
