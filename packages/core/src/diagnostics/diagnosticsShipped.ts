/**
 * Compile-time shipped capabilities.
 *
 * Resolved once on first access from `CODEPOL_BUILD_PROFILE` (default
 * `standard`; anything else is treated as `hardened`). Bundlers (esbuild /
 * tsup) can substitute the `__CODEPOL_BUILD_PROFILE__` literal at build time
 * to bake a profile into a release artifact, which then overrides the env
 * var. Runtime policy cannot enable a capability that the binary did not
 * ship with.
 */
import type {
  DiagnosticSinkKind,
  ShippedDebugCapabilities,
} from './diagnosticsTypes';

declare const __CODEPOL_BUILD_PROFILE__: string | undefined;

export type BuildProfile = 'standard' | 'hardened';

const STANDARD_CAPABILITIES: ShippedDebugCapabilities = {
  deepStateSnapshots: true,
  invariantChecks: true,
  traceSpans: true,
  profiling: true,
  faultInjection: true,
  adminInspectors: true,
  allowedSinks: ['console', 'file', 'memory', 'stdout', 'otel'],
  allowedMaxLevel: 'trace',
};

const HARDENED_CAPABILITIES: ShippedDebugCapabilities = {
  deepStateSnapshots: false,
  invariantChecks: false,
  traceSpans: true,
  profiling: false,
  faultInjection: false,
  adminInspectors: false,
  allowedSinks: ['stdout', 'otel'],
  allowedMaxLevel: 'info',
};

function buildProfileResolve(): BuildProfile {
  const bundleReplacement = typeof __CODEPOL_BUILD_PROFILE__ === 'string'
    ? __CODEPOL_BUILD_PROFILE__
    : undefined;
  const raw = (bundleReplacement ?? process.env.CODEPOL_BUILD_PROFILE ?? '')
    .trim()
    .toLowerCase();
  return raw === 'hardened' ? 'hardened' : 'standard';
}

let cachedCapabilities: ShippedDebugCapabilities | undefined;

export function shippedDebugCapabilitiesGet(): ShippedDebugCapabilities {
  if (!cachedCapabilities) {
    const profile = buildProfileResolve();
    const base = profile === 'hardened' ? HARDENED_CAPABILITIES : STANDARD_CAPABILITIES;
    cachedCapabilities = Object.freeze({
      ...base,
      allowedSinks: Object.freeze([...base.allowedSinks]) as readonly DiagnosticSinkKind[],
    });
  }
  return cachedCapabilities;
}

/** Test-only: reset the cached capabilities so tests can swap the profile. */
export function shippedDebugCapabilitiesResetForTest(): void {
  cachedCapabilities = undefined;
}

/** Test-only: install a specific capabilities set without going through the env. */
export function shippedDebugCapabilitiesSetForTest(
  capabilities: ShippedDebugCapabilities,
): void {
  cachedCapabilities = Object.freeze({
    ...capabilities,
    allowedSinks: Object.freeze([...capabilities.allowedSinks]) as readonly DiagnosticSinkKind[],
  });
}
