/**
 * @packageDocumentation
 * Tiny LSP transport abstraction the bridge speaks against.
 *
 * The bridge does NOT spawn `tsserver` itself — that responsibility
 * stays with the host (the LSP server, an editor extension, a CLI
 * entry point that owns the lifecycle). The host wires up an
 * `LspTransport` that resolves to the language server's response and
 * passes it to the bridge constructors.
 *
 * Keeping this seam tiny lets the bridge be unit-tested against a
 * fake transport (no real `tsserver`) and keeps the bridge package
 * free of any direct LSP / language-server SDK imports.
 */

export type LspTransport = {
  /**
   * Send a JSON-RPC request and return the language server's response.
   * The transport is responsible for cancellation, timeouts, and
   * connection lifecycle. The bridge only uses the returned promise
   * shape, so transports backed by `vscode-languageserver`,
   * `vscode-jsonrpc`, a forked `tsserver` process, or an in-memory
   * fake all work.
   */
  request<T>(method: string, params: unknown): Promise<T>;
};
