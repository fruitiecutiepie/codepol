import { randomUUID } from 'node:crypto';
import {
  configFileDiscover,
  diagnosticsRuntimeGet,
  workspaceUriToPath,
  type DiagnosticsConfig,
  type DiagnosticsConfigPatch,
  type EscalationRule,
  type EscalationRuleInput,
  type IndexStatusResult,
  type WorkspaceArchitectureSummaryResult,
  type WorkspaceCallGraphDirection,
  type WorkspaceCodeAction,
  type WorkspaceDeadModulesResult,
  type WorkspaceDependencyDiffResult,
  type WorkspaceDependencyGraphResult,
  type WorkspaceDependencyPathResult,
  type WorkspaceDiagnostic,
  type WorkspaceEditPlan,
  type WorkspaceImpactRadiusDirection,
  type WorkspaceTypeHierarchyDirection,
  type WorkspaceSymbolFlowDirection,
  type WorkspaceSymbolFlowResult,
  type WorkspaceLintRuleDetailsResult,
  type WorkspaceLintRulesResult,
  type WorkspacePrepareRenameResult,
  type WorkspaceRenamePreviewResult,
  type WorkspaceRenameTarget,
  type WorkspaceSearchResult,
  type WorkspacePosition,
  type WorkspaceSemanticDefinitionResult,
  type WorkspaceSemanticHoverResult,
  type WorkspaceSemanticReferencesResult,
  type WorkspaceSymbolAtPositionResult,
  type WorkspaceSymbolDescriptorKind,
  type WorkspaceSymbolLookupResult,
  type WorkspaceSymbolResult,
} from '@codepol/core';
import type { WorkspaceService } from '@codepol/workspace-service/contracts';
import {
  CODEPOL_LSP_COMMAND_APPLY_EDIT_PLAN,
  CODEPOL_LSP_COMMAND_CONFIGURE_DIAGNOSTICS,
  CODEPOL_LSP_COMMAND_ESCALATE_DIAGNOSTICS,
  CODEPOL_LSP_COMMAND_GO_TO_SEMANTIC_DEFINITION,
  CODEPOL_LSP_COMMAND_REVOKE_DIAGNOSTICS_ESCALATION,
  CODEPOL_LSP_COMMAND_SHOW_ARCHITECTURE_LINKS,
  CODEPOL_LSP_REQUEST_ARCHITECTURE_SUMMARY,
  CODEPOL_LSP_REQUEST_CALL_GRAPH,
  CODEPOL_LSP_REQUEST_SYMBOL_FLOW,
  CODEPOL_LSP_REQUEST_DEAD_MODULES,
  CODEPOL_LSP_REQUEST_DEPENDENCY_DIFF,
  CODEPOL_LSP_REQUEST_DEPENDENCY_GRAPH,
  CODEPOL_LSP_REQUEST_DEPENDENCY_PATH,
  CODEPOL_LSP_REQUEST_IMPACT_RADIUS,
  CODEPOL_LSP_REQUEST_TYPE_HIERARCHY,
  CODEPOL_LSP_REQUEST_DIAGNOSTICS_CONFIG,
  CODEPOL_LSP_REQUEST_DIAGNOSTICS_ESCALATIONS,
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
} from './protocol';

const APPLY_EDIT_PLAN_COMMAND = CODEPOL_LSP_COMMAND_APPLY_EDIT_PLAN;
const GO_TO_SEMANTIC_DEFINITION_COMMAND =
  CODEPOL_LSP_COMMAND_GO_TO_SEMANTIC_DEFINITION;
const SHOW_ARCHITECTURE_LINKS_COMMAND =
  CODEPOL_LSP_COMMAND_SHOW_ARCHITECTURE_LINKS;
const STATUS_PROGRESS_TOKEN = 'codepol/index-status';
const STATUS_POLL_INTERVAL_ACTIVE_MS = 25;
const STATUS_POLL_INTERVAL_IDLE_MS = 250;
const PUBLISH_DIAGNOSTICS_DEBOUNCE_MS = 150;

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
    data?: unknown;
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
type TimeoutHandle = ReturnType<typeof setTimeout>;
const bundledRuntime = process.env.CODEPOL_BUNDLED_RUNTIME === '1';
const workspaceServiceDefaultFactory: WorkspaceServiceFactory | undefined =
  bundledRuntime
    ? undefined
    : async () => {
        const runtime = await import('@codepol/workspace-service');
        return runtime.workspaceServiceCreate({
          engine: new runtime.WorkspaceServiceEngine({
            backgroundWarmup: true,
          }),
        });
      };

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

function workspaceSymbolKindToLsp(
  kind: WorkspaceSymbolResult['kind'],
): number {
  if (kind === 'file') {
    return 1;
  }
  return 2;
}

function indexStatusProgressMessageCreate(
  indexStatus: IndexStatusResult,
): string {
  if (indexStatus.status === 'error') {
    return indexStatus.lastError ?? 'Workspace indexing failed';
  }
  if (indexStatus.status === 'ready') {
    return `Workspace ready (${indexStatus.indexedFileCount} indexed files)`;
  }
  if (indexStatus.status === 'warming') {
    return `Warming workspace index (${indexStatus.indexedFileCount} indexed files)`;
  }
  return 'Preparing workspace index';
}

function indexStatusProgressPercentageResolve(
  indexStatus: IndexStatusResult,
): number | undefined {
  if (indexStatus.status === 'ready') {
    return 100;
  }
  if (indexStatus.status === 'warming') {
    return 50;
  }
  if (indexStatus.status === 'cold') {
    return 0;
  }
  return undefined;
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

const CODEPOL_SOURCE_FIX_ALL_KIND = 'source.fixAll.codepol';

type CodeActionKindRequest =
  | { kind: 'quickfix' }
  | { kind: 'source.fixAll' }
  | { kind: 'source.fixAll.rule'; ruleId: string };

/**
 * Map the `context.only` filter sent by the editor into the internal code
 * action kind request. If the filter doesn't mention any of our namespaced
 * `source.fixAll*` kinds we fall back to the `quickfix` path.
 */
function codeActionKindRequestedResolve(
  only: string[] | undefined,
): CodeActionKindRequest {
  if (!only || only.length === 0) {
    return { kind: 'quickfix' };
  }
  const wantsSourceFixAll = only.some(
    (kind) => kind === 'source.fixAll' || kind === CODEPOL_SOURCE_FIX_ALL_KIND,
  );
  for (const entry of only) {
    if (entry.startsWith(`${CODEPOL_SOURCE_FIX_ALL_KIND}.`)) {
      return {
        kind: 'source.fixAll.rule',
        ruleId: entry.slice(CODEPOL_SOURCE_FIX_ALL_KIND.length + 1),
      };
    }
  }
  if (wantsSourceFixAll) {
    return { kind: 'source.fixAll' };
  }
  return { kind: 'quickfix' };
}

function workspaceCodeActionKindToLsp(action: WorkspaceCodeAction): string {
  if (action.kind === 'source.fixAll') {
    return CODEPOL_SOURCE_FIX_ALL_KIND;
  }
  if (action.kind === 'source.fixAll.rule' && action.ruleId) {
    return `${CODEPOL_SOURCE_FIX_ALL_KIND}.${action.ruleId}`;
  }
  return action.kind;
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

function requestCancelledErrorCreate(): Error {
  return new Error('Request cancelled');
}

function errorDataResolve(error: unknown): unknown {
  if (typeof error !== 'object' || error === null || !('data' in error)) {
    return undefined;
  }
  return error.data;
}

function staleDocumentVersionErrorIs(error: unknown): boolean {
  return error instanceof Error && error.message.includes('Document version mismatch');
}

function requestSupersededErrorIs(error: unknown): boolean {
  if (typeof error === 'object' && error !== null) {
    if ('code' in error && error.code === 'request_superseded') {
      return true;
    }
    const data = errorDataResolve(error);
    if (
      typeof data === 'object' &&
      data !== null &&
      'kind' in data &&
      data.kind === 'request_superseded'
    ) {
      return true;
    }
  }
  return error instanceof Error && error.message.includes('Request superseded');
}

export class CodepolLspServer {
  private service: WorkspaceService | undefined;
  private readonly serviceFactory: WorkspaceServiceFactory;
  private servicePromise: Promise<WorkspaceService> | undefined;
  private reconnectPromise: Promise<WorkspaceService> | undefined;
  private readonly sendMessage: SendMessage;
  private readonly clientInstanceId: string;
  private readonly stableClientSessionId: string;
  private readonly documents = new Map<string, LspDocument>();
  private readonly pendingClientRequests = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private readonly activeRequestIds = new Set<number | string>();
  private readonly canceledRequestIds = new Set<number | string>();
  private readonly requestAbortControllers = new Map<
    number | string,
    AbortController
  >();
  private readonly diagnosticsStateVersions = new Map<string, number>();
  private diagnosticsPublishedAnalysisGeneration: number | undefined;
  private registeredClientSessionId: string | undefined;
  private workspaceId: string | undefined;
  private workspaceRootPath: string | undefined;
  private workspaceConfigPath: string | undefined;
  private workspaceEpoch = 0;
  private nextRequestId = 1;
  private readonly timers: {
    setTimeout: (callback: () => void, delayMs: number) => TimeoutHandle;
    clearTimeout: (handle: TimeoutHandle | undefined) => void;
  };
  private readonly statusPollIntervalsMs: {
    active: number;
    idle: number;
  };
  private readonly publishDebounceMs: number;
  private readonly debouncedPublishTimers = new Map<string, TimeoutHandle>();
  private supportsWorkDoneProgress = false;
  private statusPollGeneration = 0;
  private statusPollTimer: TimeoutHandle | undefined;
  private statusProgressActive = false;
  private shutdownRequested = false;

  constructor(options: {
    service?: WorkspaceService;
    serviceFactory?: WorkspaceServiceFactory;
    sendMessage: SendMessage;
    clientInstanceId?: string;
    clientSessionId?: string;
    timers?: {
      setTimeout?: (callback: () => void, delayMs: number) => TimeoutHandle;
      clearTimeout?: (handle: TimeoutHandle | undefined) => void;
    };
    statusPollIntervalsMs?: {
      active?: number;
      idle?: number;
    };
    publishDebounceMs?: number;
  }) {
    this.service = options.service;
    this.serviceFactory =
      options.serviceFactory ??
      workspaceServiceDefaultFactory ??
      (() => {
        throw new Error('Codepol LSP requires an explicit workspace service factory in bundled mode');
      });
    this.sendMessage = options.sendMessage;
    this.clientInstanceId = options.clientInstanceId ?? `codepol-lsp-${process.pid}`;
    this.stableClientSessionId = options.clientSessionId ?? `client-${randomUUID()}`;
    this.timers = {
      setTimeout: options.timers?.setTimeout ?? setTimeout,
      clearTimeout: options.timers?.clearTimeout ?? clearTimeout,
    };
    this.statusPollIntervalsMs = {
      active:
        options.statusPollIntervalsMs?.active ?? STATUS_POLL_INTERVAL_ACTIVE_MS,
      idle: options.statusPollIntervalsMs?.idle ?? STATUS_POLL_INTERVAL_IDLE_MS,
    };
    this.publishDebounceMs =
      options.publishDebounceMs ?? PUBLISH_DIAGNOSTICS_DEBOUNCE_MS;
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

  private serviceReset(): void {
    this.service = undefined;
    this.servicePromise = undefined;
  }

  private workspaceEpochBump(): void {
    this.workspaceEpoch += 1;
    this.diagnosticsPublishedAnalysisGeneration = undefined;
  }

  private diagnosticsStateVersionBump(uri: string): number {
    const next = (this.diagnosticsStateVersions.get(uri) ?? 0) + 1;
    this.diagnosticsStateVersions.set(uri, next);
    return next;
  }

  private debouncedPublishCancel(uri: string): void {
    const handle = this.debouncedPublishTimers.get(uri);
    if (handle === undefined) {
      return;
    }
    this.timers.clearTimeout(handle);
    this.debouncedPublishTimers.delete(uri);
  }

  private debouncedPublishCancelAll(): void {
    for (const handle of this.debouncedPublishTimers.values()) {
      this.timers.clearTimeout(handle);
    }
    this.debouncedPublishTimers.clear();
  }

  private async debouncedPublishFire(uri: string): Promise<void> {
    this.debouncedPublishTimers.delete(uri);
    const expectedStateVersion = this.diagnosticsStateVersionBump(uri);
    try {
      await this.serviceCall((service) =>
        this.publishDiagnostics(uri, { service, expectedStateVersion }),
      );
    } catch {
      // Swallow so a failed debounced publish never escapes as an unhandled rejection
      // when the underlying timer is the real Node setTimeout.
    }
  }

  private debouncedPublishSchedule(uri: string): void {
    this.debouncedPublishCancel(uri);
    if (this.publishDebounceMs <= 0) {
      void this.debouncedPublishFire(uri);
      return;
    }
    const handle = this.timers.setTimeout(
      () => this.debouncedPublishFire(uri),
      this.publishDebounceMs,
    );
    this.debouncedPublishTimers.set(uri, handle);
  }

  private diagnosticsPublishCurrentIs(input: {
    uri: string;
    expectedStateVersion: number;
    expectedWorkspaceEpoch: number;
    expectedClientSessionId: string;
    expectedWorkspaceId: string;
  }): boolean {
    return (
      this.workspaceEpoch === input.expectedWorkspaceEpoch &&
      this.registeredClientSessionId === input.expectedClientSessionId &&
      this.workspaceId === input.expectedWorkspaceId &&
      (this.diagnosticsStateVersions.get(input.uri) ?? 0) === input.expectedStateVersion
    );
  }

  private requestIdTrackStart(id: JsonRpcId): void {
    if (typeof id === 'number' || typeof id === 'string') {
      this.activeRequestIds.add(id);
      this.requestAbortControllers.set(id, new AbortController());
    }
  }

  private requestIdTrackEnd(id: JsonRpcId): void {
    if (typeof id === 'number' || typeof id === 'string') {
      this.activeRequestIds.delete(id);
      this.canceledRequestIds.delete(id);
      this.requestAbortControllers.delete(id);
    }
  }

  private requestAbortSignalGet(id: JsonRpcId): AbortSignal | undefined {
    if (typeof id !== 'number' && typeof id !== 'string') {
      return undefined;
    }
    return this.requestAbortControllers.get(id)?.signal;
  }

  private requestCanceledConsume(id: JsonRpcId): boolean {
    if (
      (typeof id === 'number' || typeof id === 'string') &&
      this.canceledRequestIds.has(id)
    ) {
      this.canceledRequestIds.delete(id);
      return true;
    }
    return false;
  }

  private requestCancelHandle(params: { id?: JsonRpcId }): void {
    if (typeof params.id === 'number') {
      const pending = this.pendingClientRequests.get(params.id);
      if (pending) {
        this.pendingClientRequests.delete(params.id);
        pending.reject(new Error('Request cancelled'));
        return;
      }
    }
    if (
      (typeof params.id === 'number' || typeof params.id === 'string') &&
      this.activeRequestIds.has(params.id)
    ) {
      this.requestAbortControllers.get(params.id)?.abort();
      this.canceledRequestIds.add(params.id);
    }
  }

  private serviceErrorRecoverableIs(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }
    return [
      'Daemon connection closed',
      'daemon unavailable',
      'ECONNREFUSED',
      'ENOENT',
      'socket hang up',
      'EPIPE',
      'write after end',
    ].some((pattern) => error.message.includes(pattern));
  }

  private async serviceReconnect(): Promise<WorkspaceService> {
    if (this.reconnectPromise) {
      return this.reconnectPromise;
    }

    this.reconnectPromise = (async () => {
      this.serviceReset();
      const service = await this.serviceGet();
      if (!this.workspaceRootPath || !this.workspaceConfigPath) {
        return service;
      }

      const registered = await service.registerClientSession({
        clientKind: 'lsp',
        clientInstanceId: this.clientInstanceId,
        clientSessionId: this.stableClientSessionId,
      });
      this.registeredClientSessionId = registered.clientSessionId;

      const attached = await service.attachWorkspace({
        clientSessionId: this.registeredClientSessionId,
        rootPath: this.workspaceRootPath,
        configPath: this.workspaceConfigPath,
      });
      await this.workspaceReplayApply({
        service,
        workspaceId: attached.workspaceId,
        workspaceInstanceId: attached.workspaceInstanceId,
      });
      this.workspaceId = attached.workspaceId;
      this.workspaceEpochBump();
      this.statusPollingStart();
      return service;
    })().finally(() => {
      this.reconnectPromise = undefined;
    });

    return this.reconnectPromise;
  }

  private async serviceCall<T>(
    operation: (service: WorkspaceService) => Promise<T>,
    options: { signal?: AbortSignal } = {},
  ): Promise<T> {
    const service = await this.serviceGet();
    try {
      return await operation(service);
    } catch (error) {
      if (options.signal?.aborted) {
        throw requestCancelledErrorCreate();
      }
      if (
        !this.serviceErrorRecoverableIs(error) ||
        !this.registeredClientSessionId ||
        !this.workspaceRootPath ||
        !this.workspaceConfigPath
      ) {
        throw error;
      }
      const reconnected = await this.serviceReconnect();
      if (options.signal?.aborted) {
        throw requestCancelledErrorCreate();
      }
      return operation(reconnected);
    }
  }

  private async serviceSessionClose(): Promise<void> {
    this.statusPollingStop({ endProgress: true });
    this.debouncedPublishCancelAll();
    const activeService =
      this.service ??
      (this.servicePromise ? await this.servicePromise.catch(() => undefined) : undefined);

    if (activeService && this.registeredClientSessionId) {
      try {
        await activeService.closeClientSession({
          clientSessionId: this.registeredClientSessionId,
        });
      } catch {
        // ignore close failures during shutdown/exit
      }
    }

    if (
      activeService &&
      'close' in activeService &&
      typeof (activeService as { close?: () => Promise<void> }).close === 'function'
    ) {
      try {
        await (activeService as { close: () => Promise<void> }).close();
      } catch {
        // ignore transport close failures during shutdown/exit
      }
    }

    this.registeredClientSessionId = undefined;
    this.workspaceId = undefined;
    this.serviceReset();
  }

  private statusPollingStart(): void {
    if (
      !this.supportsWorkDoneProgress ||
      this.shutdownRequested ||
      !this.registeredClientSessionId ||
      !this.workspaceId
    ) {
      return;
    }
    this.statusPollGeneration += 1;
    this.timers.clearTimeout(this.statusPollTimer);
    this.statusPollTimer = undefined;
    this.statusPollSchedule(0, this.statusPollGeneration);
  }

  private statusPollingStop(
    options: {
      endProgress: boolean;
    },
  ): void {
    this.statusPollGeneration += 1;
    this.timers.clearTimeout(this.statusPollTimer);
    this.statusPollTimer = undefined;
    if (options.endProgress) {
      this.statusProgressEnd('Workspace status polling stopped');
    }
  }

  private statusPollSchedule(delayMs: number, generation: number): void {
    this.statusPollTimer = this.timers.setTimeout(() => {
      void this.statusPollRun(generation);
    }, delayMs);
  }

  private async statusPollRun(generation: number): Promise<void> {
    if (
      generation !== this.statusPollGeneration ||
      this.shutdownRequested ||
      !this.registeredClientSessionId ||
      !this.workspaceId
    ) {
      return;
    }

    try {
      const indexStatus = await this.serviceCall(async (service) => {
        const nextIndexStatus = await service.queryIndexStatus({
          clientSessionId: this.registeredClientSessionId!,
          workspaceId: this.workspaceId!,
          requestId: `lsp-status-poll:${generation}:${this.workspaceEpoch}`,
        });
        if (
          nextIndexStatus.status === 'ready' &&
          nextIndexStatus.analysisGeneration !==
            this.diagnosticsPublishedAnalysisGeneration
        ) {
          await this.publishOpenDocumentDiagnostics({
            service,
            analysisGeneration: nextIndexStatus.analysisGeneration,
          });
        }
        return nextIndexStatus;
      });
      if (generation !== this.statusPollGeneration) {
        return;
      }

      const message = indexStatusProgressMessageCreate(indexStatus);
      const percentage = indexStatusProgressPercentageResolve(indexStatus);
      if (indexStatus.status === 'cold' || indexStatus.status === 'warming') {
        this.statusProgressBeginOrReport(message, percentage);
      } else if (this.statusProgressActive) {
        this.statusProgressEnd(message);
      }

      const nextDelay =
        indexStatus.status === 'cold' || indexStatus.status === 'warming'
          ? this.statusPollIntervalsMs.active
          : this.statusPollIntervalsMs.idle;
      this.statusPollSchedule(nextDelay, generation);
    } catch (error) {
      if (generation !== this.statusPollGeneration) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      if (this.statusProgressActive) {
        this.statusProgressEnd(message);
      }
      this.statusPollSchedule(this.statusPollIntervalsMs.idle, generation);
    }
  }

  private statusProgressBeginOrReport(
    message: string,
    percentage?: number,
  ): void {
    if (!this.statusProgressActive) {
      this.clientRequestSendNoWait('window/workDoneProgress/create', {
        token: STATUS_PROGRESS_TOKEN,
      });
      this.statusProgressActive = true;
      this.sendMessage({
        jsonrpc: '2.0',
        method: '$/progress',
        params: {
          token: STATUS_PROGRESS_TOKEN,
          value: {
            kind: 'begin',
            title: 'Codepol workspace index',
            message,
            percentage,
          },
        },
      });
      return;
    }

    this.sendMessage({
      jsonrpc: '2.0',
      method: '$/progress',
      params: {
        token: STATUS_PROGRESS_TOKEN,
        value: {
          kind: 'report',
          message,
          percentage,
        },
      },
    });
  }

  private statusProgressEnd(message: string): void {
    if (!this.statusProgressActive) {
      return;
    }
    this.statusProgressActive = false;
    this.sendMessage({
      jsonrpc: '2.0',
      method: '$/progress',
      params: {
        token: STATUS_PROGRESS_TOKEN,
        value: {
          kind: 'end',
          message,
        },
      },
    });
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
    this.requestIdTrackStart(message.id);
    try {
      if (this.requestCanceledConsume(message.id)) {
        this.sendMessage({
          jsonrpc: '2.0',
          id: message.id,
          error: {
            code: -32800,
            message: 'Request cancelled',
          },
        });
        return;
      }
      const signal = this.requestAbortSignalGet(message.id);
      const result = await this.methodHandle(message.method, message.params, {
        requestId: message.id,
        signal,
      });
      if (this.requestCanceledConsume(message.id)) {
        this.sendMessage({
          jsonrpc: '2.0',
          id: message.id,
          error: {
            code: -32800,
            message: 'Request cancelled',
          },
        });
        return;
      }
      this.sendMessage({
        jsonrpc: '2.0',
        id: message.id,
        result,
      });
    } catch (error) {
      if (this.requestCanceledConsume(message.id)) {
        this.sendMessage({
          jsonrpc: '2.0',
          id: message.id,
          error: {
            code: -32800,
            message: 'Request cancelled',
          },
        });
        return;
      }
      this.sendMessage({
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : String(error),
          data: errorDataResolve(error),
        },
      });
    } finally {
      this.requestIdTrackEnd(message.id);
    }
  }

  private async notificationHandle(message: JsonRpcNotification): Promise<void> {
    if (message.method === '$/cancelRequest') {
      this.requestCancelHandle(message.params as { id?: JsonRpcId });
      return;
    }
    await this.methodHandle(message.method, message.params);
  }

  private async methodHandle(
    method: string,
    params: unknown,
    context: { requestId?: JsonRpcId; signal?: AbortSignal } = {},
  ): Promise<unknown> {
    switch (method) {
      case 'initialize':
        return this.initializeHandle(params as {
          rootUri?: string | null;
          rootPath?: string | null;
          workspaceFolders?: Array<{ uri: string }>;
          capabilities?: {
            window?: {
              workDoneProgress?: boolean;
            };
          };
        });
      case 'initialized':
        return null;
      case 'shutdown':
        await this.shutdownHandle();
        return null;
      case 'exit':
        await this.exitHandle();
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
        }, context);
      case 'workspace/executeCommand':
        return this.executeCommandHandle(params as {
          command: string;
          arguments?: Array<unknown>;
        }, context);
      case CODEPOL_LSP_REQUEST_DIAGNOSTICS_CONFIG:
        return diagnosticsRuntimeGet().getConfig();
      case CODEPOL_LSP_REQUEST_DIAGNOSTICS_ESCALATIONS:
        return diagnosticsRuntimeGet().listEscalations();
      case 'workspace/symbol':
        return this.workspaceSymbolHandle(params as {
          query?: string;
        }, context);
      case CODEPOL_LSP_REQUEST_INDEX_STATUS:
        return this.indexStatusHandle(context);
      case CODEPOL_LSP_REQUEST_LINT_RULES:
        return this.lintRulesHandle(context);
      case CODEPOL_LSP_REQUEST_LINT_RULE_DETAILS:
        return this.lintRuleDetailsHandle(params as {
          ruleId?: string;
        }, context);
      case CODEPOL_LSP_REQUEST_DEPENDENCY_GRAPH:
        return this.dependencyGraphHandle(context);
      case CODEPOL_LSP_REQUEST_IMPACT_RADIUS:
        return this.impactRadiusHandle(params as {
          uri?: string;
          direction?: WorkspaceImpactRadiusDirection;
          depth?: number;
        }, context);
      case CODEPOL_LSP_REQUEST_DEPENDENCY_PATH:
        return this.dependencyPathHandle(params as {
          fromUri?: string;
          toUri?: string;
          maxPaths?: number;
        }, context);
      case CODEPOL_LSP_REQUEST_DEAD_MODULES:
        return this.deadModulesHandle(params as {
          entryPointUris?: string[];
        }, context);
      case CODEPOL_LSP_REQUEST_DEPENDENCY_DIFF:
        return this.dependencyDiffHandle(params as {
          baselineLabel?: string;
          baselineGraph?: WorkspaceDependencyGraphResult;
        }, context);
      case CODEPOL_LSP_REQUEST_CALL_GRAPH:
        return this.callGraphHandle(params as {
          symbolId?: string;
          direction?: WorkspaceCallGraphDirection;
          depth?: number;
          requireTypeAware?: boolean;
        }, context);
      case CODEPOL_LSP_REQUEST_SYMBOL_FLOW:
        return this.symbolFlowHandle(params as {
          symbolId?: string;
          direction?: WorkspaceSymbolFlowDirection;
        }, context);
      case CODEPOL_LSP_REQUEST_TYPE_HIERARCHY:
        return this.typeHierarchyHandle(params as {
          symbolId?: string;
          direction?: WorkspaceTypeHierarchyDirection;
          depth?: number;
        }, context);
      case CODEPOL_LSP_REQUEST_SEMANTIC_SEARCH:
        return this.semanticSearchHandle(params as {
          query?: string;
          limit?: number;
        }, context);
      case CODEPOL_LSP_REQUEST_SEMANTIC_DEFINITION:
        return this.semanticDefinitionHandle(params as {
          uri?: string;
        }, context);
      case CODEPOL_LSP_REQUEST_SEMANTIC_REFERENCES:
        return this.semanticReferencesHandle(params as {
          uri?: string;
        }, context);
      case CODEPOL_LSP_REQUEST_SEMANTIC_HOVER:
        return this.semanticHoverHandle(params as {
          uri?: string;
        }, context);
      case CODEPOL_LSP_REQUEST_PREPARE_RENAME:
        return this.prepareRenameHandle(params as {
          target?: WorkspaceRenameTarget;
        }, context);
      case CODEPOL_LSP_REQUEST_PREVIEW_RENAME:
        return this.previewRenameHandle(params as {
          target?: WorkspaceRenameTarget;
          newName?: string;
        }, context);
      case CODEPOL_LSP_REQUEST_ARCHITECTURE_SUMMARY:
        return this.architectureSummaryHandle(context);
      case CODEPOL_LSP_REQUEST_SYMBOL_LOOKUP:
        return this.symbolLookupHandle(params as {
          name?: string;
          kind?: WorkspaceSymbolDescriptorKind;
          scopeUri?: string;
          limit?: number;
        }, context);
      case CODEPOL_LSP_REQUEST_SYMBOL_AT_POSITION:
        return this.symbolAtPositionHandle(params as {
          uri?: string;
          position?: WorkspacePosition;
        }, context);
      default:
        return null;
    }
  }

  private async initializeHandle(params: {
    rootUri?: string | null;
    rootPath?: string | null;
    workspaceFolders?: Array<{ uri: string }>;
    capabilities?: {
      window?: {
        workDoneProgress?: boolean;
      };
    };
  }): Promise<unknown> {
    this.supportsWorkDoneProgress = params.capabilities?.window?.workDoneProgress === true;
    this.shutdownRequested = false;
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
        const configPath = await configFileDiscover(rootPath);
        if (!configPath) {
          throw new Error('No codepol config file found');
        }
        this.workspaceRootPath = rootPath;
        this.workspaceConfigPath = configPath;
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
        this.workspaceEpochBump();
        this.statusPollingStart();
      } catch {
        this.workspaceId = undefined;
      }
    }

    return {
      capabilities: {
        textDocumentSync: 2,
        codeActionProvider: {
          codeActionKinds: [
            'quickfix',
            'source.fixAll',
            'source.fixAll.codepol',
          ],
          resolveProvider: false,
        },
        workspaceSymbolProvider: true,
        executeCommandProvider: {
          commands: [
            APPLY_EDIT_PLAN_COMMAND,
            GO_TO_SEMANTIC_DEFINITION_COMMAND,
            SHOW_ARCHITECTURE_LINKS_COMMAND,
            CODEPOL_LSP_COMMAND_CONFIGURE_DIAGNOSTICS,
            CODEPOL_LSP_COMMAND_ESCALATE_DIAGNOSTICS,
            CODEPOL_LSP_COMMAND_REVOKE_DIAGNOSTICS_ESCALATION,
          ],
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

  private async publishOpenDocumentDiagnostics(input: {
    service: WorkspaceService;
    analysisGeneration?: number;
  }): Promise<void> {
    if (!this.registeredClientSessionId || !this.workspaceId) {
      return;
    }

    for (const document of this.documents.values()) {
      this.debouncedPublishCancel(document.uri);
      const expectedStateVersion = this.diagnosticsStateVersionBump(document.uri);
      await this.publishDiagnostics(document.uri, {
        service: input.service,
        expectedStateVersion,
      });
    }

    this.diagnosticsPublishedAnalysisGeneration = input.analysisGeneration;
  }

  private async shutdownHandle(): Promise<void> {
    this.shutdownRequested = true;
    await this.serviceSessionClose();
  }

  private async exitHandle(): Promise<void> {
    this.shutdownRequested = true;
    await this.serviceSessionClose();
  }

  private async didOpenHandle(params: {
    textDocument: { uri: string; version: number; text: string };
  }): Promise<void> {
    if (!this.registeredClientSessionId || !this.workspaceId) {
      return;
    }
    this.documents.set(params.textDocument.uri, {
      uri: params.textDocument.uri,
      version: params.textDocument.version,
      text: params.textDocument.text,
    });
    this.debouncedPublishCancel(params.textDocument.uri);
    const expectedStateVersion = this.diagnosticsStateVersionBump(
      params.textDocument.uri,
    );
    await this.serviceCall(async (service) => {
      await service.openOverlay({
        clientSessionId: this.registeredClientSessionId!,
        workspaceId: this.workspaceId!,
        uri: params.textDocument.uri,
        version: params.textDocument.version,
        text: params.textDocument.text,
      });
      await this.publishDiagnostics(params.textDocument.uri, {
        service,
        expectedStateVersion,
      });
    });
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
    await this.serviceCall((service) =>
      service.updateOverlay({
        clientSessionId: this.registeredClientSessionId!,
        workspaceId: this.workspaceId!,
        uri: current.uri,
        version: nextDocument.version,
        text: nextDocument.text,
      }),
    );
    this.debouncedPublishSchedule(current.uri);
  }

  private async didCloseHandle(params: {
    textDocument: { uri: string };
  }): Promise<void> {
    if (!this.registeredClientSessionId || !this.workspaceId) {
      return;
    }
    this.documents.delete(params.textDocument.uri);
    this.debouncedPublishCancel(params.textDocument.uri);
    const expectedStateVersion = this.diagnosticsStateVersionBump(
      params.textDocument.uri,
    );
    await this.serviceCall(async (service) => {
      await service.closeOverlay({
        clientSessionId: this.registeredClientSessionId!,
        workspaceId: this.workspaceId!,
        uri: params.textDocument.uri,
      });
      await this.publishDiagnostics(params.textDocument.uri, {
        service,
        expectedStateVersion,
      });
    });
  }

  private async codeActionHandle(params: {
    textDocument: { uri: string };
    range?: LspRange;
    context: {
      diagnostics?: Array<{ data?: { id?: string } }>;
      only?: string[];
    };
  }, context: { requestId?: JsonRpcId; signal?: AbortSignal } = {}): Promise<unknown> {
    if (!this.registeredClientSessionId || !this.workspaceId) {
      return [];
    }
    const document = this.documents.get(params.textDocument.uri);
    const requested = codeActionKindRequestedResolve(params.context.only);
    try {
      return await this.serviceCall(async (service) => {
        if (requested.kind === 'source.fixAll') {
          const action = await service.planSourceFixAll({
            clientSessionId: this.registeredClientSessionId!,
            workspaceId: this.workspaceId!,
            uri: params.textDocument.uri,
            version: document?.version ?? 0,
            requestId:
              context.requestId === undefined || context.requestId === null
                ? undefined
                : `lsp-code-action:${String(context.requestId)}:source-fix-all`,
            signal: context.signal,
          });
          return action ? [this.codeActionToLsp(action)] : [];
        }
        if (requested.kind === 'source.fixAll.rule') {
          const action = await service.planFileFixAll({
            clientSessionId: this.registeredClientSessionId!,
            workspaceId: this.workspaceId!,
            uri: params.textDocument.uri,
            version: document?.version ?? 0,
            includeRuleIds: [requested.ruleId],
            requestId:
              context.requestId === undefined || context.requestId === null
                ? undefined
                : `lsp-code-action:${String(context.requestId)}:source-fix-all-rule:${requested.ruleId}`,
            signal: context.signal,
          });
          return action ? [this.codeActionToLsp(action)] : [];
        }

        const diagnosticIds = new Set(
          (params.context.diagnostics ?? [])
            .map((diagnostic) => diagnostic.data?.id)
            .filter((diagnosticId): diagnosticId is string => typeof diagnosticId === 'string'),
        );
        if (params.range) {
          const diagnostics = await service.queryDiagnostics({
            clientSessionId: this.registeredClientSessionId!,
            workspaceId: this.workspaceId!,
            uri: params.textDocument.uri,
            requestId:
              context.requestId === undefined || context.requestId === null
                ? undefined
                : `lsp-code-action:${String(context.requestId)}:diagnostics`,
            documentVersion: document?.version,
            signal: context.signal,
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
        if (context.signal?.aborted) {
          return [];
        }
        const actions = await service.queryCodeActions({
          clientSessionId: this.registeredClientSessionId!,
          workspaceId: this.workspaceId!,
          uri: params.textDocument.uri,
          version: document?.version ?? 0,
          diagnosticIds: [...diagnosticIds],
          requestId:
            context.requestId === undefined || context.requestId === null
              ? undefined
              : `lsp-code-action:${String(context.requestId)}:actions`,
          signal: context.signal,
        });
        return actions.map((action: WorkspaceCodeAction) => this.codeActionToLsp(action));
      }, {
        signal: context.signal,
      });
    } catch (error) {
      if (staleDocumentVersionErrorIs(error) || requestSupersededErrorIs(error)) {
        return [];
      }
      throw error;
    }
  }

  private codeActionToLsp(action: WorkspaceCodeAction): unknown {
    const lspKind = workspaceCodeActionKindToLsp(action);
    return {
      title: action.title,
      kind: lspKind,
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
    arguments?: Array<unknown>;
  }, context: { requestId?: JsonRpcId; signal?: AbortSignal } = {}): Promise<unknown> {
    if (params.command === CODEPOL_LSP_COMMAND_CONFIGURE_DIAGNOSTICS) {
      const patch = (params.arguments?.[0] ?? {}) as DiagnosticsConfigPatch;
      return this.diagnosticsConfigureHandle(patch);
    }
    if (params.command === CODEPOL_LSP_COMMAND_ESCALATE_DIAGNOSTICS) {
      const rule = (params.arguments?.[0] ?? undefined) as EscalationRuleInput | undefined;
      if (!rule) return null;
      return this.diagnosticsEscalateHandle(rule);
    }
    if (params.command === CODEPOL_LSP_COMMAND_REVOKE_DIAGNOSTICS_ESCALATION) {
      const arg = params.arguments?.[0] as { id?: string } | undefined;
      if (!arg?.id) return null;
      return this.diagnosticsRevokeEscalationHandle(arg.id);
    }

    if (!this.registeredClientSessionId || !this.workspaceId) {
      return null;
    }

    if (params.command === APPLY_EDIT_PLAN_COMMAND) {
      const firstArg = params.arguments?.[0] as { planId?: string } | undefined;
      const planId = firstArg?.planId;
      if (!planId) {
        return null;
      }

      const documentVersions: Record<string, number> = {};
      for (const document of this.documents.values()) {
        documentVersions[document.uri] = document.version;
      }

      return this.serviceCall(async (service) => {
        const applyResult = await service.applyEditPlan({
          clientSessionId: this.registeredClientSessionId!,
          workspaceId: this.workspaceId!,
          planId,
          documentVersions,
          requestId:
            context.requestId === undefined || context.requestId === null
              ? undefined
              : `lsp-execute-command:${String(context.requestId)}`,
          signal: context.signal,
        });
        if (!applyResult.applied || !applyResult.plan) {
          return null;
        }
        if (context.signal?.aborted) {
          return null;
        }

        await this.clientRequest('workspace/applyEdit', {
          label: applyResult.plan.title,
          edit: workspaceEditToLsp(applyResult.plan),
        });
        return null;
      }, {
        signal: context.signal,
      });
    }

    const uriArg = params.arguments?.[0] as { uri?: string } | undefined;
    const uri = uriArg?.uri;
    if (!uri) {
      return null;
    }

    if (params.command === GO_TO_SEMANTIC_DEFINITION_COMMAND) {
      return this.semanticDefinitionHandle({ uri }, context);
    }
    if (params.command === SHOW_ARCHITECTURE_LINKS_COMMAND) {
      return this.semanticReferencesHandle({ uri }, context);
    }

    return null;
  }

  private async diagnosticsConfigureHandle(
    patch: DiagnosticsConfigPatch,
  ): Promise<DiagnosticsConfig> {
    const runtime = diagnosticsRuntimeGet();
    runtime.setConfig(patch);
    const localConfig = runtime.getConfig();
    // Mirror the change to the daemon (if the LSP is fronting a daemon service).
    try {
      const anyService = this.service as unknown as {
        setDiagnosticsConfig?: (
          input: DiagnosticsConfigPatch,
        ) => Promise<DiagnosticsConfig>;
      };
      if (typeof anyService.setDiagnosticsConfig === 'function') {
        await anyService.setDiagnosticsConfig(patch);
      }
    } catch (err) {
      console.warn(
        `[codepol-lsp] failed to forward diagnostics config: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    return localConfig;
  }

  private async diagnosticsEscalateHandle(
    rule: EscalationRuleInput,
  ): Promise<{ id: string; expiresAtUnixMs: number; escalations: readonly EscalationRule[] }> {
    const runtime = diagnosticsRuntimeGet();
    const handle = runtime.escalate(rule);
    try {
      const anyService = this.service as unknown as {
        setDiagnosticsEscalation?: (
          input: EscalationRuleInput,
        ) => Promise<{ id: string; expiresAtUnixMs: number; escalations: readonly EscalationRule[] }>;
      };
      if (typeof anyService.setDiagnosticsEscalation === 'function') {
        await anyService.setDiagnosticsEscalation(rule);
      }
    } catch (err) {
      console.warn(
        `[codepol-lsp] failed to forward diagnostics escalation: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    return {
      id: handle.id,
      expiresAtUnixMs: handle.expiresAtUnixMs,
      escalations: runtime.listEscalations(),
    };
  }

  private async diagnosticsRevokeEscalationHandle(
    id: string,
  ): Promise<{ revoked: boolean; escalations: readonly EscalationRule[] }> {
    const runtime = diagnosticsRuntimeGet();
    const revoked = runtime.revokeEscalation(id);
    try {
      const anyService = this.service as unknown as {
        revokeDiagnosticsEscalation?: (
          id: string,
        ) => Promise<{ revoked: boolean; escalations: readonly EscalationRule[] }>;
      };
      if (typeof anyService.revokeDiagnosticsEscalation === 'function') {
        await anyService.revokeDiagnosticsEscalation(id);
      }
    } catch (err) {
      console.warn(
        `[codepol-lsp] failed to forward diagnostics escalation revoke: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    return {
      revoked,
      escalations: runtime.listEscalations(),
    };
  }

  private async workspaceSymbolHandle(
    params: {
      query?: string;
    },
    context: { requestId?: JsonRpcId; signal?: AbortSignal } = {},
  ): Promise<unknown> {
    if (!this.registeredClientSessionId || !this.workspaceId) {
      return [];
    }

    return this.serviceCall(async (service) => {
      const symbols = await service.queryWorkspaceSymbols({
        clientSessionId: this.registeredClientSessionId!,
        workspaceId: this.workspaceId!,
        query: params.query ?? '',
        requestId:
          context.requestId === undefined || context.requestId === null
            ? undefined
            : `lsp-workspace-symbol:${String(context.requestId)}`,
        signal: context.signal,
      });
      return symbols.map((symbol) => this.workspaceSymbolToLsp(symbol));
    }, {
      signal: context.signal,
    });
  }

  private workspaceSymbolToLsp(
    symbol: WorkspaceSymbolResult,
  ): unknown {
    return {
      name: symbol.name,
      kind: workspaceSymbolKindToLsp(symbol.kind),
      location: symbol.location,
      containerName: symbol.containerName ?? 'Codepol',
      data: {
        source: symbol.source,
        semanticClass: symbol.semanticClass,
        detail: symbol.detail,
        score: symbol.score,
      },
    };
  }

  private async indexStatusHandle(
    context: { requestId?: JsonRpcId; signal?: AbortSignal } = {},
  ): Promise<IndexStatusResult | null> {
    if (!this.registeredClientSessionId || !this.workspaceId) {
      return null;
    }

    return this.serviceCall((service) =>
      service.queryIndexStatus({
        clientSessionId: this.registeredClientSessionId!,
        workspaceId: this.workspaceId!,
        requestId:
          context.requestId === undefined || context.requestId === null
            ? undefined
            : `lsp-codepol-index-status:${String(context.requestId)}`,
        signal: context.signal,
      }), {
      signal: context.signal,
    });
  }

  private async lintRulesHandle(
    context: { requestId?: JsonRpcId; signal?: AbortSignal } = {},
  ): Promise<WorkspaceLintRulesResult | null> {
    if (!this.registeredClientSessionId || !this.workspaceId) {
      return null;
    }

    return this.serviceCall((service) =>
      service.queryLintRules({
        clientSessionId: this.registeredClientSessionId!,
        workspaceId: this.workspaceId!,
        requestId:
          context.requestId === undefined || context.requestId === null
            ? undefined
            : `lsp-codepol-lint-rules:${String(context.requestId)}`,
        signal: context.signal,
      }), {
      signal: context.signal,
    });
  }

  private async lintRuleDetailsHandle(
    params: {
      ruleId?: string;
    },
    context: { requestId?: JsonRpcId; signal?: AbortSignal } = {},
  ): Promise<WorkspaceLintRuleDetailsResult | null> {
    if (!this.registeredClientSessionId || !this.workspaceId || !params.ruleId) {
      return null;
    }
    const ruleId = params.ruleId;

    return this.serviceCall((service) =>
      service.queryLintRuleDetails({
        clientSessionId: this.registeredClientSessionId!,
        workspaceId: this.workspaceId!,
        ruleId,
        requestId:
          context.requestId === undefined || context.requestId === null
            ? undefined
            : `lsp-codepol-lint-rule-details:${String(context.requestId)}`,
        signal: context.signal,
      }), {
      signal: context.signal,
    });
  }

  private async dependencyGraphHandle(
    context: { requestId?: JsonRpcId; signal?: AbortSignal } = {},
  ): Promise<WorkspaceDependencyGraphResult | null> {
    if (!this.registeredClientSessionId || !this.workspaceId) {
      return null;
    }

    return this.serviceCall((service) =>
      service.queryDependencyGraph({
        clientSessionId: this.registeredClientSessionId!,
        workspaceId: this.workspaceId!,
        requestId:
          context.requestId === undefined || context.requestId === null
            ? undefined
            : `lsp-codepol-dependency-graph:${String(context.requestId)}`,
        signal: context.signal,
      }), {
      signal: context.signal,
    });
  }

  private async impactRadiusHandle(
    params: {
      uri?: string;
      direction?: WorkspaceImpactRadiusDirection;
      depth?: number;
    },
    context: { requestId?: JsonRpcId; signal?: AbortSignal } = {},
  ): Promise<WorkspaceDependencyGraphResult | null> {
    if (
      !this.registeredClientSessionId ||
      !this.workspaceId ||
      !params.uri ||
      !params.direction
    ) {
      return null;
    }
    const uri = params.uri;
    const direction = params.direction;

    return this.serviceCall((service) =>
      service.queryImpactRadius({
        clientSessionId: this.registeredClientSessionId!,
        workspaceId: this.workspaceId!,
        uri,
        direction,
        depth: params.depth,
        requestId:
          context.requestId === undefined || context.requestId === null
            ? undefined
            : `lsp-codepol-impact-radius:${String(context.requestId)}`,
        signal: context.signal,
      }), {
      signal: context.signal,
    });
  }

  private async dependencyPathHandle(
    params: {
      fromUri?: string;
      toUri?: string;
      maxPaths?: number;
    },
    context: { requestId?: JsonRpcId; signal?: AbortSignal } = {},
  ): Promise<WorkspaceDependencyPathResult | null> {
    if (
      !this.registeredClientSessionId ||
      !this.workspaceId ||
      !params.fromUri ||
      !params.toUri
    ) {
      return null;
    }
    const fromUri = params.fromUri;
    const toUri = params.toUri;

    return this.serviceCall((service) =>
      service.queryDependencyPath({
        clientSessionId: this.registeredClientSessionId!,
        workspaceId: this.workspaceId!,
        fromUri,
        toUri,
        maxPaths: params.maxPaths,
        requestId:
          context.requestId === undefined || context.requestId === null
            ? undefined
            : `lsp-codepol-dependency-path:${String(context.requestId)}`,
        signal: context.signal,
      }), {
      signal: context.signal,
    });
  }

  private async deadModulesHandle(
    params: {
      entryPointUris?: string[];
    },
    context: { requestId?: JsonRpcId; signal?: AbortSignal } = {},
  ): Promise<WorkspaceDeadModulesResult | null> {
    if (!this.registeredClientSessionId || !this.workspaceId) {
      return null;
    }

    return this.serviceCall((service) =>
      service.queryDeadModules({
        clientSessionId: this.registeredClientSessionId!,
        workspaceId: this.workspaceId!,
        entryPointUris: params.entryPointUris,
        requestId:
          context.requestId === undefined || context.requestId === null
            ? undefined
            : `lsp-codepol-dead-modules:${String(context.requestId)}`,
        signal: context.signal,
      }), {
      signal: context.signal,
    });
  }

  private async dependencyDiffHandle(
    params: {
      baselineLabel?: string;
      baselineGraph?: WorkspaceDependencyGraphResult;
    },
    context: { requestId?: JsonRpcId; signal?: AbortSignal } = {},
  ): Promise<WorkspaceDependencyDiffResult | null> {
    if (!this.registeredClientSessionId || !this.workspaceId) {
      return null;
    }
    const hasLabel = params.baselineLabel !== undefined;
    const hasGraph = params.baselineGraph !== undefined;
    if (hasLabel === hasGraph) {
      return null;
    }

    return this.serviceCall((service) =>
      service.queryDependencyDiff({
        clientSessionId: this.registeredClientSessionId!,
        workspaceId: this.workspaceId!,
        baselineLabel: params.baselineLabel,
        baselineGraph: params.baselineGraph,
        requestId:
          context.requestId === undefined || context.requestId === null
            ? undefined
            : `lsp-codepol-dependency-diff:${String(context.requestId)}`,
        signal: context.signal,
      }), {
      signal: context.signal,
    });
  }

  private async callGraphHandle(
    params: {
      symbolId?: string;
      direction?: WorkspaceCallGraphDirection;
      depth?: number;
      requireTypeAware?: boolean;
    },
    context: { requestId?: JsonRpcId; signal?: AbortSignal } = {},
  ): Promise<WorkspaceDependencyGraphResult | null> {
    if (
      !this.registeredClientSessionId ||
      !this.workspaceId ||
      !params.symbolId ||
      !params.direction
    ) {
      return null;
    }
    const symbolId = params.symbolId;
    const direction = params.direction;

    return this.serviceCall((service) =>
      service.queryCallGraph({
        clientSessionId: this.registeredClientSessionId!,
        workspaceId: this.workspaceId!,
        symbolId,
        direction,
        depth: params.depth,
        requireTypeAware: params.requireTypeAware,
        requestId:
          context.requestId === undefined || context.requestId === null
            ? undefined
            : `lsp-codepol-call-graph:${String(context.requestId)}`,
        signal: context.signal,
      }), {
      signal: context.signal,
    });
  }

  private async symbolFlowHandle(
    params: {
      symbolId?: string;
      direction?: WorkspaceSymbolFlowDirection;
    },
    context: { requestId?: JsonRpcId; signal?: AbortSignal } = {},
  ): Promise<WorkspaceSymbolFlowResult | null> {
    if (
      !this.registeredClientSessionId ||
      !this.workspaceId ||
      !params.symbolId ||
      !params.direction
    ) {
      return null;
    }
    const symbolId = params.symbolId;
    const direction = params.direction;

    return this.serviceCall((service) =>
      service.querySymbolFlow({
        clientSessionId: this.registeredClientSessionId!,
        workspaceId: this.workspaceId!,
        symbolId,
        direction,
        requestId:
          context.requestId === undefined || context.requestId === null
            ? undefined
            : `lsp-codepol-symbol-flow:${String(context.requestId)}`,
        signal: context.signal,
      }), {
      signal: context.signal,
    });
  }

  private async typeHierarchyHandle(
    params: {
      symbolId?: string;
      direction?: WorkspaceTypeHierarchyDirection;
      depth?: number;
    },
    context: { requestId?: JsonRpcId; signal?: AbortSignal } = {},
  ): Promise<WorkspaceDependencyGraphResult | null> {
    if (
      !this.registeredClientSessionId ||
      !this.workspaceId ||
      !params.symbolId ||
      !params.direction
    ) {
      return null;
    }
    const symbolId = params.symbolId;
    const direction = params.direction;

    return this.serviceCall((service) =>
      service.queryTypeHierarchy({
        clientSessionId: this.registeredClientSessionId!,
        workspaceId: this.workspaceId!,
        symbolId,
        direction,
        depth: params.depth,
        requestId:
          context.requestId === undefined || context.requestId === null
            ? undefined
            : `lsp-codepol-type-hierarchy:${String(context.requestId)}`,
        signal: context.signal,
      }), {
      signal: context.signal,
    });
  }

  private async semanticSearchHandle(
    params: {
      query?: string;
      limit?: number;
    },
    context: { requestId?: JsonRpcId; signal?: AbortSignal } = {},
  ): Promise<WorkspaceSearchResult[] | null> {
    if (!this.registeredClientSessionId || !this.workspaceId) {
      return null;
    }

    return this.serviceCall((service) =>
      service.querySemanticSearch({
        clientSessionId: this.registeredClientSessionId!,
        workspaceId: this.workspaceId!,
        query: params.query ?? '',
        limit: params.limit,
        requestId:
          context.requestId === undefined || context.requestId === null
            ? undefined
            : `lsp-codepol-semantic-search:${String(context.requestId)}`,
        signal: context.signal,
      }), {
      signal: context.signal,
    });
  }

  private async semanticDefinitionHandle(
    params: {
      uri?: string;
    },
    context: { requestId?: JsonRpcId; signal?: AbortSignal } = {},
  ): Promise<WorkspaceSemanticDefinitionResult | null> {
    if (!this.registeredClientSessionId || !this.workspaceId || !params.uri) {
      return null;
    }
    const uri = params.uri;

    return this.serviceCall((service) =>
      service.querySemanticDefinition({
        clientSessionId: this.registeredClientSessionId!,
        workspaceId: this.workspaceId!,
        uri,
        requestId:
          context.requestId === undefined || context.requestId === null
            ? undefined
            : `lsp-codepol-semantic-definition:${String(context.requestId)}`,
        signal: context.signal,
      }), {
      signal: context.signal,
    });
  }

  private async semanticReferencesHandle(
    params: {
      uri?: string;
    },
    context: { requestId?: JsonRpcId; signal?: AbortSignal } = {},
  ): Promise<WorkspaceSemanticReferencesResult | null> {
    if (!this.registeredClientSessionId || !this.workspaceId || !params.uri) {
      return null;
    }
    const uri = params.uri;

    return this.serviceCall((service) =>
      service.querySemanticReferences({
        clientSessionId: this.registeredClientSessionId!,
        workspaceId: this.workspaceId!,
        uri,
        requestId:
          context.requestId === undefined || context.requestId === null
            ? undefined
            : `lsp-codepol-semantic-references:${String(context.requestId)}`,
        signal: context.signal,
      }), {
      signal: context.signal,
    });
  }

  private async semanticHoverHandle(
    params: {
      uri?: string;
    },
    context: { requestId?: JsonRpcId; signal?: AbortSignal } = {},
  ): Promise<WorkspaceSemanticHoverResult | null> {
    if (!this.registeredClientSessionId || !this.workspaceId || !params.uri) {
      return null;
    }
    const uri = params.uri;

    return this.serviceCall((service) =>
      service.querySemanticHover({
        clientSessionId: this.registeredClientSessionId!,
        workspaceId: this.workspaceId!,
        uri,
        requestId:
          context.requestId === undefined || context.requestId === null
            ? undefined
            : `lsp-codepol-semantic-hover:${String(context.requestId)}`,
        signal: context.signal,
      }), {
      signal: context.signal,
    });
  }

  private async prepareRenameHandle(
    params: {
      target?: WorkspaceRenameTarget;
    },
    context: { requestId?: JsonRpcId; signal?: AbortSignal } = {},
  ): Promise<WorkspacePrepareRenameResult | null> {
    if (!this.registeredClientSessionId || !this.workspaceId || !params.target) {
      return null;
    }
    const target = params.target;

    return this.serviceCall((service) =>
      service.prepareRename({
        clientSessionId: this.registeredClientSessionId!,
        workspaceId: this.workspaceId!,
        target,
        requestId:
          context.requestId === undefined || context.requestId === null
            ? undefined
            : `lsp-codepol-prepare-rename:${String(context.requestId)}`,
        signal: context.signal,
      }), {
      signal: context.signal,
    });
  }

  private async previewRenameHandle(
    params: {
      target?: WorkspaceRenameTarget;
      newName?: string;
    },
    context: { requestId?: JsonRpcId; signal?: AbortSignal } = {},
  ): Promise<WorkspaceRenamePreviewResult | null> {
    if (
      !this.registeredClientSessionId ||
      !this.workspaceId ||
      !params.target ||
      params.newName === undefined
    ) {
      return null;
    }
    const target = params.target;
    const newName = params.newName;

    return this.serviceCall((service) =>
      service.previewRename({
        clientSessionId: this.registeredClientSessionId!,
        workspaceId: this.workspaceId!,
        target,
        newName,
        requestId:
          context.requestId === undefined || context.requestId === null
            ? undefined
            : `lsp-codepol-preview-rename:${String(context.requestId)}`,
        signal: context.signal,
      }), {
      signal: context.signal,
    });
  }

  private async architectureSummaryHandle(
    context: { requestId?: JsonRpcId; signal?: AbortSignal } = {},
  ): Promise<WorkspaceArchitectureSummaryResult | null> {
    if (!this.registeredClientSessionId || !this.workspaceId) {
      return null;
    }

    return this.serviceCall((service) =>
      service.queryArchitectureSummary({
        clientSessionId: this.registeredClientSessionId!,
        workspaceId: this.workspaceId!,
        requestId:
          context.requestId === undefined || context.requestId === null
            ? undefined
            : `lsp-codepol-architecture-summary:${String(context.requestId)}`,
        signal: context.signal,
      }), {
      signal: context.signal,
    });
  }

  private async symbolLookupHandle(
    params: {
      name?: string;
      kind?: WorkspaceSymbolDescriptorKind;
      scopeUri?: string;
      limit?: number;
    },
    context: { requestId?: JsonRpcId; signal?: AbortSignal } = {},
  ): Promise<WorkspaceSymbolLookupResult | null> {
    if (
      !this.registeredClientSessionId ||
      !this.workspaceId ||
      params.name === undefined
    ) {
      return null;
    }
    const name = params.name;

    return this.serviceCall((service) =>
      service.querySymbolLookup({
        clientSessionId: this.registeredClientSessionId!,
        workspaceId: this.workspaceId!,
        name,
        kind: params.kind,
        scopeUri: params.scopeUri,
        limit: params.limit,
        requestId:
          context.requestId === undefined || context.requestId === null
            ? undefined
            : `lsp-codepol-symbol-lookup:${String(context.requestId)}`,
        signal: context.signal,
      }), {
      signal: context.signal,
    });
  }

  private async symbolAtPositionHandle(
    params: {
      uri?: string;
      position?: WorkspacePosition;
    },
    context: { requestId?: JsonRpcId; signal?: AbortSignal } = {},
  ): Promise<WorkspaceSymbolAtPositionResult | null> {
    if (
      !this.registeredClientSessionId ||
      !this.workspaceId ||
      !params.uri ||
      !params.position
    ) {
      return null;
    }
    const uri = params.uri;
    const position = params.position;

    return this.serviceCall((service) =>
      service.querySymbolAtPosition({
        clientSessionId: this.registeredClientSessionId!,
        workspaceId: this.workspaceId!,
        uri,
        position,
        requestId:
          context.requestId === undefined || context.requestId === null
            ? undefined
            : `lsp-codepol-symbol-at-position:${String(context.requestId)}`,
        signal: context.signal,
      }), {
      signal: context.signal,
    });
  }

  private async publishDiagnostics(
    uri: string,
    options: {
      expectedStateVersion: number;
      service?: WorkspaceService;
    },
  ): Promise<void> {
    if (!this.registeredClientSessionId || !this.workspaceId) {
      return;
    }
    const expectedWorkspaceEpoch = this.workspaceEpoch;
    const expectedClientSessionId = this.registeredClientSessionId;
    const expectedWorkspaceId = this.workspaceId;
    const activeService = options.service ?? (await this.serviceGet());
    const documentVersion = this.documents.get(uri)?.version;
    let diagnostics: WorkspaceDiagnostic[];
    try {
      diagnostics = await activeService.queryDiagnostics({
        clientSessionId: expectedClientSessionId,
        workspaceId: expectedWorkspaceId,
        uri,
        requestId: `lsp-publish-diagnostics:${expectedWorkspaceEpoch}:${options.expectedStateVersion}:${uri}`,
        documentVersion,
      });
    } catch (error) {
      if (staleDocumentVersionErrorIs(error) || requestSupersededErrorIs(error)) {
        return;
      }
      throw error;
    }
    if (
      !this.diagnosticsPublishCurrentIs({
        uri,
        expectedStateVersion: options.expectedStateVersion,
        expectedWorkspaceEpoch,
        expectedClientSessionId,
        expectedWorkspaceId,
      })
    ) {
      return;
    }
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

  private clientRequestSendNoWait(method: string, params: unknown): void {
    const id = this.nextRequestId;
    this.nextRequestId += 1;
    this.sendMessage({
      jsonrpc: '2.0',
      id,
      method,
      params,
    });
  }
}
