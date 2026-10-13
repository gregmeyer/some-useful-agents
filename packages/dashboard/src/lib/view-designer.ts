/**
 * "Redesign this widget" (View editor; docs/a2ui-views.md): sua's
 * `view-designer` agent proposes a better view for one agent from its current
 * view (or the starter), a trimmed sample of its last run's data, the
 * component catalog and the brand guide. The proposal is validated like any
 * view (one retry with the errors), kept in `.sua/view-proposals/<agent>.json`
 * and shown beside the current view; nothing changes until you use it.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  brandGuideText,
  buildViewDataModel,
  executeAgentDag,
  extractTaggedJson,
  loadBrandTheme,
  suaComponentDocs,
  validateViewComponents,
  type Agent,
  type ViewComponent,
} from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { ensureSystemAgentCurrent } from '../routes/inbox-catalog.js';
import { buildLlmSettingsSnapshot } from './llm-settings-snapshot.js';
import { editorStarterView, viewSample, type ViewSample } from './view-editor.js';

type Ctx = ReturnType<typeof getContext>;

export const VIEW_DESIGNER_ID = 'view-designer';

export type ViewProposal =
  | { status: 'working'; request: string; at: string; baseVersion: number }
  | { status: 'ready'; request: string; at: string; baseVersion: number; components: ViewComponent[]; why?: string }
  | { status: 'failed'; request: string; at: string; baseVersion: number; error: string };

const safe = (agentId: string) => agentId.replace(/[^\w.-]/g, '_');

export function viewProposalPath(dataDir: string, agentId: string): string {
  return join(dataDir, '.sua', 'view-proposals', `${safe(agentId)}.json`);
}

export function readViewProposal(dataDir: string, agentId: string): ViewProposal | undefined {
  try { return JSON.parse(readFileSync(viewProposalPath(dataDir, agentId), 'utf-8')) as ViewProposal; } catch { return undefined; }
}

function writeProposal(dataDir: string, agentId: string, p: ViewProposal): void {
  const path = viewProposalPath(dataDir, agentId);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(p, null, 2)}\n`, { mode: 0o600 });
}

export function discardViewProposal(dataDir: string, agentId: string): void {
  const path = viewProposalPath(dataDir, agentId);
  if (existsSync(path)) rmSync(path);
}

/** The sample data a view binds to, small enough for a prompt: lists cut to 5, long text to 300 characters. */
export function trimForPrompt(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return value.length > 300 ? `${value.slice(0, 300)}…` : value;
  if (Array.isArray(value)) {
    const kept = value.slice(0, 5).map((v) => trimForPrompt(v, depth + 1));
    return value.length > 5 ? [...kept, `(${String(value.length - 5)} more)`] : kept;
  }
  if (value && typeof value === 'object') {
    if (depth > 5) return '…';
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 40).map(([k, v]) => [k, trimForPrompt(v, depth + 1)]));
  }
  return value;
}

function catalogText(): string {
  const sua = suaComponentDocs().map((d) => `- ${d.name}: ${d.summary} e.g. ${JSON.stringify(d.example)}`);
  return [
    'A2UI basics: Text (text, variant: h1-h5 / body / caption), Image (url), Row / Column (children: [ids]), List, Card (child), Tabs (tabs: [{title, child}]), Divider, Button (child: a Text id, action), TextField, ChoicePicker.',
    'A prop is a literal, or bound: { "path": "/outputs/name" }.',
    ...sua,
  ].join('\n');
}

/** The inputs the view-designer agent gets. */
export function designerInputs(
  agent: Pick<Agent, 'id' | 'name' | 'description' | 'view' | 'outputWidget'>,
  sample: ViewSample | undefined,
  brand: string,
  request: string,
): Record<string, string> {
  const current = agent.view && 'components' in agent.view ? agent.view.components : editorStarterView(agent, sample);
  const model = sample ? buildViewDataModel({ run: sample.run, nodeExecutions: sample.nodeExecutions, history: sample.history }) : undefined;
  const data = model ? { outputs: model.outputs, series: model.series, inputs: model.inputs, result: model.result, run: model.run } : { result: '(no run yet)' };
  return {
    AGENT: `${agent.name} (${agent.id})${agent.description ? `: ${agent.description}` : ''}`.slice(0, 600),
    CURRENT: JSON.stringify(current),
    DATA: JSON.stringify(trimForPrompt(data)).slice(0, 12_000),
    CATALOG: catalogText(),
    BRAND: brand,
    REQUEST: request,
    FIX: '',
  };
}

/** The agent's <view> block as a checked proposal, or why it isn't one. Pure. */
export function parseViewProposal(raw: string, imgHosts: string[] = []): { components: ViewComponent[]; why?: string } | { error: string } {
  const block = extractTaggedJson(raw, 'view');
  if (!block) return { error: "sua didn't come back with a view." };
  let v: unknown;
  try { v = JSON.parse(block); } catch { return { error: "sua's view wasn't valid JSON." }; }
  const obj = v as { components?: unknown; why?: unknown };
  const list = Array.isArray(v) ? v : obj && Array.isArray(obj.components) ? obj.components : undefined;
  if (!list) return { error: 'sua\'s view had no components.' };
  const checked = validateViewComponents(list, { imgHosts });
  if (!checked.ok) return { error: checked.errors.slice(0, 3).join(' ') };
  const why = typeof obj.why === 'string' ? obj.why.slice(0, 300) : undefined;
  return { components: checked.components, ...(why ? { why } : {}) };
}

/** Start a proposal in the background. False when one is already being made for this agent, or the designer isn't available. */
export function startViewProposal(ctx: Ctx, agent: Agent, request: string): boolean {
  const req = request.replace(/\s+/g, ' ').trim().slice(0, 500);
  const running = (ctx.viewDesignerRunning ??= new Set());
  if (running.has(agent.id)) return false;
  const fake = ctx.viewDesignerRun;
  if (!fake && !ensureSystemAgentCurrent(ctx, VIEW_DESIGNER_ID, 'view redesigns')) return false;
  const designer = fake ? undefined : ctx.agentStore.getAgent(VIEW_DESIGNER_ID);
  if (!fake && !designer) return false;
  running.add(agent.id);
  const base = { request: req, baseVersion: agent.version };
  writeProposal(ctx.dataDir, agent.id, { status: 'working', at: new Date().toISOString(), ...base });
  const inputs = designerInputs(agent, viewSample(agent, ctx.runStore), brandGuideText(loadBrandTheme(ctx.dataDir)), req);
  const imgHosts = agent.permissions?.imgSrc ?? [];

  const ask = async (ins: Record<string, string>): Promise<{ text?: string; error?: string }> => {
    if (fake) return { text: await fake(ins) };
    const runId = randomUUID();
    const ac = new AbortController();
    ctx.activeRuns.set(runId, ac);
    try {
      await executeAgentDag(designer!, { triggeredBy: 'dashboard', runId, signal: ac.signal, inputs: ins }, {
        runStore: ctx.runStore, secretsStore: ctx.secretsStore, variablesStore: ctx.variablesStore,
        dataRoot: ctx.agentStore.dataRoot, llmSettings: buildLlmSettingsSnapshot(ctx), spawnNode: ctx.workflowSpawnNode,
      });
      const run = ctx.runStore.getRun(runId);
      return run?.status === 'completed' ? { text: run.result ?? '' } : { error: run?.error ?? 'sua stopped before it finished.' };
    } finally {
      ctx.activeRuns.delete(runId);
    }
  };

  void (async () => {
    const at = () => new Date().toISOString();
    try {
      let reply = await ask(inputs);
      let parsed = reply.text !== undefined ? parseViewProposal(reply.text, imgHosts) : { error: reply.error ?? 'sua stopped.' };
      // One more try, told what was wrong, when the reply came back but didn't check out.
      if ('error' in parsed && reply.text !== undefined) {
        reply = await ask({ ...inputs, FIX: parsed.error });
        parsed = reply.text !== undefined ? parseViewProposal(reply.text, imgHosts) : { error: reply.error ?? 'sua stopped.' };
      }
      writeProposal(ctx.dataDir, agent.id, 'error' in parsed
        ? { status: 'failed', at: at(), ...base, error: parsed.error }
        : { status: 'ready', at: at(), ...base, components: parsed.components, ...(parsed.why ? { why: parsed.why } : {}) });
    } catch (err) {
      writeProposal(ctx.dataDir, agent.id, { status: 'failed', at: at(), ...base, error: err instanceof Error ? err.message : String(err) });
    } finally {
      running.delete(agent.id);
    }
  })();
  return true;
}
