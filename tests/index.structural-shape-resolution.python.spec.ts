/**
 * Python structural-shape resolution for Protocol-backed contracts.
 *
 * Exercises the public index surface end-to-end so Protocol contracts
 * produce structural implementer edges, while explicit inheritance
 * stays declared-only.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { langAdd, parserInit, projectIndexBuildSync } from '@codepol/core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('structural shape resolution (Python)', () => {
  let testDir: string;

  beforeAll(async () => {
    langAdd({ langId: 'python', fileExtensions: ['.py'] });
    await parserInit();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-python-shape-resolve-'));
  });

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  function setup(prefix: string, files: Record<string, string>): {
    indexFiles: string[];
    rootDir: string;
  } {
    const rootDir = path.join(testDir, prefix);
    fs.mkdirSync(rootDir, { recursive: true });
    const indexFiles: string[] = [];
    for (const [name, content] of Object.entries(files)) {
      const file = path.join(rootDir, name);
      fs.writeFileSync(file, content, 'utf8');
      indexFiles.push(file);
    }
    return { indexFiles, rootDir };
  }

  it('emits a structural-shape edge for a class matching a Protocol', () => {
    const { indexFiles, rootDir } = setup('structural', {
      'protocols.py': `
from typing import Protocol

class ReaderProtocol(Protocol):
    def read(self, size):
        ...
`,
      'impl.py': `
class DuckReader:
    def read(self, size):
        return ''
`,
    });

    const { index } = projectIndexBuildSync({ files: indexFiles, dir: rootDir });
    const [protocol] = index.symbolsGetByName('ReaderProtocol');
    const [duck] = index.symbolsGetByName('DuckReader');

    expect(protocol.kind).toBe('interface');
    expect(index.subTypesGet(protocol.id)).toHaveLength(0);

    const all = index.subTypesGet(protocol.id, { confidence: 'all' });
    expect(all).toHaveLength(1);
    expect(all[0]?.symbolId).toBe(duck.id);
    expect(all[0]?.confidence).toBe('structural-shape');
    expect(all[0]?.relationKind).toBe('implements');
  });

  it('does not duplicate a declared inheritance edge for an explicit Protocol subclass', () => {
    const { indexFiles, rootDir } = setup('declared', {
      'protocols.py': `
from typing import Protocol

class ReaderProtocol(Protocol):
    def read(self):
        ...
`,
      'impl.py': `
from .protocols import ReaderProtocol

class DeclaredReader(ReaderProtocol):
    def read(self):
        return ''
`,
    });

    const { index } = projectIndexBuildSync({ files: indexFiles, dir: rootDir });
    const [protocol] = index.symbolsGetByName('ReaderProtocol');

    const declared = index.subTypesGet(protocol.id);
    expect(declared).toHaveLength(1);
    expect(declared[0]?.relationKind).toBe('extends');
    expect(
      declared[0]?.confidence === 'declared' || declared[0]?.confidence === undefined,
    ).toBe(true);

    const all = index.subTypesGet(protocol.id, { confidence: 'all' });
    expect(all).toHaveLength(1);
    expect(all[0]?.relationKind).toBe('extends');
    expect(all[0]?.confidence === 'declared' || all[0]?.confidence === undefined).toBe(true);
  });
});
