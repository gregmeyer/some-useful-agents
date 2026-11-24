/**
 * sua's `tool-refactor` (docs/tools.md "Ask sua to share a tool"): from a
 * conversation, point several agents at one shared tool. Working it out
 * changes nothing; it ends in ONE card (lib/tool-refactor.ts) to approve:
 *  1. which agents: the ones sua named, or your agents whose steps match the
 *     ask (their names, hosts and commands), at most MAX_REFACTOR_AGENTS;
 *  2. the tool: the tool-refactorer drafts one for what their steps do, or
 *     names one of yours that already does it (checked as `sua tool add`
 *     would, with one more try told what was wrong);
 *  3. each agent: the agent-retooler rewrites it to call the tool, three at a
 *     time, each checked as the card will check it (one more try each);
 *  4. the card, with what was left out and why.
 */
import {
  exportAgent,
  type Agent,
  type InboxActionMeta,
  type InboxActionStatus,
} from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { ensureSystemAgentCurrent } from '../routes/inbox-catalog.js';
import { runDispatchedAgentToTerminal } from '../routes/inbox-engine.js';
import { publishInboxEvent } from '../routes/inbox-shared.js';
import { inBackground } from './background.js';
import { existingToolsText, parseToolDraft } from './tool-drafter.js';
import { toolIdsUsed } from './agent-edit.js';
import { TOOL_REFACTOR_APPLY, checkRefactorEdit, type RefactorEdit } from './tool-refactor.js';

type Ctx = ReturnType<typeof getContext>;

export const TOOL_REFACTORER_ID = 'tool-refactorer';
export const AGENT_RETOOLER_ID = 'agent-retooler';
export const MAX_REFACTOR_AGENTS = 8;
const RETOOL_AT_ONCE = 3;
const MAX_STEP_CHARS = 4000;
const MAX_STEPS_CHARS = 24_000;

const STOP = new Set(['point', 'points', 'pointed', 'my', 'agents', 'agent', 'shared', 'share', 'tool', 'tools', 'one', 'single', 'the', 'and', 'for', 'all', 'them', 'these', 'those', 'make', 'use', 'uses', 'using', 'with', 'into', 'that', 'this', 'their', 'same', 'common', 'instead', 'please', 'can', 'you', 'could', 'should', 'would', 'stop', 'repeating', 'fetch', 'fetches', 'jobs', 'job']);

const words = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w));

const shellSteps = (a: Agent) => a.nodes.filter((n) => n.type === 'shell' && !n.tool && (n.command ?? '').trim().length >= 20);

/**
 * The agents an ask is about: `ids` when given (installed, local), else your
 * local agents (not archived) with a shell step, scored by how many of the
 * ask's words their id, name, description and commands contain. Pure.
 */
export function pickRefactorAgents(
  agents: readonly Agent[],
  ask: string,
  ids?: readonly string[],
): { picked: Agent[]; leftOut: Array<{ agentId: string; why: string }> } {
  const leftOut: Array<{ agentId: string; why: string }> = [];
  let ranked: Agent[];
  if (ids && ids.length) {
    ranked = [];
    for (const id of ids) {
      const a = agents.find((x) => x.id === id);
      if (!a) leftOut.push({ agentId: id, why: "it isn't installed" });
      else if (a.source !== 'local') leftOut.push({ agentId: id, why: 'it ships with sua; change your own agents only' });
      else if (!shellSteps(a).length) {
        const calls = toolIdsUsed(a);
        leftOut.push({ agentId: id, why: calls.length ? `it already calls ${calls.join(', ')}` : 'it has no command step to share' });
      }
      else ranked.push(a);
    }
  } else {
    const terms = [...new Set(words(ask))];
    if (!terms.length) return { picked: [], leftOut };
    const scored = agents
      .filter((a) => a.source === 'local' && a.status !== 'archived' && shellSteps(a).length > 0)
      .map((a) => {
        const hay = `${a.id} ${a.name} ${a.description ?? ''} ${shellSteps(a).map((n) => n.command).join(' ')}`.toLowerCase();
        return { a, score: terms.filter((t) => hay.includes(t)).length };
      })
      .filter((x) => x.score > 0)
      .sort((x, y) => y.score - x.score || x.a.id.localeCompare(y.a.id));
    // The agents that match the ask best: a word or two in common by chance isn't enough.
    const top = scored[0]?.score ?? 0;
    ranked = scored.filter((x) => x.score >= Math.ceil(top * 0.6)).map((x) => x.a);
  }
  for (const a of ranked.slice(MAX_REFACTOR_AGENTS)) leftOut.push({ agentId: a.id, why: `more than ${MAX_REFACTOR_AGENTS} on one card` });
  return { picked: ranked.slice(0, MAX_REFACTOR_AGENTS), leftOut };
}

/** The picked agents' command steps, as the tool-refactorer reads them. Pure. */
export function stepsText(agents: readonly Agent[]): string {
  const out: string[] = [];
  for (const a of agents) {
    for (const n of shellSteps(a)) {
      const cmd = (n.command ?? '').trim();
      out.push(`--- agent "${a.id}" (${a.name}), step "${n.id}":\n${cmd.length > MAX_STEP_CHARS ? `${cmd.slice(0, MAX_STEP_CHARS)}\n…(cut)` : cmd}`);
    }
  }
  const all = out.join('\n\n');
  return all.length > MAX_STEPS_CHARS ? `${all.slice(0, MAX_STEPS_CHARS)}\n…(cut)` : all;
}

const tagged = (raw: string, tag: string): string | undefined => {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i').exec(raw);
  return m ? m[1].replace(/^\n+|\s+$/g, '') : undefined;
};

function dedent(text: string): string {
  const lines = text.split('\n');
  const indents = lines.filter((l) => l.trim()).map((l) => /^ */.exec(l)![0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return min ? lines.map((l) => l.slice(min)).join('\n') : text;
}

type Runner = (inputs: Record<string, string>) => Promise<{ text?: string; error?: string }>;

function runnerFor(ctx: Ctx, id: string, fake: ((inputs: Record<string, string>) => Promise<string | undefined>) | undefined): Runner | undefined {
  if (fake) return async (inputs) => ({ text: await fake(inputs) });
  if (!ensureSystemAgentCurrent(ctx, id, 'sharing a tool')) return undefined;
  const agent = ctx.agentStore.getAgent(id);
  if (!agent) return undefined;
  return async (inputs) => {
    const run = await runDispatchedAgentToTerminal(ctx, agent, inputs);
    return run.status === 'completed' ? { text: run.result ?? '' } : { error: run.error ?? run.status };
  };
}

function say(ctx: Ctx, threadId: string, words: string): void {
  const msg = ctx.inboxStore!.addResponse(threadId, 'triage', words);
  publishInboxEvent(ctx, threadId, 'message:created', { responseId: msg.id, role: 'triage', body: msg.body, createdAt: msg.createdAt });
}

/** Ids sua named, from "a, b c". Pure. */
export function idsFrom(raw: string | undefined): string[] {
  return [...new Set((raw ?? '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))];
}

/**
 * Triage's `tool-refactor`: work out the shared tool and each agent's change
 * in the background (it changes nothing), then post the card. Returns at once.
 */
export function startToolRefactor(ctx: Ctx, messageId: string, meta: InboxActionMeta): { status: InboxActionStatus; summary?: string; refusalReason?: string } {
  const ask = (meta.inputs.ASK ?? '').trim();
  if (!ask) return { status: 'failed', refusalReason: 'tool-refactor needs inputs.ASK: what to share, in their words.' };
  if (!ctx.toolStore) return { status: 'failed', refusalReason: "The tool store isn't available here." };
  const refactorer = runnerFor(ctx, TOOL_REFACTORER_ID, ctx.toolRefactorRun);
  const retooler = runnerFor(ctx, AGENT_RETOOLER_ID, ctx.agentRetoolerRun);
  if (!refactorer || !retooler) return { status: 'failed', refusalReason: "sua can't share tools right now (its tool refactorer isn't installed)." };

  const { picked, leftOut } = pickRefactorAgents(ctx.agentStore.listAgents(), ask, idsFrom(meta.inputs.AGENT_IDS));
  if (picked.length < 2) {
    return { status: 'failed', refusalReason: picked.length === 1
      ? `Only \`${picked[0].id}\` matched, and a shared tool is for several agents. To change one agent, ask sua to fix it instead.`
      : `None of your agents matched "${ask}". Name the agents (or a word in their names).` };
  }

  inBackground(ctx, 'tool-refactor', (async () => {
    try {
      // 2. The tool, or one of yours.
      const base = { ASK: ask, STEPS: stepsText(picked), TOOLS: existingToolsText(ctx), FIX: '' };
      let toolYaml = '';
      let reuse = '';
      let why = '';
      let problem = '';
      for (let tries = 1; tries <= 2 && !toolYaml && !reuse; tries++) {
        const reply = await refactorer(tries === 1 ? base : { ...base, FIX: problem });
        if (reply.text === undefined) { problem = reply.error ?? 'it stopped'; break; }
        const r = tagged(reply.text, 'reuse')?.trim();
        why = tagged(reply.text, 'why')?.replace(/\s+/g, ' ').trim() ?? '';
        if (r) {
          const t = ctx.toolStore!.getTool(r);
          if (t && !ctx.toolStore!.getToolServerId(r)) { reuse = r; break; }
          problem = `There's no tool of theirs called "${r}". Write the tool instead.`;
          continue;
        }
        const d = parseToolDraft(reply.text, ctx.toolStore);
        if ('error' in d) { problem = d.error; continue; }
        toolYaml = d.yaml;
      }
      if (!toolYaml && !reuse) {
        say(ctx, messageId, `I couldn't draft a shared tool for those agents (${problem.slice(0, 200)}). Nothing changed.`);
        return;
      }
      const toolId = reuse || /^id:\s*([a-z0-9-]+)/m.exec(toolYaml)?.[1] || '';
      const toolText = toolYaml || ctx.toolStore!.getTool(reuse)?.yamlText || JSON.stringify(ctx.toolStore!.getTool(reuse));

      // 3. Each agent, three at a time.
      const todo = picked.filter((a) => {
        if (toolIdsUsed(a).includes(toolId)) { leftOut.push({ agentId: a.id, why: `it already uses ${toolId}` }); return false; }
        return true;
      });
      const edits: RefactorEdit[] = [];
      const retool = async (a: Agent): Promise<void> => {
        const baseYaml = exportAgent(a);
        const ins = { AGENT_YAML: baseYaml, TOOL_YAML: toolText, ASK: ask, FIX: '' };
        let reason = '';
        for (let tries = 1; tries <= 2; tries++) {
          const reply = await retooler(tries === 1 ? ins : { ...ins, FIX: reason });
          if (reply.text === undefined) { reason = reply.error ?? 'it stopped'; break; }
          const skip = tagged(reply.text, 'skip');
          if (skip) { leftOut.push({ agentId: a.id, why: skip.replace(/\s+/g, ' ').trim().slice(0, 160) }); return; }
          const yaml = tagged(reply.text, 'yaml');
          if (!yaml) { reason = 'The reply had no <yaml> block.'; continue; }
          const y = `${dedent(yaml).trim()}\n`;
          const checked = checkRefactorEdit(ctx, { agentId: a.id, yaml: y, baseVersion: a.version }, toolId);
          if (checked.ok) { edits.push({ agentId: a.id, baseVersion: a.version, baseYaml, yaml: y }); return; }
          reason = checked.reason;
        }
        leftOut.push({ agentId: a.id, why: `its change didn't check out: ${reason.slice(0, 160)}` });
      };
      for (let i = 0; i < todo.length; i += RETOOL_AT_ONCE) await Promise.all(todo.slice(i, i + RETOOL_AT_ONCE).map(retool));
      if (!edits.length) {
        say(ctx, messageId, `I drafted ${reuse ? `a way to use ${toolId}` : `the tool ${toolId}`}, but none of the agents' changes checked out: ${leftOut.map((l) => `${l.agentId} (${l.why})`).join('; ')}. Nothing changed.`);
        return;
      }
      edits.sort((x, y) => picked.findIndex((a) => a.id === x.agentId) - picked.findIndex((a) => a.id === y.agentId));

      // 4. The card.
      const summary = `${reuse ? `Use your tool \`${toolId}\`` : `A shared tool, \`${toolId}\`,`} for ${edits.length} agent${edits.length === 1 ? '' : 's'}: ${edits.map((e) => `\`${e.agentId}\``).join(', ')}.${why ? ` ${why}` : ''}`;
      const action: InboxActionMeta = {
        kind: 'action', status: 'proposed', agentId: TOOL_REFACTOR_APPLY, effect: 'write',
        inputs: { TOOL_YAML: toolYaml, TOOL_BASE: '', REUSE_TOOL: reuse, EDITS: JSON.stringify(edits), LEFT_OUT: JSON.stringify(leftOut), ASK: ask },
        rationale: summary,
        ctaLabel: reuse ? 'Change them' : 'Add the tool and change them',
      };
      const resp = ctx.inboxStore!.addResponse(messageId, 'action', summary, JSON.stringify(action));
      publishInboxEvent(ctx, messageId, 'action:created', { responseId: resp.id, agentId: action.agentId, rationale: summary, inputs: action.inputs, createdAt: resp.createdAt });
      ctx.inboxStore?.updateStatus(messageId, 'awaiting_user');
    } catch (err) {
      try { say(ctx, messageId, `I couldn't work out a shared tool: ${err instanceof Error ? err.message.slice(0, 160) : 'it failed'}. Nothing changed.`); } catch { /* the thread is gone */ }
    }
  })());
  return { status: 'completed', summary: `Looking at ${picked.length} agents (${picked.map((a) => a.id).join(', ')}) and drafting a shared tool…` };
}
