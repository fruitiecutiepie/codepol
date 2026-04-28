import { fork } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  indexStoreNew,
  projectIndexBuildSync,
  projectIndexStoreSnapshotCreate,
  type IndexBuildProgress,
  type IndexStatusProgress,
  type ProjectIndexStoreSnapshot,
} from '@codepol/core';

export type WorkspaceIndexBuildRequest = {
  files: string[];
  dir: string;
  workspacePackages: Array<[string, string]>;
};

export type WorkspaceIndexBuildResult = {
  snapshot: ProjectIndexStoreSnapshot;
};

export type WorkspaceIndexBuildHost = {
  build(input: {
    request: WorkspaceIndexBuildRequest;
    signal?: AbortSignal;
    onProgress?: (progress: IndexStatusProgress) => void;
  }): Promise<WorkspaceIndexBuildResult>;
};

type IndexBuildWorkerRequest = {
  type: 'build';
  request: WorkspaceIndexBuildRequest;
};

type IndexBuildWorkerMessage =
  | {
      type: 'progress';
      progress: IndexStatusProgress;
    }
  | {
      type: 'result';
      snapshot: ProjectIndexStoreSnapshot;
    }
  | {
      type: 'error';
      message: string;
      stack?: string;
    };

function indexBuildAbortErrorCreate(): Error {
  return new Error('Workspace index build cancelled');
}

function indexBuildProgressMap(progress: IndexBuildProgress): IndexStatusProgress {
  if (progress.phase === 'indexing_files') {
    return {
      phase: 'building_index_files',
      current: progress.completed,
      total: progress.total,
      message: `Building workspace index (${progress.completed}/${progress.total} files)`,
    };
  }
  return {
    phase: 'resolving_index_graph',
    message: 'Resolving workspace index graph',
  };
}

function indexBuildSubprocessEntryPathResolve(): string | undefined {
  const candidates = [
    path.join(__dirname, 'indexBuildSubprocessMain.js'),
    path.join(__dirname, '..', 'dist', 'indexBuildSubprocessMain.js'),
  ];
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }
  return undefined;
}

function workspaceInProcessIndexBuildHostCreate(): WorkspaceIndexBuildHost {
  return {
    async build(input) {
      if (input.signal?.aborted) {
        throw indexBuildAbortErrorCreate();
      }
      const store = indexStoreNew();
      const { index } = projectIndexBuildSync({
        files: input.request.files,
        dir: input.request.dir,
        store,
        workspacePackages: new Map(input.request.workspacePackages),
        onProgress(progress) {
          input.onProgress?.(indexBuildProgressMap(progress));
        },
      });
      if (input.signal?.aborted) {
        throw indexBuildAbortErrorCreate();
      }
      return {
        snapshot: projectIndexStoreSnapshotCreate(store, index.capabilities),
      };
    },
  };
}

function workspaceSubprocessIndexBuildHostCreate(
  entryPath: string,
): WorkspaceIndexBuildHost {
  return {
    build(input) {
      if (input.signal?.aborted) {
        return Promise.reject(indexBuildAbortErrorCreate());
      }
      return new Promise<WorkspaceIndexBuildResult>((resolve, reject) => {
        const child = fork(entryPath, [], {
          stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
          serialization: 'advanced',
          env: { ...process.env, NODE_NO_WARNINGS: '1' },
          execArgv: [],
        });
        let settled = false;
        let stderr = '';

        const settle = (callback: () => void): void => {
          if (settled) {
            return;
          }
          settled = true;
          input.signal?.removeEventListener('abort', onAbort);
          child.removeAllListeners('error');
          child.removeAllListeners('exit');
          child.removeAllListeners('message');
          child.stderr?.removeAllListeners('data');
          callback();
        };

        const childStop = (): void => {
          if (child.connected) {
            child.disconnect();
          }
          if (!child.killed) {
            child.kill();
          }
        };

        const onAbort = (): void => {
          settle(() => {
            childStop();
            reject(indexBuildAbortErrorCreate());
          });
        };

        child.stderr?.on('data', (chunk: Buffer | string) => {
          const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
          stderr = `${stderr}${text}`.slice(-8192);
        });
        child.on('message', (message: IndexBuildWorkerMessage) => {
          if (message.type === 'progress') {
            input.onProgress?.(message.progress);
            return;
          }
          if (message.type === 'result') {
            settle(() => {
              childStop();
              resolve({
                snapshot: message.snapshot,
              });
            });
            return;
          }
          settle(() => {
            childStop();
            const error = new Error(message.message);
            if (message.stack) {
              error.stack = message.stack;
            }
            reject(error);
          });
        });
        child.on('error', (error) => {
          settle(() => {
            childStop();
            reject(error);
          });
        });
        child.on('exit', (code, signal) => {
          if (settled) {
            return;
          }
          settle(() => {
            const detail = stderr.trim();
            const suffix = detail ? `: ${detail}` : '';
            reject(
              new Error(
                `Workspace index subprocess exited before replying (code=${code ?? 'null'}, signal=${
                  signal ?? 'null'
                })${suffix}`,
              ),
            );
          });
        });
        input.signal?.addEventListener('abort', onAbort, { once: true });
        child.send({
          type: 'build',
          request: input.request,
        } satisfies IndexBuildWorkerRequest);
      });
    },
  };
}

export function workspaceIndexBuildHostCreate(): WorkspaceIndexBuildHost {
  const entryPath = indexBuildSubprocessEntryPathResolve();
  if (!entryPath) {
    return workspaceInProcessIndexBuildHostCreate();
  }
  return workspaceSubprocessIndexBuildHostCreate(entryPath);
}
