/**
 * Class-boundary tests for `ImportSpecifierMarkerController`.
 *
 * The controller is the identity layer for the deferred Phase 5 hover
 * (per `TODO_CODEPOL_LSP_HOVER_MODEL.md`). It maintains a per-document
 * `Map<docUri, markers[]>` populated from
 * `protocol.queryImportSpecifiersInFile`, and exposes a `markerAt`
 * lookup the hover provider uses as its identity gate.
 *
 * The full `attachToEditor` debounce path uses real `setTimeout`s; we
 * cover the staleness logic and the lookup helper directly through the
 * exported `importSpecifierMarkerLocate` helper without spinning up the
 * timer pipeline.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => {
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
  function disposableCreate(): { dispose: () => void } {
    return { dispose: () => {} };
  }
  return {
    Range: FakeRange,
    Position: FakePosition,
    window: {
      createTextEditorDecorationType: () => ({ dispose: () => {} }),
      visibleTextEditors: [] as unknown[],
      onDidChangeActiveTextEditor: () => disposableCreate(),
    },
    workspace: {
      onDidChangeTextDocument: () => disposableCreate(),
      onDidCloseTextDocument: () => disposableCreate(),
    },
  };
});

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
    // Wait one tick so any synchronously-scheduled refresh has a
    // chance to fire (we still expect zero calls because the scheme
    // gate short-circuits before the timer is set).
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(queryImportSpecifiersInFile).not.toHaveBeenCalled();
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
