import * as vscode from 'vscode';
import type { CodepolProtocolClient } from './protocolClient';
import {
  CODEPOL_EXTENSION_CONTEXT_INDEX_BACKED_COMMANDS_ENABLED,
  CODEPOL_EXTENSION_CONTEXT_WORKSPACE_PACKAGE_RENAME_ENABLED,
} from './constants';
import {
  codepolIndexBackedCommandsEnabledResolve,
  type CodepolReadinessSnapshot,
  codepolWorkspacePackageRenameEnabledResolve,
} from './readiness';

function errorMessageResolve(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type CodepolReadinessSource = {
  readonly onDidChange: vscode.Event<CodepolReadinessSnapshot>;
  snapshotGet(): CodepolReadinessSnapshot;
  refresh(): Promise<void>;
};

export class CodepolReadinessController
  implements CodepolReadinessSource, vscode.Disposable
{
  private readonly emitter = new vscode.EventEmitter<CodepolReadinessSnapshot>();
  readonly onDidChange = this.emitter.event;
  private snapshot: CodepolReadinessSnapshot = {
    status: null,
  };
  private pollHandle: ReturnType<typeof setTimeout> | undefined;
  private refreshRequestId = 0;

  constructor(
    private readonly protocol: CodepolProtocolClient,
    private readonly pollIntervalMs = 2500,
  ) {}

  snapshotGet(): CodepolReadinessSnapshot {
    return this.snapshot;
  }

  start(): void {
    this.contextKeysUpdate();
    void this.refresh();
  }

  dispose(): void {
    if (this.pollHandle) {
      clearTimeout(this.pollHandle);
      this.pollHandle = undefined;
    }
    this.emitter.dispose();
  }

  async refresh(): Promise<void> {
    const requestId = ++this.refreshRequestId;
    let nextSnapshot: CodepolReadinessSnapshot;

    try {
      nextSnapshot = {
        status: await this.protocol.queryIndexStatus(),
      };
    } catch (error) {
      nextSnapshot = {
        status: null,
        errorMessage: errorMessageResolve(error),
      };
    }

    if (requestId !== this.refreshRequestId) {
      return;
    }

    this.snapshot = nextSnapshot;
    this.contextKeysUpdate();
    this.emitter.fire(nextSnapshot);
    this.pollSchedule();
  }

  private pollSchedule(): void {
    if (this.pollHandle) {
      clearTimeout(this.pollHandle);
      this.pollHandle = undefined;
    }

    const status = this.snapshot.status;
    if (
      status &&
      status.status !== 'cold' &&
      status.status !== 'warming' &&
      status.replayState !== 'pending'
    ) {
      return;
    }

    this.pollHandle = setTimeout(() => {
      void this.refresh();
    }, this.pollIntervalMs);
  }

  private contextKeysUpdate(): void {
    void vscode.commands.executeCommand(
      'setContext',
      CODEPOL_EXTENSION_CONTEXT_INDEX_BACKED_COMMANDS_ENABLED,
      codepolIndexBackedCommandsEnabledResolve(this.snapshot),
    );
    void vscode.commands.executeCommand(
      'setContext',
      CODEPOL_EXTENSION_CONTEXT_WORKSPACE_PACKAGE_RENAME_ENABLED,
      codepolWorkspacePackageRenameEnabledResolve(this.snapshot),
    );
  }
}
