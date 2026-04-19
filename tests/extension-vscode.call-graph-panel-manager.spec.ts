/**
 * Manager-level tests for the call-graph panel.
 *
 * The view-model spec
 * (`tests/extension-vscode.call-graph-panel.spec.ts`) covers the
 * pure layout / click-translation helpers. This spec covers the
 * piece neither it nor any other spec exercises today: the
 * `CodepolPanelManager.callGraphControlMessageHandle` chain that
 * runs when the user toggles a chip in the panel.
 *
 * Specifically:
 *
 * - chip-click postMessage from the webview goes through the
 *   manager's message router (`messageHandle`), is recognised as a
 *   call-graph control message, parses the value, and invokes the
 *   rebuilder closure with the new direction / depth
 * - the rebuilder's return value replaces `managed.model.data` and
 *   the panel's HTML is re-rendered via `codepolPanelHtmlRender`
 * - clicking a `codepol-symbol://` node fires `openLocation` with
 *   the resolved declaration URI + range from the view-model
 *
 * `vscode` is mocked at the module boundary so the manager runs
 * with a fake `WebviewPanel` we control.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  callGraphPanelViewModelCreate,
  type CallGraphPanelViewModel,
} from '../extension-vscode/src/callGraphViewModels';
import type { WorkspaceDependencyGraphResult } from '@codepol/core';

type ReceiveListener = (message: unknown) => void;

type FakeWebviewPanel = {
  webview: {
    html: string;
    onDidReceiveMessage(listener: ReceiveListener): { dispose(): void };
  };
  title: string;
  reveal(): void;
  dispose(): void;
  onDidDispose(listener: () => void): { dispose(): void };
  receive(message: unknown): void;
};

function fakeWebviewPanelCreate(): FakeWebviewPanel {
  let listener: ReceiveListener | null = null;
  const disposeListeners: Array<() => void> = [];
  return {
    webview: {
      html: '',
      onDidReceiveMessage(register) {
        listener = register;
        return { dispose() { listener = null; } };
      },
    },
    title: '',
    reveal() {},
    dispose() {
      for (const fn of disposeListeners.splice(0)) fn();
    },
    onDidDispose(register) {
      disposeListeners.push(register);
      return { dispose() {} };
    },
    receive(message) {
      listener?.(message);
    },
  };
}

const lastCreatedPanel: { value: FakeWebviewPanel | null } = { value: null };

vi.mock('vscode', () => {
  return {
    EventEmitter: class {
      private listeners: Array<(value: unknown) => void> = [];
      event = (listener: (value: unknown) => void) => {
        this.listeners.push(listener);
        return { dispose: () => {} };
      };
      fire(value?: unknown): void {
        for (const fn of this.listeners) fn(value);
      }
      dispose(): void {
        this.listeners = [];
      }
    },
    ViewColumn: { Beside: 2 },
    window: {
      createWebviewPanel(): unknown {
        const panel = fakeWebviewPanelCreate();
        lastCreatedPanel.value = panel;
        return panel;
      },
    },
  };
});

const SEED_ID = 'seed-symbol-id';
const CALLER_ID = 'caller-symbol-id';
const SEED_URI = `codepol-symbol://${encodeURIComponent(SEED_ID)}`;
const CALLER_URI = `codepol-symbol://${encodeURIComponent(CALLER_ID)}`;

function fixtureGraphCreate(): WorkspaceDependencyGraphResult {
  return {
    nodes: [
      {
        uri: SEED_URI,
        workspaceRelativePath: 'src/seed.ts::seed',
        symbolId: SEED_ID,
        symbolName: 'seed',
        symbolKind: 'function',
        declarationUri: 'file:///workspace/src/seed.ts',
        declarationRange: {
          start: { line: 0, character: 9 },
          end: { line: 0, character: 13 },
        },
      },
      {
        uri: CALLER_URI,
        workspaceRelativePath: 'src/caller.ts::caller',
        symbolId: CALLER_ID,
        symbolName: 'caller',
        symbolKind: 'function',
        declarationUri: 'file:///workspace/src/caller.ts',
        declarationRange: {
          start: { line: 7, character: 4 },
          end: { line: 7, character: 10 },
        },
      },
    ],
    edges: [{ fromUri: CALLER_URI, toUri: SEED_URI }],
    entryPoints: [],
    cycles: [],
  };
}

function modelCreate(direction: 'callers' | 'callees' | 'both'): CallGraphPanelViewModel {
  return callGraphPanelViewModelCreate({
    graph: fixtureGraphCreate(),
    focusSymbolId: SEED_ID,
    focusSymbolName: 'seed',
    direction,
    depth: 1,
  });
}

afterEach(() => {
  lastCreatedPanel.value = null;
  vi.clearAllMocks();
});

describe('CodepolPanelManager call-graph routing', () => {
  it('runs the rebuilder with the new direction when the panel posts callGraphDirectionSet', async () => {
    const { CodepolPanelManager } = await import(
      '../extension-vscode/src/panels/manager'
    );

    const openLocation = vi.fn(async () => {});
    const manager = new CodepolPanelManager({
      openLocation,
      applyEditPlan: async () => {},
      executeCommand: async () => {},
    });

    const initial = modelCreate('both');
    const rebuilt = modelCreate('callers');
    const rebuilder = vi.fn(async () => rebuilt);

    manager.showCallGraph(initial, rebuilder);

    const panel = lastCreatedPanel.value;
    expect(panel).not.toBeNull();
    const htmlBeforeToggle = panel!.webview.html;
    expect(htmlBeforeToggle).toContain('Call Graph: seed');

    panel!.receive({
      type: 'callGraphDirectionSet',
      direction: 'callers',
    });
    // The rebuilder is async — await a microtask so the manager
    // finishes swapping the model.
    await Promise.resolve();
    await Promise.resolve();

    expect(rebuilder).toHaveBeenCalledTimes(1);
    expect(rebuilder).toHaveBeenCalledWith({
      direction: 'callers',
      depth: 1,
    });
    // Webview was repainted with the new model (HTML changes because
    // the chip activation moves from "Both" to "Callers").
    expect(panel!.webview.html).not.toBe(htmlBeforeToggle);
    expect(panel!.webview.html).toContain('cg-chip-active');
  });

  it('ignores a no-op direction toggle so the rebuilder is not re-run', async () => {
    const { CodepolPanelManager } = await import(
      '../extension-vscode/src/panels/manager'
    );

    const manager = new CodepolPanelManager({
      openLocation: async () => {},
      applyEditPlan: async () => {},
      executeCommand: async () => {},
    });

    const initial = modelCreate('both');
    const rebuilder = vi.fn(async () => initial);
    manager.showCallGraph(initial, rebuilder);

    const panel = lastCreatedPanel.value!;
    panel.receive({ type: 'callGraphDirectionSet', direction: 'both' });
    await Promise.resolve();

    expect(rebuilder).not.toHaveBeenCalled();
  });

  it('parses the depth value strings into numbers / unbounded for the rebuilder', async () => {
    const { CodepolPanelManager } = await import(
      '../extension-vscode/src/panels/manager'
    );

    const manager = new CodepolPanelManager({
      openLocation: async () => {},
      applyEditPlan: async () => {},
      executeCommand: async () => {},
    });

    const initial = modelCreate('both');
    const rebuilt = modelCreate('both');
    const rebuilder = vi.fn(async () => rebuilt);
    manager.showCallGraph(initial, rebuilder);

    const panel = lastCreatedPanel.value!;
    panel.receive({ type: 'callGraphDepthSet', depth: '2' });
    await Promise.resolve();
    await Promise.resolve();

    expect(rebuilder).toHaveBeenCalledWith({ direction: 'both', depth: 2 });

    rebuilder.mockClear();
    panel.receive({ type: 'callGraphDepthSet', depth: 'unbounded' });
    await Promise.resolve();
    await Promise.resolve();
    expect(rebuilder).toHaveBeenCalledWith({
      direction: 'both',
      depth: 'unbounded',
    });
  });

  it('translates a codepol-symbol:// node click into the declaration URI + range', async () => {
    const { CodepolPanelManager } = await import(
      '../extension-vscode/src/panels/manager'
    );

    const openLocation = vi.fn(async () => {});
    const manager = new CodepolPanelManager({
      openLocation,
      applyEditPlan: async () => {},
      executeCommand: async () => {},
    });

    const model = modelCreate('both');
    manager.showCallGraph(model);
    const panel = lastCreatedPanel.value!;

    panel.receive({
      type: 'openLocation',
      uri: CALLER_URI,
      // The webview always sends 0/0 — the manager must override
      // these with the declaration range from the view-model.
      line: 0,
      character: 0,
    });
    await Promise.resolve();

    expect(openLocation).toHaveBeenCalledWith({
      uri: 'file:///workspace/src/caller.ts',
      line: 7,
      character: 4,
    });
  });

  it('passes through file:// URIs unchanged (no symbol-translation interference)', async () => {
    const { CodepolPanelManager } = await import(
      '../extension-vscode/src/panels/manager'
    );

    const openLocation = vi.fn(async () => {});
    const manager = new CodepolPanelManager({
      openLocation,
      applyEditPlan: async () => {},
      executeCommand: async () => {},
    });

    const model = modelCreate('both');
    manager.showCallGraph(model);
    const panel = lastCreatedPanel.value!;

    panel.receive({
      type: 'openLocation',
      uri: 'file:///some/other/file.ts',
      line: 12,
      character: 4,
    });
    await Promise.resolve();

    expect(openLocation).toHaveBeenCalledWith({
      uri: 'file:///some/other/file.ts',
      line: 12,
      character: 4,
    });
  });
});
