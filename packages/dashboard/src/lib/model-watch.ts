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
 * This check finds every place a Codex model is chosen — Settings → LLM, Codex's
 * own config.toml default, an agent's model, a step's model — and posts ONE
 * thread to sua per model Codex no longer offers, naming where it's used and
 * what Codex offers now. "No longer offers" is either side of the evidence:
 *   - not in the model list the Codex CLI keeps for this account
 *     (models_cache.json — an unknown list never calls anything retired), or
 *   - a run was refused it (`model_unavailable`, recorded by the runtime in
 *     the LLM settings file).
 * The thread resolves itself once nothing uses that model any more.
 */
import {
  codexConfigModel,
  codexModelRetired,
  codexModels,
  type Agent,
  type AddMessageInput,
  type CodexModelList,
  type InboxMessage,
  type InboxStore,
  type LlmSettings,
} from '@some-useful-agents/core';

/** Loop cadence. Cheap: two small file reads and the agent list. */
export const MODEL_WATCH_INTERVAL_MS = 10 * 60 * 1000;
/** dedupeKey prefix; `provider/model` is appended. */
export const MODEL_RETIRED_DEDUPE_PREFIX = 'system-health:model-retired:';

export interface RetiredModel {
  provider: 'codex';
  model: string;
  /** Where it's chosen, in words ("Settings → LLM", "agent `x`, step `y`"). */
  where: string[];
  /** The provider's own refusal, when a run hit one. */
  refusal?: string;
}

export interface ModelWatchInput {
  settings: LlmSettings;
  codex: CodexModelList;
  /** `model` in Codex's own config.toml. */
  codexConfigModel?: string;
  agents: readonly Agent[];
}

const LLM_NODE_TYPES = new Set(['llm-prompt', 'claude-code']);

/** Every Codex model in use that Codex no longer offers. Pure; exported for tests. */
export function findRetiredModels(input: ModelWatchInput): RetiredModel[] {
  const { settings, codex } = input;
  const refused = settings.unavailableModels ?? {};
  const byModel = new Map<string, RetiredModel>();
  const note = (model: string | undefined, where: string) => {
    if (!model) return;
    const refusal = refused[`codex/${model}`];
    if (!codexModelRetired(model, codex) && !refusal) return;
    const hit = byModel.get(model) ?? { provider: 'codex' as const, model, where: [], ...(refusal?.error ? { refusal: refusal.error } : {}) };
    if (!hit.where.includes(where)) hit.where.push(where);
    byModel.set(model, hit);
  };

  // The default only matters while Codex is in the waterfall and switched on.
  const codexOn = settings.providers.includes('codex') && !(settings.disabledProviders ?? []).includes('codex');
  if (codexOn) {
    if (settings.models?.codex) note(settings.models.codex, 'Settings → LLM (the Codex model)');
    else note(input.codexConfigModel, "Codex's own default (`model` in ~/.codex/config.toml)");
  }

  for (const agent of input.agents) {
    if (agent.status === 'archived') continue;
    if (agent.provider === 'codex' && agent.model) note(agent.model, `agent \`${agent.id}\``);
    for (const node of agent.nodes ?? []) {
      if (!LLM_NODE_TYPES.has(node.type)) continue;
      if (!node.model) continue;
      if ((node.provider ?? agent.provider) !== 'codex') continue;
      note(node.model, `agent \`${agent.id}\`, step \`${node.id}\``);
    }
  }
  return [...byModel.values()];
}

/** The thread to sua for one retired model. Pure; exported for tests. */
export function buildRetiredModelMessage(r: RetiredModel, codex: CodexModelList): AddMessageInput {
  const offered = codex.models.length > 0
    ? codex.models.map((m) => `- \`${m.id}\` — ${m.label}${m.desc ? `: ${m.desc}` : ''}`).join('\n')
    : '- (Codex hasn\'t shared its list yet — run `codex` once to fetch it.)';
  return {
    priority: 'high',
    source: 'system-health',
    title: `Codex no longer offers ${r.model}`,
    body: [
      `Codex no longer offers the model \`${r.model}\`, so every attempt that asks for it fails and moves on to the next provider in your waterfall. Runs still finish, but each one pays for a failed Codex attempt first, and nothing runs on Codex.`,
      ...(r.refusal ? ['', `Codex said: “${r.refusal}”`] : []),
      '',
      `Where \`${r.model}\` is chosen:`,
      ...r.where.map((w) => `- ${w}`),
      '',
      'Codex offers these now:',
      offered,
      '',
      'Pick one under [Settings → LLM](/settings/llm) (the Codex row). An agent or step that names its own model needs its model changed on that agent.',
      '',
      'This thread resolves itself once nothing uses that model any more.',
    ].join('\n'),
    dedupeKey: `${MODEL_RETIRED_DEDUPE_PREFIX}codex/${r.model}`,
  };
}

export interface ModelWatchOpts {
  /** Injected for tests; defaults read the Codex CLI's files. */
  codex?: CodexModelList;
  codexConfigModel?: string;
  /** Publish hook so the inbox UI updates live. */
  onChanged?: (message: InboxMessage) => void;
}

export interface ModelWatchOutcome {
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
  const codex = opts.codex ?? codexModels();
  const retired = findRetiredModels({
    settings,
    codex,
    codexConfigModel: 'codexConfigModel' in opts ? opts.codexConfigModel : codexConfigModel(),
    agents,
  });
  const out: ModelWatchOutcome = { posted: [], resolved: [] };

  for (const r of retired) {
    const input = buildRetiredModelMessage(r, codex);
    if (inboxStore.findByDedupeKey(input.dedupeKey!)) continue;
    const message = inboxStore.add(input);
    opts.onChanged?.(message);
    out.posted.push(r.model);
  }

  const stillRetired = new Set(retired.map((r) => `${MODEL_RETIRED_DEDUPE_PREFIX}codex/${r.model}`));
  const open = inboxStore.list({ source: 'system-health', limit: 50 })
    .filter((m) => m.dedupeKey?.startsWith(MODEL_RETIRED_DEDUPE_PREFIX)
      && !stillRetired.has(m.dedupeKey)
      && m.status !== 'resolved' && m.status !== 'dismissed');
  for (const m of open) {
    const model = m.dedupeKey!.slice(MODEL_RETIRED_DEDUPE_PREFIX.length).replace(/^codex\//, '');
    inboxStore.addResponse(m.id, 'system', `Nothing uses \`${model}\` any more.`);
    inboxStore.updateStatus(m.id, 'resolved', { autoResolved: true });
    const updated = inboxStore.get(m.id);
    if (updated) opts.onChanged?.(updated);
    out.resolved.push(model);
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
