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
    });

    expect(watchMock).toHaveBeenCalledWith(
      ['/workspace', '/workspace/codepol.toml'],
      expect.objectContaining({
        ignoreInitial: true,
        depth: 0,
      }),
    );
  });
});
