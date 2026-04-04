/**
 * @packageDocumentation
 * @codepol/plugin-vulture – Vulture dead-code adapter for codepol.
 *
 * Runs `vulture` as a subprocess, parses text output, and maps
 * findings to codepol PolicyViolation[].
 */

export {
  vultureCheck,
  vultureFindingsGet,
  vultureOutputParse,
  vultureLineParse,
  vultureFindingToViolation,
} from './vultureRunner';

export type {
  VultureFinding,
  VultureProviderConfig,
} from './vultureTypes';

export { pythonDeadCodeCheck } from './pythonDeadCodeCheck';
export { pythonDeadCodeFixApply } from './pythonDeadCodeFix';
export { pythonDeadCodeRule } from './pythonDeadCodeRule';
export { vultureFindingMatchesFile } from './vulturePathMatch';

// export default [pythonDeadCodeRule];
