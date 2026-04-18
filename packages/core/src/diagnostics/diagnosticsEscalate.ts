/**
 * Escalation store.
 *
 * Holds active `EscalationRule`s, enforces TTL-based expiry, and emits audit
 * events (`escalation.added` / `escalation.revoked` / `escalation.expired`)
 * through an injected audit `Diagnostics` handle so that all adds/revokes
 * show up in whichever sink is currently active.
 */
import { randomUUID } from 'node:crypto';
import type {
  Clock,
  Diagnostics,
  EscalationHandle,
  EscalationRule,
  EscalationRuleInput,
} from './diagnosticsTypes';

export type EscalationStore = {
  list(): readonly EscalationRule[];
  add(rule: EscalationRuleInput): EscalationHandle;
  revoke(id: string): boolean;
  pruneExpired(nowMs?: number): EscalationRule[];
  replace(rules: readonly EscalationRule[]): void;
};

export type EscalationStoreCreateArgs = {
  clock: Clock;
  audit?: Diagnostics;
  onChange?: () => void;
};

function escalationAuditFields(rule: EscalationRule): Record<string, unknown> {
  return {
    id: rule.id,
    ruleScope: rule.scope,
    level: rule.level,
    expiresAtUnixMs: rule.expiresAtUnixMs,
    reason: rule.reason,
    actor: rule.actor,
    hasPolicyOverrides: Boolean(rule.policyOverrides),
  };
}

export function escalationStoreCreate(
  args: EscalationStoreCreateArgs,
): EscalationStore {
  const { clock, audit, onChange } = args;
  let rules: EscalationRule[] = [];

  function notify(): void {
    try { onChange?.(); } catch { /* swallow listener errors */ }
  }

  function pruneExpired(nowMs?: number): EscalationRule[] {
    const now = nowMs ?? clock.now();
    if (rules.length === 0) return [];
    const kept: EscalationRule[] = [];
    const expired: EscalationRule[] = [];
    for (const rule of rules) {
      if (rule.expiresAtUnixMs <= now) {
        expired.push(rule);
      } else {
        kept.push(rule);
      }
    }
    if (expired.length === 0) return [];
    rules = kept;
    for (const rule of expired) {
      audit?.info('escalation.expired', escalationAuditFields(rule));
    }
    notify();
    return expired;
  }

  function add(input: EscalationRuleInput): EscalationHandle {
    pruneExpired();
    const id = input.id ?? randomUUID();
    const expiresAtUnixMs = clock.now() + Math.max(0, input.ttlMs);
    const rule: EscalationRule = {
      id,
      scope: input.scope,
      level: input.level,
      policyOverrides: input.policyOverrides,
      expiresAtUnixMs,
      reason: input.reason,
      actor: input.actor,
    };
    rules = [...rules.filter((r) => r.id !== id), rule];
    audit?.info('escalation.added', escalationAuditFields(rule));
    notify();
    return {
      id,
      expiresAtUnixMs,
      revoke() { revoke(id); },
    };
  }

  function revoke(id: string): boolean {
    const before = rules.length;
    const removed = rules.filter((r) => r.id === id);
    if (removed.length === 0) return false;
    rules = rules.filter((r) => r.id !== id);
    if (rules.length === before) return false;
    for (const rule of removed) {
      audit?.info('escalation.revoked', escalationAuditFields(rule));
    }
    notify();
    return true;
  }

  function replace(next: readonly EscalationRule[]): void {
    const previousIds = new Set(rules.map((r) => r.id));
    rules = [...next];
    for (const rule of rules) {
      if (!previousIds.has(rule.id)) {
        audit?.info('escalation.added', escalationAuditFields(rule));
      }
    }
    notify();
  }

  return {
    list() {
      pruneExpired();
      return rules;
    },
    add,
    revoke,
    pruneExpired,
    replace,
  };
}
