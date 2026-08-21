/**
 * Behavior conditioning — the OPT-IN path that lets a project-scope behavior
 * spec steer an agent's conduct.
 *
 * Separate from `behaviors/` on purpose. That module is the reader and is
 * provably inert (its isolation test forbids importing the LLM layer). The
 * dependency arrow points INWARD: this module imports the reader, the spawner
 * imports this. Putting injection inside the reader would break that test,
 * correctly.
 *
 * Two invariants, both enforced by tests:
 *   - Only `project` scope can condition a run (resolve.ts).
 *   - The injected text is NEVER template-substituted, because it is prepended
 *     after every resolver has run (see the call site in node-spawner.ts).
 *
 * See docs/adr/0031-agent-behavior-specs.md.
 */

export {
  buildBehaviorPreamble,
  BEHAVIOR_PREAMBLE_MARKERS,
  type BehaviorPreamble,
} from './preamble.js';

export { MAX_PREAMBLE_BYTES } from './constants.js';

export {
  resolveBehaviorsForRun,
  BehaviorConditioningError,
  type ResolveBehaviorsInput,
  type ResolvedBehaviors,
} from './resolve.js';
