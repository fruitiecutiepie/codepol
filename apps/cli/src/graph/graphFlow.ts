/**
 * `codepol graph flow <symbolId>` — emit "function-as-argument" flow
 * sites for a stable symbol id.
 *
 * Phase 9.1 / Gap 1. Distinct from the call-graph subcommands: this
 * command surfaces {@link SymbolFlowRelation}s, NOT call edges. The
 * structural call graph stays free of higher-order data flow on
 * purpose — see the architecture note in `TODO_CODEPOL_LSP_ARCHITECTURE_GRAPH_MODEL.md`.
 *
 * JSON output is byte-equal to {@link WorkspaceSymbolFlowResult} so
 * panels, CI consumers, and tests share one payload shape.
 */
import type { WorkspaceSymbolFlowDirection } from '@codepol/core';
import { graphWorkspaceSessionCreate } from './graphWorkspaceResolve';
import {
  graphJsonStringify,
  graphOutputFormatParse,
  type GraphOutputFormat,
} from './graphOutputFormat';

export type GraphFlowOptions = {
  cwd: string;
  configPath: string;
  symbolId: string;
  direction: WorkspaceSymbolFlowDirection;
  format: string | undefined;
};

export async function graphFlowRun(options: GraphFlowOptions): Promise<number> {
  const format: GraphOutputFormat = graphOutputFormatParse(options.format);

  const session = await graphWorkspaceSessionCreate({
    cwd: options.cwd,
    configPath: options.configPath,
  });
  try {
    const result = await session.service.querySymbolFlow({
      clientSessionId: session.clientSessionId,
      workspaceId: session.workspaceId,
      symbolId: options.symbolId,
      direction: options.direction,
    });

    if (format === 'json') {
      console.log(graphJsonStringify(result));
      return 0;
    }

    if (result.edges.length === 0) {
      console.log(`No ${options.direction} flow sites for ${options.symbolId}`);
      return 0;
    }
    console.log(`direction: ${options.direction}`);
    console.log(`edges: ${result.edges.length}`);
    for (const edge of result.edges) {
      const argSlot = edge.argumentIndex !== undefined ? `[arg ${edge.argumentIndex}]` : '';
      const receiver = edge.receivingCallSymbolId
        ? ` -> ${edge.receivingCallSymbolId}`
        : '';
      console.log(
        `  ${edge.file}:${edge.range.start.line + 1}:${edge.range.start.character + 1}${argSlot}${receiver}`,
      );
    }
    return 0;
  } finally {
    await session.close();
  }
}
