import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { PROVIDER_IDS, type LlmProvider } from './llm-providers.js';

export type { LlmProvider };

/**
 * LLM provider waterfall config.
 *
 * Persistent across daemon restarts: the operator manages an ORDERED
 * list of providers via `/settings/llm`. `providers[0]` is the primary
 * (the default for any llm-prompt node that doesn't pin its own
 * provider). When a provider's attempt fails with a recognized
 * "should fall back" category (credit / quota / binary-missing /
 * hard-timeout), node-spawner walks the rest of the chain in order
 * until one succeeds or the chain is exhausted.
 *
 * A node that pins its own provider (`node.provider: codex`) gets
 * that provider at the HEAD of the chain regardless of the global
 * order — and the remaining providers in the global order still run
 * as fallbacks. This fixes the "pinned-to-X means no fallback" bug
 * where a single CLI outage would brick the run.
 *
 * File-backed JSON. Old `{ primary, fallback? }` shape from before
 * the waterfall is auto-migrated to `{ providers: [primary, ...] }`
 * on first read.
 */

/**
 * Re-export the canonical provider list from llm-providers.ts so the
 * settings UI's dropdowns and the validation logic here stay in sync
 * with whatever providers the runtime actually knows how to spawn.
 */
export const LLM_PROVIDERS: readonly LlmProvider[] = PROVIDER_IDS;

export interface LlmFallbackEvent {
  /** Unix millis when the fallback fired. */
  at: number;
  /** Provider that failed (the "from" side of the hop). */
  primary: LlmProvider;
  /** Provider the run continued on (the "to" side). */
  fallback: LlmProvider;
  /** Failure category that triggered the hop. */
  reason: string;
  /** The agent whose node fell back, if known. */
  agentId?: string;
  /** Specific node id within the agent, if known. */
  nodeId?: string;
}

/**
 * An operator-defined OpenAI-compatible HTTP provider (a local or self-hosted
 * model behind a `/v1/chat/completions` endpoint — llama.cpp, LM Studio, vLLM,
 * a gateway, etc.). Referenced in the waterfall by `name`, alongside the builtin
 * CLI providers. `kind` is a discriminant so future non-OpenAI HTTP shapes can
 * be added without breaking stored configs.
 *
 * `apiKey` is stored here in the settings file for v1 (masked in the UI, never
 * echoed into an HTML value). For a real cloud key, prefer moving it into the
 * secrets store — tracked as a follow-up.
 */
export interface CustomLlmProvider {
  /** Unique id used in the waterfall + node `provider` pins (e.g. "local-qwen-8b"). */
  name: string;
  kind: 'openai';
  /** Optional friendly label for the UI; falls back to `name`. */
  displayName?: string;
  /** Base URL including the version segment, e.g. http://127.0.0.1:8181/v1 */
  apiBase: string;
  /** Bearer token. Optional — omitted ⇒ no Authorization header (local servers). */
  apiKey?: string;
  /** Model id passed in the request body. */
  model: string;
}

/**
 * A waterfall entry: either a builtin CLI provider id or the `name` of a
 * defined custom provider. Kept as a plain string so the ordered list can mix
 * both; validation resolves it against the builtins + `customProviders`.
 */
export type ProviderRef = string;

export interface LlmSettings {
  /**
   * Ordered waterfall. `providers[0]` is the primary (used by default
   * for any llm-prompt node without a pinned provider). Subsequent
   * entries are tried in order on classified failures. Never empty —
   * the store enforces at least one entry. Each entry is a builtin
   * provider id OR a defined custom-provider `name`.
   */
  providers: ProviderRef[];
  /** Operator-defined OpenAI-compatible HTTP providers. */
  customProviders?: CustomLlmProvider[];
  /** Set whenever the fallback most recently fired. */
  lastFallback?: LlmFallbackEvent;
}

interface LlmSettingsFileV1 {
  version: 1;
  settings: { primary: LlmProvider; fallback?: LlmProvider; lastFallback?: LlmFallbackEvent };
}

interface LlmSettingsFileV2 {
  version: 2;
  settings: { providers: ProviderRef[]; lastFallback?: LlmFallbackEvent };
}

interface LlmSettingsFileV3 {
  version: 3;
  settings: LlmSettings;
}

const DEFAULT_PRIMARY: LlmProvider = 'claude';

/**
 * File-backed LLM settings store. The file is small (<1KB) — we
 * read on every access so the daemon can react to operator edits
 * without holding stale state. Writes are atomic enough for this
 * use case (single small JSON object).
 */
export class LlmSettingsStore {
  private readonly path: string;

  constructor(filePath: string) {
    this.path = filePath;
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  /** Get the current settings. Returns defaults if the file is absent. */
  get(): LlmSettings {
    return this.read().settings;
  }

  /**
   * Replace the entire waterfall. Validates each entry against
   * PROVIDER_IDS, dedupes (first occurrence wins), and rejects empty
   * lists — the operator must pick at least one provider so any
   * llm-prompt node has something to dispatch to.
   *
   * Preserves `lastFallback` telemetry — only `recordFallback` and
   * `clearLastFallback` mutate that.
   */
  setProviders(providers: ProviderRef[]): void {
    const data = this.read();
    const known = new Set<string>([
      ...LLM_PROVIDERS,
      ...(data.settings.customProviders ?? []).map((c) => c.name),
    ]);
    const deduped: ProviderRef[] = [];
    for (const p of providers) {
      if (!known.has(p)) {
        throw new Error(`Invalid provider: ${p}`);
      }
      if (!deduped.includes(p)) deduped.push(p);
    }
    if (deduped.length === 0) {
      throw new Error('Provider waterfall must have at least one entry.');
    }
    data.settings.providers = deduped;
    this.write(data);
  }

  /** All defined custom (OpenAI-compatible) providers. */
  listCustomProviders(): CustomLlmProvider[] {
    return [...(this.read().settings.customProviders ?? [])];
  }

  /** Look up one custom provider by name (undefined if absent). */
  getCustomProvider(name: string): CustomLlmProvider | undefined {
    return this.read().settings.customProviders?.find((c) => c.name === name);
  }

  /**
   * Define (or replace) a custom OpenAI-compatible provider. Validates the
   * shape; the name must be a non-empty slug that doesn't collide with a
   * builtin provider id. Replacing an existing custom provider by name is
   * allowed (edit-in-place).
   */
  addCustomProvider(def: CustomLlmProvider): void {
    const name = (def.name ?? '').trim();
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name)) {
      throw new Error('Provider name must be a slug (letters, digits, . _ -), starting alphanumeric.');
    }
    if (isProvider(name)) {
      throw new Error(`"${name}" is a builtin provider id — pick a different name.`);
    }
    if (def.kind !== 'openai') {
      throw new Error(`Unsupported custom provider kind "${def.kind}".`);
    }
    const apiBase = (def.apiBase ?? '').trim();
    try {
      const u = new URL(apiBase);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad protocol');
    } catch {
      throw new Error('apiBase must be an http(s) URL, e.g. http://127.0.0.1:8181/v1');
    }
    const model = (def.model ?? '').trim();
    if (!model) throw new Error('model is required.');
    const clean: CustomLlmProvider = {
      name,
      kind: 'openai',
      displayName: def.displayName?.trim() || undefined,
      apiBase,
      apiKey: def.apiKey?.trim() || undefined,
      model,
    };
    const data = this.read();
    const list = data.settings.customProviders ?? [];
    const next = list.filter((c) => c.name !== name);
    next.push(clean);
    data.settings.customProviders = next;
    this.write(data);
  }

  /**
   * Delete a custom provider by name, and strip it from the waterfall so the
   * chain never references a provider the runtime can no longer resolve.
   * Refuses if removing it would empty the waterfall (pick a replacement first).
   */
  removeCustomProvider(name: string): void {
    const data = this.read();
    const list = data.settings.customProviders ?? [];
    if (!list.some((c) => c.name === name)) {
      throw new Error(`No custom provider named "${name}".`);
    }
    const nextProviders = data.settings.providers.filter((p) => p !== name);
    if (nextProviders.length === 0) {
      throw new Error('Cannot remove the last provider in the waterfall — add a replacement first.');
    }
    data.settings.customProviders = list.filter((c) => c.name !== name);
    data.settings.providers = nextProviders;
    this.write(data);
  }

  /** Record a fallback event for the settings page's status line. */
  recordFallback(event: LlmFallbackEvent): void {
    const data = this.read();
    data.settings.lastFallback = event;
    this.write(data);
  }

  /** Clear the lastFallback telemetry (operator-driven, via UI). */
  clearLastFallback(): void {
    const data = this.read();
    data.settings.lastFallback = undefined;
    this.write(data);
  }

  private read(): LlmSettingsFileV3 {
    if (!existsSync(this.path)) {
      return { version: 3, settings: { providers: [DEFAULT_PRIMARY], customProviders: [] } };
    }
    try {
      const raw = readFileSync(this.path, 'utf-8');
      const parsed = JSON.parse(raw) as LlmSettingsFileV1 | LlmSettingsFileV2 | LlmSettingsFileV3;

      // Auto-migrate the legacy { primary, fallback? } shape. We tolerate
      // a missing version key from very early dev builds by sniffing the
      // shape directly.
      if (parsed.version === 1 || (parsed.version === undefined && (parsed as LlmSettingsFileV1).settings?.primary !== undefined)) {
        const old = (parsed as LlmSettingsFileV1).settings ?? { primary: DEFAULT_PRIMARY };
        const providers: ProviderRef[] = [];
        if (isProvider(old.primary)) providers.push(old.primary);
        if (old.fallback && isProvider(old.fallback) && !providers.includes(old.fallback)) {
          providers.push(old.fallback);
        }
        if (providers.length === 0) providers.push(DEFAULT_PRIMARY);
        return { version: 3, settings: { providers, customProviders: [], lastFallback: old.lastFallback } };
      }

      const version = (parsed as { version?: number }).version;
      if (version !== 2 && version !== 3) {
        throw new Error(`Unsupported llm-settings file version: ${version}`);
      }

      const settings = (parsed as LlmSettingsFileV2 | LlmSettingsFileV3).settings;
      const customProviders = sanitizeCustomProviders((settings as LlmSettings).customProviders);
      const customNames = new Set(customProviders.map((c) => c.name));
      // Defensive: keep only entries that resolve to a builtin OR a still-
      // defined custom provider, rather than blow up on a hand-edited file.
      const filtered = (settings.providers ?? []).filter((p) => isProvider(p) || customNames.has(p));
      const deduped: ProviderRef[] = [];
      for (const p of filtered) if (!deduped.includes(p)) deduped.push(p);
      if (deduped.length === 0) deduped.push(DEFAULT_PRIMARY);
      return { version: 3, settings: { providers: deduped, customProviders, lastFallback: settings.lastFallback } };
    } catch (err) {
      if ((err as Error).message.includes('version')) throw err;
      return { version: 3, settings: { providers: [DEFAULT_PRIMARY], customProviders: [] } };
    }
  }

  private write(data: LlmSettingsFileV3): void {
    writeFileSync(this.path, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  }
}

/** Drop malformed custom-provider entries from a hand-edited file. */
function sanitizeCustomProviders(raw: unknown): CustomLlmProvider[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomLlmProvider[] = [];
  for (const c of raw) {
    if (!c || typeof c !== 'object') continue;
    const r = c as Record<string, unknown>;
    if (typeof r.name !== 'string' || r.kind !== 'openai') continue;
    if (typeof r.apiBase !== 'string' || typeof r.model !== 'string') continue;
    if (isProvider(r.name)) continue;
    out.push({
      name: r.name,
      kind: 'openai',
      displayName: typeof r.displayName === 'string' ? r.displayName : undefined,
      apiBase: r.apiBase,
      apiKey: typeof r.apiKey === 'string' ? r.apiKey : undefined,
      model: r.model,
    });
  }
  return out;
}

export function isProvider(value: unknown): value is LlmProvider {
  return typeof value === 'string' && (LLM_PROVIDERS as readonly string[]).includes(value as LlmProvider);
}
