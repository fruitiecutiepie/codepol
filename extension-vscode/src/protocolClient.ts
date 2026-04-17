import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import * as vscode from 'vscode';
import type {
  ExecuteCommandParams,
  LanguageClientOptions,
  ServerOptions,
} from 'vscode-languageclient/node';
import {
  LanguageClient,
  State,
  TransportKind,
} from 'vscode-languageclient/node';
import type {
  IndexStatusResult,
  WorkspaceArchitectureSummaryResult,
  WorkspaceDependencyGraphResult,
  WorkspaceLintRuleDetailsResult,
  WorkspaceLintRulesResult,
  WorkspacePrepareRenameResult,
  WorkspaceRange,
  WorkspaceRenamePreviewResult,
  WorkspaceRenameTarget,
  WorkspaceSemanticDefinitionResult,
  WorkspaceSemanticHoverResult,
  WorkspaceSemanticReferencesResult,
  WorkspaceSearchResult,
} from '@codepol/core';
import {
  CODEPOL_LSP_COMMAND_APPLY_EDIT_PLAN,
  CODEPOL_LSP_REQUEST_ARCHITECTURE_SUMMARY,
  CODEPOL_LSP_REQUEST_DEPENDENCY_GRAPH,
  CODEPOL_LSP_REQUEST_INDEX_STATUS,
  CODEPOL_LSP_REQUEST_LINT_RULE_DETAILS,
  CODEPOL_LSP_REQUEST_LINT_RULES,
  CODEPOL_LSP_REQUEST_PREPARE_RENAME,
  CODEPOL_LSP_REQUEST_PREVIEW_RENAME,
  CODEPOL_LSP_REQUEST_SEMANTIC_DEFINITION,
  CODEPOL_LSP_REQUEST_SEMANTIC_HOVER,
  CODEPOL_LSP_REQUEST_SEMANTIC_REFERENCES,
  CODEPOL_LSP_REQUEST_SEMANTIC_SEARCH,
} from '@codepol/lsp/protocol';
import {
  codepolConnectionDisposedErrorIs,
  codepolProtocolStartNeededResolve,
  codepolRequestSupersededErrorDataResolve,
  codepolRequestSupersededErrorIs,
  type CodepolProtocolConnectionState,
} from './readiness';

const nodeRequire = createRequire(__filename);
const CODEPOL_LSP_TRACE_OUTPUT_NAME = 'Codepol LSP';
const CODEPOL_LSP_VERBOSE_DIAGNOSTICS_SETTING = 'lsp.verboseDiagnostics';
let traceOutputChannel: vscode.LogOutputChannel | undefined;

export type CodepolProtocolQuickFixAction = {
  title: string;
  kind: 'quickfix';
  isPreferred?: boolean;
  planId: string;
};

function protocolQuickFixActionResolve(
  value: unknown,
): CodepolProtocolQuickFixAction | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const record = value as {
    title?: unknown;
    kind?: unknown;
    isPreferred?: unknown;
    command?: {
      command?: unknown;
      arguments?: Array<{
        planId?: unknown;
      }>;
    };
  };
  const planId = record.command?.arguments?.[0]?.planId;
  if (
    typeof record.title !== 'string' ||
    record.kind !== 'quickfix' ||
    record.command?.command !== CODEPOL_LSP_COMMAND_APPLY_EDIT_PLAN ||
    typeof planId !== 'string'
  ) {
    return undefined;
  }

  return {
    title: record.title,
    kind: 'quickfix',
    isPreferred: record.isPreferred === true,
    planId,
  };
}

function bundledServerModulePathResolve(): string | undefined {
  const candidate = path.join(__dirname, 'lsp.js');
  return fs.existsSync(candidate) ? candidate : undefined;
}

function verboseDiagnosticsEnabledResolve(): boolean {
  return vscode.workspace
    .getConfiguration('codepol')
    .get<boolean>(CODEPOL_LSP_VERBOSE_DIAGNOSTICS_SETTING, false);
}

function traceOutputChannelGet(): vscode.LogOutputChannel {
  traceOutputChannel ??= vscode.window.createOutputChannel(
    CODEPOL_LSP_TRACE_OUTPUT_NAME,
    { log: true },
  );
  return traceOutputChannel;
}

export type CodepolProtocolClient = {
  start(): Promise<void>;
  stop(): Promise<void>;
  queryIndexStatus(): Promise<IndexStatusResult | null>;
  queryLintRules(): Promise<WorkspaceLintRulesResult | null>;
  queryLintRuleDetails(ruleId: string): Promise<WorkspaceLintRuleDetailsResult | null>;
  queryCodeActions(input: {
    uri: string;
    range: WorkspaceRange;
    diagnosticIds?: string[];
  }): Promise<CodepolProtocolQuickFixAction[]>;
  queryArchitectureSummary(): Promise<WorkspaceArchitectureSummaryResult | null>;
  queryDependencyGraph(): Promise<WorkspaceDependencyGraphResult | null>;
  querySemanticSearch(query: string): Promise<WorkspaceSearchResult[] | null>;
  querySemanticDefinition(uri: string): Promise<WorkspaceSemanticDefinitionResult | null>;
  querySemanticReferences(uri: string): Promise<WorkspaceSemanticReferencesResult | null>;
  querySemanticHover(uri: string): Promise<WorkspaceSemanticHoverResult | null>;
  prepareRename(
    target: WorkspaceRenameTarget,
  ): Promise<WorkspacePrepareRenameResult | null>;
  previewRename(
    target: WorkspaceRenameTarget,
    newName: string,
  ): Promise<WorkspaceRenamePreviewResult | null>;
  applyEditPlan(planId: string): Promise<void>;
};

export class VscodeLanguageClientProtocol implements CodepolProtocolClient {
  private readonly client: Pick<LanguageClient, 'start' | 'state' | 'stop' | 'sendRequest'>;
  private startPromise: Promise<void> | undefined;
  private startError: unknown;

  constructor(
    client?: Pick<LanguageClient, 'start' | 'state' | 'stop' | 'sendRequest'>,
  ) {
    if (client) {
      this.client = client;
      return;
    }

    const serverModule = bundledServerModulePathResolve() ?? nodeRequire.resolve('@codepol/lsp');
    const serverOptions: ServerOptions = {
      run: {
        module: serverModule,
        transport: TransportKind.stdio,
      },
      debug: {
        module: serverModule,
        transport: TransportKind.stdio,
        options: {
          execArgv: ['--nolazy', '--inspect=6009'],
        },
      },
    };
    const clientOptions: LanguageClientOptions = {
      documentSelector: [
        { scheme: 'file' },
      ],
    };
    this.client = new LanguageClient(
      'codepol',
      'Codepol',
      serverOptions,
      clientOptions,
    );
  }

  private connectionStateResolve(): CodepolProtocolConnectionState {
    if (this.client.state === State.Running) {
      return 'running';
    }
    if (this.client.state === State.Starting) {
      return 'starting';
    }
    return 'stopped';
  }

  async start(): Promise<void> {
    if (
      codepolProtocolStartNeededResolve({
        hasStartPromise: this.startPromise !== undefined,
        state: this.connectionStateResolve(),
      })
    ) {
      this.startError = undefined;
      const started = this.client.start();
      this.startPromise = Promise.resolve(started).catch((error) => {
        this.startError = error;
        throw error;
      });
    }
    await this.startPromise;
  }

  async stop(): Promise<void> {
    await this.client.stop();
    this.startPromise = undefined;
    this.startError = undefined;
  }

  private async ensureStarted(): Promise<void> {
    if (
      codepolProtocolStartNeededResolve({
        hasStartPromise: this.startPromise !== undefined,
        state: this.connectionStateResolve(),
      })
    ) {
      await this.start();
      return;
    }

    if (this.startError) {
      throw this.startError;
    }

    await this.startPromise;
  }

  private async requestSend<TResult>(
    method: string,
    params?: unknown,
  ): Promise<TResult> {
    if (params === undefined) {
      return this.client.sendRequest<TResult>(method);
    }
    return this.client.sendRequest<TResult>(method, params);
  }

  private requestSupersededTraceWrite(method: string, error: unknown): void {
    if (!verboseDiagnosticsEnabledResolve()) {
      return;
    }

    const data = codepolRequestSupersededErrorDataResolve(error);
    const parts = [`method=${method}`];
    if (data?.requestType) {
      parts.push(`requestType=${data.requestType}`);
    }
    if (data?.requestKey) {
      parts.push(`requestKey=${data.requestKey}`);
    }
    if (data?.requestId) {
      parts.push(`requestId=${data.requestId}`);
    }
    if (data?.replacedByRequestId) {
      parts.push(`replacedByRequestId=${data.replacedByRequestId}`);
    }
    traceOutputChannelGet().trace(`Request superseded ${parts.join(' ')}`);
  }

  private async requestSendWithSupersededTrace<TResult>(
    method: string,
    params?: unknown,
  ): Promise<TResult> {
    try {
      return await this.requestSend<TResult>(method, params);
    } catch (error) {
      if (codepolRequestSupersededErrorIs(error)) {
        this.requestSupersededTraceWrite(method, error);
      }
      throw error;
    }
  }

  private async requestRun<TResult>(
    method: string,
    params?: unknown,
  ): Promise<TResult> {
    await this.ensureStarted();

    try {
      return await this.requestSendWithSupersededTrace<TResult>(method, params);
    } catch (error) {
      if (!codepolConnectionDisposedErrorIs(error)) {
        throw error;
      }

      await this.start();
      return this.requestSendWithSupersededTrace<TResult>(method, params);
    }
  }

  async queryIndexStatus(): Promise<IndexStatusResult | null> {
    return this.requestRun<IndexStatusResult | null>(
      CODEPOL_LSP_REQUEST_INDEX_STATUS,
    );
  }

  async queryLintRules(): Promise<WorkspaceLintRulesResult | null> {
    return this.requestRun<WorkspaceLintRulesResult | null>(
      CODEPOL_LSP_REQUEST_LINT_RULES,
    );
  }

  async queryLintRuleDetails(
    ruleId: string,
  ): Promise<WorkspaceLintRuleDetailsResult | null> {
    return this.requestRun<WorkspaceLintRuleDetailsResult | null>(
      CODEPOL_LSP_REQUEST_LINT_RULE_DETAILS,
      { ruleId },
    );
  }

  async queryCodeActions(input: {
    uri: string;
    range: WorkspaceRange;
    diagnosticIds?: string[];
  }): Promise<CodepolProtocolQuickFixAction[]> {
    const result = await this.requestRun<unknown[]>('textDocument/codeAction', {
      textDocument: {
        uri: input.uri,
      },
      range: input.range,
      context: {
        diagnostics: (input.diagnosticIds ?? []).map((diagnosticId) => ({
          data: {
            id: diagnosticId,
          },
        })),
      },
    });
    if (!Array.isArray(result)) {
      return [];
    }
    return result
      .map((action) => protocolQuickFixActionResolve(action))
      .filter(
        (action): action is CodepolProtocolQuickFixAction => action !== undefined,
      );
  }

  async queryArchitectureSummary(): Promise<WorkspaceArchitectureSummaryResult | null> {
    return this.requestRun<WorkspaceArchitectureSummaryResult | null>(
      CODEPOL_LSP_REQUEST_ARCHITECTURE_SUMMARY,
    );
  }

  async queryDependencyGraph(): Promise<WorkspaceDependencyGraphResult | null> {
    return this.requestRun<WorkspaceDependencyGraphResult | null>(
      CODEPOL_LSP_REQUEST_DEPENDENCY_GRAPH,
    );
  }

  async querySemanticSearch(
    query: string,
  ): Promise<WorkspaceSearchResult[] | null> {
    return this.requestRun<WorkspaceSearchResult[] | null>(
      CODEPOL_LSP_REQUEST_SEMANTIC_SEARCH,
      { query },
    );
  }

  async querySemanticDefinition(
    uri: string,
  ): Promise<WorkspaceSemanticDefinitionResult | null> {
    return this.requestRun<WorkspaceSemanticDefinitionResult | null>(
      CODEPOL_LSP_REQUEST_SEMANTIC_DEFINITION,
      { uri },
    );
  }

  async querySemanticReferences(
    uri: string,
  ): Promise<WorkspaceSemanticReferencesResult | null> {
    return this.requestRun<WorkspaceSemanticReferencesResult | null>(
      CODEPOL_LSP_REQUEST_SEMANTIC_REFERENCES,
      { uri },
    );
  }

  async querySemanticHover(
    uri: string,
  ): Promise<WorkspaceSemanticHoverResult | null> {
    return this.requestRun<WorkspaceSemanticHoverResult | null>(
      CODEPOL_LSP_REQUEST_SEMANTIC_HOVER,
      { uri },
    );
  }

  async prepareRename(
    target: WorkspaceRenameTarget,
  ): Promise<WorkspacePrepareRenameResult | null> {
    return this.requestRun<WorkspacePrepareRenameResult | null>(
      CODEPOL_LSP_REQUEST_PREPARE_RENAME,
      { target },
    );
  }

  async previewRename(
    target: WorkspaceRenameTarget,
    newName: string,
  ): Promise<WorkspaceRenamePreviewResult | null> {
    return this.requestRun<WorkspaceRenamePreviewResult | null>(
      CODEPOL_LSP_REQUEST_PREVIEW_RENAME,
      { target, newName },
    );
  }

  async applyEditPlan(planId: string): Promise<void> {
    const params: ExecuteCommandParams = {
      command: CODEPOL_LSP_COMMAND_APPLY_EDIT_PLAN,
      arguments: [{ planId }],
    };
    await this.requestRun('workspace/executeCommand', params);
  }
}
