import type { LlmSettingsSnapshot } from '@some-useful-agents/core';
import type { DashboardContext } from '../context.js';

/**
 * Build a per-run snapshot of LLM provider config from the dashboard
 * context's `LlmSettingsStore`. Pass the result as `llmSettings` on
 * `DagExecutorDeps`; node-spawner consults it to assemble the waterfall
 * chain and writes one telemetry event per hop via `onFallback`.
 *
 * Returns undefined when no store is configured — the dag executor
 * then runs without any fallback (each llm-prompt's `node.provider`
 * applies as-is, with the hardcoded 'claude' default as the only
 * fallback target).
 *
 * The snapshot is captured at call time so operators editing
 * /settings/llm take effect on the next run without a daemon restart.
 */
export function buildLlmSettingsSnapshot(
  ctx: Pick<DashboardContext, 'llmSettingsStore'>,
): LlmSettingsSnapshot | undefined {
  const store = ctx.llmSettingsStore;
  if (!store) return undefined;
  const current = store.get();
  return {
    providers: [...current.providers],
    customProviders: current.customProviders ? [...current.customProviders] : undefined,
    onFallback: (event) => {
      try {
        store.recordFallback({
          at: Date.now(),
          // `LlmFallbackEvent` is shaped around the legacy
          // primary→fallback hop vocabulary; the runtime event uses
          // from/to. They mean the same thing — the cast keeps the
          // persisted shape stable for the settings page renderer.
          primary: event.from as never,
          fallback: event.to as never,
          reason: event.reason,
          agentId: event.agentId,
          nodeId: event.nodeId,
        });
      } catch {
        // Telemetry failure should never break a run.
      }
    },
  };
}
