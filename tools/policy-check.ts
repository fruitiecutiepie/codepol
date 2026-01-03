import path from 'path';
import chokidar from 'chokidar';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { collectRuleMatches, loadPolicy } from './policy-scan';
import { formatTreeViolations, runPolicyChecks } from './policy-runner';

interface CliOptions {
  fix: boolean;
  watch: boolean;
  policy: string;
}

async function runOnce(options: CliOptions): Promise<boolean> {
  const result = await runPolicyChecks({
    policyPath: options.policy,
    fix: options.fix,
  });

  const outputs: string[] = [];
  if (result.eslintOutput.length > 0) {
    outputs.push(result.eslintOutput);
  }
  const treeOutput = formatTreeViolations(result.treeViolations, process.cwd());
  if (treeOutput) {
    outputs.push('Tree-sitter policy violations:');
    outputs.push(treeOutput);
  }

  if (outputs.length > 0) {
    console.log(outputs.join('\n\n'));
  } else {
    console.log('✔ Policy checks passed');
  }

  return !result.eslintHasErrors && result.treeViolations.length === 0;
}

function createWatcher(options: CliOptions, files: string[], patterns: string[]): void {
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

  const execute = async () => {
    if (running) {
      pending = true;
      return;
    }
    running = true;
    console.log('Running policy checks...');
    await runOnce(options);
    running = false;
    if (pending) {
      pending = false;
      void execute();
    }
  };

  watcher.on('all', () => {
    void execute();
  });

  void execute();
}

async function main(): Promise<void> {
  const argv = await yargs(hideBin(process.argv))
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
    .help(false)
    .version(false)
    .parseAsync();

  const options: CliOptions = {
    fix: argv.fix ?? false,
    watch: argv.watch ?? false,
    policy: path.resolve(argv.policy as string),
  };

  const policy = loadPolicy(options.policy);
  const matches = await collectRuleMatches(policy, process.cwd());
  const files = Array.from(new Set(matches.flatMap(match => match.files)));
  const patterns = Array.from(new Set(policy.rules.flatMap(rule => rule.files)));

  if (options.watch) {
    createWatcher(options, files, patterns);
  } else {
    const success = await runOnce(options);
    if (!success) {
      process.exitCode = 1;
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
