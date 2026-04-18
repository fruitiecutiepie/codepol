import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  diagnosticsConfigDefaults,
  diagnosticsRuntimeCreate,
} from './diagnosticsRuntimeCreate';

describe('diagnosticsRuntimeCreate', () => {
  const tempFiles: string[] = [];

  afterEach(() => {
    for (const file of tempFiles) {
      try { fs.unlinkSync(file); } catch { /* ignore */ }
    }
    tempFiles.length = 0;
  });

  it('setLevel affects future contexts but not previously captured ones', () => {
    const runtime = diagnosticsRuntimeCreate({
      initialConfig: { ...diagnosticsConfigDefaults(), level: 'warn' },
    });
    const earlier = runtime.getDiagnostics('scope.a');
    runtime.setLevel('trace');
    const later = runtime.getDiagnostics('scope.a');
    expect(earlier.enabled('debug')).toBe(false);
    expect(later.enabled('debug')).toBe(true);
  });

  it('setScopeLevel overrides only the targeted scope', () => {
    const runtime = diagnosticsRuntimeCreate({
      initialConfig: { ...diagnosticsConfigDefaults(), level: 'warn' },
    });
    runtime.setScopeLevel('parser', 'trace');
    expect(runtime.getDiagnostics('parser.adapterCore').enabled('trace')).toBe(true);
    expect(runtime.getDiagnostics('workspace.analyzer').enabled('trace')).toBe(false);
  });

  it('setSink({ logFilePath }) re-opens the file sink at the new path', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-diag-'));
    const fileA = path.join(dir, 'a.log');
    const fileB = path.join(dir, 'b.log');
    tempFiles.push(fileA, fileB);

    const runtime = diagnosticsRuntimeCreate({
      initialConfig: {
        ...diagnosticsConfigDefaults(),
        level: 'info',
        sink: { consoleEnabled: false, logFilePath: fileA },
      },
    });
    runtime.getDiagnostics('svc').info('first', { where: 'A' });
    runtime.setSink({ logFilePath: fileB });
    runtime.getDiagnostics('svc').info('second', { where: 'B' });

    const contentA = fs.readFileSync(fileA, 'utf8');
    const contentB = fs.readFileSync(fileB, 'utf8');
    expect(contentA).toContain('"first"');
    expect(contentA).not.toContain('"second"');
    expect(contentB).toContain('"second"');
    expect(contentB).not.toContain('"first"');
  });

  it('clearing a scope override restores parent level', () => {
    const runtime = diagnosticsRuntimeCreate({
      initialConfig: { ...diagnosticsConfigDefaults(), level: 'warn' },
    });
    runtime.setScopeLevel('plugin', 'trace');
    expect(runtime.getDiagnostics('plugin.logger').enabled('trace')).toBe(true);
    runtime.setScopeLevel('plugin', undefined);
    expect(runtime.getDiagnostics('plugin.logger').enabled('trace')).toBe(false);
  });

  it('setConfig patches multiple fields atomically', () => {
    const runtime = diagnosticsRuntimeCreate({
      initialConfig: diagnosticsConfigDefaults(),
    });
    runtime.setConfig({
      level: 'debug',
      scopes: { parser: 'trace' },
      policy: { includeTiming: true },
    });
    const cfg = runtime.getConfig();
    expect(cfg.level).toBe('debug');
    expect(cfg.scopes.parser).toBe('trace');
    expect(cfg.policy.includeTiming).toBe(true);
  });
});
