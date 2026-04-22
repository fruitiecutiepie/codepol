import { describe, expect, it } from 'vitest';
import { CODEPOL_LSP_CLIENT_REQUEST_EDITOR_TYPE_AWARE } from '../apps/lsp/src/protocol';
import { codepolLspEditorTypeAwareProviderCreate } from '../apps/lsp/src/editorTypeAwareProvider';

describe('codepolLspEditorTypeAwareProviderCreate', () => {
  it('forwards type-aware transport requests to the LSP client bridge', async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const provider = codepolLspEditorTypeAwareProviderCreate({
      async clientRequest(method, params) {
        calls.push({ method, params });
        return [{ ok: true }];
      },
    });

    const python = provider.transports?.python;
    const typescript = provider.transports?.typescript;
    expect(python).toBeDefined();
    expect(typescript).toBeDefined();

    const result = await python?.request<Array<{ ok: boolean }>>(
      'textDocument/implementation',
      {
        textDocument: { uri: 'file:///workspace/example.py' },
        position: { line: 1, character: 2 },
      },
    );

    expect(result).toEqual([{ ok: true }]);
    expect(calls).toEqual([
      {
        method: CODEPOL_LSP_CLIENT_REQUEST_EDITOR_TYPE_AWARE,
        params: {
          method: 'textDocument/implementation',
          params: {
            textDocument: { uri: 'file:///workspace/example.py' },
            position: { line: 1, character: 2 },
          },
        },
      },
    ]);
  });
});
