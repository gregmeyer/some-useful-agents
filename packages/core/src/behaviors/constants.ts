/**
 * Normative constants from the Agent Behavior standard.
 *
 * Source: https://www.agentbehavior.dev/ and the reference validator at
 * github.com/braintrustdata/agentbehavior (Apache-2.0). These values are
 * transcribed from the spec's published constants; no upstream code was copied.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CAUTION: `BEHAVIORS_DIR` is DOTTED (`.agents/`), and this repo already has a
 * NON-dotted `agents/` directory holding our own agent YAML. They differ by one
 * character and both exist in a working tree. This module is the ONLY place the
 * literal is written — never concatenate it elsewhere, and never name a variable
 * in this feature `agentsDir`. `COLLIDING_DIR` exists so the loader can detect
 * the mistake and say so out loud instead of returning an empty list.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Where behavior specs live, relative to a scope root. */
export const BEHAVIORS_DIR = '.agents/behaviors';

/** The canonical file name. Clients MUST look for this exact name. */
export const BEHAVIOR_FILE = 'BEHAVIOR.md';

/** Lowercase alphanumeric words joined by single hyphens; no leading/trailing hyphen. */
export const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const MAX_NAME_LENGTH = 64;

/**
 * The spec says "max 1024 characters" without naming a unit. We match the
 * reference validator's `String.prototype.length`, i.e. UTF-16 code units,
 * which means an emoji-heavy description hits the cap sooner than a byte count
 * would. Documented in docs/behaviors.md as a known ambiguity.
 */
export const MAX_DESCRIPTION_LENGTH = 1024;

/**
 * sua-local, NOT normative. Behavior bodies are untrusted third-party content
 * and end up in a DOM; an unbounded read is a trivial denial of service.
 */
export const MAX_BODY_BYTES = 256 * 1024;

/** The near-miss path: this repo's own agents dir, one dot away from the real one. */
export const COLLIDING_DIR = 'agents/behaviors';

/** Directory names never treated as a behavior spec. */
export const IGNORED_DIR_NAMES: ReadonlySet<string> = new Set(['node_modules', 'references']);
