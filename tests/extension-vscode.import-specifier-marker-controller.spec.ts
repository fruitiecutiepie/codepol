/**
 * Class-boundary tests for `ImportSpecifierMarkerController`.
 *
 * The controller is the identity layer for the deferred Phase 5 hover
 * (per `TODO_CODEPOL_LSP_HOVER_MODEL.md`). It maintains a per-document
 * marker list populated from `protocol.queryImportSpecifiersInFile`,
 * applies a subtle dotted-underline decoration, and exposes a
 * `markerAt` lookup the hover provider uses as its identity gate.
 *
 * The fake `vscode` module captures the controller's listener
 * registrations so each test can drive the active-editor /
 * document-change events directly. Refresh debouncing is exercised
 * with vitest's fake timers — that is the only way to hit the actual
 * `queryImportSpecifiersInFile` invocation path without depending on
 * real wall-clock time.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceImportSpecifiersInFileResult } from '@codepol/core';

vi.mock('vscode', () => {
  type Listener = (event: unknown) => void;

  class FakeRange {
    constructor(
      public startLine: number,
      public startCharacter: number,
      public endLine: number,
      public endCharacter: number,
    ) {}
    contains(position: { line: number; character: number }): boolean {
      if (position.line < this.startLine || position.line > this.endLine) {
        return false;
      }
      if (
        position.line === this.startLine &&
        position.character < this.startCharacter
      ) {
        return false;
      }
      if (
        position.line === this.endLine &&
        position.character > this.endCharacter
      ) {
        return false;
      }
      return true;
    }
  }
  class FakePosition {
    constructor(public line: number, public character: number) {}
  }

  const decorationCalls: Array<{ decorationType: unknown; ranges: unknown[] }> = [];
  const editorState: { active: unknown; visible: unknown[] } = {
    active: undefined,
    visible: [],
  };
  const activeEditorListeners: Listener[] = [];
  const changeDocListeners: Listener[] = [];
  const closeDocListeners: Listener[] = [];

  function disposableCreate(): { dispose: () => void } {
    return { dispose: () => {} };
  }

  return {
    Range: FakeRange,
    Position: FakePosition,
    window: {
      createTextEditorDecorationType: () => ({ dispose: () => {} }),
      get visibleTextEditors(): readonly unknown[] {
        return editorState.visible;
      },
      get activeTextEditor(): unknown {
        return editorState.active;
      },
      onDidChangeActiveTextEditor(listener: Listener) {
        activeEditorListeners.push(listener);
        return disposableCreate();
      },
    },
    workspace: {
      onDidChangeTextDocument(listener: Listener) {
        changeDocListeners.push(listener);
        return disposableCreate();
      },
      onDidCloseTextDocument(listener: Listener) {
        closeDocListeners.push(listener);
        return disposableCreate();
      },
    },
    // Test-only state bag exposed so each test can drive events,
    // mutate the active/visible editors, and inspect decoration calls
    // without leaking implementation details across tests.
    __state: {
      decorationCalls,
      editorState,
      activeEditorListeners,
      changeDocListeners,
      closeDocListeners,
    },
  };
});

type FakeEditor = {
  document: {
    uri: { scheme: string; toString(): string };
    version: number;
  };
  setDecorations: (decorationType: unknown, ranges: unknown[]) => void;
};

function fakeEditorCreate(uriString: string, version: number): FakeEditor {
  const decorationCallsLog: Array<{ decorationType: unknown; ranges: unknown[] }> = [];
  return {
    document: {
      uri: { scheme: 'file', toString: () => uriString },
      version,
    },
    setDecorations(decorationType, ranges) {
      decorationCallsLog.push({ decorationType, ranges });
    },
  };
}

async function vscodeStateGet(): Promise<{
  decorationCalls: Array<{ decorationType: unknown; ranges: unknown[] }>;
  editorState: { active: unknown; visible: unknown[] };
  activeEditorListeners: Array<(event: unknown) => void>;
  changeDocListeners: Array<(event: unknown) => void>;
  closeDocListeners: Array<(event: unknown) => void>;
}> {
  const vscode = (await import('vscode')) as unknown as {
    __state: {
      decorationCalls: Array<{ decorationType: unknown; ranges: unknown[] }>;
      editorState: { active: unknown; visible: unknown[] };
      activeEditorListeners: Array<(event: unknown) => void>;
      changeDocListeners: Array<(event: unknown) => void>;
      closeDocListeners: Array<(event: unknown) => void>;
    };
  };
  return vscode.__state;
}

function specifiersResultCreate(
  entries: Array<{
    line: number;
    startChar: number;
    endChar: number;
    target: string;
  }>,
): WorkspaceImportSpecifiersInFileResult {
  return {
    specifiers: entries.map((entry) => ({
      range: {
        start: { line: entry.line, character: entry.startChar },
        end: { line: entry.line, character: entry.endChar },
      },
      resolvedModuleUri: entry.target,
      resolvedModuleWorkspaceRelativePath: entry.target.replace(
        'file:///workspace/',
        '',
      ),
      edgeKind: 'static' as const,
      bindingCount: 1,
    })),
  };
}

function requestSupersededErrorCreate(): Error & {
  code: string;
  data: { kind: string };
} {
  const error = new Error('Request superseded') as Error & {
    code: string;
    data: { kind: string };
  };
  error.code = 'request_superseded';
  error.data = { kind: 'request_superseded' };
  return error;
}

const importerUri = 'file:///workspace/src/importer.ts';
const helperUri = 'file:///workspace/src/helper.ts';

describe('importSpecifierMarkerLocate', () => {
  it('returns the marker whose range contains the position', async () => {
    const vscode = await import('vscode');
    const { importSpecifierMarkerLocate } = await import(
      '../extension-vscode/src/importSpecifierMarkerController'
    );
    const range1 = new vscode.Range(0, 0, 0, 32);
    const range2 = new vscode.Range(2, 0, 2, 28);
    const markers = [
      {
        range: range1 as never,
        resolvedModuleUri: 'file:///workspace/src/a.ts',
        resolvedModuleWorkspaceRelativePath: 'src/a.ts',
        edgeKind: 'static' as const,
        bindingCount: 1,
      },
      {
        range: range2 as never,
        resolvedModuleUri: 'file:///workspace/src/b.ts',
        resolvedModuleWorkspaceRelativePath: 'src/b.ts',
        edgeKind: 'static' as const,
        bindingCount: 2,
      },
    ];
    const hit = importSpecifierMarkerLocate(
      markers,
      new vscode.Position(2, 8) as never,
    );
    expect(hit).toBeDefined();
    expect(hit!.resolvedModuleUri).toBe('file:///workspace/src/b.ts');
  });

  it('returns undefined when no marker covers the position', async () => {
    const vscode = await import('vscode');
    const { importSpecifierMarkerLocate } = await import(
      '../extension-vscode/src/importSpecifierMarkerController'
    );
    const markers = [
      {
        range: new vscode.Range(0, 0, 0, 32) as never,
        resolvedModuleUri: 'file:///workspace/src/a.ts',
        resolvedModuleWorkspaceRelativePath: 'src/a.ts',
        edgeKind: 'static' as const,
        bindingCount: 1,
      },
    ];
    const hit = importSpecifierMarkerLocate(
      markers,
      new vscode.Position(7, 0) as never,
    );
    expect(hit).toBeUndefined();
  });
});

describe('ImportSpecifierMarkerController', () => {
  beforeEach(async () => {
    const state = await vscodeStateGet();
    state.decorationCalls.length = 0;
    state.editorState.active = undefined;
    state.editorState.visible = [];
    state.activeEditorListeners.length = 0;
    state.changeDocListeners.length = 0;
    state.closeDocListeners.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns undefined from markerAt for unknown documents (identity gate stays closed)', async () => {
    const { ImportSpecifierMarkerController } = await import(
      '../extension-vscode/src/importSpecifierMarkerController'
    );
    const vscode = await import('vscode');
    const controller = new ImportSpecifierMarkerController({
      protocol: { queryImportSpecifiersInFile: vi.fn() },
    });
    const hit = controller.markerAt(
      'file:///workspace/src/nope.ts',
      new vscode.Position(0, 0) as never,
    );
    expect(hit).toBeUndefined();
    controller.dispose();
  });

  it('attachToEditor on a non-file scheme is a no-op (the protocol is never consulted)', async () => {
    const { ImportSpecifierMarkerController } = await import(
      '../extension-vscode/src/importSpecifierMarkerController'
    );
    const queryImportSpecifiersInFile = vi.fn();
    const controller = new ImportSpecifierMarkerController({
      protocol: { queryImportSpecifiersInFile },
    });
    const editor = {
      document: {
        uri: { scheme: 'untitled', toString: () => 'untitled:Untitled-1' },
        version: 0,
      },
    };
    controller.attachToEditor(editor as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(queryImportSpecifiersInFile).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('attachToEditor schedules a debounced refresh, then markerAt resolves to the fetched marker', async () => {
    vi.useFakeTimers();
    const { ImportSpecifierMarkerController } = await import(
      '../extension-vscode/src/importSpecifierMarkerController'
    );
    const vscode = await import('vscode');
    const queryImportSpecifiersInFile = vi.fn().mockResolvedValue(
      specifiersResultCreate([
        { line: 0, startChar: 0, endChar: 34, target: helperUri },
      ]),
    );
    const controller = new ImportSpecifierMarkerController({
      protocol: { queryImportSpecifiersInFile },
    });
    const editor = fakeEditorCreate(importerUri, 1);
    controller.attachToEditor(editor as never);

    // Before the debounce expires the protocol must not have been
    // called — keystroke storms otherwise saturate the editor-driven
    // `high` queue lane.
    expect(queryImportSpecifiersInFile).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    // Yield so the queued microtask resolving the protocol mock can
    // run before we assert on controller state.
    await Promise.resolve();
    await Promise.resolve();
    expect(queryImportSpecifiersInFile).toHaveBeenCalledTimes(1);
    expect(queryImportSpecifiersInFile).toHaveBeenCalledWith({
      uri: importerUri,
    });

    const hit = controller.markerAt(
      importerUri,
      new vscode.Position(0, 8) as never,
    );
    expect(hit).toBeDefined();
    expect(hit!.resolvedModuleUri).toBe(helperUri);
    controller.dispose();
  });

  it('drops a stale fetch when the document moved while the response was in flight', async () => {
    vi.useFakeTimers();
    const { ImportSpecifierMarkerController } = await import(
      '../extension-vscode/src/importSpecifierMarkerController'
    );
    const vscode = await import('vscode');
    // Hand-rolled deferred so the test controls when the protocol
    // mock resolves — this is the only way to simulate a response
    // that arrives after the document version moved.
    let resolveFirst: (value: WorkspaceImportSpecifiersInFileResult) => void = () => {};
    const firstPromise = new Promise<WorkspaceImportSpecifiersInFileResult>(
      (resolve) => {
        resolveFirst = resolve;
      },
    );
    const queryImportSpecifiersInFile = vi
      .fn()
      .mockImplementationOnce(() => firstPromise)
      .mockResolvedValue(
        specifiersResultCreate([
          { line: 1, startChar: 0, endChar: 30, target: helperUri },
        ]),
      );
    const controller = new ImportSpecifierMarkerController({
      protocol: { queryImportSpecifiersInFile },
    });
    const editor = fakeEditorCreate(importerUri, 1);
    controller.attachToEditor(editor as never);
    await vi.advanceTimersByTimeAsync(250);
    expect(queryImportSpecifiersInFile).toHaveBeenCalledTimes(1);

    // Mutate the document version BEFORE the first response settles.
    // Anything the controller observes from `firstPromise` must be
    // discarded.
    editor.document.version = 2;
    resolveFirst(
      specifiersResultCreate([
        { line: 9, startChar: 0, endChar: 30, target: helperUri },
      ]),
    );
    await Promise.resolve();
    await Promise.resolve();

    // The line-9 marker MUST NOT be attached because the response is
    // stale. `markerAt` should still return undefined for any cursor.
    const stale = controller.markerAt(
      importerUri,
      new vscode.Position(9, 5) as never,
    );
    expect(stale).toBeUndefined();
    controller.dispose();
  });

  it('swallows request_superseded from queryImportSpecifiersInFile without throwing', async () => {
    vi.useFakeTimers();
    const { ImportSpecifierMarkerController } = await import(
      '../extension-vscode/src/importSpecifierMarkerController'
    );
    const vscode = await import('vscode');
    const queryImportSpecifiersInFile = vi
      .fn()
      .mockRejectedValue(requestSupersededErrorCreate());
    const controller = new ImportSpecifierMarkerController({
      protocol: { queryImportSpecifiersInFile },
    });
    const editor = fakeEditorCreate(importerUri, 1);
    controller.attachToEditor(editor as never);
    await vi.advanceTimersByTimeAsync(250);
    await Promise.resolve();
    await Promise.resolve();
    expect(queryImportSpecifiersInFile).toHaveBeenCalledTimes(1);
    // No marker attached, no exception bubbles up.
    const hit = controller.markerAt(
      importerUri,
      new vscode.Position(0, 0) as never,
    );
    expect(hit).toBeUndefined();
    controller.dispose();
  });

  it('applies setDecorations on the visible editor with the fetched marker ranges', async () => {
    vi.useFakeTimers();
    const { ImportSpecifierMarkerController } = await import(
      '../extension-vscode/src/importSpecifierMarkerController'
    );
    const queryImportSpecifiersInFile = vi.fn().mockResolvedValue(
      specifiersResultCreate([
        { line: 0, startChar: 0, endChar: 34, target: helperUri },
        { line: 2, startChar: 0, endChar: 30, target: helperUri },
      ]),
    );
    const setDecorations = vi.fn();
    const editor = {
      document: {
        uri: { scheme: 'file', toString: () => importerUri },
        version: 1,
      },
      setDecorations,
    };
    const state = await vscodeStateGet();
    state.editorState.visible = [editor];
    const controller = new ImportSpecifierMarkerController({
      protocol: { queryImportSpecifiersInFile },
    });
    controller.attachToEditor(editor as never);
    await vi.advanceTimersByTimeAsync(250);
    await Promise.resolve();
    await Promise.resolve();
    expect(setDecorations).toHaveBeenCalledTimes(1);
    const ranges = setDecorations.mock.calls[0]![1] as Array<{
      startLine: number;
    }>;
    expect(ranges.map((r) => r.startLine)).toEqual([0, 2]);
    controller.dispose();
  });

  it('document-change event triggers a refresh after the debounce window', async () => {
    vi.useFakeTimers();
    const { ImportSpecifierMarkerController } = await import(
      '../extension-vscode/src/importSpecifierMarkerController'
    );
    const queryImportSpecifiersInFile = vi.fn().mockResolvedValue(
      specifiersResultCreate([
        { line: 0, startChar: 0, endChar: 34, target: helperUri },
      ]),
    );
    const state = await vscodeStateGet();
    const controller = new ImportSpecifierMarkerController({
      protocol: { queryImportSpecifiersInFile },
    });

    // Simulate the editor opening (initial attach on activation), then
    // a content change. The first refresh consumes one call; the
    // change should trigger a second.
    const editor = fakeEditorCreate(importerUri, 1);
    controller.attachToEditor(editor as never);
    await vi.advanceTimersByTimeAsync(250);
    await Promise.resolve();
    await Promise.resolve();
    expect(queryImportSpecifiersInFile).toHaveBeenCalledTimes(1);

    // Drive `onDidChangeTextDocument` directly via the captured
    // listener.
    editor.document.version = 2;
    for (const listener of state.changeDocListeners) {
      listener({ document: editor.document });
    }
    await vi.advanceTimersByTimeAsync(250);
    await Promise.resolve();
    await Promise.resolve();
    expect(queryImportSpecifiersInFile).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it('rapid back-to-back changes coalesce into a single refresh (debounce)', async () => {
    vi.useFakeTimers();
    const { ImportSpecifierMarkerController } = await import(
      '../extension-vscode/src/importSpecifierMarkerController'
    );
    const queryImportSpecifiersInFile = vi.fn().mockResolvedValue({
      specifiers: [],
    });
    const state = await vscodeStateGet();
    const controller = new ImportSpecifierMarkerController({
      protocol: { queryImportSpecifiersInFile },
    });
    const editor = fakeEditorCreate(importerUri, 1);
    controller.attachToEditor(editor as never);

    // Fire three changes within the debounce window.
    for (let i = 0; i < 3; i += 1) {
      editor.document.version += 1;
      for (const listener of state.changeDocListeners) {
        listener({ document: editor.document });
      }
      await vi.advanceTimersByTimeAsync(50);
    }
    // Now let the window expire.
    await vi.advanceTimersByTimeAsync(250);
    await Promise.resolve();
    await Promise.resolve();
    // Should have fired ONCE — the last change. attachToEditor's
    // initial schedule is replaced by each subsequent change.
    expect(queryImportSpecifiersInFile).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it('dispose tears down without throwing even when no document state was registered', async () => {
    const { ImportSpecifierMarkerController } = await import(
      '../extension-vscode/src/importSpecifierMarkerController'
    );
    const controller = new ImportSpecifierMarkerController({
      protocol: { queryImportSpecifiersInFile: vi.fn() },
    });
    expect(() => controller.dispose()).not.toThrow();
  });
});
