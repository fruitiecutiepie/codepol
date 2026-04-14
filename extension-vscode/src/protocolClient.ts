import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
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
  WorkspacePrepareRenameResult,
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
  type CodepolProtocolConnectionState,
} from './readiness';

const nodeRequire = createRequire(__filename);

function bundledServerModulePathResolve(): string | undefined {
  const candidate = path.join(__dirname, 'lsp.js');
  return fs.existsSync(candidate) ? candidate : undefined;
}

export type CodepolProtocolClient = {
  start(): Promise<void>;
  stop(): Promise<void>;
  queryIndexStatus(): Promise<IndexStatusResult | null>;
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

  private async requestRun<TResult>(
    method: string,
    params?: unknown,
  ): Promise<TResult> {
    await this.ensureStarted();

    try {
      return await this.requestSend<TResult>(method, params);
    } catch (error) {
      if (!codepolConnectionDisposedErrorIs(error)) {
        throw error;
      }

      await this.start();
      return this.requestSend<TResult>(method, params);
    }
  }

  async queryIndexStatus(): Promise<IndexStatusResult | null> {
    return this.requestRun<IndexStatusResult | null>(
      CODEPOL_LSP_REQUEST_INDEX_STATUS,
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
