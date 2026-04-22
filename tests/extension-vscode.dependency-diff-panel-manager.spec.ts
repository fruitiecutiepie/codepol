/**
 * Manager-level tests for the dependency-diff panel.
 *
 * The view-model spec covers the pure factory. The render spec covers
 * the body HTML. The command spec covers `showDependencyDiff` using
 * mocked protocol + host. This spec covers the slice none of those
 * touch: the `CodepolPanelManager` message router for the diff panel.
 *
 * Specifically:
 *
 * - `dependencyDiffChooseBaselineRequest` goes through `messageHandle`,
 *   calls the host prompt hook, replays the rebuilder with the chosen
 *   label, and re-renders the webview HTML
 * - prompt cancel (`undefined`) aborts the flow
 * - `dependencyDiffUseConfiguredBaselineRequest` reads the host's
 *   configured label and replays the rebuilder with it
 * - file-row click carries a real `file://` URI, so the manager passes
 *   it straight through to `actions.openLocation`
 *
 * `vscode` is mocked at the module boundary so the manager runs with a
 * fake `WebviewPanel` we control.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  dependencyDiffPanelViewModelCreate,
  type DependencyDiffPanelViewModel,
} from '../extension-vscode/src/dependencyDiffViewModels';

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
        return {
          dispose() {
            listener = null;
          },
        };
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

function diffModelCreate(baselineLabel: string): DependencyDiffPanelViewModel {
  return dependencyDiffPanelViewModelCreate({
    result: {
      workspaceId: 'workspace-1',
      baselineLabel,
      currentAnalysisGeneration: 9,
      baselineAnalysisGeneration: 3,
      addedNodes: [
        {
          uri: 'file:///workspace/src/new.ts',
          workspaceRelativePath: 'src/new.ts',
        },
      ],
      removedNodes: [],
      addedEdges: [],
      removedEdges: [],
      newCycles: [],
      removedCycles: [],
    },
    nodeWorkspaceRelativePathGet: (uri) =>
      uri.replace('file:///workspace/', ''),
  });
}

afterEach(() => {
  lastCreatedPanel.value = null;
  vi.clearAllMocks();
});

describe('CodepolPanelManager dependency-diff routing', () => {
  it('runs the prompt hook + rebuilder when the panel posts dependencyDiffChooseBaselineRequest', async () => {
    const { CodepolPanelManager } = await import(
      '../extension-vscode/src/panels/manager'
    );

    const prompt = vi.fn(async () => 'main');
    const manager = new CodepolPanelManager({
      openLocation: async () => {},
      applyEditPlan: async () => {},
      executeCommand: async () => {},
      architectureBaselineLabelPrompt: prompt,
    });

    const initial = diffModelCreate('base');
    const rebuilt = diffModelCreate('main');
    const rebuilder = vi.fn(async () => rebuilt);
    manager.showDependencyDiff(initial, rebuilder);

    const panel = lastCreatedPanel.value!;
    const htmlBefore = panel.webview.html;

    panel.receive({ type: 'dependencyDiffChooseBaselineRequest' });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(prompt).toHaveBeenCalledWith('base');
    expect(rebuilder).toHaveBeenCalledWith({ baselineLabel: 'main' });
    expect(panel.webview.html).not.toBe(htmlBefore);
    expect(panel.webview.html).toContain('Diff against baseline &quot;main&quot;');
  });

  it('cancels the choose-baseline flow when the prompt returns undefined', async () => {
    const { CodepolPanelManager } = await import(
      '../extension-vscode/src/panels/manager'
    );

    const prompt = vi.fn(async () => undefined);
    const manager = new CodepolPanelManager({
      openLocation: async () => {},
      applyEditPlan: async () => {},
      executeCommand: async () => {},
      architectureBaselineLabelPrompt: prompt,
    });

    const initial = diffModelCreate('base');
    const rebuilder = vi.fn(async () => initial);
    manager.showDependencyDiff(initial, rebuilder);

    const panel = lastCreatedPanel.value!;
    panel.receive({ type: 'dependencyDiffChooseBaselineRequest' });
    await Promise.resolve();
    await Promise.resolve();

    expect(prompt).toHaveBeenCalledWith('base');
    expect(rebuilder).not.toHaveBeenCalled();
  });

  it('replays the rebuilder with the configured baseline when the panel posts dependencyDiffUseConfiguredBaselineRequest', async () => {
    const { CodepolPanelManager } = await import(
      '../extension-vscode/src/panels/manager'
    );

    const getBaseline = vi.fn(() => 'configured-main');
    const manager = new CodepolPanelManager({
      openLocation: async () => {},
      applyEditPlan: async () => {},
      executeCommand: async () => {},
      architectureBaselineLabelGet: getBaseline,
    });

    const initial = diffModelCreate('base');
    const rebuilt = diffModelCreate('configured-main');
    const rebuilder = vi.fn(async () => rebuilt);
    manager.showDependencyDiff(initial, rebuilder);

    const panel = lastCreatedPanel.value!;
    panel.receive({ type: 'dependencyDiffUseConfiguredBaselineRequest' });
    await Promise.resolve();
    await Promise.resolve();

    expect(getBaseline).toHaveBeenCalledTimes(1);
    expect(rebuilder).toHaveBeenCalledWith({
      baselineLabel: 'configured-main',
    });
    expect(panel.webview.html).toContain(
      'Diff against baseline &quot;configured-main&quot;',
    );
  });

  it('passes a file-row click straight through to actions.openLocation', async () => {
    const { CodepolPanelManager } = await import(
      '../extension-vscode/src/panels/manager'
    );

    const openLocation = vi.fn(async () => {});
    const manager = new CodepolPanelManager({
      openLocation,
      applyEditPlan: async () => {},
      executeCommand: async () => {},
    });

    manager.showDependencyDiff(diffModelCreate('base'));
    const panel = lastCreatedPanel.value!;

    panel.receive({
      type: 'openLocation',
      uri: 'file:///workspace/src/new.ts',
      line: 0,
      character: 0,
    });
    await Promise.resolve();

    expect(openLocation).toHaveBeenCalledWith({
      uri: 'file:///workspace/src/new.ts',
      line: 0,
      character: 0,
    });
  });
});
