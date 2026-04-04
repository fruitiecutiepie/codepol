#!/usr/bin/env node

import { workspaceDaemonServerStart } from '@codepol/workspace-service';

async function main(): Promise<void> {
  const server = await workspaceDaemonServerStart();

  const shutdown = async (): Promise<void> => {
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
    await server.stop();
    process.exit(0);
  };

  const onSigint = () => {
    void shutdown();
  };
  const onSigterm = () => {
    void shutdown();
  };

  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);
}

if (require.main === module) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
