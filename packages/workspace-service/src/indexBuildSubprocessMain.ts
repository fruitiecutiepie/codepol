#!/usr/bin/env node

import {
  indexStoreNew,
  projectIndexBuildSync,
  projectIndexStoreSnapshotCreate,
  type IndexBuildProgress,
  type IndexStatusProgress,
  type ProjectIndexStoreSnapshot,
} from '@codepol/core';
import { daemonExitOnFirstWasmAbortInstall } from './daemonSelfWatch';
import { ensureWorkspaceRuntimeReady } from './runtime';

type IndexBuildWorkerRequest = {
  type: 'build';
  request: {
    files: string[];
    dir: string;
    workspacePackages: Array<[string, string]>;
  };
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

function indexStatusProgressMap(progress: IndexBuildProgress): IndexStatusProgress {
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

function workerMessageSend(message: IndexBuildWorkerMessage): Promise<void> {
  if (!process.send) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    process.send?.(message, undefined, undefined, () => {
      resolve();
    });
  });
}

let handled = false;
daemonExitOnFirstWasmAbortInstall();
process.on('message', async (message: IndexBuildWorkerRequest) => {
  if (handled || message.type !== 'build') {
    return;
  }
  handled = true;
  try {
    const store = indexStoreNew();
    let lastIndexedProgress = -1;
    await ensureWorkspaceRuntimeReady();
    const { index } = projectIndexBuildSync({
      files: message.request.files,
      dir: message.request.dir,
      store,
      workspacePackages: new Map(message.request.workspacePackages),
      onProgress(progress) {
        if (progress.phase === 'indexing_files') {
          const stride = progress.total > 0 ? Math.max(1, Math.ceil(progress.total / 100)) : 1;
          const shouldEmit =
            progress.completed === 0 ||
            progress.completed === progress.total ||
            progress.completed - lastIndexedProgress >= stride;
          if (!shouldEmit) {
            return;
          }
          lastIndexedProgress = progress.completed;
        }
        void workerMessageSend({
          type: 'progress',
          progress: indexStatusProgressMap(progress),
        });
      },
    });
    await workerMessageSend({
      type: 'result',
      snapshot: projectIndexStoreSnapshotCreate(store, index.capabilities),
    });
  } catch (error) {
    const resolved = error instanceof Error ? error : new Error(String(error));
    await workerMessageSend({
      type: 'error',
      message: resolved.message,
      stack: resolved.stack,
    });
  } finally {
    process.disconnect?.();
  }
});
