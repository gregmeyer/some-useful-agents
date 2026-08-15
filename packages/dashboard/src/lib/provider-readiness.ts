/**
 * "Can this install actually run an llm-prompt node?"
 *
 * The honest answer cannot be read out of `llm-settings.json`. The store
 * returns `providers: ['claude']` when the file is absent
 * (llm-settings-store.ts read()), and `buildProviderChain` falls back to the
 * literal `'claude'` when the chain is empty (node-spawner.ts). So a virgin
 * machine with no `claude` binary reports a fully-configured waterfall and
 * then fails at run time with `binary_missing`. Readiness has to be probed.
 *
 * Two classes of provider, two different questions:
 *   - builtins (claude / codex / apple-foundation-models) — is the binary on
 *     PATH? `detectLlms()` answers this, and handles the Apple runner
 *     compile-on-first-use bootstrap correctly.
 *   - customs (OpenAI-compatible HTTP endpoints) — the operator typed a URL
 *     and a model on purpose, so *configured* counts as ready. We do NOT
 *     reach across the network on the readiness path: the endpoint being
 *     momentarily down should not throw a first-run gate in the operator's
 *     face. Reachability is a separate, explicit probe (`probeCustomProvider`).
 */
import { spawn } from 'node:child_process';
import {
  detectLlms,
  PROVIDERS,
  PROVIDER_IDS,
  type LlmProvider,
} from '@some-useful-agents/core';
import type { DashboardContext } from '../context.js';

export interface BuiltinReadiness {
  id: LlmProvider;
  displayName: string;
  binary: string;
  installed: boolean;
  version?: string;
}

export interface CustomReadiness {
  name: string;
  displayName?: string;
  apiBase: string;
  model: string;
  hasKey: boolean;
}

export interface ProviderReadiness {
  /** True when at least one provider could plausibly serve an llm-prompt node. */
  ready: boolean;
  builtins: BuiltinReadiness[];
  customs: CustomReadiness[];
  /** Epoch ms this snapshot was computed — the cache key, effectively. */
  checkedAt: number;
}

/**
 * `detectLlms()` shells out once per builtin (and may compile the Apple
 * Swift runner on a cold cache), so it is far too expensive to run on every
 * `GET /`. Cache it. The TTL keeps a freshly-installed CLI from staying
 * invisible for the life of the process; mutations that can flip readiness
 * call `invalidateProviderReadiness()` for an immediate refresh.
 */
const READINESS_TTL_MS = 30_000;
let cached: ProviderReadiness | undefined;

/** Drop the cache — call after any mutation that can change readiness. */
export function invalidateProviderReadiness(): void {
  cached = undefined;
}

function computeProviderReadiness(ctx: Pick<DashboardContext, 'llmSettingsStore'>): ProviderReadiness {
  const availability = detectLlms();
  const builtins: BuiltinReadiness[] = PROVIDER_IDS.map((id) => ({
    id,
    displayName: PROVIDERS[id].displayName,
    binary: PROVIDERS[id].binary,
    installed: availability[id].installed,
    version: availability[id].version,
  }));

  const customs: CustomReadiness[] = (ctx.llmSettingsStore?.listCustomProviders() ?? []).map((c) => ({
    name: c.name,
    displayName: c.displayName,
    apiBase: c.apiBase,
    model: c.model,
    hasKey: Boolean(c.apiKey),
  }));

  return {
    ready: builtins.some((b) => b.installed) || customs.length > 0,
    builtins,
    customs,
    checkedAt: Date.now(),
  };
}

/** Cached readiness snapshot. Safe to call on a request path. */
export function getProviderReadiness(ctx: Pick<DashboardContext, 'llmSettingsStore'>): ProviderReadiness {
  if (cached && Date.now() - cached.checkedAt < READINESS_TTL_MS) return cached;
  cached = computeProviderReadiness(ctx);
  return cached;
}

/**
 * Warm the cache off the request path so the first page load doesn't eat the
 * `detectLlms()` spawn cost (or an Apple-runner compile). Best-effort.
 */
export function warmProviderReadiness(ctx: Pick<DashboardContext, 'llmSettingsStore'>): void {
  setTimeout(() => {
    try { getProviderReadiness(ctx); } catch { /* readiness is advisory; never fatal */ }
  }, 0).unref?.();
}

/** GET the endpoint's /models to confirm a custom provider is reachable. */
export async function probeCustomProvider(
  def: { apiBase: string; apiKey?: string },
): Promise<{ ok: boolean; message: string }> {
  const url = def.apiBase.replace(/\/+$/, '') + '/models';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const headers: Record<string, string> = {};
    if (def.apiKey) headers.authorization = `Bearer ${def.apiKey}`;
    const res = await fetch(url, { signal: controller.signal, headers });
    if (!res.ok) return { ok: false, message: `HTTP ${res.status} from ${url}` };
    return { ok: true, message: `reachable (${url})` };
  } catch (err) {
    if (controller.signal.aborted) return { ok: false, message: 'probe timed out after 5s' };
    return { ok: false, message: `unreachable: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Briefly spawn a builtin's binary with its version argv to confirm liveness.
 *
 * Uses `PROVIDERS[provider]` rather than hardcoding a binary name — an
 * earlier version probed apple-foundation-models by spawning `claude`, which
 * reported the wrong thing on an Apple-FM-only host.
 */
export async function probeProvider(provider: LlmProvider): Promise<{ ok: boolean; message: string }> {
  const def = PROVIDERS[provider];
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result: { ok: boolean; message: string }) => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
      resolve(result);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(def.binary, [...def.versionArgv], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      finish({ ok: false, message: `spawn failed: ${(err as Error).message}` });
      return;
    }
    child.stdout?.on('data', (b) => { stdout += b.toString(); });
    child.stderr?.on('data', (b) => { stderr += b.toString(); });
    child.on('error', (err) => {
      finish({ ok: false, message: `binary not found: ${err.message}` });
    });
    child.on('close', (code) => {
      if (code === 0) {
        const line = (stdout + stderr).split('\n').find((l) => l.trim()) ?? '';
        finish({ ok: true, message: line.trim() || 'reachable' });
      } else {
        finish({ ok: false, message: (stderr || stdout || `exit ${code}`).split('\n')[0].slice(0, 200) });
      }
    });
    setTimeout(() => finish({ ok: false, message: 'probe timed out after 5s' }), 5000);
  });
}
