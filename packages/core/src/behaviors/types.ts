/**
 * Types for Agent Behavior spec discovery. See docs/behaviors.md and
 * docs/adr/0031-agent-behavior-specs.md.
 *
 * `BehaviorDiagnostic` mirrors the reference validator's `Diagnostic` shape
 * field-for-field so a future swap to an upstream package is a call-site change,
 * not a data migration. `BehaviorRecord` is a strict SUPERSET of theirs: same
 * names and semantics for `name`/`description`/`metadata`/`location`/`body`,
 * plus fields we need. A superset is still conformant; a rename would not be.
 *
 * Named `BehaviorDiagnostic` rather than `Diagnostic` on purpose — the core
 * barrel re-exports ~35 modules and a bare `Diagnostic` would collide.
 */

/**
 * Where a spec was found. The standard defines three scopes but no precedence
 * between them; ours is project > user > org (see `loadBehaviors`).
 */
export type BehaviorScope = 'project' | 'user' | 'org';

/**
 * Provenance. Deliberately a struct rather than a bare path string: the standard
 * requires clients to store `location` AND to preserve provenance, and keeping
 * them in one value means the two can never drift apart.
 */
export interface BehaviorLocation {
  scope: BehaviorScope;
  /** Absolute path to the scope's behaviors root, e.g. /repo/.agents/behaviors */
  rootDir: string;
  /** Absolute path to this spec's directory. Its basename must equal `name`. */
  dir: string;
  /** Absolute path to the BEHAVIOR.md file itself. */
  file: string;
}

/**
 * Every way a spec can be wrong or surprising. One code per distinct cause so a
 * caller can filter, and so docs/behaviors.md can list a fix per code.
 */
export type BehaviorDiagnosticCode =
  // discovery
  | 'behavior/root-missing'
  | 'behavior/unreadable'
  | 'behavior/missing-file'
  | 'behavior/filename-case'
  | 'behavior/nested-ignored'
  | 'behavior/symlink-escape'
  | 'behavior/misplaced-directory'
  | 'behavior/duplicate-name'
  // parsing
  | 'behavior/missing-frontmatter'
  | 'behavior/invalid-yaml'
  | 'behavior/frontmatter-not-mapping'
  | 'behavior/binary-content'
  // frontmatter fields
  | 'behavior/missing-name'
  | 'behavior/invalid-name'
  | 'behavior/name-too-long'
  | 'behavior/name-dir-mismatch'
  | 'behavior/missing-description'
  | 'behavior/description-too-long'
  | 'behavior/invalid-license'
  | 'behavior/invalid-metadata'
  // body
  | 'behavior/empty-body'
  | 'behavior/body-truncated';

export interface BehaviorDiagnostic {
  severity: 'error' | 'warning';
  code: BehaviorDiagnosticCode;
  message: string;
  file?: string;
  line?: number;
  column?: number;
}

/**
 * `metadata` is specified only as a "key-value mapping". We accept scalars and
 * arrays of scalars; a nested object is dropped with a warning rather than
 * failing the whole spec, since one odd metadata key should not cost you an
 * otherwise valid behavior.
 */
export type BehaviorMetadataValue =
  | string | number | boolean | null
  | Array<string | number | boolean | null>;

export interface BehaviorRecord {
  name: string;
  description: string;
  license?: string;
  metadata: Record<string, BehaviorMetadataValue>;
  location: BehaviorLocation;
  /**
   * UNTRUSTED free-form Markdown, author-controlled and possibly hostile.
   * Never interpolate into a model prompt. Render only via `renderMarkdownSafe`.
   */
  body: string;
  bodyTruncated: boolean;
  /** sha256 of the raw file bytes — stable identity for provenance and diffing. */
  sha256: string;
}

/** One scope root to search. */
export interface BehaviorScopeConfig {
  scope: BehaviorScope;
  /** Absolute path to the scope root that CONTAINS `.agents/behaviors`. */
  rootDir: string;
  /** When true, a missing root is normal and produces no diagnostic. */
  optional?: boolean;
}

export interface LoadBehaviorsResult {
  /** Precedence-resolved, sorted by name. */
  behaviors: BehaviorRecord[];
  byName: Map<string, BehaviorRecord>;
  /** Specs that lost a name collision. Kept, not discarded, so the UI can explain. */
  shadowed: BehaviorRecord[];
  diagnostics: BehaviorDiagnostic[];
}
