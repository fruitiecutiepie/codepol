import { describe, expect, it } from 'vitest';
import { escalationStoreCreate } from './diagnosticsEscalate';
import type { Clock, Diagnostics, EscalationRule } from './diagnosticsTypes';

function mockClockCreate(start = 1_000): {
  clock: Clock;
  advance: (ms: number) => void;
  set: (ms: number) => void;
} {
  let now = start;
  return {
    clock: { now: () => now },
    advance(ms) { now += ms; },
    set(ms) { now = ms; },
  };
}

function recordingDiagCreate(): {
  diag: Diagnostics;
  events: Array<{ level: string; name: string; fields?: Record<string, unknown> }>;
} {
  const events: Array<{ level: string; name: string; fields?: Record<string, unknown> }> = [];
  const diag: Diagnostics = {
    scope: 'diagnostics.audit',
    child() { return diag; },
    enabled() { return true; },
    error(name, fields) { events.push({ level: 'error', name, fields }); },
    warn(name, fields) { events.push({ level: 'warn', name, fields }); },
    info(name, fields) { events.push({ level: 'info', name, fields }); },
    debug(name, fields) {
      const resolved = typeof fields === 'function' ? fields() : fields;
      events.push({ level: 'debug', name, fields: resolved });
    },
    trace(name, fields) {
      const resolved = typeof fields === 'function' ? fields() : fields;
      events.push({ level: 'trace', name, fields: resolved });
    },
    span() { return { end() {} }; },
  };
  return { diag, events };
}

describe('escalationStoreCreate', () => {
  it('assigns an id and expiresAtUnixMs when add is called', () => {
    const { clock } = mockClockCreate();
    const store = escalationStoreCreate({ clock });
    const handle = store.add({
      scope: { kind: 'global' },
      level: 'debug',
      ttlMs: 5_000,
      reason: 'probe',
      actor: 'test',
    });
    expect(handle.id).toBeTruthy();
    expect(handle.expiresAtUnixMs).toBe(6_000);
    expect(store.list()).toHaveLength(1);
  });

  it('revokes an escalation by id', () => {
    const { clock } = mockClockCreate();
    const store = escalationStoreCreate({ clock });
    const handle = store.add({
      scope: { kind: 'global' },
      level: 'debug',
      ttlMs: 5_000,
      reason: 'probe',
      actor: 'test',
    });
    expect(store.revoke(handle.id)).toBe(true);
    expect(store.list()).toHaveLength(0);
    expect(store.revoke(handle.id)).toBe(false);
  });

  it('prunes expired escalations on list()', () => {
    const mock = mockClockCreate();
    const store = escalationStoreCreate({ clock: mock.clock });
    store.add({
      scope: { kind: 'global' },
      level: 'debug',
      ttlMs: 1_000,
      reason: 'probe',
      actor: 'test',
    });
    expect(store.list()).toHaveLength(1);
    mock.advance(5_000);
    expect(store.list()).toHaveLength(0);
  });

  it('emits audit events on add / revoke / expire', () => {
    const mock = mockClockCreate();
    const { diag, events } = recordingDiagCreate();
    const store = escalationStoreCreate({ clock: mock.clock, audit: diag });
    const handle = store.add({
      scope: { kind: 'global' },
      level: 'debug',
      ttlMs: 1_000,
      reason: 'probe',
      actor: 'test',
    });
    store.revoke(handle.id);
    const next = store.add({
      scope: { kind: 'global' },
      level: 'debug',
      ttlMs: 100,
      reason: 'probe2',
      actor: 'test',
    });
    mock.advance(10_000);
    store.pruneExpired();
    const names = events.map((e) => e.name);
    expect(names).toContain('escalation.added');
    expect(names).toContain('escalation.revoked');
    expect(names).toContain('escalation.expired');
    expect(next.id).toBeTruthy();
  });

  it('replace() emits add events only for newly-introduced rules', () => {
    const { clock } = mockClockCreate();
    const { diag, events } = recordingDiagCreate();
    const store = escalationStoreCreate({ clock, audit: diag });
    const existing: EscalationRule = {
      id: 'kept',
      scope: { kind: 'global' },
      level: 'debug',
      expiresAtUnixMs: 999_999,
      reason: 'existing',
      actor: 'test',
    };
    store.add({
      id: 'kept',
      scope: { kind: 'global' },
      level: 'debug',
      ttlMs: 998_000,
      reason: 'existing',
      actor: 'test',
    });
    events.length = 0;
    const added: EscalationRule = {
      id: 'new',
      scope: { kind: 'global' },
      level: 'trace',
      expiresAtUnixMs: 999_999,
      reason: 'new',
      actor: 'test',
    };
    store.replace([existing, added]);
    const addedNames = events.filter((e) => e.name === 'escalation.added');
    expect(addedNames).toHaveLength(1);
    expect(addedNames[0]?.fields?.id).toBe('new');
  });
});
