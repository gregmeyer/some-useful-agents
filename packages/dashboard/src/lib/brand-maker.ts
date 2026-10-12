/**
 * "Update my brand" (Settings → Appearance; docs/brand.md): sua's
 * `brand-maker` agent proposes a brand from a website or a few words. The
 * proposal is validated (brandThemeSchema) and contrast-checked, kept in
 * `.sua/brand-proposal.json`, and shown as a preview; nothing changes until
 * you use it. One proposal at a time.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  brandThemeSchema, brandContrastIssues, FONT_STACK_RE, executeAgentDag, extractTaggedJson, loadBrandTheme,
  type BrandTheme,
} from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { ensureSystemAgentCurrent } from '../routes/inbox-catalog.js';
import { buildLlmSettingsSnapshot } from './llm-settings-snapshot.js';

type Ctx = ReturnType<typeof getContext>;

export const BRAND_MAKER_ID = 'brand-maker';

export type BrandProposal =
  | { status: 'working'; source: string; at: string }
  | { status: 'ready'; source: string; at: string; theme: BrandTheme; why?: string; issues: string[] }
  | { status: 'failed'; source: string; at: string; error: string };

export function brandProposalPath(dataDir: string): string {
  return join(dataDir, '.sua', 'brand-proposal.json');
}

export function readBrandProposal(dataDir: string): BrandProposal | undefined {
  try { return JSON.parse(readFileSync(brandProposalPath(dataDir), 'utf-8')) as BrandProposal; } catch { return undefined; }
}

function writeProposal(dataDir: string, p: BrandProposal): void {
  const path = brandProposalPath(dataDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(p, null, 2)}\n`, { mode: 0o600 });
}

export function discardBrandProposal(dataDir: string): void {
  if (existsSync(brandProposalPath(dataDir))) rmSync(brandProposalPath(dataDir));
}

/** The agent's <brand> block as a checked proposal, or why it isn't one. Pure. */
export function parseBrandProposal(raw: string, source: string, now = new Date().toISOString()): BrandProposal {
  const block = extractTaggedJson(raw, 'brand');
  if (!block) return { status: 'failed', source, at: now, error: "sua didn't come back with a brand." };
  let v: Record<string, unknown>;
  try { v = JSON.parse(block) as Record<string, unknown>; } catch { return { status: 'failed', source, at: now, error: "sua's brand wasn't readable." }; }
  const why = typeof v.why === 'string' ? v.why.slice(0, 300) : undefined;
  const { why: _why, ...rest } = v;
  // A font family that doesn't check out is dropped, not the whole brand.
  const fonts = rest.fonts as Record<string, unknown> | undefined;
  if (fonts && typeof fonts === 'object') {
    for (const k of Object.keys(fonts)) {
      if (typeof fonts[k] !== 'string') { delete fonts[k]; continue; }
      const kept = (fonts[k] as string).split(',').map((f) => f.trim()).filter((f) => f && FONT_STACK_RE.test(f)).join(', ').slice(0, 200);
      if (kept) fonts[k] = kept; else delete fonts[k];
    }
  }
  const parsed = brandThemeSchema.safeParse({ ...rest, version: 1 });
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || '(brand)'}: ${i.message}`).join('; ');
    return { status: 'failed', source, at: now, error: `The proposed brand didn't check out (${issues}). Try again, or describe it differently.` };
  }
  return { status: 'ready', source, at: now, theme: parsed.data, ...(why ? { why } : {}), issues: brandContrastIssues(parsed.data) };
}

export function brandProposalRunning(ctx: Ctx): boolean {
  return !!ctx.brandProposalRunning;
}

/** Start a proposal in the background. Returns false when one is already being made. */
export function startBrandProposal(ctx: Ctx, source: string): boolean {
  const src = source.replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!src || ctx.brandProposalRunning) return false;
  const fake = ctx.brandMakerRun;
  if (!fake && !ensureSystemAgentCurrent(ctx, BRAND_MAKER_ID, 'brand proposals')) return false;
  const agent = fake ? undefined : ctx.agentStore.getAgent(BRAND_MAKER_ID);
  if (!fake && !agent) return false;
  ctx.brandProposalRunning = true;
  writeProposal(ctx.dataDir, { status: 'working', source: src, at: new Date().toISOString() });
  const inputs = { SOURCE: src, CURRENT: JSON.stringify(loadBrandTheme(ctx.dataDir)) };
  const runId = randomUUID();
  const ac = new AbortController();
  ctx.activeRuns.set(runId, ac);
  void (async () => {
    try {
      let result: string | undefined;
      let error: string | undefined;
      if (fake) {
        result = await fake(inputs);
      } else {
        await executeAgentDag(agent!, { triggeredBy: 'dashboard', runId, signal: ac.signal, inputs }, {
          runStore: ctx.runStore, secretsStore: ctx.secretsStore, variablesStore: ctx.variablesStore,
          dataRoot: ctx.agentStore.dataRoot, llmSettings: buildLlmSettingsSnapshot(ctx), spawnNode: ctx.workflowSpawnNode,
        });
        const run = ctx.runStore.getRun(runId);
        if (run?.status === 'completed') result = run.result ?? undefined;
        else error = run?.error ?? 'sua stopped before it finished.';
      }
      writeProposal(ctx.dataDir, result
        ? parseBrandProposal(result, src)
        : { status: 'failed', source: src, at: new Date().toISOString(), error: error ?? "sua didn't come back with a brand." });
    } catch (err) {
      writeProposal(ctx.dataDir, { status: 'failed', source: src, at: new Date().toISOString(), error: err instanceof Error ? err.message : String(err) });
    } finally {
      ctx.activeRuns.delete(runId);
      ctx.brandProposalRunning = false;
    }
  })();
  return true;
}
