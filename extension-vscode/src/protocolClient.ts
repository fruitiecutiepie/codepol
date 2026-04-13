import { createRequire } from 'node:module';
import type {
  ExecuteCommandParams,
  LanguageClientOptions,
  ServerOptions,
} from 'vscode-languageclient/node';
import {
  LanguageClient,
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

const nodeRequire = createRequire(__filename);

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
  private readonly client: LanguageClient;

  constructor() {
    const serverModule = nodeRequire.resolve('@codepol/lsp');
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

  async start(): Promise<void> {
    const started = this.client.start();
    await Promise.resolve(started);
  }

  async stop(): Promise<void> {
    await this.client.stop();
  }

  async queryIndexStatus(): Promise<IndexStatusResult | null> {
    return this.client.sendRequest<IndexStatusResult | null>(
      CODEPOL_LSP_REQUEST_INDEX_STATUS,
    );
  }

  async queryArchitectureSummary(): Promise<WorkspaceArchitectureSummaryResult | null> {
    return this.client.sendRequest<WorkspaceArchitectureSummaryResult | null>(
      CODEPOL_LSP_REQUEST_ARCHITECTURE_SUMMARY,
    );
  }

  async queryDependencyGraph(): Promise<WorkspaceDependencyGraphResult | null> {
    return this.client.sendRequest<WorkspaceDependencyGraphResult | null>(
      CODEPOL_LSP_REQUEST_DEPENDENCY_GRAPH,
    );
  }

  async querySemanticSearch(
    query: string,
  ): Promise<WorkspaceSearchResult[] | null> {
    return this.client.sendRequest<WorkspaceSearchResult[] | null>(
      CODEPOL_LSP_REQUEST_SEMANTIC_SEARCH,
      { query },
    );
  }

  async querySemanticDefinition(
    uri: string,
  ): Promise<WorkspaceSemanticDefinitionResult | null> {
    return this.client.sendRequest<WorkspaceSemanticDefinitionResult | null>(
      CODEPOL_LSP_REQUEST_SEMANTIC_DEFINITION,
      { uri },
    );
  }

  async querySemanticReferences(
    uri: string,
  ): Promise<WorkspaceSemanticReferencesResult | null> {
    return this.client.sendRequest<WorkspaceSemanticReferencesResult | null>(
      CODEPOL_LSP_REQUEST_SEMANTIC_REFERENCES,
      { uri },
    );
  }

  async querySemanticHover(
    uri: string,
  ): Promise<WorkspaceSemanticHoverResult | null> {
    return this.client.sendRequest<WorkspaceSemanticHoverResult | null>(
      CODEPOL_LSP_REQUEST_SEMANTIC_HOVER,
      { uri },
    );
  }

  async prepareRename(
    target: WorkspaceRenameTarget,
  ): Promise<WorkspacePrepareRenameResult | null> {
    return this.client.sendRequest<WorkspacePrepareRenameResult | null>(
      CODEPOL_LSP_REQUEST_PREPARE_RENAME,
      { target },
    );
  }

  async previewRename(
    target: WorkspaceRenameTarget,
    newName: string,
  ): Promise<WorkspaceRenamePreviewResult | null> {
    return this.client.sendRequest<WorkspaceRenamePreviewResult | null>(
      CODEPOL_LSP_REQUEST_PREVIEW_RENAME,
      { target, newName },
    );
  }

  async applyEditPlan(planId: string): Promise<void> {
    const params: ExecuteCommandParams = {
      command: CODEPOL_LSP_COMMAND_APPLY_EDIT_PLAN,
      arguments: [{ planId }],
    };
    await this.client.sendRequest('workspace/executeCommand', params);
  }
}
