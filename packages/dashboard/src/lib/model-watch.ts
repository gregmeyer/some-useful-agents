/**
 * Retired-model inbox producer (a `system-health` source, like the
 * scheduler-down one).
 *
 * Providers retire models. When the model Codex is set to run goes away, every
 * Codex attempt fails `model_unavailable` and the waterfall quietly moves on to
 * the next provider — runs still finish, so nothing tells you, and every node
 * pays for a failed attempt first. That ran for days once (gpt-5.5, ~300
 * failed attempts) before anyone noticed.
 *
 * The same goes for Claude. This check finds every place a Codex or Claude model
 * is chosen — Settings → LLM, the CLI's own default (Codex's config.toml,
 * Claude's settings.json), an agent's model, a step's model — and posts ONE
 * thread to sua per model the provider no longer offers, naming where it's used
 * and what it offers now. "No longer offers" is either side of the evidence:
 *   - not in the model list the CLI keeps for this account (Codex's
 *     models_cache.json, Claude's cache/model-catalog — an unknown list never
 *     calls anything retired), or
 *   - a run was refused it (`model_unavailable`, recorded by the runtime in
 *     the LLM settings file).
 * The thread resolves itself once nothing uses that model any more.
 */
import {
  claudeConfigModel,
  claudeModels,
  codexConfigModel,
  codexModels,
  modelRetired,
  type Agent,
  type AddMessageInput,
  type InboxMessage,
  type InboxStore,
  type LlmSettings,
  type ProviderModelList,
} from '@some-useful-agents/core';

/** Loop cadence. Cheap: a few small file reads and the agent list. */
export const MODEL_WATCH_INTERVAL_MS = 10 * 60 * 1000;
/** dedupeKey prefix; `provider/model` is appended. */
export const MODEL_RETIRED_DEDUPE_PREFIX = 'system-health:model-retired:';

/** The CLI providers whose models sua watches. */
export type WatchedProvider = 'codex' | 'claude';
export const WATCHED_PROVIDERS: readonly WatchedProvider[] = ['codex', 'claude'];

const PROVIDER_NAME: Record<WatchedProvider, string> = { codex: 'Codex', claude: 'Claude' };
const CONFIG_WHERE: Record<WatchedProvider, string> = {
  codex: "Codex's own default (`model` in ~/.codex/config.toml)",
  claude: "Claude's own default (`model` in ~/.claude/settings.json)",
};

/** What one provider offers now, and the model its CLI config defaults to. */
export interface ProviderModels {
  list: ProviderModelList;
  configModel?: string;
}

/** Read every watched provider's list and default from its CLI's files. */
export function readProviderModels(): Record<WatchedProvider, ProviderModels> {
  return {
    codex: { list: codexModels(), configModel: codexConfigModel() },
    claude: { list: claudeModels(), configModel: claudeConfigModel() },
  };
}

export interface RetiredModel {
  provider: WatchedProvider;
  model: string;
  /** Where it's chosen, in words ("Settings → LLM", "agent `x`, step `y`"). */
  where: string[];
  /** The provider's own refusal, when a run hit one. */
  refusal?: string;
}

export interface ModelWatchInput {
  settings: LlmSettings;
  providers: Partial<Record<WatchedProvider, ProviderModels>>;
  agents: readonly Agent[];
}

const LLM_NODE_TYPES = new Set(['llm-prompt', 'claude-code']);

/** Every Codex/Claude model in use that its provider no longer offers. Pure; exported for tests. */
export function findRetiredModels(input: ModelWatchInput): RetiredModel[] {
  const { settings } = input;
  const refused = settings.unavailableModels ?? {};
  const hits = new Map<string, RetiredModel>();
  const note = (provider: string | undefined, model: string | undefined, where: string) => {
    if (!model || (provider !== 'codex' && provider !== 'claude')) return;
    const known = input.providers[provider];
    const refusal = refused[`${provider}/${model}`];
    if (!(known && modelRetired(model, known.list)) && !refusal) return;
    const key = `${provider}/${model}`;
    const hit = hits.get(key) ?? { provider, model, where: [], ...(refusal?.error ? { refusal: refusal.error } : {}) };
    if (!hit.where.includes(where)) hit.where.push(where);
    hits.set(key, hit);
  };

  // A provider's default only matters while it's in the waterfall and switched on.
  for (const provider of WATCHED_PROVIDERS) {
    const on = settings.providers.includes(provider) && !(settings.disabledProviders ?? []).includes(provider);
    if (!on) continue;
    const picked = settings.models?.[provider];
    if (picked) note(provider, picked, `Settings → LLM (the ${PROVIDER_NAME[provider]} model)`);
    else note(provider, input.providers[provider]?.configModel, CONFIG_WHERE[provider]);
  }

  for (const agent of input.agents) {
    if (agent.status === 'archived') continue;
    if (agent.model) note(agent.provider, agent.model, `agent \`${agent.id}\``);
    for (const node of agent.nodes ?? []) {
      if (!LLM_NODE_TYPES.has(node.type) || !node.model) continue;
      note(node.provider ?? agent.provider, node.model, `agent \`${agent.id}\`, step \`${node.id}\``);
    }
  }
  return [...hits.values()];
}

/** The thread to sua for one retired model. Pure; exported for tests. */
export function buildRetiredModelMessage(r: RetiredModel, list: ProviderModelList): AddMessageInput {
  const name = PROVIDER_NAME[r.provider];
  const offered = list.models.length > 0
    ? list.models.map((m) => `- \`${m.id}\` — ${m.label}${m.desc ? `: ${m.desc}` : ''}`).join('\n')
    : `- (${name} hasn't shared its list yet — run \`${r.provider}\` once to fetch it.)`;
  return {
    priority: 'high',
    source: 'system-health',
    title: `${name} no longer offers ${r.model}`,
    body: [
      `${name} no longer offers the model \`${r.model}\`, so every attempt that asks for it fails and moves on to the next provider in your waterfall. Runs still finish, but each one pays for a failed ${name} attempt first, and nothing runs on ${name}.`,
      ...(r.refusal ? ['', `${name} said: “${r.refusal}”`] : []),
      '',
      `Where \`${r.model}\` is chosen:`,
      ...r.where.map((w) => `- ${w}`),
      '',
      `${name} offers these now:`,
      offered,
      '',
      `Pick one under [Settings → LLM](/settings/llm) (the ${r.provider} row). An agent or step that names its own model needs its model changed on that agent.`,
      '',
      'This thread resolves itself once nothing uses that model any more.',
    ].join('\n'),
    dedupeKey: `${MODEL_RETIRED_DEDUPE_PREFIX}${r.provider}/${r.model}`,
  };
}

export interface ModelWatchOpts {
  /** Injected for tests; default reads the CLIs' own files. */
  providers?: Partial<Record<WatchedProvider, ProviderModels>>;
  /** Publish hook so the inbox UI updates live. */
  onChanged?: (message: InboxMessage) => void;
}

export interface ModelWatchOutcome {
  /** `provider/model` keys. */
  posted: string[];
  resolved: string[];
}

/** One check: post new retired models, resolve threads for ones no longer used. */
export function checkModelsOnce(
  inboxStore: InboxStore,
  settings: LlmSettings,
  agents: readonly Agent[],
  opts: ModelWatchOpts = {},
): ModelWatchOutcome {
  const providers = opts.providers ?? readProviderModels();
  const retired = findRetiredModels({ settings, providers, agents });
  const out: ModelWatchOutcome = { posted: [], resolved: [] };

  for (const r of retired) {
    const input = buildRetiredModelMessage(r, providers[r.provider]?.list ?? { models: [], ids: [] });
    if (inboxStore.findByDedupeKey(input.dedupeKey!)) continue;
    const message = inboxStore.add(input);
    opts.onChanged?.(message);
    out.posted.push(`${r.provider}/${r.model}`);
  }

  const stillRetired = new Set(retired.map((r) => `${MODEL_RETIRED_DEDUPE_PREFIX}${r.provider}/${r.model}`));
  const open = inboxStore.list({ source: 'system-health', limit: 50 })
    .filter((m) => m.dedupeKey?.startsWith(MODEL_RETIRED_DEDUPE_PREFIX)
      && !stillRetired.has(m.dedupeKey)
      && m.status !== 'resolved' && m.status !== 'dismissed');
  for (const m of open) {
    const key = m.dedupeKey!.slice(MODEL_RETIRED_DEDUPE_PREFIX.length);
    const model = key.slice(key.indexOf('/') + 1);
    inboxStore.addResponse(m.id, 'system', `Nothing uses \`${model}\` any more.`);
    inboxStore.updateStatus(m.id, 'resolved', { autoResolved: true });
    const updated = inboxStore.get(m.id);
    if (updated) opts.onChanged?.(updated);
    out.resolved.push(key);
  }
  return out;
}

/** Start the periodic check. Returns a stop function for `close()`. */
export function startModelWatch(
  inboxStore: InboxStore,
  read: () => { settings: LlmSettings | undefined; agents: readonly Agent[] },
  opts: Pick<ModelWatchOpts, 'onChanged'> = {},
): () => void {
  const tick = () => {
    try {
      const { settings, agents } = read();
      if (settings) checkModelsOnce(inboxStore, settings, agents, opts);
    } catch (err) {
      console.warn('[model-watch] check failed:', err instanceof Error ? err.message : String(err));
    }
  };
  tick();
  const timer = setInterval(tick, MODEL_WATCH_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
