import type { LlmSettingsSnapshot } from '@some-useful-agents/core';
import type { DashboardContext } from '../context.js';

/**
 * Build a per-run snapshot of LLM provider config from the dashboard
 * context's `LlmSettingsStore`. Pass the result as `llmSettings` on
 * `DagExecutorDeps`; node-spawner consults it when the primary
 * provider fails with a fallback-worthy error category and writes a
 * telemetry event back to the store via `onFallback`.
 *
 * Returns undefined when no store is configured — the dag executor
 * then runs without fallback (each llm-prompt's `node.provider`
 * applies as-is, no retry under a different provider).
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
    primary: current.primary,
    fallback: current.fallback,
    onFallback: (event) => {
      try {
        store.recordFallback({
          at: Date.now(),
          primary: event.primary as never,
          fallback: event.fallback as never,
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
