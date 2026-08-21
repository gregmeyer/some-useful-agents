/**
 * Resolve an agent's declared `behaviors:` into the text that will condition it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SCOPE GUARD. This is the security boundary for the whole feature, and it
 * is the reason conditioning lives in its own module instead of inside
 * `behaviors/`.
 *
 * ONLY `project` scope may condition a run.
 *
 * A project spec lives in the repository under code review, at the same trust
 * level as the agent YAML sitting beside it — which we already put in prompts.
 * A `user` spec is any file in a home directory that would apply to every
 * project on the machine, and an `org` spec comes from a registry this repo
 * never reviewed. Letting either steer a run means a file gains authority over
 * your agents by merely existing on disk. That is the prompt-injection shape
 * ADR-0031 exists to prevent.
 *
 * A name that resolves ONLY in user or org scope is therefore an ERROR, not a
 * silent fallback and not a downgrade to "run unconditioned" — see below.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { BehaviorRecord, LoadBehaviorsResult } from '../behaviors/index.js';
import { buildBehaviorPreamble, type BehaviorPreamble } from './preamble.js';

/** Thrown before a run starts when conditioning cannot be honored. */
export class BehaviorConditioningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BehaviorConditioningError';
  }
}

export interface ResolveBehaviorsInput {
  /** Names from the agent's `behaviors:` field. */
  names: readonly string[];
  /** Everything discovered on disk, all scopes. */
  discovered: LoadBehaviorsResult;
}

export interface ResolvedBehaviors extends BehaviorPreamble {
  records: BehaviorRecord[];
}

/**
 * Resolve names → project-scope records → preamble text.
 *
 * FAILS THE RUN rather than proceeding when anything is off. The author
 * explicitly asked to be held to this conduct; running without it would produce
 * output that looks fine and nobody knows was un-steered. A loud failure at
 * startup is recoverable in seconds; a quietly un-conditioned run is not
 * detectable at all.
 */
export function resolveBehaviorsForRun(input: ResolveBehaviorsInput): ResolvedBehaviors {
  const { names, discovered } = input;
  if (names.length === 0) {
    return { records: [], text: '', applied: [], truncated: [] };
  }

  const records: BehaviorRecord[] = [];
  const missing: string[] = [];
  const wrongScope: Array<{ name: string; scope: string; file: string }> = [];

  for (const name of names) {
    const hit = discovered.byName.get(name);
    if (hit && hit.location.scope === 'project') {
      records.push(hit);
      continue;
    }
    // Look through everything, including specs that lost a precedence contest,
    // so the error can say WHY a name that visibly exists is not usable.
    const anywhere = hit
      ?? discovered.shadowed.find((s) => s.name === name);
    if (anywhere) {
      wrongScope.push({
        name,
        scope: anywhere.location.scope,
        file: anywhere.location.file,
      });
    } else {
      missing.push(name);
    }
  }

  if (missing.length > 0) {
    throw new BehaviorConditioningError(
      `Agent declares behaviors that do not exist: ${missing.join(', ')}. ` +
      `Expected .agents/behaviors/<name>/BEHAVIOR.md in this project. ` +
      `Run \`sua behaviors list\` to see what is available.`,
    );
  }

  if (wrongScope.length > 0) {
    const detail = wrongScope
      .map((w) => `"${w.name}" is ${w.scope} scope (${w.file})`)
      .join('; ');
    throw new BehaviorConditioningError(
      `Only project-scope behaviors can condition a run, but ${detail}. ` +
      `A spec in this repository is reviewed like code; one in a home directory or an ` +
      `org registry is not, and must not gain authority over a run by being present. ` +
      `Copy it into this project's .agents/behaviors/ if you intend to be held to it.`,
    );
  }

  const preamble = buildBehaviorPreamble(records);

  if (preamble.truncated.length > 0) {
    throw new BehaviorConditioningError(
      `Behavior text is too large to inject: ${preamble.truncated.join(', ')} did not fit ` +
      `the conditioning budget. Shorten the specs, or declare fewer of them on this agent. ` +
      `Sending a partial standard would be worse than sending none, because it reads as complete.`,
    );
  }

  return { ...preamble, records };
}
