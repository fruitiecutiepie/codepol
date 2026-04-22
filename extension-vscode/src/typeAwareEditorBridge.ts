import * as vscode from 'vscode';
import { CODEPOL_LSP_CLIENT_REQUEST_EDITOR_TYPE_AWARE } from '@codepol/lsp/protocol';
import type { VscodeLanguageClientProtocol } from './protocolClient';

const CODEPOL_CALL_HIERARCHY_TOKEN_KEY = 'codepolCallHierarchyToken';

type CodepolEditorTypeAwareRequest = {
  method: string;
  params: unknown;
};

type SerializablePosition = {
  line: number;
  character: number;
};

type SerializableRange = {
  start: SerializablePosition;
  end: SerializablePosition;
};

type SerializableLocation = {
  uri: string;
  range: SerializableRange;
};

type SerializableLocationLink = {
  targetUri: string;
  targetRange: SerializableRange;
  targetSelectionRange: SerializableRange;
  originSelectionRange?: SerializableRange;
};

type SerializableCallHierarchyItem = {
  name: string;
  kind: number;
  tags?: readonly number[];
  detail?: string;
  uri: string;
  range: SerializableRange;
  selectionRange: SerializableRange;
  data?: unknown;
};

type SerializableIncomingCall = {
  from: SerializableCallHierarchyItem;
  fromRanges: SerializableRange[];
};

type SerializableOutgoingCall = {
  to: SerializableCallHierarchyItem;
  fromRanges: SerializableRange[];
};

export function codepolTypeAwareEditorBridgeRegister(
  protocol: Pick<VscodeLanguageClientProtocol, 'serverRequestHandlerRegister'>,
): void {
  const callHierarchyStore = new CodepolCallHierarchyItemStore();
  protocol.serverRequestHandlerRegister(
    CODEPOL_LSP_CLIENT_REQUEST_EDITOR_TYPE_AWARE,
    async (params: unknown) =>
      await codepolTypeAwareEditorRequestHandle(
        params as CodepolEditorTypeAwareRequest,
        callHierarchyStore,
      ),
  );
}

async function codepolTypeAwareEditorRequestHandle(
  request: CodepolEditorTypeAwareRequest,
  callHierarchyStore: CodepolCallHierarchyItemStore,
): Promise<unknown> {
  switch (request.method) {
    case 'textDocument/implementation':
      return await locationsQueryRun(
        'vscode.executeImplementationProvider',
        request.params,
      );
    case 'textDocument/typeDefinition':
      return await locationsQueryRun(
        'vscode.executeTypeDefinitionProvider',
        request.params,
      );
    case 'textDocument/prepareCallHierarchy':
      return await callHierarchyPrepareQueryRun(request.params, callHierarchyStore);
    case 'callHierarchy/incomingCalls':
      return await callHierarchyIncomingQueryRun(request.params, callHierarchyStore);
    case 'callHierarchy/outgoingCalls':
      return await callHierarchyOutgoingQueryRun(request.params, callHierarchyStore);
    default:
      throw new Error(`Unsupported editor type-aware request: ${request.method}`);
  }
}

async function locationsQueryRun(
  command: string,
  params: unknown,
): Promise<Array<SerializableLocation | SerializableLocationLink> | null> {
  const input = locationParamsResolve(params);
  const result = await vscode.commands.executeCommand<
    readonly (vscode.Location | vscode.LocationLink)[] | undefined
  >(
    command,
    vscode.Uri.parse(input.uri),
    new vscode.Position(input.position.line, input.position.character),
  );
  if (!result || result.length === 0) {
    return null;
  }
  return result.map((location) => locationLikeSerialize(location));
}

async function callHierarchyPrepareQueryRun(
  params: unknown,
  callHierarchyStore: CodepolCallHierarchyItemStore,
): Promise<SerializableCallHierarchyItem[] | null> {
  const input = locationParamsResolve(params);
  const result = await vscode.commands.executeCommand<
    readonly vscode.CallHierarchyItem[] | undefined
  >(
    'vscode.prepareCallHierarchy',
    vscode.Uri.parse(input.uri),
    new vscode.Position(input.position.line, input.position.character),
  );
  if (!result || result.length === 0) {
    return null;
  }
  return result.map((item) => callHierarchyStore.itemSerialize(item));
}

async function callHierarchyIncomingQueryRun(
  params: unknown,
  callHierarchyStore: CodepolCallHierarchyItemStore,
): Promise<SerializableIncomingCall[] | null> {
  const item = callHierarchyStore.itemResolve(callHierarchyItemGet(params));
  const result = await vscode.commands.executeCommand<
    readonly vscode.CallHierarchyIncomingCall[] | undefined
  >(
    'vscode.provideIncomingCalls',
    item,
  );
  if (!result || result.length === 0) {
    return null;
  }
  return result.map((call) => ({
    from: callHierarchyStore.itemSerialize(call.from),
    fromRanges: call.fromRanges.map(rangeSerialize),
  }));
}

async function callHierarchyOutgoingQueryRun(
  params: unknown,
  callHierarchyStore: CodepolCallHierarchyItemStore,
): Promise<SerializableOutgoingCall[] | null> {
  const item = callHierarchyStore.itemResolve(callHierarchyItemGet(params));
  const result = await vscode.commands.executeCommand<
    readonly vscode.CallHierarchyOutgoingCall[] | undefined
  >(
    'vscode.provideOutgoingCalls',
    item,
  );
  if (!result || result.length === 0) {
    return null;
  }
  return result.map((call) => ({
    to: callHierarchyStore.itemSerialize(call.to),
    fromRanges: call.fromRanges.map(rangeSerialize),
  }));
}

class CodepolCallHierarchyItemStore {
  private nextId = 1;
  private readonly itemsByToken = new Map<string, vscode.CallHierarchyItem>();

  itemSerialize(item: vscode.CallHierarchyItem): SerializableCallHierarchyItem {
    const token = `codepol-call-hierarchy-${this.nextId++}`;
    this.itemsByToken.set(token, item);
    return {
      name: item.name,
      kind: item.kind,
      tags: item.tags,
      detail: item.detail,
      uri: item.uri.toString(),
      range: rangeSerialize(item.range),
      selectionRange: rangeSerialize(item.selectionRange),
      data: {
        [CODEPOL_CALL_HIERARCHY_TOKEN_KEY]: token,
      },
    };
  }

  itemResolve(item: SerializableCallHierarchyItem): vscode.CallHierarchyItem {
    const token = callHierarchyTokenGet(item);
    const stored = this.itemsByToken.get(token);
    if (!stored) {
      throw new Error(`Unknown call hierarchy token: ${token}`);
    }
    return stored;
  }
}

function locationParamsResolve(params: unknown): {
  uri: string;
  position: SerializablePosition;
} {
  if (
    typeof params !== 'object' ||
    params === null ||
    !('textDocument' in params) ||
    !('position' in params)
  ) {
    throw new Error('Expected textDocument + position params');
  }
  const record = params as {
    textDocument?: { uri?: unknown };
    position?: { line?: unknown; character?: unknown };
  };
  if (typeof record.textDocument?.uri !== 'string') {
    throw new Error('Expected textDocument.uri');
  }
  if (
    typeof record.position?.line !== 'number' ||
    typeof record.position.character !== 'number'
  ) {
    throw new Error('Expected position.line + position.character');
  }
  return {
    uri: record.textDocument.uri,
    position: {
      line: record.position.line,
      character: record.position.character,
    },
  };
}

function callHierarchyItemGet(params: unknown): SerializableCallHierarchyItem {
  if (
    typeof params !== 'object' ||
    params === null ||
    !('item' in params) ||
    typeof (params as { item?: unknown }).item !== 'object' ||
    (params as { item?: unknown }).item === null
  ) {
    throw new Error('Expected call hierarchy item params');
  }
  return (params as { item: SerializableCallHierarchyItem }).item;
}

function callHierarchyTokenGet(item: SerializableCallHierarchyItem): string {
  const token = (item.data as Record<string, unknown> | undefined)?.[
    CODEPOL_CALL_HIERARCHY_TOKEN_KEY
  ];
  if (typeof token !== 'string') {
    throw new Error('Missing call hierarchy token');
  }
  return token;
}

function locationLikeSerialize(
  value: vscode.Location | vscode.LocationLink,
): SerializableLocation | SerializableLocationLink {
  if ('targetUri' in value) {
    return {
      targetUri: value.targetUri.toString(),
      targetRange: rangeSerialize(value.targetRange),
      targetSelectionRange: rangeSerialize(
        value.targetSelectionRange ?? value.targetRange,
      ),
      originSelectionRange: value.originSelectionRange
        ? rangeSerialize(value.originSelectionRange)
        : undefined,
    };
  }
  return {
    uri: value.uri.toString(),
    range: rangeSerialize(value.range),
  };
}

function rangeSerialize(range: vscode.Range): SerializableRange {
  return {
    start: positionSerialize(range.start),
    end: positionSerialize(range.end),
  };
}

function positionSerialize(position: vscode.Position): SerializablePosition {
  return {
    line: position.line,
    character: position.character,
  };
}
