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

export interface LlmSettings {
  /**
   * Ordered waterfall. `providers[0]` is the primary (used by default
   * for any llm-prompt node without a pinned provider). Subsequent
   * entries are tried in order on classified failures. Never empty —
   * the store enforces at least one entry.
   */
  providers: LlmProvider[];
  /** Set whenever the fallback most recently fired. */
  lastFallback?: LlmFallbackEvent;
}

interface LlmSettingsFileV1 {
  version: 1;
  settings: { primary: LlmProvider; fallback?: LlmProvider; lastFallback?: LlmFallbackEvent };
}

interface LlmSettingsFileV2 {
  version: 2;
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
  setProviders(providers: LlmProvider[]): void {
    const deduped: LlmProvider[] = [];
    for (const p of providers) {
      if (!isProvider(p)) {
        throw new Error(`Invalid provider: ${p}`);
      }
      if (!deduped.includes(p)) deduped.push(p);
    }
    if (deduped.length === 0) {
      throw new Error('Provider waterfall must have at least one entry.');
    }
    const data = this.read();
    data.settings.providers = deduped;
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

  private read(): LlmSettingsFileV2 {
    if (!existsSync(this.path)) {
      return { version: 2, settings: { providers: [DEFAULT_PRIMARY] } };
    }
    try {
      const raw = readFileSync(this.path, 'utf-8');
      const parsed = JSON.parse(raw) as LlmSettingsFileV1 | LlmSettingsFileV2;

      // Auto-migrate the legacy { primary, fallback? } shape. We tolerate
      // a missing version key from very early dev builds by sniffing the
      // shape directly.
      if (parsed.version === 1 || (parsed.version === undefined && (parsed as LlmSettingsFileV1).settings?.primary !== undefined)) {
        const old = (parsed as LlmSettingsFileV1).settings ?? { primary: DEFAULT_PRIMARY };
        const providers: LlmProvider[] = [];
        if (isProvider(old.primary)) providers.push(old.primary);
        if (old.fallback && isProvider(old.fallback) && !providers.includes(old.fallback)) {
          providers.push(old.fallback);
        }
        if (providers.length === 0) providers.push(DEFAULT_PRIMARY);
        return { version: 2, settings: { providers, lastFallback: old.lastFallback } };
      }

      if ((parsed as { version?: number }).version !== 2) {
        throw new Error(`Unsupported llm-settings file version: ${(parsed as { version?: number }).version}`);
      }

      // Defensive: drop unknown providers from a hand-edited file rather
      // than blow up at module-load time.
      const filtered = (parsed.settings.providers ?? []).filter(isProvider);
      const deduped: LlmProvider[] = [];
      for (const p of filtered) if (!deduped.includes(p)) deduped.push(p);
      if (deduped.length === 0) deduped.push(DEFAULT_PRIMARY);
      parsed.settings.providers = deduped;
      return parsed;
    } catch (err) {
      if ((err as Error).message.includes('version')) throw err;
      return { version: 2, settings: { providers: [DEFAULT_PRIMARY] } };
    }
  }

  private write(data: LlmSettingsFileV2): void {
    writeFileSync(this.path, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  }
}

export function isProvider(value: unknown): value is LlmProvider {
  return typeof value === 'string' && (LLM_PROVIDERS as readonly string[]).includes(value as LlmProvider);
}
