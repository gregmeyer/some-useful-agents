import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { PROVIDER_IDS, type LlmProvider } from './llm-providers.js';

export type { LlmProvider };

/**
 * LLM provider config + fallback policy.
 *
 * Persistent across daemon restarts: the operator picks a primary
 * provider via `/settings/llm`; if the primary fails with a
 * recognized "should fall back" error category (credit exhausted,
 * quota exceeded, binary missing, hard timeout) AND a fallback is
 * configured, node-spawner retries the LLM attempt with the fallback
 * provider and records the event in `lastFallback` so the settings
 * page can show "fallback fired 3m ago on agent X because Y."
 *
 * File-backed JSON (mirrors `VariablesStore`) — no migration story
 * needed for a two-field config, and the daemon can pick up edits
 * the operator makes without a restart.
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
  primary: LlmProvider;
  fallback: LlmProvider;
  /** Failure category that triggered the fallback. */
  reason: string;
  /** The agent whose node fell back, if known. */
  agentId?: string;
  /** Specific node id within the agent, if known. */
  nodeId?: string;
}

export interface LlmSettings {
  primary: LlmProvider;
  /** When undefined the operator has not enabled a fallback. */
  fallback?: LlmProvider;
  /** Set whenever the fallback most recently fired. */
  lastFallback?: LlmFallbackEvent;
}

interface LlmSettingsFile {
  version: 1;
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
   * Replace the primary/fallback pair. `fallback` may be undefined to
   * clear the fallback (no automatic retry on failure). Preserves
   * `lastFallback` telemetry — only `recordFallback` mutates that.
   */
  setProviders(primary: LlmProvider, fallback?: LlmProvider): void {
    if (!isProvider(primary)) {
      throw new Error(`Invalid primary provider: ${primary}`);
    }
    if (fallback !== undefined && !isProvider(fallback)) {
      throw new Error(`Invalid fallback provider: ${fallback}`);
    }
    if (fallback !== undefined && fallback === primary) {
      throw new Error('Fallback provider must differ from primary.');
    }
    const data = this.read();
    data.settings.primary = primary;
    data.settings.fallback = fallback;
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

  private read(): LlmSettingsFile {
    if (!existsSync(this.path)) {
      return { version: 1, settings: { primary: DEFAULT_PRIMARY } };
    }
    try {
      const raw = readFileSync(this.path, 'utf-8');
      const parsed = JSON.parse(raw) as LlmSettingsFile;
      if (parsed.version !== 1) {
        throw new Error(`Unsupported llm-settings file version: ${parsed.version}`);
      }
      // Defensive: tolerate hand-edited files with bad providers — fall
      // back to defaults rather than blowing up at module-load time.
      if (!isProvider(parsed.settings?.primary)) {
        parsed.settings = { primary: DEFAULT_PRIMARY };
      }
      if (parsed.settings.fallback !== undefined && !isProvider(parsed.settings.fallback)) {
        parsed.settings.fallback = undefined;
      }
      return parsed;
    } catch (err) {
      if ((err as Error).message.includes('version')) throw err;
      return { version: 1, settings: { primary: DEFAULT_PRIMARY } };
    }
  }

  private write(data: LlmSettingsFile): void {
    writeFileSync(this.path, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  }
}

export function isProvider(value: unknown): value is LlmProvider {
  return typeof value === 'string' && (LLM_PROVIDERS as readonly string[]).includes(value as LlmProvider);
}
