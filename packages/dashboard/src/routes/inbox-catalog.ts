import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  buildDiscoveryCatalog,
  exportAgent,
  listBuiltinTools,
  parseAgent,
  LLM_PROVIDERS,
  type Agent,
  type LlmProvider,
  type ToolDefinition,
} from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { formatToolCatalog } from './run-now-build.js';
import { TEMPLATE_REGISTRY } from '../views/pulse-templates.js';
import { SYSTEM_AGENT_IDS, TRIAGE_AGENT_ID } from './inbox-shared.js';
import { canRenderInlineInboxWidget } from './inbox-widgets.js';

const TRIAGE_SUB_AGENT_ALLOWLIST: readonly string[] = [
  'agent-analyzer',
  'agent-editor',
  'agent-catalog-search',
  'agent-builder',
];

/**
 * For allowlist entries that aren't already installed, the route
 * lazy-imports the YAML on first triage call (mirrors what the
 * existing analyze route does for agent-analyzer). The path lookup
 * is conservative — any agent that isn't installed AND isn't shipped
 * under `agents/examples/` is silently dropped from the effective
 * allowlist.
 */
const ALLOWLIST_AUTOIMPORT_DIR = 'agents/examples';

/**
 * Build the effective allowlist of sub-agent ids triage may propose
 * running. For entries not yet installed, attempt a one-shot import
 * from `agents/examples/<id>.yaml` (same pattern the analyze route uses
 * for agent-analyzer). Entries that can't be imported are silently
 * dropped — the prompt never sees them, so triage can't propose them.
 */
/**
 * Auto-install OR auto-refresh a single system agent from its
 * bundled `agents/examples/<id>.yaml`. Returns true when the agent
 * exists in the store after the call (whether imported, refreshed,
 * or already current); false when the disk YAML is missing or
 * unparseable. Scoped to system agents only — `inbox-triage` itself
 * plus everything in TRIAGE_SUB_AGENT_ALLOWLIST. User agents are
 * never touched by this path.
 *
 * Refresh trigger: the installed exported YAML differs from the
 * bundled one. The diff catches prompt updates (e.g. PR #395's
 * VOICE section on inbox-triage) plus structural changes (e.g.
 * PR #394's preflight node on agent-analyzer).
 */
export function ensureSystemAgentCurrent(
  ctx: ReturnType<typeof getContext>,
  id: string,
  context: string,
): boolean {
  try {
    const yamlPath = join(resolve(ALLOWLIST_AUTOIMPORT_DIR), `${id}.yaml`);
    const yamlText = readFileSync(yamlPath, 'utf-8');
    const parsed = parseAgent(yamlText);
    const installed = ctx.agentStore.getAgent(id);
    const needsImport = !installed;
    const needsRefresh = installed && exportAgent(installed) !== exportAgent(parsed);
    if (needsImport || needsRefresh) {
      ctx.agentStore.upsertAgent(parsed, 'import', needsImport
        ? `Auto-imported for ${context}`
        : 'Auto-refreshed from agents/examples/ (bundled YAML changed)');
    }
    return ctx.agentStore.getAgent(id) !== undefined;
  } catch {
    return false;
  }
}

export function getSubAgentAllowlist(ctx: ReturnType<typeof getContext>): string[] {
  // Per-agent override on inbox-triage controls the system-agent
  // portion of the allowlist. Explicitly inbox-runnable user agents
  // are always appended when installed.
  const triage = ctx.agentStore.getAgent(TRIAGE_AGENT_ID);
  const operatorOverride = triage?.allowedSubAgents;
  const available = new Set<string>();
  if (operatorOverride !== undefined) {
    for (const id of operatorOverride) {
      if (ctx.agentStore.getAgent(id) !== undefined) available.add(id);
    }
  } else {
    for (const id of TRIAGE_SUB_AGENT_ALLOWLIST) {
      if (ensureSystemAgentCurrent(ctx, id, 'inbox triage allowlist')) {
        available.add(id);
      }
    }
  }

  for (const agent of ctx.agentStore.listAgents()) {
    if (!agent.permissions?.inboxRunnable) continue;
    if (agent.source !== 'local' && agent.source !== 'community') continue;
    if (SYSTEM_AGENT_IDS.has(agent.id)) continue;
    available.add(agent.id);
  }

  return Array.from(available);
}

/**
 * Installed user agents that triage COULD run but haven't been granted
 * `inboxRunnable` yet — the inverse of the allowlist's runnable filter.
 * Triage proposes running one anyway; the dashboard turns that into a
 * one-click "Enable & run" action (grantsInboxRunnable). Without this,
 * triage dead-ends on "I can't run X from this thread" and the operator
 * has to go hunt for the agent's Config toggle. System agents and
 * already-runnable agents are excluded.
 */
export function getRunnableCandidates(ctx: ReturnType<typeof getContext>): string[] {
  const runnable = new Set(getSubAgentAllowlist(ctx));
  const candidates: string[] = [];
  for (const agent of ctx.agentStore.listAgents()) {
    if (agent.permissions?.inboxRunnable) continue;        // already runnable
    if (agent.source !== 'local' && agent.source !== 'community') continue;
    if (SYSTEM_AGENT_IDS.has(agent.id)) continue;
    if (runnable.has(agent.id)) continue;                  // operator-allowlisted
    candidates.push(agent.id);
  }
  return candidates;
}

/**
 * Inject `AGENT_CATALOG` into agent-catalog-search inputs: a JSON array
 * of installed-agent metadata (id, name, description, tags, source,
 * status) excluding system/scaffolding agents. The catalog-search
 * agent's prompt also self-filters, but stripping here saves prompt
 * tokens and prevents the LLM from accidentally proposing a system
 * agent even on edge cases.
 */
/**
 * Build the installed-agent catalog (newest first, system/scaffolding agents
 * excluded). Shared by the catalog-search enrichment and the triage-turn
 * injection. Newest-first ordering means entry [0] answers "what's the newest
 * agent?" without guessing at list order.
 */
export function buildAgentCatalogJson(ctx: ReturnType<typeof getContext>): string {
  try {
    const catalog = ctx.agentStore.listAgents()
      .filter((a) => !SYSTEM_AGENT_IDS.has(a.id))
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
      .map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description ?? '',
        tags: a.tags ?? [],
        source: a.source,
        status: a.status,
        createdAt: a.createdAt,
      }));
    return JSON.stringify(catalog);
  } catch {
    return '[]';
  }
}

// Budget for the catalog injected into the triage turn itself. Triage sees a
// trimmed view (newest N, short descriptions) so it can answer recency /
// "what does agent X do" directly; deep capability search still dispatches
// agent-catalog-search, which gets the full catalog.
const TRIAGE_CATALOG_MAX_AGENTS = 40;
const TRIAGE_CATALOG_DESC_CAP = 200;
/** Most relevance matches surfaced for one request (so a vague ask can't flood). */
const TRIAGE_RELEVANCE_CAP = 15;
/** Slots reserved for newest-created agents so brand-new (never-run) ones appear. */
const TRIAGE_CREATED_RESERVE = 6;

/**
 * Generic filler words to ignore when matching the operator's request against
 * agent id/name/tags. Deliberately small — topic words like "weather",
 * "dashboard", "pr", "review" must still match.
 */
const CATALOG_STOPWORDS: ReadonlySet<string> = new Set([
  'show', 'the', 'and', 'for', 'with', 'from', 'this', 'that', 'what', 'does',
  'are', 'you', 'can', 'get', 'see', 'pull', 'run', 'now', 'again', 'latest',
  'current', 'output', 'please', 'give', 'tell', 'about', 'into', 'out', 'any',
  'all', 'how', 'why', 'who', 'when', 'where', 'has', 'have', 'want', 'need',
]);

/** Meaningful tokens (≥3 chars, not stopwords) from free text. */
function catalogTokens(text: string): string[] {
  return Array.from(new Set(
    text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !CATALOG_STOPWORDS.has(t)),
  ));
}

/** Relevance score of an agent to the request tokens: id/name/tags weigh more
 *  than description. 0 = no signal. */
function catalogRelevance(agent: Agent, tokens: readonly string[]): number {
  if (tokens.length === 0) return 0;
  const strong = `${agent.id} ${agent.name} ${(agent.tags ?? []).join(' ')}`.toLowerCase();
  const weak = (agent.description ?? '').toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (strong.includes(t)) score += 3;
    else if (weak.includes(t)) score += 1;
  }
  return score;
}

/**
 * Pick + order the agents triage sees, blending three signals so the operator
 * can reach the agent they mean even with many installed (the createdAt-only
 * cut truncated named/used agents). Pure + exported for testing.
 *
 *  1. RELEVANCE — agents matching the current request (front of the list so
 *     triage sees the likely target), score-ranked, capped.
 *  2. RECENTLY USED — fill by last-run recency (`lastUsedAt`, fallback createdAt).
 *  3. RECENTLY CREATED — reserve a few tail slots for newest agents so brand-new
 *     (never-run) ones and "what's the newest?" lookups still work.
 *
 * Deduped, capped at `max`. With ≤ max agents, all appear (just reordered).
 */
export function selectTriageCatalog(
  agents: readonly Agent[],
  lastUsedAt: ReadonlyMap<string, string>,
  currentRequest: string,
  max = TRIAGE_CATALOG_MAX_AGENTS,
): Agent[] {
  const tokens = catalogTokens(currentRequest);
  const recencyKey = (a: Agent): string => lastUsedAt.get(a.id) ?? a.createdAt ?? '';

  const relevant = agents
    .map((a) => ({ a, score: catalogRelevance(a, tokens) }))
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score || recencyKey(y.a).localeCompare(recencyKey(x.a)))
    .slice(0, TRIAGE_RELEVANCE_CAP)
    .map((x) => x.a);
  const usedDesc = [...agents].sort((a, b) => recencyKey(b).localeCompare(recencyKey(a)));
  const createdDesc = [...agents].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

  const selected: Agent[] = [];
  const seen = new Set<string>();
  const add = (a: Agent): void => { if (!seen.has(a.id) && selected.length < max) { seen.add(a.id); selected.push(a); } };

  relevant.forEach(add);                                              // 1. relevance, front
  for (const a of usedDesc) { if (selected.length >= max - TRIAGE_CREATED_RESERVE) break; add(a); } // 2. recently used
  let reserved = 0;                                                  // 3. newest-created reserve
  for (const a of createdDesc) { if (reserved >= TRIAGE_CREATED_RESERVE || selected.length >= max) break; if (!seen.has(a.id)) { add(a); reserved += 1; } }
  usedDesc.forEach(add);                                             // 4. top off if reserve underfilled
  return selected;
}

/**
 * Trimmed catalog for the triage turn: id, name, short description, createdAt,
 * tags (+ hasWidget). Selected by relevance to `currentRequest` + recency-of-use
 * + newest-created (see selectTriageCatalog), capped at TRIAGE_CATALOG_MAX_AGENTS.
 * Returns the JSON plus a `truncated` count of elided agents. Deep capability
 * search still dispatches agent-catalog-search, which gets the FULL catalog.
 */
export function buildTriageCatalogJson(
  ctx: ReturnType<typeof getContext>,
  currentRequest = '',
): string {
  try {
    const all = ctx.agentStore.listAgents().filter((a) => !SYSTEM_AGENT_IDS.has(a.id));
    const lastUsedAt = ctx.runStore.latestRunAtByAgent();
    const selected = selectTriageCatalog(all, lastUsedAt, currentRequest);
    const shown = selected.map((a) => ({
      id: a.id,
      name: a.name,
      description: (a.description ?? '').slice(0, TRIAGE_CATALOG_DESC_CAP),
      tags: a.tags ?? [],
      createdAt: a.createdAt,
      // Whether this agent has an inline-able output widget — lets triage pick a
      // sensible target for a `show-widget` action. Omitted when false (token thrift).
      ...(canRenderInlineInboxWidget(a) ? { hasWidget: true } : {}),
      // Whether this agent has a Pulse signal — only signal agents render as
      // dashboard tiles, so triage uses this to pick valid `dashboard-editor`
      // add-tile targets. Omitted when false (token thrift).
      ...(a.signal ? { hasSignal: true } : {}),
    }));
    const payload: { agents: typeof shown; truncated?: number } = { agents: shown };
    if (all.length > shown.length) payload.truncated = all.length - shown.length;
    return JSON.stringify(payload);
  } catch {
    return JSON.stringify({ agents: [] });
  }
}

/**
 * Compact runnable-agent specs for the triage prompt. The load-bearing fact
 * is the input NAMES (so triage proposes actions with real keys, not guesses);
 * the full prose descriptions are the bulk of the prompt's token weight. We
 * drop the agent-level description (the AGENT_CATALOG already carries it),
 * truncate each input's description, and omit empty/false fields. This roughly
 * halves the specs block — the single biggest chunk of a triage turn — with no
 * correctness loss. The shape (`{id,name,inputs:[{name,type,required?,desc?,default?}]}`)
 * still gives triage exact input names; the kernel still says "use EXACT names".
 */
const TRIAGE_SPEC_INPUT_DESC_CAP = 80;

export function buildRunnableAgentSpecsJson(
  ctx: ReturnType<typeof getContext>,
  allowlist: readonly string[],
): string {
  try {
    const specs = allowlist
      .map((id) => ctx.agentStore.getAgent(id))
      .filter((agent): agent is NonNullable<typeof agent> => Boolean(agent))
      .map((agent) => ({
        id: agent.id,
        name: agent.name,
        inputs: Object.entries(agent.inputs ?? {}).map(([name, spec]) => {
          const out: Record<string, unknown> = { name, type: spec.type };
          if (spec.required) out.required = true;
          const desc = (spec.description ?? '').trim().replace(/\s+/g, ' ');
          if (desc) {
            out.desc = desc.length > TRIAGE_SPEC_INPUT_DESC_CAP
              ? `${desc.slice(0, TRIAGE_SPEC_INPUT_DESC_CAP)}…`
              : desc;
          }
          const def = 'default' in spec ? spec.default : undefined;
          if (def !== undefined && def !== '' && def !== null) out.default = String(def).slice(0, 48);
          return out;
        }),
      }));
    return JSON.stringify(specs);
  } catch {
    return '[]';
  }
}

export function enrichAgentCatalogSearchInputs(
  ctx: ReturnType<typeof getContext>,
  inputs: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = { ...inputs };
  if (out.AGENT_CATALOG && out.AGENT_CATALOG.trim().length > 0) return out;
  out.AGENT_CATALOG = buildAgentCatalogJson(ctx);
  return out;
}

/**
 * For agent-analyzer specifically: auto-inject AGENT_YAML (and
 * LAST_RUN_OUTPUT when available) so triage doesn't have to thread
 * the full YAML string through its <plan>. Mirrors the analyze
 * route's input shape at run-now-build.ts:441-489 but stripped down
 * (no DISCOVERY_CATALOG yet — that needs the tools/templates registry
 * and we keep this PR focused on the inbox plumbing).
 *
 * Returns a new inputs object; the original is not mutated. When the
 * inbox message has no `agentId`, the function returns the inputs
 * unchanged and execution proceeds — agent-analyzer will fail loudly
 * on the missing required AGENT_YAML, surfaced via the action's
 * `failed` state in the conversation thread.
 */
export function enrichAgentAnalyzerInputs(
  ctx: ReturnType<typeof getContext>,
  targetAgentId: string | undefined,
  inputs: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = { ...inputs };
  if (!out.AGENT_YAML && targetAgentId) {
    const target = ctx.agentStore.getAgent(targetAgentId);
    if (target) {
      try { out.AGENT_YAML = exportAgent(target); } catch { /* swallow */ }
    }
  }
  if (!out.LAST_RUN_OUTPUT && targetAgentId) {
    const summary = collectRunSummary(ctx, targetAgentId);
    if (summary) out.LAST_RUN_OUTPUT = summary;
  }
  return out;
}

/**
 * Inject `AVAILABLE_TOOLS` + `DISCOVERY_CATALOG` into agent-builder
 * inputs. Both are required by `agents/examples/agent-builder.yaml`'s
 * design node; the operator-facing "Build from goal" flow at
 * `run-now-build.ts:340-348` already supplies them and we mirror its
 * input shape here so a triage-dispatched agent-builder run sees the
 * same catalog the dashboard's button-driven flow does.
 *
 * Preserves any caller-supplied values (triage occasionally passes a
 * narrowed FOCUS; never the registries). Falls back to whatever the
 * stores expose — empty strings are acceptable inputs and the agent
 * gracefully degrades when a catalog is missing.
 */
export function enrichAgentBuilderInputs(
  ctx: ReturnType<typeof getContext>,
  inputs: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = { ...inputs };
  // PROVIDER is a routing hint, not an agent input — it gets converted
  // to a per-node pin in extractAgentBuilderProviderPin. Drop it here
  // so executeAgentDag's input-resolution doesn't reject it as an
  // undeclared key.
  delete out.PROVIDER;
  const focusHints = [
    'Prefer the simplest viable agent for the goal.',
    'Use one llm-prompt node when possible instead of a multi-step DAG.',
    'Infer explicit run inputs from the request instead of leaving them implicit.',
    'Include a basic output widget for the final structured result.',
    'Set permissions.inboxRunnable: true so inbox triage can run the installed agent from threads.',
  ].join(' ');
  out.FOCUS = out.FOCUS && out.FOCUS.trim().length > 0
    ? `${out.FOCUS.trim()} ${focusHints}`.trim()
    : focusHints;
  try {
    const builtins = listBuiltinTools();
    let userTools: ToolDefinition[] = [];
    try {
      if (ctx.toolStore) userTools = ctx.toolStore.listTools();
    } catch { /* store not available */ }
    const allTools = [...builtins, ...userTools];
    if (!out.AVAILABLE_TOOLS) {
      out.AVAILABLE_TOOLS = formatToolCatalog(allTools);
    }
    if (!out.DISCOVERY_CATALOG) {
      out.DISCOVERY_CATALOG = buildDiscoveryCatalog({
        agents: ctx.agentStore.listAgents(),
        tools: allTools,
        templateRegistry: TEMPLATE_REGISTRY,
        dashboards: ctx.dashboardsStore?.listDashboards(),
        packs: ctx.packsStore?.listPacks(),
      });
    }
  } catch { /* swallow — agent-builder validates inputs and will fail loudly */ }
  return out;
}

/**
 * Pull a provider pin off an agent-builder action's inputs. Triage may
 * include `PROVIDER` when the operator names one explicitly ("build
 * it on apple", "use codex"); we strip it from the agent inputs in
 * `enrichAgentBuilderInputs` and apply it as a per-node pin on the
 * cloned agent before dispatch. Invalid / unknown values are ignored
 * so the system default chain still kicks in.
 */
export function extractAgentBuilderProviderPin(inputs: Record<string, string>): LlmProvider | undefined {
  const raw = typeof inputs.PROVIDER === 'string' ? inputs.PROVIDER.trim() : '';
  if (!raw) return undefined;
  return (LLM_PROVIDERS as readonly string[]).includes(raw) ? (raw as LlmProvider) : undefined;
}

/**
 * Distilled version of run-now-build.ts's run-output collector:
 * grab the latest completed run's result + the latest failed run's
 * error/output, cap at 3000 chars. Empty string when neither exists.
 */
export function collectRunSummary(
  ctx: ReturnType<typeof getContext>,
  agentName: string,
): string {
  let out = '';
  try {
    const completed = ctx.runStore.listRuns({ agentName, status: 'completed', limit: 1 });
    if (completed.length > 0 && completed[0].result) {
      const raw = completed[0].result;
      out = raw.length > 2000 ? raw.slice(0, 2000) + '\n...(truncated)' : raw;
    }
    const failed = ctx.runStore.listRuns({ agentName, status: 'failed', limit: 1 });
    if (failed.length > 0) {
      const f = failed[0];
      const failedAt = f.completedAt ?? f.startedAt;
      const completedAt = completed[0]?.completedAt ?? '';
      if (!completedAt || failedAt > completedAt) {
        const parts = [
          `\n\nMOST RECENT RUN FAILED (${f.id.slice(0, 8)}):`,
          f.error ? `Error: ${f.error}` : '',
          f.result ? `Output: ${f.result.slice(0, 1000)}` : '',
        ].filter(Boolean);
        out += parts.join('\n');
      }
    }
  } catch { /* swallow */ }
  return out.length > 3000 ? out.slice(0, 3000) + '\n...(truncated)' : out;
}

export function deriveRunFailureReason(
  ctx: ReturnType<typeof getContext>,
  runId: string,
  fallback: string | undefined,
): string | undefined {
  try {
    const failedExec = ctx.runStore.listNodeExecutions(runId).find((exec) => exec.status === 'failed');
    if (failedExec?.error && failedExec.error.trim().length > 0) return failedExec.error.trim();
  } catch { /* ignore */ }
  return fallback;
}
