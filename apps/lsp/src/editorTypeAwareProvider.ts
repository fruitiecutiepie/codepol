import type { WorkspaceTypeAwareBridgeProviderRuntime } from '@codepol/workspace-service';
import { CODEPOL_LSP_CLIENT_REQUEST_EDITOR_TYPE_AWARE } from './protocol';

export type CodepolEditorTypeAwareRequest = {
  method: string;
  params: unknown;
};

export function codepolLspEditorTypeAwareProviderCreate(options: {
  clientRequest(method: string, params: unknown): Promise<unknown>;
}): WorkspaceTypeAwareBridgeProviderRuntime {
  const transport = {
    async request<T>(method: string, params: unknown): Promise<T> {
      return await options.clientRequest(
        CODEPOL_LSP_CLIENT_REQUEST_EDITOR_TYPE_AWARE,
        {
          method,
          params,
        } satisfies CodepolEditorTypeAwareRequest,
      ) as T;
    },
  };
  return {
    transports: {
      typescript: transport,
      python: transport,
    },
  };
}
