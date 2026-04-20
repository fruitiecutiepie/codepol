/**
 * Class-boundary tests for `CodepolCycleGutterDecorationController`.
 *
 * Phase 5 follow-up — covers the controller's contract at its outer
 * edge:
 *
 * - `attachToEditor` on a non-`file:` scheme is a no-op (the protocol
 *   is never consulted)
 * - the `codepol.diagnostics.showCycleDecorations` setting gates the
 *   controller — when `false`, the controller clears decorations and
 *   never queries the protocol
 * - cycles found by `queryDependencyGraph` are turned into a
 *   per-editor decoration with a hover Markdown that lists the cycle
 *   members
 * - non-cycle files receive no decoration (empty `setDecorations`
 *   payload)
 * - `dispose()` is idempotent
 *
 * `vscode` is mocked at the module boundary; the document fake only
 * needs `uri` and `version`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => {
  type Listener = (event: unknown) => void;

  class FakeRange {
    constructor(
      public startLine: number,
      public startCharacter: number,
      public endLine: number,
      public endCharacter: number,
    ) {}
  }
  class FakeMarkdownString {
    isTrusted = false;
    constructor(public value: string, public _supportThemeIcons?: boolean) {}
  }
  class FakeThemeColor {
    constructor(public id: string) {}
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
    MarkdownString: FakeMarkdownString,
    ThemeColor: FakeThemeColor,
    OverviewRulerLane: { Left: 1, Center: 2, Right: 4, Full: 7 },
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
      // The controller injects its own getConfiguration /
      // onDidChangeConfiguration via the host so the live module-level
      // ones are never consulted in this test.
      getConfiguration: () => ({ get: () => true }),
      onDidChangeConfiguration: (_listener: Listener) => disposableCreate(),
    },
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
  setDecorations: ReturnType<typeof vi.fn>;
};

function fakeEditorCreate(uriString: string, version = 1): FakeEditor {
  return {
    document: {
      uri: { scheme: 'file', toString: () => uriString },
      version,
    },
    setDecorations: vi.fn(),
  };
}

async function vscodeStateGet(): Promise<{
  editorState: { active: unknown; visible: unknown[] };
  activeEditorListeners: Array<(event: unknown) => void>;
  changeDocListeners: Array<(event: unknown) => void>;
  closeDocListeners: Array<(event: unknown) => void>;
}> {
  const vscode = (await import('vscode')) as unknown as {
    __state: {
      editorState: { active: unknown; visible: unknown[] };
      activeEditorListeners: Array<(event: unknown) => void>;
      changeDocListeners: Array<(event: unknown) => void>;
      closeDocListeners: Array<(event: unknown) => void>;
    };
  };
  return vscode.__state;
}

function fakeConfigCreate(value: boolean | undefined) {
  return () => ({
    get<T>(_key: string, fallback?: T): T | undefined {
      if (value === undefined) return fallback;
      return value as unknown as T;
    },
  });
}

const URI_A = 'file:///workspace/src/a.ts';
const URI_B = 'file:///workspace/src/b.ts';
const URI_NON_CYCLE = 'file:///workspace/src/c.ts';

describe('CodepolCycleGutterDecorationController', () => {
  beforeEach(async () => {
    const state = await vscodeStateGet();
    state.editorState.active = undefined;
    state.editorState.visible = [];
    state.activeEditorListeners.length = 0;
    state.changeDocListeners.length = 0;
    state.closeDocListeners.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('attachToEditor on a non-file scheme is a no-op (the protocol is never consulted)', async () => {
    const { CodepolCycleGutterDecorationController } = await import(
      '../extension-vscode/src/cycleGutterDecorationController'
    );
    const queryDependencyGraph = vi.fn();
    const controller = new CodepolCycleGutterDecorationController({
      protocol: { queryDependencyGraph },
      peekCommandId: 'codepol.architecture.peek',
      getConfiguration: fakeConfigCreate(true),
    });
    const editor = {
      document: {
        uri: { scheme: 'untitled', toString: () => 'untitled:Untitled-1' },
        version: 0,
      },
      setDecorations: vi.fn(),
    };
    controller.attachToEditor(editor as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(queryDependencyGraph).not.toHaveBeenCalled();
    expect(editor.setDecorations).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('attachToEditor clears decorations and skips protocol when the setting is off', async () => {
    const { CodepolCycleGutterDecorationController } = await import(
      '../extension-vscode/src/cycleGutterDecorationController'
    );
    const queryDependencyGraph = vi.fn();
    const controller = new CodepolCycleGutterDecorationController({
      protocol: { queryDependencyGraph },
      peekCommandId: 'codepol.architecture.peek',
      getConfiguration: fakeConfigCreate(false),
    });
    const editor = fakeEditorCreate(URI_A);
    controller.attachToEditor(editor as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(queryDependencyGraph).not.toHaveBeenCalled();
    expect(editor.setDecorations).toHaveBeenCalledTimes(1);
    expect(editor.setDecorations.mock.calls[0]![1]).toEqual([]);
    controller.dispose();
  });

  it('decorates an in-cycle file with a hover Markdown listing the cycle members', async () => {
    const { CodepolCycleGutterDecorationController } = await import(
      '../extension-vscode/src/cycleGutterDecorationController'
    );
    const queryDependencyGraph = vi.fn().mockResolvedValue({
      nodes: [
        { uri: URI_A, workspaceRelativePath: 'src/a.ts' },
        { uri: URI_B, workspaceRelativePath: 'src/b.ts' },
        { uri: URI_NON_CYCLE, workspaceRelativePath: 'src/c.ts' },
      ],
      edges: [],
      entryPoints: [],
      cycles: [[URI_A, URI_B]],
    });
    const controller = new CodepolCycleGutterDecorationController({
      protocol: { queryDependencyGraph },
      peekCommandId: 'codepol.architecture.peek',
      getConfiguration: fakeConfigCreate(true),
    });
    const editor = fakeEditorCreate(URI_A);
    controller.attachToEditor(editor as never);
    // Yield until the async refresh completes.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(queryDependencyGraph).toHaveBeenCalledTimes(1);
    expect(editor.setDecorations).toHaveBeenCalledTimes(1);
    const ranges = editor.setDecorations.mock.calls[0]![1] as Array<{
      range: { startLine: number };
      hoverMessage: { value: string; isTrusted: boolean };
    }>;
    expect(ranges).toHaveLength(1);
    expect(ranges[0]!.range.startLine).toBe(0);
    expect(ranges[0]!.hoverMessage.isTrusted).toBe(true);
    expect(ranges[0]!.hoverMessage.value).toContain('Codepol cycle (2 files)');
    expect(ranges[0]!.hoverMessage.value).toContain('src/a.ts');
    expect(ranges[0]!.hoverMessage.value).toContain('src/b.ts');
    expect(ranges[0]!.hoverMessage.value).toContain('codepol.architecture.peek');
    controller.dispose();
  });

  it('emits an empty decoration payload for files outside any known cycle', async () => {
    const { CodepolCycleGutterDecorationController } = await import(
      '../extension-vscode/src/cycleGutterDecorationController'
    );
    const queryDependencyGraph = vi.fn().mockResolvedValue({
      nodes: [
        { uri: URI_A, workspaceRelativePath: 'src/a.ts' },
        { uri: URI_NON_CYCLE, workspaceRelativePath: 'src/c.ts' },
      ],
      edges: [],
      entryPoints: [],
      cycles: [[URI_A, URI_B]],
    });
    const controller = new CodepolCycleGutterDecorationController({
      protocol: { queryDependencyGraph },
      peekCommandId: 'codepol.architecture.peek',
      getConfiguration: fakeConfigCreate(true),
    });
    const editor = fakeEditorCreate(URI_NON_CYCLE);
    controller.attachToEditor(editor as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(editor.setDecorations).toHaveBeenCalledTimes(1);
    expect(editor.setDecorations.mock.calls[0]![1]).toEqual([]);
    controller.dispose();
  });

  it('caches the membership lookup across attachments so a second attach does not re-query', async () => {
    const { CodepolCycleGutterDecorationController } = await import(
      '../extension-vscode/src/cycleGutterDecorationController'
    );
    const queryDependencyGraph = vi.fn().mockResolvedValue({
      nodes: [{ uri: URI_A, workspaceRelativePath: 'src/a.ts' }],
      edges: [],
      entryPoints: [],
      cycles: [],
    });
    const controller = new CodepolCycleGutterDecorationController({
      protocol: { queryDependencyGraph },
      peekCommandId: 'codepol.architecture.peek',
      getConfiguration: fakeConfigCreate(true),
    });
    const editor1 = fakeEditorCreate(URI_A);
    const editor2 = fakeEditorCreate(URI_NON_CYCLE);
    controller.attachToEditor(editor1 as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(queryDependencyGraph).toHaveBeenCalledTimes(1);

    controller.attachToEditor(editor2 as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Second attach reuses the cached lookup — no extra protocol call.
    expect(queryDependencyGraph).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it('dispose tears down without throwing even when no editor was registered', async () => {
    const { CodepolCycleGutterDecorationController } = await import(
      '../extension-vscode/src/cycleGutterDecorationController'
    );
    const controller = new CodepolCycleGutterDecorationController({
      protocol: { queryDependencyGraph: vi.fn() },
      peekCommandId: 'codepol.architecture.peek',
      getConfiguration: fakeConfigCreate(true),
    });
    expect(() => controller.dispose()).not.toThrow();
    // Idempotent.
    expect(() => controller.dispose()).not.toThrow();
  });
});
