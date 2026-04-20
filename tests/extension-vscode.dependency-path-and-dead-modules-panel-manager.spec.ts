/**
 * Manager-level tests for the dependency-path and dead-modules panels.
 *
 * The view-model specs
 * (`tests/extension-vscode.dependency-path-view-models.spec.ts`,
 * `tests/extension-vscode.dead-modules-view-models.spec.ts`) cover the
 * pure factories. The render spec
 * (`tests/extension-vscode.panels-render.spec.ts`) covers the body
 * HTML. The command spec
 * (`tests/extension-vscode.commands.spec.ts`) covers the controller
 * methods using mocks. This spec covers the slice none of those touch:
 * the `CodepolPanelManager` message router for the new panels.
 *
 * Specifically:
 *
 * - chip-click postMessage (`dependencyPathMaxPathsSet`) flows through
 *   `messageHandle`, parses the value, calls the rebuilder, and
 *   re-renders the webview HTML
 * - "Use natural entry points" postMessage
 *   (`deadModulesEntryPointsSet` with `entryPointUris: undefined`)
 *   triggers the rebuilder with `undefined` and rewrites the panel
 * - "Configure entry points..." postMessage
 *   (`deadModulesEntryPointsConfigureRequest`) calls the host's
 *   `deadModulesEntryPointsPick` hook and threads the picked URIs
 *   through the rebuilder
 * - file-row click on either panel emits `openLocation` with the
 *   real `data-open-uri` (no synthetic-URI translation, so the manager
 *   passes the URI straight through to `actions.openLocation`)
 *
 * `vscode` is mocked at the module boundary so the manager runs with a
 * fake `WebviewPanel` we control.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  dependencyPathPanelViewModelCreate,
  type DependencyPathPanelViewModel,
} from '../extension-vscode/src/dependencyPathViewModels';
import {
  deadModulesPanelViewModelCreate,
  type DeadModulesPanelViewModel,
} from '../extension-vscode/src/deadModulesViewModels';

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

const FROM_URI = 'file:///workspace/src/app.ts';
const MIDDLE_URI = 'file:///workspace/src/middle.ts';
const TO_URI = 'file:///workspace/src/leaf.ts';

function dependencyPathModelCreate(input: {
  maxPaths: 5 | 10 | 20;
}): DependencyPathPanelViewModel {
  return dependencyPathPanelViewModelCreate({
    result: {
      paths: [[FROM_URI, MIDDLE_URI, TO_URI]],
      shortestLength: 2,
      truncated: input.maxPaths < 20,
    },
    fromUri: FROM_URI,
    toUri: TO_URI,
    fromWorkspaceRelativePath: 'src/app.ts',
    toWorkspaceRelativePath: 'src/leaf.ts',
    nodeWorkspaceRelativePathGet: (uri) =>
      uri.replace('file:///workspace/', ''),
    maxPaths: input.maxPaths,
  });
}

function deadModulesModelCreate(input: {
  entryPointUris?: string[];
}): DeadModulesPanelViewModel {
  return deadModulesPanelViewModelCreate({
    result: {
      unreachable: ['file:///workspace/src/orphan.ts'],
    },
    entryPointUris: input.entryPointUris,
    nodeWorkspaceRelativePathGet: (uri) =>
      uri.replace('file:///workspace/', ''),
  });
}

afterEach(() => {
  lastCreatedPanel.value = null;
  vi.clearAllMocks();
});

describe('CodepolPanelManager dependency-path routing', () => {
  it('runs the rebuilder with the parsed maxPaths when the panel posts dependencyPathMaxPathsSet', async () => {
    const { CodepolPanelManager } = await import(
      '../extension-vscode/src/panels/manager'
    );
    const manager = new CodepolPanelManager({
      openLocation: async () => {},
      applyEditPlan: async () => {},
      executeCommand: async () => {},
    });

    const initial = dependencyPathModelCreate({ maxPaths: 5 });
    const rebuilt = dependencyPathModelCreate({ maxPaths: 20 });
    const rebuilder = vi.fn(async () => rebuilt);

    manager.showDependencyPath(initial, rebuilder);

    const panel = lastCreatedPanel.value;
    expect(panel).not.toBeNull();
    const htmlBeforeToggle = panel!.webview.html;
    expect(htmlBeforeToggle).toContain('data-dp-chip-value="5"');

    panel!.receive({
      type: 'dependencyPathMaxPathsSet',
      maxPaths: '20',
    });
    // Two microtasks: one for the rebuilder promise, one for the html
    // swap that runs after it resolves.
    await Promise.resolve();
    await Promise.resolve();

    expect(rebuilder).toHaveBeenCalledTimes(1);
    expect(rebuilder).toHaveBeenCalledWith({ maxPaths: 20 });
    // HTML re-rendered: the active chip moves from 5 to 20.
    expect(panel!.webview.html).not.toBe(htmlBeforeToggle);
    expect(panel!.webview.html).toContain('data-dp-chip-value="20"');
  });

  it('ignores a no-op chip toggle so the rebuilder is not re-run', async () => {
    const { CodepolPanelManager } = await import(
      '../extension-vscode/src/panels/manager'
    );
    const manager = new CodepolPanelManager({
      openLocation: async () => {},
      applyEditPlan: async () => {},
      executeCommand: async () => {},
    });

    const initial = dependencyPathModelCreate({ maxPaths: 5 });
    const rebuilder = vi.fn(async () => initial);
    manager.showDependencyPath(initial, rebuilder);

    const panel = lastCreatedPanel.value!;
    panel.receive({ type: 'dependencyPathMaxPathsSet', maxPaths: '5' });
    await Promise.resolve();
    await Promise.resolve();

    expect(rebuilder).not.toHaveBeenCalled();
  });

  it('drops a chip message with an unrecognised value (defensive parse)', async () => {
    const { CodepolPanelManager } = await import(
      '../extension-vscode/src/panels/manager'
    );
    const manager = new CodepolPanelManager({
      openLocation: async () => {},
      applyEditPlan: async () => {},
      executeCommand: async () => {},
    });

    const initial = dependencyPathModelCreate({ maxPaths: 5 });
    const rebuilder = vi.fn(async () => initial);
    manager.showDependencyPath(initial, rebuilder);

    const panel = lastCreatedPanel.value!;
    panel.receive({ type: 'dependencyPathMaxPathsSet', maxPaths: '7' });
    await Promise.resolve();

    expect(rebuilder).not.toHaveBeenCalled();
  });

  it('passes a file-row click straight through to actions.openLocation (no symbol translation)', async () => {
    const { CodepolPanelManager } = await import(
      '../extension-vscode/src/panels/manager'
    );
    const openLocation = vi.fn(async () => {});
    const manager = new CodepolPanelManager({
      openLocation,
      applyEditPlan: async () => {},
      executeCommand: async () => {},
    });

    const model = dependencyPathModelCreate({ maxPaths: 5 });
    manager.showDependencyPath(model);

    const panel = lastCreatedPanel.value!;
    panel.receive({
      type: 'openLocation',
      uri: MIDDLE_URI,
      line: 0,
      character: 0,
    });
    await Promise.resolve();

    expect(openLocation).toHaveBeenCalledWith({
      uri: MIDDLE_URI,
      line: 0,
      character: 0,
    });
  });
});

describe('CodepolPanelManager dead-modules routing', () => {
  it('runs the rebuilder with the supplied entry-point URIs when the panel posts deadModulesEntryPointsSet', async () => {
    const { CodepolPanelManager } = await import(
      '../extension-vscode/src/panels/manager'
    );
    const manager = new CodepolPanelManager({
      openLocation: async () => {},
      applyEditPlan: async () => {},
      executeCommand: async () => {},
    });

    const initial = deadModulesModelCreate({
      entryPointUris: ['file:///workspace/src/index.ts'],
    });
    const rebuilt = deadModulesModelCreate({ entryPointUris: undefined });
    const rebuilder = vi.fn(async () => rebuilt);
    manager.showDeadModules(initial, rebuilder);

    const panel = lastCreatedPanel.value!;
    const htmlBefore = panel.webview.html;
    expect(htmlBefore).toContain('Entry points: src/index.ts');

    panel.receive({
      type: 'deadModulesEntryPointsSet',
      entryPointUris: undefined,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(rebuilder).toHaveBeenCalledTimes(1);
    expect(rebuilder).toHaveBeenCalledWith({ entryPointUris: undefined });
    expect(panel.webview.html).not.toBe(htmlBefore);
    expect(panel.webview.html).toContain('Entry points: natural');
  });

  it('routes deadModulesEntryPointsConfigureRequest through the host picker and replays the rebuilder with the chosen URIs', async () => {
    const { CodepolPanelManager } = await import(
      '../extension-vscode/src/panels/manager'
    );

    const pickedUris = [
      'file:///workspace/src/index.ts',
      'file:///workspace/scripts/main.ts',
    ];
    const deadModulesEntryPointsPick = vi.fn(async () => pickedUris);

    const manager = new CodepolPanelManager({
      openLocation: async () => {},
      applyEditPlan: async () => {},
      executeCommand: async () => {},
      deadModulesEntryPointsPick,
    });

    const initial = deadModulesModelCreate({ entryPointUris: undefined });
    const rebuilt = deadModulesModelCreate({ entryPointUris: pickedUris });
    const rebuilder = vi.fn(async () => rebuilt);
    manager.showDeadModules(initial, rebuilder);

    const panel = lastCreatedPanel.value!;
    panel.receive({ type: 'deadModulesEntryPointsConfigureRequest' });
    // Three microtasks: pick promise + rebuilder promise + html swap.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(deadModulesEntryPointsPick).toHaveBeenCalledWith({
      currentEntryPointUris: undefined,
    });
    expect(rebuilder).toHaveBeenCalledWith({ entryPointUris: pickedUris });
    expect(panel.webview.html).toContain(
      'Entry points: src/index.ts, scripts/main.ts',
    );
  });

  it('aborts the configure flow when the host picker returns undefined (user cancels)', async () => {
    const { CodepolPanelManager } = await import(
      '../extension-vscode/src/panels/manager'
    );

    const deadModulesEntryPointsPick = vi.fn(async () => undefined);

    const manager = new CodepolPanelManager({
      openLocation: async () => {},
      applyEditPlan: async () => {},
      executeCommand: async () => {},
      deadModulesEntryPointsPick,
    });

    const initial = deadModulesModelCreate({ entryPointUris: undefined });
    const rebuilder = vi.fn(async () => initial);
    manager.showDeadModules(initial, rebuilder);

    const panel = lastCreatedPanel.value!;
    panel.receive({ type: 'deadModulesEntryPointsConfigureRequest' });
    await Promise.resolve();
    await Promise.resolve();

    expect(deadModulesEntryPointsPick).toHaveBeenCalled();
    expect(rebuilder).not.toHaveBeenCalled();
  });

  it('treats an empty pick (no items selected) as "switch to natural entry points"', async () => {
    const { CodepolPanelManager } = await import(
      '../extension-vscode/src/panels/manager'
    );

    const deadModulesEntryPointsPick = vi.fn(async () => [] as string[]);

    const manager = new CodepolPanelManager({
      openLocation: async () => {},
      applyEditPlan: async () => {},
      executeCommand: async () => {},
      deadModulesEntryPointsPick,
    });

    const initial = deadModulesModelCreate({
      entryPointUris: ['file:///workspace/src/index.ts'],
    });
    const rebuilt = deadModulesModelCreate({ entryPointUris: undefined });
    const rebuilder = vi.fn(async () => rebuilt);
    manager.showDeadModules(initial, rebuilder);

    const panel = lastCreatedPanel.value!;
    panel.receive({ type: 'deadModulesEntryPointsConfigureRequest' });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(rebuilder).toHaveBeenCalledWith({ entryPointUris: undefined });
  });

  it('drops the configure request silently when no host picker hook is wired', async () => {
    const { CodepolPanelManager } = await import(
      '../extension-vscode/src/panels/manager'
    );

    const manager = new CodepolPanelManager({
      openLocation: async () => {},
      applyEditPlan: async () => {},
      executeCommand: async () => {},
      // No deadModulesEntryPointsPick — the host hasn't wired the
      // multi-select picker.
    });

    const initial = deadModulesModelCreate({ entryPointUris: undefined });
    const rebuilder = vi.fn(async () => initial);
    manager.showDeadModules(initial, rebuilder);

    const panel = lastCreatedPanel.value!;
    panel.receive({ type: 'deadModulesEntryPointsConfigureRequest' });
    await Promise.resolve();

    expect(rebuilder).not.toHaveBeenCalled();
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

    const model = deadModulesModelCreate({ entryPointUris: undefined });
    manager.showDeadModules(model);

    const panel = lastCreatedPanel.value!;
    panel.receive({
      type: 'openLocation',
      uri: 'file:///workspace/src/orphan.ts',
      line: 0,
      character: 0,
    });
    await Promise.resolve();

    expect(openLocation).toHaveBeenCalledWith({
      uri: 'file:///workspace/src/orphan.ts',
      line: 0,
      character: 0,
    });
  });
});
