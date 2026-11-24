/**
 * Tools → New tool → Describe it (docs/tools.md): sua's `tool-drafter` agent
 * drafts a tool from a sentence. The draft is checked like any tool you write
 * (core `checkUserToolYaml`, plus: every input is used, no secret written into
 * it), with up to two more tries told what was wrong. A draft that checks out
 * opens in the New tool form, filled in, for you to read, Try and Save; nothing
 * runs or is saved before you press those. Drafts live in memory for an hour.
 */
import { randomUUID } from 'node:crypto';
import {
  checkUserToolYaml,
  executeAgentDag,
  listBuiltinTools,
  type ToolDefinition,
} from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { ensureSystemAgentCurrent } from '../routes/inbox-catalog.js';
import { buildLlmSettingsSnapshot } from './llm-settings-snapshot.js';
import { inBackground } from './background.js';

type Ctx = ReturnType<typeof getContext>;

export const TOOL_DRAFTER_ID = 'tool-drafter';
/** The first try plus two more, each told what was wrong. */
export const TOOL_DRAFT_TRIES = 3;
const DRAFT_TTL_MS = 60 * 60 * 1000;

export type ToolDraft =
  | { status: 'working'; description: string; at: string; tries: number }
  | { status: 'ready'; description: string; at: string; tries: number; yaml: string; sample: string; why?: string; warnings: string[] }
  | { status: 'failed'; description: string; at: string; tries: number; error: string };

const tagged = (raw: string, tag: string): string | undefined => {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i').exec(raw);
  return m ? m[1].replace(/^\n+|\s+$/g, '') : undefined;
};

/** Dedent a block the model indented as a whole. */
function dedent(text: string): string {
  const lines = text.split('\n');
  const indents = lines.filter((l) => l.trim()).map((l) => /^ */.exec(l)![0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return min ? lines.map((l) => l.slice(min)).join('\n') : text;
}

const SECRET_LIKE = /\b(sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|xox[abp]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,})/;

/** What the drafter's reply makes: a tool that can be saved, its sample inputs, or why not. Pure apart from the store lookup. */
export function parseToolDraft(
  raw: string,
  store?: Parameters<typeof checkUserToolYaml>[1],
): { yaml: string; tool: ToolDefinition; sample: string; why?: string; warnings: string[] } | { error: string } {
  const block = tagged(raw, 'tool');
  if (!block) return { error: 'The reply had no <tool> block.' };
  const yaml = `${dedent(block).trim()}\n`;
  const checked = checkUserToolYaml(yaml, store);
  if (!checked.tool) return { error: checked.errors.join(' ') };
  const tool = checked.tool;
  if (store?.getTool(tool.id)) return { error: `There's already a tool "${tool.id}". Choose another id.` };
  const body = tool.implementation.command ?? tool.implementation.prompt ?? '';
  if (SECRET_LIKE.test(body)) return { error: 'It has what looks like a key written into it. Read keys from an environment variable the calling step declares.' };
  const unused = Object.keys(tool.inputs).filter((n) => tool.implementation.type === 'shell'
    // $name, ${name}, or read by name (os.environ["name"] in a python3 one-liner).
    ? !new RegExp(`\\b${n}\\b`).test(body)
    : !new RegExp(`\\{\\{\\s*inputs\\.${n}\\s*\\}\\}`).test(body));
  if (unused.length) return { error: `It declares inputs it never uses: ${unused.join(', ')}.` };
  const sample = dedent(tagged(raw, 'samples') ?? '').trim();
  const why = tagged(raw, 'why')?.replace(/\s+/g, ' ').trim().slice(0, 300);
  return { yaml, tool, sample, ...(why ? { why } : {}), warnings: checked.warnings };
}

/** The tools that exist, one per line, for the drafter to reuse or steer clear of. */
export function existingToolsText(ctx: Pick<Ctx, 'toolStore'>): string {
  const lines = listBuiltinTools().map((t) => `- ${t.id}: ${(t.description ?? '').split('\n')[0].slice(0, 120)}`);
  try {
    for (const t of ctx.toolStore?.listTools() ?? []) lines.push(`- ${t.id}: ${(t.description ?? '').slice(0, 120)}`);
  } catch { /* store unavailable */ }
  return lines.join('\n');
}

function drafts(ctx: Ctx): Map<string, ToolDraft> {
  const map = (ctx.toolDrafts ??= new Map());
  const cutoff = Date.now() - DRAFT_TTL_MS;
  for (const [id, d] of map) if (Date.parse(d.at) < cutoff) map.delete(id);
  return map;
}

export function readToolDraft(ctx: Ctx, id: string): ToolDraft | undefined {
  return drafts(ctx).get(id);
}

/** Start drafting a tool in the background; its id, or undefined when the drafter isn't available. */
export function startToolDraft(ctx: Ctx, description: string): string | undefined {
  // Keep line breaks: a step's command pasted in (Make a tool from this step) needs them.
  const said = description.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 2000);
  const fake = ctx.toolDrafterRun;
  if (!fake && !ensureSystemAgentCurrent(ctx, TOOL_DRAFTER_ID, 'drafting tools')) return undefined;
  const drafter = fake ? undefined : ctx.agentStore.getAgent(TOOL_DRAFTER_ID);
  if (!fake && !drafter) return undefined;
  const id = randomUUID();
  const map = drafts(ctx);
  const at = () => new Date().toISOString();
  map.set(id, { status: 'working', description: said, at: at(), tries: 1 });

  const ask = async (ins: Record<string, string>): Promise<{ text?: string; error?: string }> => {
    if (fake) return { text: await fake(ins) };
    const runId = randomUUID();
    const ac = new AbortController();
    ctx.activeRuns.set(runId, ac);
    try {
      await executeAgentDag(drafter!, { triggeredBy: 'dashboard', runId, signal: ac.signal, inputs: ins }, {
        runStore: ctx.runStore, secretsStore: ctx.secretsStore, variablesStore: ctx.variablesStore,
        dataRoot: ctx.agentStore.dataRoot, llmSettings: buildLlmSettingsSnapshot(ctx), spawnNode: ctx.workflowSpawnNode,
      });
      const run = ctx.runStore.getRun(runId);
      return run?.status === 'completed' ? { text: run.result ?? '' } : { error: run?.error ?? 'sua stopped before it finished.' };
    } finally {
      ctx.activeRuns.delete(runId);
    }
  };

  inBackground(ctx, 'tool-drafter', (async () => {
    const inputs = { DESCRIPTION: said, TOOLS: existingToolsText(ctx), FIX: '' };
    let lastError = 'sua stopped before it finished.';
    try {
      for (let tries = 1; tries <= TOOL_DRAFT_TRIES; tries++) {
        map.set(id, { status: 'working', description: said, at: at(), tries });
        const reply = await ask(tries === 1 ? inputs : { ...inputs, FIX: lastError });
        if (reply.text === undefined) { lastError = reply.error ?? lastError; break; }
        const parsed = parseToolDraft(reply.text, ctx.toolStore);
        if (!('error' in parsed)) {
          map.set(id, { status: 'ready', description: said, at: at(), tries, yaml: parsed.yaml, sample: parsed.sample, ...(parsed.why ? { why: parsed.why } : {}), warnings: parsed.warnings });
          return;
        }
        lastError = parsed.error;
      }
      map.set(id, { status: 'failed', description: said, at: at(), tries: TOOL_DRAFT_TRIES, error: lastError });
    } catch (err) {
      map.set(id, { status: 'failed', description: said, at: at(), tries: 1, error: err instanceof Error ? err.message : String(err) });
    }
  })());
  return id;
}
