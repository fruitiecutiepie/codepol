/**
 * Python member-shape extraction matrix for Protocol-based contracts.
 *
 * Pins the public index surface (`projectIndexBuildSync`) so Python
 * `Protocol` declarations participate in structural matching the same
 * way TS interfaces do, without widening into arbitrary class-to-class
 * duck typing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { langAdd, parserInit, projectIndexBuildSync } from '@codepol/core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('member shape extraction (Python)', () => {
  let testDir: string;

  beforeAll(async () => {
    langAdd({ langId: 'python', fileExtensions: ['.py'] });
    await parserInit();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-python-membershape-'));
  });

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('indexes Protocol declarations as interface symbols and extracts their member shapes', () => {
    const file = path.join(testDir, 'reader_protocol.py');
    fs.writeFileSync(
      file,
      `
import typing

class Reader(typing.Protocol):
    name: str

    def read(self, size, extra=0):
        ...

    @property
    def closed(self):
        ...

    @closed.setter
    def closed(self, value):
        ...

    @staticmethod
    def make(path):
        ...
`,
      'utf8',
    );

    const { index } = projectIndexBuildSync({ files: [file], dir: testDir });
    const [reader] = index.symbolsGetByName('Reader');
    expect(reader).toBeDefined();
    expect(reader.kind).toBe('interface');

    const shape = index.memberShapeForSymbolGet(reader.id);
    expect(shape).toBeDefined();
    expect(shape!.memberCountTruncated).toBe(false);

    const nameProperty = shape!.members.find((m) => m.name === 'name');
    expect(nameProperty?.memberKind).toBe('property');
    expect(nameProperty?.isStatic).toBe(false);

    const readMethod = shape!.members.find((m) => m.name === 'read');
    expect(readMethod?.memberKind).toBe('method');
    expect(readMethod?.paramArity).toBe(2);
    expect(readMethod?.isStatic).toBe(false);

    const closedGetter = shape!.members.find(
      (m) => m.name === 'closed' && m.memberKind === 'getter',
    );
    expect(closedGetter?.paramArity).toBe(0);

    const closedSetter = shape!.members.find(
      (m) => m.name === 'closed' && m.memberKind === 'setter',
    );
    expect(closedSetter?.paramArity).toBe(1);

    const makeMethod = shape!.members.find((m) => m.name === 'make');
    expect(makeMethod?.memberKind).toBe('method');
    expect(makeMethod?.isStatic).toBe(true);
    expect(makeMethod?.paramArity).toBe(1);
  });

  it('treats direct Protocol imports as interface-like owners too', () => {
    const file = path.join(testDir, 'writer_protocol.py');
    fs.writeFileSync(
      file,
      `
from typing import Protocol

class Writer(Protocol):
    def write(self, chunk):
        ...
`,
      'utf8',
    );

    const { index } = projectIndexBuildSync({ files: [file], dir: testDir });
    const [writer] = index.symbolsGetByName('Writer');
    expect(writer).toBeDefined();
    expect(writer.kind).toBe('interface');

    const shape = index.memberShapeForSymbolGet(writer.id);
    expect(shape).toBeDefined();
    expect(shape!.members).toHaveLength(1);
    expect(shape!.members[0]?.name).toBe('write');
    expect(shape!.members[0]?.paramArity).toBe(1);
  });
});
