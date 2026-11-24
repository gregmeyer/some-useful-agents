/**
 * Checking and saving a new definition of an agent sua proposed on a card:
 * the agent-editor card (one agent) and the shared-tool card (a tool and
 * several agents, lib/tool-refactor.ts) both go through these, so an edit is
 * judged the same way wherever it comes from.
 *
 *  1. `parseAgentEdit`: the YAML repaired, parsed, for the right agent,
 *     calling only installed agents (never itself), and (when asked) using
 *     only tools that exist or are about to.
 *  2. `prepareAgentEdit`: refused when the agent moved on since the edit was
 *     proposed; what the edit leaves out that it shouldn't take away (status,
 *     schedule, outcome, success criteria, behaviors, skills) carried over.
 *  3. `applyAgentEdit`: saved as a new version, with an undo that saves the
 *     previous definition back.
 */
import {
  parseAgent,
  calledAgentIds,
  getBuiltinTool,
  getGeneratedTool,
  isAppleIntegrationEnabled,
  toolIdsUsed,
  type Agent,
} from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { autoFixYaml } from '../routes/run-now-build.js';

type Ctx = ReturnType<typeof getContext>;

export type Parsed = ReturnType<typeof parseAgent>;

export type AgentEditCheck<T> = { ok: true; value: T } | { ok: false; reason: string };

/** The YAML as it will be read: template escaping reversed, shell commands auto-fixed. Pure. */
export function repairEditYaml(yaml: string): string {
  // The template-substitution pipeline escapes `{{` → `{ {` so a NEW_YAML that
  // round-tripped through it can't be re-expanded; committing that raw leaves
  // a literal `{ {inputs.X}}` that never resolves at run time. The escape only
  // ever produces `{ {` from a real `{{`, so reversing it globally is safe.
  return autoFixYaml(yaml.replace(/\{ \{/g, '{{'));
}

/** Tool ids the agent's steps use (now in core; kept here for the callers that import it from this module). */
export { toolIdsUsed };

function toolExists(ctx: Ctx, id: string): boolean {
  if (getBuiltinTool(id)) return true;
  if (ctx.integrationsStore && getGeneratedTool(ctx.integrationsStore, id, { secretsStore: ctx.secretsStore, experimentalApple: isAppleIntegrationEnabled() })) return true;
  try { return !!ctx.toolStore?.getTool(id); } catch { return false; }
}

/**
 * Parse an edit and check what it refers to. `pendingTools` are tool ids
 * saved together with this edit (they count as existing); with
 * `checkTools`, every tool a step uses must exist.
 */
export function parseAgentEdit(
  ctx: Ctx,
  agentId: string,
  yaml: string,
  opts: { checkTools?: boolean; pendingTools?: readonly string[] } = {},
): AgentEditCheck<{ parsed: Parsed; repairedYaml: string }> {
  const repairedYaml = repairEditYaml(yaml);
  let parsed: Parsed;
  try {
    parsed = parseAgent(repairedYaml);
  } catch (err) {
    return { ok: false, reason: `NEW_YAML failed validation: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (parsed.id !== agentId) {
    return { ok: false, reason: `NEW_YAML parsed id "${parsed.id}" does not match AGENT_ID "${agentId}". Refusing the edit.` };
  }
  // Every agent it calls must be installed (and it can't call itself):
  // caught here, not as a failed run later.
  const calls = calledAgentIds(parsed);
  if (calls.includes(agentId)) {
    return { ok: false, reason: `\`${agentId}\` would call itself. Refusing the edit.` };
  }
  const missing = calls.filter((id) => !ctx.agentStore.getAgent(id));
  if (missing.length) {
    return {
      ok: false,
      reason: `\`${agentId}\` would call ${missing.map((id) => `\`${id}\``).join(', ')}, which ${missing.length === 1 ? "isn't" : "aren't"} installed. Install ${missing.length === 1 ? 'it' : 'them'} first, or ask sua for a fix that doesn't need ${missing.length === 1 ? 'it' : 'them'}.`,
    };
  }
  if (opts.checkTools) {
    const pending = new Set(opts.pendingTools ?? []);
    const unknown = toolIdsUsed(parsed).filter((id) => !pending.has(id) && !toolExists(ctx, id));
    if (unknown.length) {
      return { ok: false, reason: `\`${agentId}\` would use ${unknown.map((id) => `\`${id}\``).join(', ')}, which ${unknown.length === 1 ? "isn't a tool" : "aren't tools"} you have.` };
    }
  }
  return { ok: true, value: { parsed, repairedYaml } };
}

/**
 * Ready an edit to save: refused when the agent moved past `baseVersion`;
 * fields the edit omitted carried over from the agent as it is (`parsed` is
 * changed in place). `preserved` names what was kept.
 */
export function prepareAgentEdit(
  ctx: Ctx,
  parsed: Parsed,
  repairedYaml: string,
  baseVersion: number | undefined,
): AgentEditCheck<{ before?: Agent; preserved: string[] }> {
  const agentId = parsed.id;
  const before = ctx.agentStore.getAgent(agentId);
  // The agent moved on since this was proposed (someone edited it, or another
  // fix landed): applying would silently undo that. Ask for a fresh proposal.
  if (before && baseVersion !== undefined && before.version !== baseVersion) {
    return {
      ok: false,
      reason: `\`${agentId}\` changed since this fix was proposed (v${baseVersion} → v${before.version}). Ask sua to look again so the fix starts from the current version.`,
    };
  }
  // NEW_YAML replaces the whole definition (no merge). Fields that say whether
  // or when it runs, and what it's graded and held to, are kept when the edit
  // omits them: an edit that drops them would quietly stop a scheduled agent,
  // let the loop grade its own homework, or un-condition every future run.
  // Preserving on OMISSION only; an edit that deliberately rewrites them is
  // honoured.
  const preserved: string[] = [];
  if (before) {
    parsed.status = before.status;
    if (before.schedule && !/^schedule\s*:/m.test(repairedYaml)) {
      parsed.schedule = before.schedule;
      preserved.push('schedule');
    }
    if (before.outcome && !parsed.outcome) {
      parsed.outcome = before.outcome;
      preserved.push('outcome');
    }
    if (before.successCriteria && !parsed.successCriteria) {
      parsed.successCriteria = before.successCriteria;
      if (before.maxLoopIterations !== undefined && parsed.maxLoopIterations === undefined) {
        parsed.maxLoopIterations = before.maxLoopIterations;
      }
      preserved.push('successCriteria');
    }
    if (before.behaviors && !parsed.behaviors) {
      parsed.behaviors = before.behaviors;
      preserved.push('behaviors');
    }
    if (before.skills && !parsed.skills) {
      parsed.skills = before.skills;
      preserved.push('skills');
    }
  }
  return { ok: true, value: { before: before ?? undefined, preserved } };
}

/** Save a prepared edit as a new version. Throws when the store refuses. The undo saves `before` back. */
export function applyAgentEdit(ctx: Ctx, parsed: Parsed, before: Agent | undefined, message: string): { version: number | string; undo: () => void } {
  ctx.agentStore.upsertAgent(parsed, 'dashboard', message);
  const version = ctx.agentStore.getAgent(parsed.id)?.version ?? '?';
  return {
    version,
    undo: () => {
      if (before) ctx.agentStore.upsertAgent(before, 'dashboard', `Undid "${message}"`);
    },
  };
}

/** "Kept the existing schedule and outcome (the edit omitted them)." or ''. */
export function preservedNote(preserved: readonly string[]): string {
  return preserved.length > 0
    ? ` Kept the existing ${preserved.join(' and ')} (the edit omitted ${preserved.length === 1 ? 'it' : 'them'}).`
    : '';
}
