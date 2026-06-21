import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  buildDiscoveryCatalog,
  exportAgent,
  listBuiltinTools,
  parseAgent,
  LLM_PROVIDERS,
  type LlmProvider,
  type ToolDefinition,
} from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { formatToolCatalog } from './run-now-build.js';
import { TEMPLATE_REGISTRY } from '../views/pulse-templates.js';
import { SYSTEM_AGENT_IDS, TRIAGE_AGENT_ID } from './inbox-shared.js';

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

/**
 * Trimmed catalog for the triage turn: id, name, short description, createdAt,
 * tags — newest TRIAGE_CATALOG_MAX_AGENTS only. Drops source/status to save
 * tokens. Returns the JSON plus a flag noting whether older agents were elided.
 */
export function buildTriageCatalogJson(ctx: ReturnType<typeof getContext>): string {
  try {
    const all = ctx.agentStore.listAgents()
      .filter((a) => !SYSTEM_AGENT_IDS.has(a.id))
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
    const shown = all.slice(0, TRIAGE_CATALOG_MAX_AGENTS).map((a) => ({
      id: a.id,
      name: a.name,
      description: (a.description ?? '').slice(0, TRIAGE_CATALOG_DESC_CAP),
      tags: a.tags ?? [],
      createdAt: a.createdAt,
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
  messageAgentId: string | undefined,
  inputs: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = { ...inputs };
  if (!out.AGENT_YAML && messageAgentId) {
    const target = ctx.agentStore.getAgent(messageAgentId);
    if (target) {
      try { out.AGENT_YAML = exportAgent(target); } catch { /* swallow */ }
    }
  }
  if (!out.LAST_RUN_OUTPUT && messageAgentId) {
    const summary = collectRunSummary(ctx, messageAgentId);
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
