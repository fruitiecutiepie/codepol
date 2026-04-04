import { randomUUID } from 'node:crypto';
import {
  workspaceUriToPath,
  type WorkspaceCodeAction,
  type WorkspaceDiagnostic,
  type WorkspaceEditPlan,
} from '@codepol/core';
import {
  configDiscover,
  workspaceServiceCreate,
  type WorkspaceService,
} from '@codepol/workspace-service';

const APPLY_EDIT_PLAN_COMMAND = 'codepol.applyEditPlan';

type JsonRpcId = number | string | null;

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params?: unknown;
};

type JsonRpcNotification = {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
};

type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
};

type LspDocument = {
  uri: string;
  version: number;
  text: string;
};

type LspPosition = {
  line: number;
  character: number;
};

type LspRange = {
  start: LspPosition;
  end: LspPosition;
};

type SendMessage = (message: JsonRpcRequest | JsonRpcNotification | JsonRpcResponse) => void;
type WorkspaceServiceFactory = () => WorkspaceService | Promise<WorkspaceService>;

function promiseLikeIs<T>(value: T | Promise<T>): value is Promise<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof (value as Promise<T>).then === 'function'
  );
}

function messageIsResponse(
  message: JsonRpcRequest | JsonRpcNotification | JsonRpcResponse,
): message is JsonRpcResponse {
  return 'result' in message || 'error' in message;
}

function messageIsRequest(
  message: JsonRpcRequest | JsonRpcNotification | JsonRpcResponse,
): message is JsonRpcRequest {
  return 'id' in message && 'method' in message;
}

function severityToLsp(severity: WorkspaceDiagnostic['severity']): number {
  if (severity === 'warning') {
    return 2;
  }
  if (severity === 'info') {
    return 3;
  }
  return 1;
}

function positionCompare(a: LspPosition, b: LspPosition): number {
  if (a.line !== b.line) {
    return a.line - b.line;
  }
  return a.character - b.character;
}

function rangeIsPoint(range: LspRange): boolean {
  return positionCompare(range.start, range.end) === 0;
}

function positionInRange(position: LspPosition, range: LspRange): boolean {
  return (
    positionCompare(position, range.start) >= 0 &&
    positionCompare(position, range.end) <= 0
  );
}

function rangesIntersect(a: LspRange, b: LspRange): boolean {
  if (rangeIsPoint(a)) {
    return positionInRange(a.start, b);
  }
  if (rangeIsPoint(b)) {
    return positionInRange(b.start, a);
  }
  return positionCompare(a.end, b.start) > 0 && positionCompare(b.end, a.start) > 0;
}

function diagnosticTouchesRange(
  diagnostic: WorkspaceDiagnostic,
  uri: string,
  range: LspRange,
): boolean {
  if (rangesIntersect(diagnostic.range, range)) {
    return true;
  }

  return diagnostic.relatedLocations?.some(
    (related) => related.uri === uri && rangesIntersect(related.range, range),
  ) ?? false;
}

function diagnosticsToLsp(diagnostics: WorkspaceDiagnostic[]): unknown[] {
  const lspDiagnostics: unknown[] = [];

  for (const diagnostic of diagnostics) {
    lspDiagnostics.push({
      range: diagnostic.range,
      severity: severityToLsp(diagnostic.severity),
      source: diagnostic.source,
      code: diagnostic.code,
      message: diagnostic.message,
      relatedInformation: diagnostic.relatedLocations
        ?.filter((related) => related.uri !== diagnostic.uri)
        .map((related) => ({
          location: {
            uri: related.uri,
            range: related.range,
          },
          message: related.message ?? '',
        })),
      data: {
        id: diagnostic.id,
      },
    });

    for (const related of diagnostic.relatedLocations ?? []) {
      if (related.uri !== diagnostic.uri) {
        continue;
      }
      lspDiagnostics.push({
        range: related.range,
        severity: severityToLsp(diagnostic.severity),
        source: diagnostic.source,
        code: diagnostic.code,
        message: related.message ?? diagnostic.message,
        data: {
          id: diagnostic.id,
        },
      });
    }
  }

  return lspDiagnostics;
}

function workspaceEditToLsp(plan: WorkspaceEditPlan): { changes: Record<string, unknown[]> } {
  const changes: Record<string, unknown[]> = {};
  for (const edit of plan.edits) {
    const list = changes[edit.uri] ?? [];
    list.push({
      range: edit.range,
      newText: edit.newText,
    });
    changes[edit.uri] = list;
  }
  return { changes };
}

function offsetAt(text: string, position: { line: number; character: number }): number {
  const lines = text.split('\n');
  let offset = 0;
  for (let index = 0; index < position.line; index += 1) {
    offset += (lines[index] ?? '').length + 1;
  }
  return offset + position.character;
}

function textChangesApply(
  currentText: string,
  changes: Array<{
    range?: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
    text: string;
  }>,
): string {
  let text = currentText;
  for (const change of changes) {
    if (!change.range) {
      text = change.text;
      continue;
    }
    const start = offsetAt(text, change.range.start);
    const end = offsetAt(text, change.range.end);
    text = text.slice(0, start) + change.text + text.slice(end);
  }
  return text;
}

export class CodepolLspServer {
  private service: WorkspaceService | undefined;
  private readonly serviceFactory: WorkspaceServiceFactory;
  private servicePromise: Promise<WorkspaceService> | undefined;
  private readonly sendMessage: SendMessage;
  private readonly clientInstanceId: string;
  private readonly stableClientSessionId: string;
  private readonly documents = new Map<string, LspDocument>();
  private readonly pendingClientRequests = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private registeredClientSessionId: string | undefined;
  private workspaceId: string | undefined;
  private nextRequestId = 1;

  constructor(options: {
    service?: WorkspaceService;
    serviceFactory?: WorkspaceServiceFactory;
    sendMessage: SendMessage;
    clientInstanceId?: string;
    clientSessionId?: string;
  }) {
    this.service = options.service;
    this.serviceFactory = options.serviceFactory ?? (() => workspaceServiceCreate());
    this.sendMessage = options.sendMessage;
    this.clientInstanceId = options.clientInstanceId ?? `codepol-lsp-${process.pid}`;
    this.stableClientSessionId = options.clientSessionId ?? `client-${randomUUID()}`;
  }

  private async serviceGet(): Promise<WorkspaceService> {
    if (this.service) {
      return this.service;
    }
    if (!this.servicePromise) {
      const created = this.serviceFactory();
      if (!promiseLikeIs(created)) {
        this.service = created;
        return created;
      }
      this.servicePromise = created.then((service) => {
        this.service = service;
        return service;
      });
    }
    return this.servicePromise;
  }

  async handleMessage(message: JsonRpcRequest | JsonRpcNotification | JsonRpcResponse): Promise<void> {
    if (messageIsResponse(message)) {
      if (typeof message.id === 'number') {
        const pending = this.pendingClientRequests.get(message.id);
        if (!pending) {
          return;
        }
        this.pendingClientRequests.delete(message.id);
        if (message.error) {
          pending.reject(new Error(message.error.message));
        } else {
          pending.resolve(message.result);
        }
      }
      return;
    }

    if (messageIsRequest(message)) {
      await this.requestHandle(message);
      return;
    }

    await this.notificationHandle(message);
  }

  private async requestHandle(message: JsonRpcRequest): Promise<void> {
    try {
      const result = await this.methodHandle(message.method, message.params);
      this.sendMessage({
        jsonrpc: '2.0',
        id: message.id,
        result,
      });
    } catch (error) {
      this.sendMessage({
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  private async notificationHandle(message: JsonRpcNotification): Promise<void> {
    await this.methodHandle(message.method, message.params);
  }

  private async methodHandle(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case 'initialize':
        return this.initializeHandle(params as {
          rootUri?: string | null;
          rootPath?: string | null;
          workspaceFolders?: Array<{ uri: string }>;
        });
      case 'initialized':
        return null;
      case 'textDocument/didOpen':
        await this.didOpenHandle(params as {
          textDocument: { uri: string; version: number; text: string };
        });
        return null;
      case 'textDocument/didChange':
        await this.didChangeHandle(params as {
          textDocument: { uri: string; version: number };
          contentChanges: Array<{
            range?: {
              start: { line: number; character: number };
              end: { line: number; character: number };
            };
            text: string;
          }>;
        });
        return null;
      case 'textDocument/didClose':
        await this.didCloseHandle(params as {
          textDocument: { uri: string };
        });
        return null;
      case 'textDocument/codeAction':
        return this.codeActionHandle(params as {
          textDocument: { uri: string };
          range?: LspRange;
          context: { diagnostics?: Array<{ data?: { id?: string } }> };
        });
      case 'workspace/executeCommand':
        return this.executeCommandHandle(params as {
          command: string;
          arguments?: Array<{ planId?: string }>;
        });
      default:
        return null;
    }
  }

  private async initializeHandle(params: {
    rootUri?: string | null;
    rootPath?: string | null;
    workspaceFolders?: Array<{ uri: string }>;
  }): Promise<unknown> {
    const service = await this.serviceGet();
    const registered = await service.registerClientSession({
      clientKind: 'lsp',
      clientInstanceId: this.clientInstanceId,
      clientSessionId: this.stableClientSessionId,
    });
    this.registeredClientSessionId = registered.clientSessionId;

    const rootUri =
      params.rootUri ??
      params.workspaceFolders?.[0]?.uri ??
      (params.rootPath ? `file://${params.rootPath}` : undefined);

    if (rootUri && this.registeredClientSessionId) {
      try {
        const rootPath = workspaceUriToPath(rootUri);
        const { configPath } = await configDiscover(rootPath);
        const attached = await service.attachWorkspace({
          clientSessionId: this.registeredClientSessionId,
          rootPath,
          configPath,
        });
        await this.workspaceReplayApply({
          service,
          workspaceId: attached.workspaceId,
          workspaceInstanceId: attached.workspaceInstanceId,
        });
        this.workspaceId = attached.workspaceId;
      } catch {
        this.workspaceId = undefined;
      }
    }

    return {
      capabilities: {
        textDocumentSync: 2,
        codeActionProvider: true,
        executeCommandProvider: {
          commands: [APPLY_EDIT_PLAN_COMMAND],
        },
      },
      serverInfo: {
        name: 'codepol-lsp',
      },
    };
  }

  private async workspaceReplayApply(input: {
    service: WorkspaceService;
    workspaceId: string;
    workspaceInstanceId: string;
  }): Promise<void> {
    if (!this.registeredClientSessionId) {
      return;
    }

    await input.service.subscribeDiagnostics({
      clientSessionId: this.registeredClientSessionId,
      workspaceId: input.workspaceId,
      workspaceInstanceId: input.workspaceInstanceId,
      scope: 'workspace',
    });

    for (const document of this.documents.values()) {
      await input.service.openOverlay({
        clientSessionId: this.registeredClientSessionId,
        workspaceId: input.workspaceId,
        uri: document.uri,
        version: document.version,
        text: document.text,
      });
    }

    await input.service.completeReplay({
      clientSessionId: this.registeredClientSessionId,
      workspaceId: input.workspaceId,
      workspaceInstanceId: input.workspaceInstanceId,
    });
  }

  private async didOpenHandle(params: {
    textDocument: { uri: string; version: number; text: string };
  }): Promise<void> {
    if (!this.registeredClientSessionId || !this.workspaceId) {
      return;
    }
    const service = await this.serviceGet();
    this.documents.set(params.textDocument.uri, {
      uri: params.textDocument.uri,
      version: params.textDocument.version,
      text: params.textDocument.text,
    });
    await service.openOverlay({
      clientSessionId: this.registeredClientSessionId,
      workspaceId: this.workspaceId,
      uri: params.textDocument.uri,
      version: params.textDocument.version,
      text: params.textDocument.text,
    });
    await this.publishDiagnostics(params.textDocument.uri);
  }

  private async didChangeHandle(params: {
    textDocument: { uri: string; version: number };
    contentChanges: Array<{
      range?: {
        start: { line: number; character: number };
        end: { line: number; character: number };
      };
      text: string;
    }>;
  }): Promise<void> {
    if (!this.registeredClientSessionId || !this.workspaceId) {
      return;
    }
    const service = await this.serviceGet();
    const current = this.documents.get(params.textDocument.uri);
    if (!current) {
      return;
    }

    const nextText = textChangesApply(current.text, params.contentChanges);
    const nextDocument: LspDocument = {
      uri: current.uri,
      version: params.textDocument.version,
      text: nextText,
    };
    this.documents.set(current.uri, nextDocument);
    await service.updateOverlay({
      clientSessionId: this.registeredClientSessionId,
      workspaceId: this.workspaceId,
      uri: current.uri,
      version: nextDocument.version,
      text: nextDocument.text,
    });
    await this.publishDiagnostics(current.uri);
  }

  private async didCloseHandle(params: {
    textDocument: { uri: string };
  }): Promise<void> {
    if (!this.registeredClientSessionId || !this.workspaceId) {
      return;
    }
    const service = await this.serviceGet();
    this.documents.delete(params.textDocument.uri);
    await service.closeOverlay({
      clientSessionId: this.registeredClientSessionId,
      workspaceId: this.workspaceId,
      uri: params.textDocument.uri,
    });
    await this.publishDiagnostics(params.textDocument.uri);
  }

  private async codeActionHandle(params: {
    textDocument: { uri: string };
    range?: LspRange;
    context: { diagnostics?: Array<{ data?: { id?: string } }> };
  }): Promise<unknown> {
    if (!this.registeredClientSessionId || !this.workspaceId) {
      return [];
    }
    const service = await this.serviceGet();
    const document = this.documents.get(params.textDocument.uri);
    const diagnosticIds = new Set(
      (params.context.diagnostics ?? [])
        .map((diagnostic) => diagnostic.data?.id)
        .filter((diagnosticId): diagnosticId is string => typeof diagnosticId === 'string'),
    );
    if (params.range) {
      const diagnostics = await service.queryDiagnostics({
        clientSessionId: this.registeredClientSessionId,
        workspaceId: this.workspaceId,
        uri: params.textDocument.uri,
      });
      for (const diagnostic of diagnostics) {
        if (diagnosticTouchesRange(diagnostic, params.textDocument.uri, params.range)) {
          diagnosticIds.add(diagnostic.id);
        }
      }
    }
    if (diagnosticIds.size === 0) {
      return [];
    }
    const actions = await service.queryCodeActions({
      clientSessionId: this.registeredClientSessionId,
      workspaceId: this.workspaceId,
      uri: params.textDocument.uri,
      version: document?.version ?? 0,
      diagnosticIds: [...diagnosticIds],
    });
    return actions.map((action: WorkspaceCodeAction) => this.codeActionToLsp(action));
  }

  private codeActionToLsp(action: WorkspaceCodeAction): unknown {
    return {
      title: action.title,
      kind: action.kind,
      isPreferred: action.isPreferred,
      command: {
        title: action.title,
        command: APPLY_EDIT_PLAN_COMMAND,
        arguments: [{ planId: action.plan.id }],
      },
    };
  }

  private async executeCommandHandle(params: {
    command: string;
    arguments?: Array<{ planId?: string }>;
  }): Promise<unknown> {
    if (
      !this.registeredClientSessionId ||
      !this.workspaceId ||
      params.command !== APPLY_EDIT_PLAN_COMMAND
    ) {
      return null;
    }
    const service = await this.serviceGet();

    const planId = params.arguments?.[0]?.planId;
    if (!planId) {
      return null;
    }

    const documentVersions: Record<string, number> = {};
    for (const document of this.documents.values()) {
      documentVersions[document.uri] = document.version;
    }

    const applyResult = await service.applyEditPlan({
      clientSessionId: this.registeredClientSessionId,
      workspaceId: this.workspaceId,
      planId,
      documentVersions,
    });
    if (!applyResult.applied || !applyResult.plan) {
      return null;
    }

    await this.clientRequest('workspace/applyEdit', {
      label: applyResult.plan.title,
      edit: workspaceEditToLsp(applyResult.plan),
    });
    return null;
  }

  private async publishDiagnostics(uri: string): Promise<void> {
    if (!this.registeredClientSessionId || !this.workspaceId) {
      return;
    }
    const service = await this.serviceGet();
    const diagnostics = await service.queryDiagnostics({
      clientSessionId: this.registeredClientSessionId,
      workspaceId: this.workspaceId,
      uri,
    });
    this.sendMessage({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: {
        uri,
        diagnostics: diagnosticsToLsp(diagnostics),
      },
    });
  }

  private clientRequest(method: string, params: unknown): Promise<unknown> {
    const id = this.nextRequestId;
    this.nextRequestId += 1;
    return new Promise((resolve, reject) => {
      this.pendingClientRequests.set(id, { resolve, reject });
      try {
        this.sendMessage({
          jsonrpc: '2.0',
          id,
          method,
          params,
        });
      } catch (error) {
        this.pendingClientRequests.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
}
