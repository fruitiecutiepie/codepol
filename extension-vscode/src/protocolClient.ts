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
  DiagnosticsConfig,
  DiagnosticsConfigPatch,
  EscalationRule,
  EscalationRuleInput,
  IndexStatusResult,
  WorkspaceArchitectureSummaryResult,
  WorkspaceCallGraphDirection,
  WorkspaceDeadModulesResult,
  WorkspaceDependencyDiffResult,
  WorkspaceDependencyGraphResult,
  WorkspaceDependencyPathResult,
  WorkspaceImpactRadiusDirection,
  WorkspaceLintRuleDetailsResult,
  WorkspaceLintRulesResult,
  WorkspacePosition,
  WorkspacePrepareRenameResult,
  WorkspaceRange,
  WorkspaceRenamePreviewResult,
  WorkspaceRenameTarget,
  WorkspaceSemanticDefinitionResult,
  WorkspaceSemanticHoverResult,
  WorkspaceSemanticReferencesResult,
  WorkspaceSearchResult,
  WorkspaceSymbolAtPositionResult,
  WorkspaceSymbolDescriptorKind,
  WorkspaceSymbolLookupResult,
  WorkspaceTypeHierarchyDirection,
} from '@codepol/core';
import {
  CODEPOL_LSP_COMMAND_APPLY_EDIT_PLAN,
  CODEPOL_LSP_COMMAND_CONFIGURE_DIAGNOSTICS,
  CODEPOL_LSP_COMMAND_ESCALATE_DIAGNOSTICS,
  CODEPOL_LSP_COMMAND_REVOKE_DIAGNOSTICS_ESCALATION,
  CODEPOL_LSP_REQUEST_ARCHITECTURE_SUMMARY,
  CODEPOL_LSP_REQUEST_CALL_GRAPH,
  CODEPOL_LSP_REQUEST_DEAD_MODULES,
  CODEPOL_LSP_REQUEST_DEPENDENCY_DIFF,
  CODEPOL_LSP_REQUEST_DEPENDENCY_GRAPH,
  CODEPOL_LSP_REQUEST_DEPENDENCY_PATH,
  CODEPOL_LSP_REQUEST_DIAGNOSTICS_CONFIG,
  CODEPOL_LSP_REQUEST_DIAGNOSTICS_ESCALATIONS,
  CODEPOL_LSP_REQUEST_IMPACT_RADIUS,
  CODEPOL_LSP_REQUEST_TYPE_HIERARCHY,
  CODEPOL_LSP_REQUEST_INDEX_STATUS,
  CODEPOL_LSP_REQUEST_LINT_RULE_DETAILS,
  CODEPOL_LSP_REQUEST_LINT_RULES,
  CODEPOL_LSP_REQUEST_PREPARE_RENAME,
  CODEPOL_LSP_REQUEST_PREVIEW_RENAME,
  CODEPOL_LSP_REQUEST_SEMANTIC_DEFINITION,
  CODEPOL_LSP_REQUEST_SEMANTIC_HOVER,
  CODEPOL_LSP_REQUEST_SEMANTIC_REFERENCES,
  CODEPOL_LSP_REQUEST_SEMANTIC_SEARCH,
  CODEPOL_LSP_REQUEST_SYMBOL_AT_POSITION,
  CODEPOL_LSP_REQUEST_SYMBOL_LOOKUP,
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
  queryImpactRadius(input: {
    uri: string;
    direction: WorkspaceImpactRadiusDirection;
    depth?: number;
  }): Promise<WorkspaceDependencyGraphResult | null>;
  queryDependencyPath(input: {
    fromUri: string;
    toUri: string;
    maxPaths?: number;
  }): Promise<WorkspaceDependencyPathResult | null>;
  queryDeadModules(input: {
    entryPointUris?: string[];
  }): Promise<WorkspaceDeadModulesResult | null>;
  queryDependencyDiff(input: {
    baselineLabel?: string;
    baselineGraph?: WorkspaceDependencyGraphResult;
  }): Promise<WorkspaceDependencyDiffResult | null>;
  queryCallGraph(input: {
    symbolId: string;
    direction: WorkspaceCallGraphDirection;
    depth?: number;
  }): Promise<WorkspaceDependencyGraphResult | null>;
  queryTypeHierarchy(input: {
    symbolId: string;
    direction: WorkspaceTypeHierarchyDirection;
    depth?: number;
  }): Promise<WorkspaceDependencyGraphResult | null>;
  querySemanticSearch(query: string): Promise<WorkspaceSearchResult[] | null>;
  querySemanticDefinition(uri: string): Promise<WorkspaceSemanticDefinitionResult | null>;
  querySemanticReferences(uri: string): Promise<WorkspaceSemanticReferencesResult | null>;
  querySemanticHover(uri: string): Promise<WorkspaceSemanticHoverResult | null>;
  querySymbolLookup(input: {
    name: string;
    kind?: WorkspaceSymbolDescriptorKind;
    scopeUri?: string;
    limit?: number;
  }): Promise<WorkspaceSymbolLookupResult | null>;
  querySymbolAtPosition(input: {
    uri: string;
    position: WorkspacePosition;
  }): Promise<WorkspaceSymbolAtPositionResult | null>;
  prepareRename(
    target: WorkspaceRenameTarget,
  ): Promise<WorkspacePrepareRenameResult | null>;
  previewRename(
    target: WorkspaceRenameTarget,
    newName: string,
  ): Promise<WorkspaceRenamePreviewResult | null>;
  applyEditPlan(planId: string): Promise<void>;
  configureDiagnostics(
    patch: DiagnosticsConfigPatch,
  ): Promise<DiagnosticsConfig | null>;
  getDiagnosticsConfig(): Promise<DiagnosticsConfig | null>;
  escalateDiagnostics(
    rule: EscalationRuleInput,
  ): Promise<{ id: string; expiresAtUnixMs: number } | null>;
  revokeDiagnosticsEscalation(id: string): Promise<void>;
  listDiagnosticsEscalations(): Promise<readonly EscalationRule[]>;
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

  async queryImpactRadius(input: {
    uri: string;
    direction: WorkspaceImpactRadiusDirection;
    depth?: number;
  }): Promise<WorkspaceDependencyGraphResult | null> {
    return this.requestRun<WorkspaceDependencyGraphResult | null>(
      CODEPOL_LSP_REQUEST_IMPACT_RADIUS,
      input,
    );
  }

  async queryDependencyPath(input: {
    fromUri: string;
    toUri: string;
    maxPaths?: number;
  }): Promise<WorkspaceDependencyPathResult | null> {
    return this.requestRun<WorkspaceDependencyPathResult | null>(
      CODEPOL_LSP_REQUEST_DEPENDENCY_PATH,
      input,
    );
  }

  async queryDeadModules(input: {
    entryPointUris?: string[];
  }): Promise<WorkspaceDeadModulesResult | null> {
    return this.requestRun<WorkspaceDeadModulesResult | null>(
      CODEPOL_LSP_REQUEST_DEAD_MODULES,
      input,
    );
  }

  async queryDependencyDiff(input: {
    baselineLabel?: string;
    baselineGraph?: WorkspaceDependencyGraphResult;
  }): Promise<WorkspaceDependencyDiffResult | null> {
    return this.requestRun<WorkspaceDependencyDiffResult | null>(
      CODEPOL_LSP_REQUEST_DEPENDENCY_DIFF,
      input,
    );
  }

  async queryCallGraph(input: {
    symbolId: string;
    direction: WorkspaceCallGraphDirection;
    depth?: number;
  }): Promise<WorkspaceDependencyGraphResult | null> {
    return this.requestRun<WorkspaceDependencyGraphResult | null>(
      CODEPOL_LSP_REQUEST_CALL_GRAPH,
      input,
    );
  }

  async queryTypeHierarchy(input: {
    symbolId: string;
    direction: WorkspaceTypeHierarchyDirection;
    depth?: number;
  }): Promise<WorkspaceDependencyGraphResult | null> {
    return this.requestRun<WorkspaceDependencyGraphResult | null>(
      CODEPOL_LSP_REQUEST_TYPE_HIERARCHY,
      input,
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

  async querySymbolLookup(input: {
    name: string;
    kind?: WorkspaceSymbolDescriptorKind;
    scopeUri?: string;
    limit?: number;
  }): Promise<WorkspaceSymbolLookupResult | null> {
    return this.requestRun<WorkspaceSymbolLookupResult | null>(
      CODEPOL_LSP_REQUEST_SYMBOL_LOOKUP,
      input,
    );
  }

  async querySymbolAtPosition(input: {
    uri: string;
    position: WorkspacePosition;
  }): Promise<WorkspaceSymbolAtPositionResult | null> {
    return this.requestRun<WorkspaceSymbolAtPositionResult | null>(
      CODEPOL_LSP_REQUEST_SYMBOL_AT_POSITION,
      input,
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

  async configureDiagnostics(
    patch: DiagnosticsConfigPatch,
  ): Promise<DiagnosticsConfig | null> {
    const params: ExecuteCommandParams = {
      command: CODEPOL_LSP_COMMAND_CONFIGURE_DIAGNOSTICS,
      arguments: [patch],
    };
    const result = await this.requestRun<DiagnosticsConfig | null>(
      'workspace/executeCommand',
      params,
    );
    return result ?? null;
  }

  async getDiagnosticsConfig(): Promise<DiagnosticsConfig | null> {
    return this.requestRun<DiagnosticsConfig | null>(
      CODEPOL_LSP_REQUEST_DIAGNOSTICS_CONFIG,
      {},
    );
  }

  async escalateDiagnostics(
    rule: EscalationRuleInput,
  ): Promise<{ id: string; expiresAtUnixMs: number } | null> {
    const params: ExecuteCommandParams = {
      command: CODEPOL_LSP_COMMAND_ESCALATE_DIAGNOSTICS,
      arguments: [rule],
    };
    const result = await this.requestRun<
      { id: string; expiresAtUnixMs: number } | null
    >('workspace/executeCommand', params);
    return result ?? null;
  }

  async revokeDiagnosticsEscalation(id: string): Promise<void> {
    const params: ExecuteCommandParams = {
      command: CODEPOL_LSP_COMMAND_REVOKE_DIAGNOSTICS_ESCALATION,
      arguments: [{ id }],
    };
    await this.requestRun('workspace/executeCommand', params);
  }

  async listDiagnosticsEscalations(): Promise<readonly EscalationRule[]> {
    const result = await this.requestRun<readonly EscalationRule[] | null>(
      CODEPOL_LSP_REQUEST_DIAGNOSTICS_ESCALATIONS,
      {},
    );
    return result ?? [];
  }
}
