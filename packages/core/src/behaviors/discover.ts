/**
 * Discover Agent Behavior specs across scopes.
 *
 * DESIGN RULE, learned the hard way: NEVER skip silently. `agent-loader.ts:79`
 * drops every v2 agent file with a bare `continue` and no warning, which is how
 * CI printed "0 agent(s) validated successfully" in green for months while
 * validating nothing at all. Every `continue` below is preceded by a diagnostic,
 * and `behaviors.test.ts` asserts a 3-valid-spec fixture returns exactly 3
 * records with 0 errors so an accidental silent skip fails the build.
 */

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';
import {
  BEHAVIORS_DIR,
  BEHAVIOR_FILE,
  COLLIDING_DIR,
  IGNORED_DIR_NAMES,
  MAX_BODY_BYTES,
} from './constants.js';
import { validateBehavior } from './validate.js';
import type {
  BehaviorDiagnostic,
  BehaviorRecord,
  BehaviorScopeConfig,
  LoadBehaviorsResult,
} from './types.js';

export interface DefaultScopesOptions {
  projectRoot?: string;
  home?: string;
  /** From sua.config.json `behaviors.orgDir`. Absolute, or relative to projectRoot. */
  orgDir?: string;
  /** Set false to skip ~/.agents/behaviors entirely. */
  userScope?: boolean;
}

/**
 * Scope roots in PRECEDENCE ORDER: project, then user, then org.
 *
 * The standard names three scopes but defines no precedence between them, so
 * this is our call: project wins because it is the most specific and the most
 * reviewed — it lives in the repo under code review, whereas a file in the
 * user's home directory could silently change how a shared repo behaves.
 * Recorded as a known divergence in docs/behaviors.md.
 */
export function defaultBehaviorScopes(opts: DefaultScopesOptions = {}): BehaviorScopeConfig[] {
  const projectRoot = opts.projectRoot ?? process.cwd();
  const home = opts.home ?? homedir();
  const scopes: BehaviorScopeConfig[] = [
    { scope: 'project', rootDir: projectRoot, optional: true },
  ];
  if (opts.userScope !== false && home && home !== projectRoot) {
    scopes.push({ scope: 'user', rootDir: home, optional: true });
  }
  if (opts.orgDir) {
    scopes.push({
      scope: 'org',
      rootDir: isAbsolute(opts.orgDir) ? opts.orgDir : resolve(projectRoot, opts.orgDir),
      // Not optional: an org dir is configured explicitly, so its absence is a
      // misconfiguration worth reporting rather than a normal empty state.
      optional: false,
    });
  }
  return scopes;
}

export interface LoadBehaviorsOptions {
  scopes: BehaviorScopeConfig[];
  maxBodyBytes?: number;
  onDiagnostic?: (d: BehaviorDiagnostic) => void;
}

/** True when `child` resolves outside `root` — i.e. a symlink escape. */
function escapesRoot(child: string, root: string): boolean {
  try {
    const realChild = realpathSync(child);
    const realRoot = realpathSync(root);
    return realChild !== realRoot && !realChild.startsWith(realRoot + sep);
  } catch {
    return true; // unresolvable → treat as unsafe
  }
}

/** The exact-case file, or a case variant, or neither. */
function findBehaviorFile(dir: string): { exact: boolean; actual?: string } {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return { exact: false };
  }
  if (entries.includes(BEHAVIOR_FILE)) return { exact: true, actual: BEHAVIOR_FILE };
  const variant = entries.find((e) => e.toLowerCase() === BEHAVIOR_FILE.toLowerCase());
  return { exact: false, ...(variant ? { actual: variant } : {}) };
}

export function loadBehaviors(options: LoadBehaviorsOptions): LoadBehaviorsResult {
  const maxBodyBytes = options.maxBodyBytes ?? MAX_BODY_BYTES;
  const diagnostics: BehaviorDiagnostic[] = [];
  const emit = (d: BehaviorDiagnostic): void => {
    diagnostics.push(d);
    options.onDiagnostic?.(d);
  };
  const diag = (
    severity: 'error' | 'warning',
    code: BehaviorDiagnostic['code'],
    message: string,
    file?: string,
  ): void => emit({ severity, code, message, ...(file ? { file } : {}) });

  const byName = new Map<string, BehaviorRecord>();
  const shadowed: BehaviorRecord[] = [];

  for (const scopeCfg of options.scopes) {
    const rootDir = join(scopeCfg.rootDir, BEHAVIORS_DIR);

    // The one-dot-away mistake, caught positively rather than as an empty list.
    // Only worth checking where the real directory is absent, otherwise a repo
    // that legitimately has both would nag on every load.
    if (!existsSync(rootDir)) {
      const colliding = join(scopeCfg.rootDir, COLLIDING_DIR);
      if (existsSync(colliding) && hasAnyBehaviorFile(colliding)) {
        diag('warning', 'behavior/misplaced-directory',
          `Found behavior specs in "${colliding}" but the standard directory is "${rootDir}" (note the leading dot). Rename the directory to .agents/behaviors.`,
          colliding);
      } else if (!scopeCfg.optional) {
        diag('warning', 'behavior/root-missing', `Behaviors directory does not exist: ${rootDir}`, rootDir);
      }
      continue;
    }

    let entries: Array<{ name: string; isDir: boolean }>;
    try {
      entries = readdirSync(rootDir, { withFileTypes: true })
        .map((e) => ({ name: e.name, isDir: e.isDirectory() || e.isSymbolicLink() }));
    } catch (err) {
      diag('warning', 'behavior/unreadable', `Cannot read ${rootDir}: ${(err as Error).message}`, rootDir);
      continue;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') || IGNORED_DIR_NAMES.has(entry.name)) continue;
      const dir = join(rootDir, entry.name);

      let isDirectory = false;
      try { isDirectory = statSync(dir).isDirectory(); } catch { isDirectory = false; }
      if (!isDirectory) continue; // stray file at the root; not a spec, not an error

      if (escapesRoot(dir, rootDir)) {
        diag('warning', 'behavior/symlink-escape',
          `Skipped "${dir}" because it resolves outside ${rootDir}. Behavior specs are untrusted input and must not read through symlinks.`,
          dir);
        continue;
      }

      const found = findBehaviorFile(dir);
      if (!found.exact) {
        if (found.actual) {
          // The standard says clients MAY accept case variants. We do not: on a
          // case-insensitive volume "accepting" is nondeterministic, so a spec
          // that loads on macOS would vanish on Linux. The fix is one rename.
          diag('warning', 'behavior/filename-case',
            `Found "${found.actual}" in ${dir}; the file must be named exactly "${BEHAVIOR_FILE}". Rename it.`,
            join(dir, found.actual));
        } else if (hasAnyBehaviorFile(dir)) {
          // Depth is unspecified by the standard. We fix it at 1 and say so
          // rather than guessing at a recursion the author may not have meant.
          diag('warning', 'behavior/nested-ignored',
            `${dir} contains a ${BEHAVIOR_FILE} in a subdirectory. Behavior specs are discovered one level below ${BEHAVIORS_DIR}; move it up.`,
            dir);
        } else {
          // ERROR, not warning, to match the reference implementation: upstream
          // `agentbehavior validate` fails on a behaviors subdirectory with no
          // BEHAVIOR.md. The standard does not specify the severity, so the
          // reference implementation is the tie-breaker — otherwise the two
          // validators would disagree on exit code for the same tree, which is
          // exactly the interop failure this feature exists to avoid.
          diag('error', 'behavior/missing-file',
            `${dir} has no ${BEHAVIOR_FILE}. Add one, or remove the directory.`, dir);
        }
        continue;
      }

      const file = join(dir, BEHAVIOR_FILE);
      let raw: string;
      try {
        raw = readFileSync(file, 'utf-8');
      } catch (err) {
        diag('warning', 'behavior/unreadable', `Cannot read ${file}: ${(err as Error).message}`, file);
        continue;
      }

      const result = validateBehavior({
        raw,
        location: { scope: scopeCfg.scope, rootDir, dir, file },
        maxBodyBytes,
      });
      for (const d of result.diagnostics) emit(d);
      if (!result.record) continue; // every path above already emitted an error

      const existing = byName.get(result.record.name);
      if (existing) {
        // First scope wins; the loser is kept so the UI can explain the shadowing
        // instead of a spec just not being there.
        shadowed.push(result.record);
        diag('warning', 'behavior/duplicate-name',
          `Behavior "${result.record.name}" is defined in both ${existing.location.scope} (${existing.location.file}) and ${result.record.location.scope} (${result.record.location.file}). The ${existing.location.scope} one wins.`,
          result.record.location.file);
        continue;
      }
      byName.set(result.record.name, result.record);
    }
  }

  const behaviors = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { behaviors, byName, shadowed, diagnostics };
}

/** Does `dir` contain a BEHAVIOR.md at any depth (bounded)? Used only for diagnostics. */
function hasAnyBehaviorFile(dir: string, depth = 0): boolean {
  if (depth > 2) return false;
  let entries: Array<{ name: string; isDir: boolean; isFile: boolean }>;
  try {
    entries = readdirSync(dir, { withFileTypes: true })
      .map((e) => ({ name: e.name, isDir: e.isDirectory(), isFile: e.isFile() }));
  } catch {
    return false;
  }
  for (const e of entries) {
    if (e.isFile && e.name === BEHAVIOR_FILE) return true;
    if (e.isDir && !e.name.startsWith('.') && hasAnyBehaviorFile(join(dir, e.name), depth + 1)) return true;
  }
  return false;
}
