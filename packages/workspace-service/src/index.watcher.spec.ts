import { describe, expect, it, vi } from 'vitest';

const watchMock = vi.fn(() => ({
  on: vi.fn(),
  close: vi.fn(),
}));

vi.mock('chokidar', () => ({
  default: {
    watch: watchMock,
  },
}));

describe('workspaceWatcherCreate', () => {
  it('uses a shallow workspace watch to avoid recursive fd exhaustion', async () => {
    const { workspaceWatcherCreate } = await import('./index.js');

    workspaceWatcherCreate({
      rootPath: '/workspace',
      configPath: '/workspace/codepol.toml',
      externalToolConfigPaths: [],
    });

    expect(watchMock).toHaveBeenCalledWith(
      ['/workspace', '/workspace/codepol.toml'],
      expect.objectContaining({
        ignoreInitial: true,
        depth: 0,
      }),
    );
  });

  it('includes external tool config paths in the watch list', async () => {
    const { workspaceWatcherCreate } = await import('./index.js');

    watchMock.mockClear();
    workspaceWatcherCreate({
      rootPath: '/workspace',
      configPath: '/workspace/codepol.toml',
      externalToolConfigPaths: [
        '/workspace/eslint.config.mjs',
        '/workspace/biome.json',
        '/elsewhere/pyproject.toml',
      ],
    });

    expect(watchMock).toHaveBeenCalledWith(
      [
        '/elsewhere/pyproject.toml',
        '/workspace',
        '/workspace/biome.json',
        '/workspace/codepol.toml',
        '/workspace/eslint.config.mjs',
      ],
      expect.objectContaining({
        ignoreInitial: true,
        depth: 0,
      }),
    );
  });
});
