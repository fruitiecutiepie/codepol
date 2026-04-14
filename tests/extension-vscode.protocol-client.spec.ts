import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  codepolConnectionDisposedErrorIs,
  codepolProtocolStartNeededResolve,
} from '../extension-vscode/src/readiness';

describe('extension-vscode protocol client', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('treats transport disposal and inactive-connection failures as retryable', () => {
    expect(
      codepolConnectionDisposedErrorIs({
        code: -32097,
        message: 'Pending response rejected since connection got disposed',
      }),
    ).toBe(true);
    expect(
      codepolConnectionDisposedErrorIs({
        code: -32096,
        message: 'Client is not running',
      }),
    ).toBe(true);
    expect(
      codepolConnectionDisposedErrorIs(
        new Error('Connection is disposed.'),
      ),
    ).toBe(true);
  });

  it('does not treat unrelated request failures as retryable', () => {
    expect(
      codepolConnectionDisposedErrorIs(
        new Error('semantic search exploded'),
      ),
    ).toBe(false);
    expect(codepolConnectionDisposedErrorIs({ code: -32603 })).toBe(false);
    expect(codepolConnectionDisposedErrorIs(undefined)).toBe(false);
  });

  it('restarts when no start promise exists or the client is stopped', () => {
    expect(
      codepolProtocolStartNeededResolve({
        hasStartPromise: false,
        state: 'running',
      }),
    ).toBe(true);
    expect(
      codepolProtocolStartNeededResolve({
        hasStartPromise: true,
        state: 'stopped',
      }),
    ).toBe(true);
    expect(
      codepolProtocolStartNeededResolve({
        hasStartPromise: true,
        state: 'starting',
      }),
    ).toBe(false);
    expect(
      codepolProtocolStartNeededResolve({
        hasStartPromise: true,
        state: 'running',
      }),
    ).toBe(false);
  });
});
