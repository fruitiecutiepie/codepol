/**
 * Wire `codepol graph <subcommand>` into the top-level yargs CLI.
 *
 * One file per subcommand keeps the router trivial — this module just
 * maps yargs args to the subcommand runners and owns the config
 * resolution that graph commands share with `codepol`.
 */
import type { Argv, CommandModule } from 'yargs';
import { configGet, configGetFromPath } from '@codepol/core';
import type {
  WorkspaceImpactRadiusDirection,
  WorkspaceSymbolFlowDirection,
  WorkspaceTypeHierarchyDirection,
  WorkspaceTypeHierarchyEdgeConfidence,
} from '@codepol/core';
import { graphCyclesRun } from './graphCycles';
import { graphDeadRun } from './graphDead';
import {
  GRAPH_DIFF_DEFAULT_BASELINE_LABEL,
  graphDiffRun,
} from './graphDiff';
import { graphExportRun } from './graphExport';
import { graphFanInRun } from './graphFanIn';
import { graphFanOutRun } from './graphFanOut';
import { graphFlowRun } from './graphFlow';
import { graphHierarchyRun } from './graphHierarchy';
import { graphImpactRun } from './graphImpact';
import { graphMetricsRun } from './graphMetrics';
import { graphPathRun } from './graphPath';
import { graphSnapshotRun } from './graphSnapshot';

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

const graphSnapshotCommand: CommandModule<
  GraphCommonArgs,
  GraphCommonArgs & { label: string; format: string }
> = {
  command: 'snapshot',
  describe:
    'Capture the live workspace dependency graph to a labeled sidecar file',
  builder: (yargs) =>
    graphFormatOption(yargs).option('label', {
      type: 'string',
      default: GRAPH_DIFF_DEFAULT_BASELINE_LABEL,
      describe:
        'Label for the snapshot (sanitized into a filename). Default: "base".',
    }) as unknown as Argv<GraphCommonArgs & { label: string; format: string }>,
  handler: async (args) => {
    const resolved = await graphConfigResolve(args);
    const exitCode = await graphSnapshotRun({
      cwd: resolved.cwd,
      configPath: resolved.configPath,
      label: args.label,
      format: args.format,
    });
    if (exitCode !== 0) process.exitCode = exitCode;
  },
};

const graphDiffCommand: CommandModule<
  GraphCommonArgs,
  GraphCommonArgs & {
    'baseline-label'?: string;
    'baseline-file'?: string;
    'fail-on-new-cycle': boolean;
    format: string;
  }
> = {
  command: 'diff [baselineLabel]',
  describe:
    'Diff the live workspace dependency graph against a baseline snapshot',
  builder: (yargs) =>
    graphFormatOption(yargs)
      .positional('baselineLabel', {
        type: 'string',
        describe:
          'Snapshot label to compare against. Equivalent to --baseline-label. Default: "base".',
      })
      .option('baseline-label', {
        type: 'string',
        describe:
          'Snapshot label to read from .codepol/graph-snapshots/. Default: "base" when neither --baseline-label nor --baseline-file is supplied.',
      })
      .option('baseline-file', {
        type: 'string',
        describe:
          'Path to a baseline JSON file (GraphSnapshot or WorkspaceDependencyGraphResult).',
      })
      .option('fail-on-new-cycle', {
        type: 'boolean',
        default: false,
        describe: 'Exit with code 1 when the diff introduces a new cycle',
      })
      .conflicts('baseline-label', 'baseline-file')
      .conflicts('baselineLabel', 'baseline-file') as unknown as Argv<
      GraphCommonArgs & {
        baselineLabel?: string;
        'baseline-label'?: string;
        'baseline-file'?: string;
        'fail-on-new-cycle': boolean;
        format: string;
      }
    >,
  handler: async (args) => {
    const resolved = await graphConfigResolve(args);
    const positionalLabel = (args as { baselineLabel?: string }).baselineLabel;
    const baselineLabel =
      args['baseline-file'] !== undefined
        ? undefined
        : (positionalLabel ?? args['baseline-label'] ?? undefined);
    const exitCode = await graphDiffRun({
      cwd: resolved.cwd,
      configPath: resolved.configPath,
      baselineLabel,
      baselineFile: args['baseline-file'],
      failOnNewCycle: args['fail-on-new-cycle'],
      format: args.format,
    });
    if (exitCode !== 0) process.exitCode = exitCode;
  },
};

const graphFlowCommand: CommandModule<
  GraphCommonArgs,
  GraphCommonArgs & {
    symbolId: string;
    direction: WorkspaceSymbolFlowDirection;
    format: string;
  }
> = {
  command: 'flow <symbolId>',
  describe:
    'Emit "function-as-argument" flow sites for a symbol (Phase 9.1 / Gap 1)',
  builder: (yargs) =>
    graphFormatOption(yargs)
      .positional('symbolId', {
        type: 'string',
        demandOption: true,
        describe: 'Stable id of the function/method symbol to inspect',
      })
      .option('direction', {
        type: 'string',
        choices: ['outgoing', 'incoming'] as const,
        default: 'outgoing' as WorkspaceSymbolFlowDirection,
        describe:
          'outgoing = flow sites where this symbol is passed as an argument; incoming = flow sites whose receiver resolves to this symbol',
      }) as unknown as Argv<
      GraphCommonArgs & {
        symbolId: string;
        direction: WorkspaceSymbolFlowDirection;
        format: string;
      }
    >,
  handler: async (args) => {
    const resolved = await graphConfigResolve(args);
    const exitCode = await graphFlowRun({
      cwd: resolved.cwd,
      configPath: resolved.configPath,
      symbolId: args.symbolId,
      direction: args.direction,
      format: args.format,
    });
    if (exitCode !== 0) process.exitCode = exitCode;
  },
};

const graphHierarchyCommand: CommandModule<
  GraphCommonArgs,
  GraphCommonArgs & {
    symbolId: string;
    direction: WorkspaceTypeHierarchyDirection;
    depth?: number;
    'include-structural': boolean;
    'min-confidence'?: WorkspaceTypeHierarchyEdgeConfidence;
    'require-type-aware': boolean;
    format: string;
  }
> = {
  command: 'hierarchy <symbolId>',
  describe:
    'Emit the symbol-level type hierarchy (declared, structural-shape, type-aware)',
  builder: (yargs) =>
    graphFormatOption(yargs)
      .positional('symbolId', {
        type: 'string',
        demandOption: true,
        describe: 'Stable id of the class/interface symbol to inspect',
      })
      .option('direction', {
        type: 'string',
        choices: ['supertypes', 'subtypes', 'both'] as const,
        default: 'both' as WorkspaceTypeHierarchyDirection,
        describe:
          'supertypes = walk parents (extends/implements); subtypes = walk children; both = union',
      })
      .option('depth', {
        type: 'number',
        describe: 'Maximum hop distance (default: unbounded)',
      })
      .option('include-structural', {
        type: 'boolean',
        default: false,
        describe:
          'Include structural-shape edges from the cross-file member-shape comparison (Phase 9.4)',
      })
      .option('min-confidence', {
        type: 'string',
        choices: ['declared', 'structural-shape', 'type-aware'] as const,
        describe:
          'Filter edges by minimum confidence tier (defaults to "declared", which keeps every tier)',
      })
      .option('require-type-aware', {
        type: 'boolean',
        default: false,
        describe:
          'Exit non-zero when no TypeAwareTypeHierarchySource is registered for the language',
      }) as unknown as Argv<
      GraphCommonArgs & {
        symbolId: string;
        direction: WorkspaceTypeHierarchyDirection;
        depth?: number;
        'include-structural': boolean;
        'min-confidence'?: WorkspaceTypeHierarchyEdgeConfidence;
        'require-type-aware': boolean;
        format: string;
      }
    >,
  handler: async (args) => {
    const resolved = await graphConfigResolve(args);
    const exitCode = await graphHierarchyRun({
      cwd: resolved.cwd,
      configPath: resolved.configPath,
      symbolId: args.symbolId,
      direction: args.direction,
      depth: args.depth,
      includeStructural: args['include-structural'],
      minConfidence: args['min-confidence'],
      requireTypeAware: args['require-type-aware'],
      format: args.format,
    });
    if (exitCode !== 0) process.exitCode = exitCode;
  },
};

const graphMetricsCommand: CommandModule<
  GraphCommonArgs,
  GraphCommonArgs & { format: string; top?: number; 'fail-on-cycle': boolean }
> = {
  command: 'metrics',
  describe:
    'Emit Phase 8 architecture health metrics (instability, longest chain, SCC distribution, complexity hotspots)',
  builder: (yargs) =>
    graphFormatOption(yargs)
      .option('top', {
        type: 'number',
        describe:
          'Cap top-N rows in text output for instability and complexity hotspots (no effect on JSON)',
      })
      .option('fail-on-cycle', {
        type: 'boolean',
        default: false,
        describe: 'Exit non-zero when the workspace has any cycle',
      }) as unknown as Argv<
      GraphCommonArgs & { format: string; top?: number; 'fail-on-cycle': boolean }
    >,
  handler: async (args) => {
    const resolved = await graphConfigResolve(args);
    const exitCode = await graphMetricsRun({
      cwd: resolved.cwd,
      configPath: resolved.configPath,
      format: args.format,
      top: args.top,
      failOnCycle: args['fail-on-cycle'],
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
      .command(graphSnapshotCommand)
      .command(graphDiffCommand)
      .command(graphFlowCommand)
      .command(graphHierarchyCommand)
      .command(graphMetricsCommand)
      .demandCommand(1, 'Specify a graph subcommand')
      .strict(),
  handler: () => {
    // Individual subcommand handlers own their logic; this top-level
    // handler only runs when no subcommand is supplied, which is
    // rejected by demandCommand.
  },
};
