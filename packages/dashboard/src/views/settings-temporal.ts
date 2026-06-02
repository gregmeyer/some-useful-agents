import type { ServiceStatus } from '@some-useful-agents/core';
import { html, unsafeHtml, type SafeHtml } from './html.js';

export interface SettingsTemporalArgs {
  /** Active run provider for this dashboard process ('local' | 'temporal'). */
  providerName: string;
  /** Live status of the daemon-managed Temporal worker (PID file + liveness). */
  workerStatus: ServiceStatus;
  /** Temporal connection config (read-only; the worker uses the same values). */
  temporal: { address: string; namespace: string; taskQueue: string };
  /** Temporal Web UI URL (the bundled docker-compose maps it here). */
  temporalUiUrl: string;
  /** Inline error from a failed worker start/stop. */
  actionError?: string;
}

/**
 * Render the `/settings/temporal` body. Surfaces the run provider, the Temporal
 * connection, and the worker — which executes v2 DAG nodes on the host. The
 * worker can be started/stopped here (it is a daemon-managed service, same as
 * the MCP server on /settings/mcp); it is NOT spawned inside the web process.
 */
export function renderSettingsTemporal(args: SettingsTemporalArgs): SafeHtml {
  const onTemporal = args.providerName === 'temporal';
  return html`
    ${args.actionError ? html`<div class="flash flash--error">${args.actionError}</div>` : unsafeHtml('')}

    <div class="card">
      <p class="card__title">Run provider</p>
      <dl class="kv">
        <dt>Active</dt>
        <dd>${onTemporal
          ? html`<span class="badge badge--info">temporal</span>`
          : html`<span class="badge badge--muted">local</span>`}</dd>
      </dl>
      ${onTemporal
        ? html`<p class="dim" style="margin-top: var(--space-2);">
            v2 DAG nodes run on the Temporal worker. A worker must be running
            below or runs will sit pending.
          </p>`
        : html`<p class="dim" style="margin-top: var(--space-2);">
            This dashboard runs work in-process. To use Temporal, restart it with
            <code>sua dashboard start --provider temporal</code> (or set
            <code>"provider": "temporal"</code> in <code>sua.config.json</code>),
            then start a worker. The worker below only matters under the temporal
            provider.
          </p>`}
    </div>

    <div class="card">
      <p class="card__title">Worker</p>
      ${renderStatusBlock(args.workerStatus)}
      <div style="display: flex; gap: var(--space-2); margin-top: var(--space-3);">
        ${args.workerStatus.state === 'running'
          ? html`<form action="/settings/temporal/worker/stop" method="post" style="margin: 0;"
              data-confirm="Stop the Temporal worker? In-flight Temporal runs will stop progressing until a worker is running again.">
              <button type="submit" class="btn btn--warn">Stop worker</button>
            </form>`
          : html`<form action="/settings/temporal/worker/start" method="post" style="margin: 0;">
              <button type="submit" class="btn btn--primary">Start worker</button>
            </form>`}
        <a class="btn btn--ghost" href="/settings/temporal">Refresh</a>
      </div>
      <p class="dim" style="margin-top: var(--space-2);">
        The worker runs on the host (it executes your shell + <code>claude</code>),
        not inside Docker — see ADR-0004. This control manages the daemon-tracked
        worker; you can also run <code>sua worker start</code> in a terminal, or
        bring up the whole stack with <code>./scripts/temporal-up.sh</code>.
        Runtime output is appended to <code>${args.workerStatus.logPath}</code>.
      </p>
    </div>

    <div class="card">
      <p class="card__title">Connection</p>
      <dl class="kv">
        <dt>Address</dt><dd class="mono">${args.temporal.address}</dd>
        <dt>Namespace</dt><dd class="mono">${args.temporal.namespace}</dd>
        <dt>Task queue</dt><dd class="mono">${args.temporal.taskQueue}</dd>
        <dt>Web UI</dt><dd><a href="${args.temporalUiUrl}" target="_blank" rel="noreferrer">${args.temporalUiUrl}</a></dd>
      </dl>
      <p class="dim" style="margin-top: var(--space-2);">
        Configure these in <code>sua.config.json</code>
        (<code>temporalAddress</code> / <code>temporalNamespace</code> /
        <code>temporalTaskQueue</code>). The Temporal server itself runs in Docker
        (<code>docker compose up -d</code>).
      </p>
    </div>
  `;
}

function renderStatusBlock(status: ServiceStatus): SafeHtml {
  const badge = status.state === 'running'
    ? html`<span class="badge badge--ok">running</span>`
    : status.state === 'stale'
    ? html`<span class="badge badge--warn">stale (PID ${String(status.pid ?? '?')} dead)</span>`
    : html`<span class="badge badge--muted">stopped</span>`;
  const pidLine = status.pid !== undefined && status.state === 'running'
    ? html`<dd class="mono">PID ${String(status.pid)}</dd>`
    : html`<dd class="dim">—</dd>`;
  return html`
    <dl class="kv">
      <dt>State</dt><dd>${badge}</dd>
      <dt>Process</dt>${pidLine}
    </dl>
  `;
}
