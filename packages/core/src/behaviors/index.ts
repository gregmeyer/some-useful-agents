/**
 * Agent Behavior spec support — discovery and validation for the open standard
 * at https://www.agentbehavior.dev/. See docs/behaviors.md and
 * docs/adr/0031-agent-behavior-specs.md.
 *
 * READ-ONLY BY DESIGN. Nothing here feeds a model prompt: behavior bodies are
 * untrusted third-party content, and the standard's own client guidance says
 * clients SHOULD NOT inject behavior specs into runtime prompts. A test asserts
 * this module never imports the LLM layer.
 *
 * Named exports only. The core barrel uses `export *` across ~35 modules, so a
 * bare `Diagnostic` here would be a collision waiting to happen — hence
 * `BehaviorDiagnostic`.
 */

export {
  BEHAVIORS_DIR,
  BEHAVIOR_FILE,
  COLLIDING_DIR,
  MAX_BODY_BYTES,
  MAX_DESCRIPTION_LENGTH,
  MAX_NAME_LENGTH,
  NAME_PATTERN,
} from './constants.js';

export {
  type BehaviorDiagnostic,
  type BehaviorDiagnosticCode,
  type BehaviorLocation,
  type BehaviorMetadataValue,
  type BehaviorRecord,
  type BehaviorScope,
  type BehaviorScopeConfig,
  type LoadBehaviorsResult,
} from './types.js';

export { splitFrontmatter, type FrontmatterSplit } from './frontmatter.js';

export {
  validateBehavior,
  type ValidateBehaviorInput,
  type ValidateBehaviorResult,
} from './validate.js';

export {
  defaultBehaviorScopes,
  loadBehaviors,
  type DefaultScopesOptions,
  type LoadBehaviorsOptions,
} from './discover.js';
