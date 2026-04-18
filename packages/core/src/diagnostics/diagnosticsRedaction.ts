/**
 * Central redaction pipeline.
 *
 * Sinks never decide what to redact individually; they consume a
 * `RedactionExecutor` that walks the emitted field object and replaces values
 * at known sensitive paths with `[redacted]`. Rules are declarative and
 * matched against dotted paths (`a.b.c`) produced while walking.
 */
import type {
  DiagnosticsRecord,
  RedactionMode,
} from './diagnosticsTypes';

export type RedactionExecutor = {
  readonly mode: RedactionMode;
  redactRecord(record: DiagnosticsRecord): DiagnosticsRecord;
  redactFields(fields: Record<string, unknown> | undefined): Record<string, unknown> | undefined;
};

const REDACTED = '[redacted]';
const MAX_STRING_LEN_STRICT = 512;
const SECRET_KEY_PATTERN = /(?:^|\.)[^.]*(?:token|secret|password|apikey|api_key|auth|cookie|sessionid|session_id|key)(?:$|\.)/i;
const SOURCE_LIKE_KEY_PATTERN = /(?:^|\.)(?:source|sourcepreview|sourcetext|source_text|raw|fileContents?|errorStack)(?:$|\.)/i;

function keyIsSecret(key: string, keyPath: string): boolean {
  if (SECRET_KEY_PATTERN.test(keyPath)) return true;
  return SECRET_KEY_PATTERN.test(key);
}

function keyIsSourceLike(key: string, keyPath: string): boolean {
  if (SOURCE_LIKE_KEY_PATTERN.test(keyPath)) return true;
  return SOURCE_LIKE_KEY_PATTERN.test(key);
}

function truncateForStrict(value: string): string {
  if (value.length <= MAX_STRING_LEN_STRICT) return value;
  return `${value.slice(0, MAX_STRING_LEN_STRICT)}...<truncated>`;
}

function redactWalk(
  value: unknown,
  keyPath: string,
  mode: RedactionMode,
  depth: number,
): unknown {
  if (depth > 16) return value;
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (mode === 'strict') return truncateForStrict(value);
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, idx) =>
      redactWalk(entry, `${keyPath}.${idx}`, mode, depth + 1),
    );
  }
  if (typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      const nextPath = keyPath.length === 0 ? key : `${keyPath}.${key}`;
      if (keyIsSecret(key, nextPath)) {
        next[key] = REDACTED;
        continue;
      }
      if (mode === 'strict' && keyIsSourceLike(key, nextPath)) {
        next[key] = REDACTED;
        continue;
      }
      next[key] = redactWalk(source[key], nextPath, mode, depth + 1);
    }
    return next;
  }
  return value;
}

export function redactionPolicyCreate(mode: RedactionMode): RedactionExecutor {
  if (mode === 'off') {
    return {
      mode,
      redactRecord(record) { return record; },
      redactFields(fields) { return fields; },
    };
  }
  return {
    mode,
    redactRecord(record) {
      if (!record.fields) return record;
      const fields = redactWalk(record.fields, '', mode, 0) as Record<string, unknown>;
      return { ...record, fields };
    },
    redactFields(fields) {
      if (!fields) return fields;
      return redactWalk(fields, '', mode, 0) as Record<string, unknown>;
    },
  };
}
