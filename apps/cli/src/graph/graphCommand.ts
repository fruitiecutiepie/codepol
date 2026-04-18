/**
 * Wire `codepol graph <subcommand>` into the top-level yargs CLI.
 *
 * One file per subcommand keeps the router trivial — this module just
 * maps yargs args to the subcommand runners and owns the config
 * resolution that graph commands share with `codepol`.
 */
import type { Argv, CommandModule } from 'yargs';
import { configGet, configGetFromPath } from '@codepol/core';
import type { WorkspaceImpactRadiusDirection } from '@codepol/core';
import { graphCyclesRun } from './graphCycles';
import { graphDeadRun } from './graphDead';
import { graphExportRun } from './graphExport';
import { graphFanInRun } from './graphFanIn';
import { graphFanOutRun } from './graphFanOut';
import { graphImpactRun } from './graphImpact';
import { graphPathRun } from './graphPath';

type GraphCommonArgs = {
  config?: string;
};

type GraphResolvedConfig = {
  cwd: string;
  configPath: string;
};

async function graphConfigResolve(args: GraphCommonArgs): Promise<GraphResolvedConfig> {
  const cwd = process.cwd();
  const { configPath } = args.config
    ? await configGetFromPath(args.config)
    : await configGet(cwd);
  return { cwd, configPath };
}

function graphCommonOptions(yargs: Argv): Argv<GraphCommonArgs> {
  return yargs.option('config', {
    type: 'string',
    describe: 'Path to codepol.toml (auto-discovered when omitted)',
  }) as Argv<GraphCommonArgs>;
}

function graphFormatOption(yargs: Argv): Argv {
  return yargs.option('format', {
    type: 'string',
    choices: ['json', 'text'] as const,
    default: 'json',
    describe: 'Output format',
  });
}

const graphExportCommand: CommandModule<GraphCommonArgs, GraphCommonArgs & { format: string }> = {
  command: 'export',
  describe: 'Emit the full workspace dependency graph as JSON',
  builder: (yargs) => graphFormatOption(yargs) as unknown as Argv<GraphCommonArgs & { format: string }>,
  handler: async (args) => {
    const resolved = await graphConfigResolve(args);
    const exitCode = await graphExportRun({
      cwd: resolved.cwd,
      configPath: resolved.configPath,
      format: args.format,
    });
    if (exitCode !== 0) process.exitCode = exitCode;
  },
};

const graphCyclesCommand: CommandModule<
  GraphCommonArgs,
  GraphCommonArgs & { format: string; max?: number }
> = {
  command: 'cycles',
  describe: 'List dependency cycles; exits non-zero when any cycle exists',
  builder: (yargs) =>
    graphFormatOption(yargs).option('max', {
      type: 'number',
      describe: 'Maximum number of cycles to report (default: unbounded)',
    }) as unknown as Argv<GraphCommonArgs & { format: string; max?: number }>,
  handler: async (args) => {
    const resolved = await graphConfigResolve(args);
    const exitCode = await graphCyclesRun({
      cwd: resolved.cwd,
      configPath: resolved.configPath,
      format: args.format,
      max: args.max,
    });
    if (exitCode !== 0) process.exitCode = exitCode;
  },
};

const graphPathCommand: CommandModule<
  GraphCommonArgs,
  GraphCommonArgs & { from: string; to: string; format: string; 'max-paths'?: number }
> = {
  command: 'path <from> <to>',
  describe: 'Emit simple dependency paths from <from> to <to>',
  builder: (yargs) =>
    graphFormatOption(yargs)
      .positional('from', {
        type: 'string',
        describe: 'Source file (relative to cwd or absolute)',
        demandOption: true,
      })
      .positional('to', {
        type: 'string',
        describe: 'Destination file (relative to cwd or absolute)',
        demandOption: true,
      })
      .option('max-paths', {
        type: 'number',
        describe: 'Cap simple path enumeration (default: 5)',
      }) as unknown as Argv<
      GraphCommonArgs & { from: string; to: string; format: string; 'max-paths'?: number }
    >,
  handler: async (args) => {
    const resolved = await graphConfigResolve(args);
    const exitCode = await graphPathRun({
      cwd: resolved.cwd,
      configPath: resolved.configPath,
      fromPath: args.from,
      toPath: args.to,
      format: args.format,
      maxPaths: args['max-paths'],
    });
    if (exitCode !== 0) process.exitCode = exitCode;
  },
};

const graphDeadCommand: CommandModule<
  GraphCommonArgs,
  GraphCommonArgs & { entry?: string[]; format: string }
> = {
  command: 'dead',
  describe: 'List modules unreachable from declared entry points',
  builder: (yargs) =>
    graphFormatOption(yargs).option('entry', {
      type: 'array',
      string: true,
      describe:
        'Treat these files as entry points (repeatable). Defaults to natural entry points.',
    }) as unknown as Argv<GraphCommonArgs & { entry?: string[]; format: string }>,
  handler: async (args) => {
    const resolved = await graphConfigResolve(args);
    const exitCode = await graphDeadRun({
      cwd: resolved.cwd,
      configPath: resolved.configPath,
      entries: args.entry ?? [],
      format: args.format,
    });
    if (exitCode !== 0) process.exitCode = exitCode;
  },
};

const graphFanInCommand: CommandModule<
  GraphCommonArgs,
  GraphCommonArgs & { file?: string; top?: number; format: string }
> = {
  command: 'fan-in [file]',
  describe: 'Rank files by importerCount (or report one file when <file> is supplied)',
  builder: (yargs) =>
    graphFormatOption(yargs)
      .positional('file', {
        type: 'string',
        describe: 'Limit output to this file',
      })
      .option('top', {
        type: 'number',
        default: 20,
        describe: 'Report only the top N entries (ignored when <file> is set)',
      }) as unknown as Argv<GraphCommonArgs & { file?: string; top?: number; format: string }>,
  handler: async (args) => {
    const resolved = await graphConfigResolve(args);
    const exitCode = await graphFanInRun({
      cwd: resolved.cwd,
      configPath: resolved.configPath,
      filePath: args.file,
      top: args.top,
      format: args.format,
    });
    if (exitCode !== 0) process.exitCode = exitCode;
  },
};

const graphFanOutCommand: CommandModule<
  GraphCommonArgs,
  GraphCommonArgs & { file?: string; top?: number; format: string }
> = {
  command: 'fan-out [file]',
  describe: 'Rank files by importeeCount (or report one file when <file> is supplied)',
  builder: (yargs) =>
    graphFormatOption(yargs)
      .positional('file', {
        type: 'string',
        describe: 'Limit output to this file',
      })
      .option('top', {
        type: 'number',
        default: 20,
        describe: 'Report only the top N entries (ignored when <file> is set)',
      }) as unknown as Argv<GraphCommonArgs & { file?: string; top?: number; format: string }>,
  handler: async (args) => {
    const resolved = await graphConfigResolve(args);
    const exitCode = await graphFanOutRun({
      cwd: resolved.cwd,
      configPath: resolved.configPath,
      filePath: args.file,
      top: args.top,
      format: args.format,
    });
    if (exitCode !== 0) process.exitCode = exitCode;
  },
};

const graphImpactCommand: CommandModule<
  GraphCommonArgs,
  GraphCommonArgs & {
    file: string;
    direction: WorkspaceImpactRadiusDirection;
    depth?: number;
    format: string;
  }
> = {
  command: 'impact <file>',
  describe: 'Emit the neighborhood of a file (impact radius)',
  builder: (yargs) =>
    graphFormatOption(yargs)
      .positional('file', {
        type: 'string',
        demandOption: true,
        describe: 'File to focus on (relative to cwd or absolute)',
      })
      .option('direction', {
        type: 'string',
        choices: ['upstream', 'downstream', 'both'] as const,
        default: 'both' as WorkspaceImpactRadiusDirection,
        describe: 'Traversal direction',
      })
      .option('depth', {
        type: 'number',
        describe: 'Maximum hop distance (default: bounded to 2)',
      }) as unknown as Argv<
      GraphCommonArgs & {
        file: string;
        direction: WorkspaceImpactRadiusDirection;
        depth?: number;
        format: string;
      }
    >,
  handler: async (args) => {
    const resolved = await graphConfigResolve(args);
    const exitCode = await graphImpactRun({
      cwd: resolved.cwd,
      configPath: resolved.configPath,
      filePath: args.file,
      direction: args.direction,
      depth: args.depth,
      format: args.format,
    });
    if (exitCode !== 0) process.exitCode = exitCode;
  },
};

export const graphCommand: CommandModule<unknown, GraphCommonArgs> = {
  command: 'graph <subcommand>',
  describe: 'Run workspace dependency-graph queries',
  builder: (yargs) =>
    graphCommonOptions(yargs)
      .command(graphExportCommand)
      .command(graphCyclesCommand)
      .command(graphPathCommand)
      .command(graphDeadCommand)
      .command(graphFanInCommand)
      .command(graphFanOutCommand)
      .command(graphImpactCommand)
      .demandCommand(1, 'Specify a graph subcommand')
      .strict(),
  handler: () => {
    // Individual subcommand handlers own their logic; this top-level
    // handler only runs when no subcommand is supplied, which is
    // rejected by demandCommand.
  },
};
