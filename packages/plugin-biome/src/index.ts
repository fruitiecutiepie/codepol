/**
 * @packageDocumentation
 * @codepol/plugin-biome – Biome integration for codepol.
 *
 * Primary integration (used by the `codepol` CLI): run `biome lint` / `biome lint --write`
 * as a subprocess, parse RDJSON, and map results to `PolicyViolation[]` (see `biomeCheck`, `biomeFix`).
 *
 * Optional: `biomeAdapter` adapts a Codepol `TreeCheckProvider` to an in-process
 * `check(filePath, source)` helper. The CLI delegates to the real Biome binary for enforcement
 * and does not wire `biomeAdapter` into that path.
 */

export { biomeAdapter } from './biomeAdapter';

export { biomeCheck, biomeFix, biomeDiagnosticToViolation } from './biomeRunner';

export type {
  BiomeDiagnostic,
  BiomeDiagnosticCode,
  BiomeDiagnosticLocation,
  BiomeDiagnosticPosition,
  BiomeDiagnosticRange,
  BiomeProviderConfig,
  BiomeReport,
  BiomeAdaptedRule,
} from './biomeTypes';
