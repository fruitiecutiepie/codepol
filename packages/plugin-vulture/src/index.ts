/**
 * @packageDocumentation
 * @codepol/plugin-vulture – Vulture dead-code adapter for codepol.
 *
 * Runs `vulture` as a subprocess, parses text output, and maps
 * findings to codepol PolicyViolation[].
 */

export {
  vultureCheck,
  vultureOutputParse,
  vultureLineParse,
  vultureFindingToViolation,
} from './vultureRunner';

export type {
  VultureFinding,
  VultureProviderConfig,
} from './vultureTypes';
