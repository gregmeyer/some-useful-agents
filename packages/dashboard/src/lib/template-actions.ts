/**
 * Templates from skills (docs/notebooks.md "Templates from a skill"):
 *
 * - `template-draft` has the template-drafter agent turn the skills named
 *   (SKILLS: evaluate-software, software-rubric) and a job ("pick a CRM for
 *   a 5-person sales team") into a notebook template, in the background,
 *   changing nothing. The draft is checked in code (cleanTemplateSetup),
 *   with one more try told what was wrong, then a `template-save` card is
 *   posted;
 * - `template-save` saves the card's template (saveTemplateSetup); notebooks
 *   are started from it like any template.
 *
 * Generic: the skills say what goes in the template; the checks are the
 * same for every one (weights add to 100, each scored criterion has anchors
 * and an axis, at most 6 steps and 4 asks, every step's agent installed).
 */
import {
  cleanTemplateSetup, NOTEBOOK_LAYOUT_PRESETS, notebookSlug,
  type InboxActionMeta, type InboxActionStatus, type NotebookTemplateSetup,
} from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { ensureSystemAgentCurrent } from '../routes/inbox-catalog.js';
import { runDispatchedAgentToTerminal } from '../routes/inbox-engine.js';
import { publishInboxEvent } from '../routes/inbox-shared.js';
import { inBackground } from './background.js';
import { notebooksOf } from './notebook-chat.js';
import { searchAgents } from './notebook-draft.js';
import { allSkills } from './skill-edit.js';
import { idsFrom } from './skill-actions.js';

type Ctx = ReturnType<typeof getContext>;

export const TEMPLATE_DRAFT = 'template-draft';
export const TEMPLATE_SAVE = 'template-save';
export const TEMPLATE_DRAFTER_ID = 'template-drafter';
/** sua's own agents a template's step can name (a scorer for weighted criteria), installed when one is used. */
export const STEP_HELPERS: readonly string[] = ['software-scorer'];
const MAX_SKILLS = 4;
const MAX_CONVERSATION_CHARS = 12_000;

type Runner = (inputs: Record<string, string>) => Promise<{ text?: string; error?: string }>;

function drafter(ctx: Ctx): Runner | undefined {
  const fake = ctx.templateDrafterRun;
  if (fake) return async (inputs) => ({ text: await fake(inputs) });
  if (!ensureSystemAgentCurrent(ctx, TEMPLATE_DRAFTER_ID, 'drafting a template')) return undefined;
  const agent = ctx.agentStore.getAgent(TEMPLATE_DRAFTER_ID);
  if (!agent) return undefined;
  return async (inputs) => {
    const run = await runDispatchedAgentToTerminal(ctx, agent, inputs);
    return run.status === 'completed' ? { text: run.result ?? '' } : { error: run.error ?? run.status };
  };
}

/** Installed, or one of sua's step helpers (installed now). */
function agentReady(ctx: Ctx, id: string): boolean {
  if (ctx.agentStore.getAgent(id)) return true;
  return STEP_HELPERS.includes(id) && ensureSystemAgentCurrent(ctx, id, 'a template step');
}

function say(ctx: Ctx, threadId: string, words: string): void {
  const msg = ctx.inboxStore!.addResponse(threadId, 'triage', words);
  publishInboxEvent(ctx, threadId, 'message:created', { responseId: msg.id, role: 'triage', body: msg.body, createdAt: msg.createdAt });
}

function conversationText(ctx: Ctx, threadId: string): string {
  const m = ctx.inboxStore?.get(threadId);
  if (!m) return '';
  const turns = [`you: ${m.body}`, ...ctx.inboxStore!.listResponses(threadId).filter((r) => r.role !== 'action').map((r) => `${r.role === 'user' ? 'you' : 'sua'}: ${r.body}`)];
  const all = turns.join('\n\n');
  return all.length > MAX_CONVERSATION_CHARS ? `…${all.slice(-MAX_CONVERSATION_CHARS)}` : all;
}

/** The drafter's reply: its template (name, description, setup as given) and why, or what's wrong with it. Pure. */
export function readTemplateReply(text: string): { name: string; description: string; setup: unknown; why: string } | { problem: string } {
  const m = /<template\s+name="([^"]+)"\s+description="([^"]*)"\s*>([\s\S]*?)<\/template>/i.exec(text);
  if (!m) return { problem: 'The reply had no <template name="…" description="…"> block.' };
  const name = m[1].replace(/\s+/g, ' ').trim();
  if (!name || name.length > 60) return { problem: 'The name is missing or longer than 60 characters.' };
  const body = m[3].trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  let setup: unknown;
  try { setup = JSON.parse(body); } catch { return { problem: "The setup inside <template> isn't valid JSON." }; }
  if (!setup || typeof setup !== 'object' || Array.isArray(setup)) return { problem: 'The setup inside <template> must be one JSON object.' };
  // A step may say "agent" (the notebook drafter's word) for agentId.
  const s = setup as Record<string, unknown>;
  if (Array.isArray(s.steps)) s.steps = s.steps.map((st) => (st && typeof st === 'object' && !('agentId' in st) && typeof (st as { agent?: unknown }).agent === 'string' ? { ...(st as object), agentId: (st as { agent: string }).agent || undefined } : st));
  const why = /<why>([\s\S]*?)<\/why>/i.exec(text)?.[1]?.replace(/\s+/g, ' ').trim() ?? '';
  return { name, description: m[2].replace(/\s+/g, ' ').trim(), setup, why };
}

/**
 * sua's `template-draft`: the template-drafter drafts it in the background
 * from the skills named and the job, checked as a saved one would be (one
 * more try told what was wrong), then the `template-save` card is posted.
 * Returns at once.
 */
export function startTemplateDraft(ctx: Ctx, messageId: string, meta: InboxActionMeta): { status: InboxActionStatus; summary?: string; refusalReason?: string } {
  const job = (meta.inputs.ASK ?? '').trim();
  if (!job) return { status: 'failed', refusalReason: 'template-draft needs inputs.ASK: the job the template is for, in their words.' };
  const { loaded } = allSkills(ctx);
  const skills = idsFrom(meta.inputs.SKILLS).slice(0, MAX_SKILLS);
  if (!skills.length) return { status: 'failed', refusalReason: 'template-draft needs inputs.SKILLS: the skills to follow, by name.' };
  const missing = skills.filter((n) => !loaded.byName.has(n));
  if (missing.length) return { status: 'failed', refusalReason: `There's no skill called ${missing.join(', ')}. Their skills are on /skills.` };
  const run = drafter(ctx);
  if (!run) return { status: 'failed', refusalReason: "sua can't draft templates right now (its template drafter isn't installed)." };
  const store = notebooksOf(ctx);
  const templates = store.listTemplates(200, { archived: 'include' });
  const named = (meta.inputs.NAME ?? '').trim();
  const current = named ? templates.find((t) => t.id === named || t.id === notebookSlug(named) || t.name.toLowerCase() === named.toLowerCase()) : undefined;
  for (const id of STEP_HELPERS) ensureSystemAgentCurrent(ctx, id, 'a template step');
  const helpers = STEP_HELPERS.map((id) => ctx.agentStore.getAgent(id)).filter((a) => !!a).map((a) => ({ id: a!.id, description: (a!.description ?? a!.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) }));
  const agents = [...helpers, ...searchAgents(ctx).filter((a) => !STEP_HELPERS.includes(a.id))];

  inBackground(ctx, TEMPLATE_DRAFT, (async () => {
    try {
      const base = {
        SKILLS: skills.join(', '),
        JOB: job,
        MODE: (meta.inputs.MODE ?? '').trim().slice(0, 40),
        CONVERSATION: conversationText(ctx, messageId),
        AGENTS: agents.length ? agents.map((a) => `${a.id}: ${a.description}`).join('\n') : '(none)',
        LAYOUTS: NOTEBOOK_LAYOUT_PRESETS.map((p) => `${p.id}: ${p.when}`).join('\n'),
        TEMPLATES: templates.map((t) => `- ${t.name}`).join('\n') || '(none yet)',
        CURRENT: current ? `name: ${current.name}\n${JSON.stringify(current.setup)}` : '',
        FIX: '',
      };
      let got: { name: string; description: string; setup: NotebookTemplateSetup; why: string } | undefined;
      let problem = '';
      for (let tries = 1; tries <= 2 && !got; tries++) {
        const reply = await run(tries === 1 ? base : { ...base, FIX: problem });
        if (reply.text === undefined) { problem = reply.error ?? 'it stopped'; break; }
        const read = readTemplateReply(reply.text);
        if ('problem' in read) { problem = read.problem; continue; }
        const { setup, problems } = cleanTemplateSetup(read.setup, { agentInstalled: (id) => agentReady(ctx, id) });
        if (problems.length) { problem = `The template can't be used: ${problems.join(' ')}`; continue; }
        const clash = templates.find((t) => t.id === notebookSlug(read.name) && t.id !== current?.id);
        if (clash) { problem = `There's already a template called ${clash.name}. Pick another name.`; continue; }
        got = { name: current ? current.name : read.name, description: read.description, setup, why: read.why };
      }
      if (!got) { say(ctx, messageId, `I couldn't draft that template (${problem.slice(0, 300)}). Nothing changed.`); return; }
      const scored = got.setup.fields.filter((f) => f.weight !== undefined).length;
      const summary = `${current ? `A change to the template **${got.name}**` : `A template, **${got.name}**`}, from ${skills.map((s) => `\`${s}\``).join(' and ')}: ${String(got.setup.steps.length)} steps, ${String(got.setup.checks.length)} checks${scored ? `, ${String(scored)} scored criteria` : ''}.${got.why ? ` ${got.why}` : ''}`;
      const action: InboxActionMeta = {
        kind: 'action', status: 'proposed', agentId: TEMPLATE_SAVE, effect: 'write',
        inputs: { NAME: got.name, DESCRIPTION: got.description, SETUP: JSON.stringify(got.setup), SKILLS: skills.join(','), ...(current ? { REPLACES: current.id } : {}) },
        rationale: summary,
        ctaLabel: current ? 'Save the change' : 'Save the template',
      };
      const resp = ctx.inboxStore!.addResponse(messageId, 'action', summary, JSON.stringify(action));
      publishInboxEvent(ctx, messageId, 'action:created', { responseId: resp.id, agentId: action.agentId, rationale: summary, inputs: action.inputs, createdAt: resp.createdAt });
      ctx.inboxStore?.updateStatus(messageId, 'awaiting_user');
    } catch (err) {
      try { say(ctx, messageId, `I couldn't draft that template: ${err instanceof Error ? err.message.slice(0, 160) : 'it failed'}. Nothing changed.`); } catch { /* the thread is gone */ }
    }
  })());
  return { status: 'completed', summary: current ? `Drafting a change to the template **${current.name}**…` : 'Drafting the template…' };
}

/** The `template-save` card: save its template (replacing one of the same name). */
export function executeTemplateSave(ctx: Ctx, meta: InboxActionMeta): { status: InboxActionStatus; summary?: string; refusalReason?: string } {
  const name = (meta.inputs.NAME ?? '').trim();
  let raw: unknown;
  try { raw = JSON.parse(meta.inputs.SETUP ?? ''); } catch { return { status: 'failed', refusalReason: "The card's template isn't readable. Ask sua to draft it again." }; }
  try {
    const t = notebooksOf(ctx).saveTemplateSetup(name, raw, { description: meta.inputs.DESCRIPTION, agentInstalled: (id) => agentReady(ctx, id) });
    return { status: 'completed', summary: `Saved the template **${t.name}**. Start a notebook from it on [New notebook](/notebooks/new), or ask me to.` };
  } catch (err) {
    return { status: 'failed', refusalReason: err instanceof Error ? err.message : String(err) };
  }
}
