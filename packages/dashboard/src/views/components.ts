import { html, type SafeHtml } from './html.js';

/**
 * Status → (badge class, label) mapping that matches the CLI's color
 * vocabulary from `ui.ts`. Keeping the surface aligned so a user reading
 * both `sua agent status` and the dashboard sees the same vocabulary.
 */
export function statusBadge(status: string): SafeHtml {
  const kind =
    status === 'completed' ? 'badge--ok'
    : status === 'failed' ? 'badge--err'
    : status === 'running' || status === 'pending' ? 'badge--info'
    : status === 'cancelled' ? 'badge--warn'
    : 'badge--muted';
  return html`<span class="badge ${kind}">${status}</span>`;
}

export function typeBadge(type: string): SafeHtml {
  const kind = type === 'shell' ? 'badge--ok' : type === 'claude-code' ? 'badge--info' : 'badge--muted';
  return html`<span class="badge ${kind}">${type}</span>`;
}

export function sourceBadge(source: string): SafeHtml {
  const kind = source === 'community' ? 'badge--err' : source === 'examples' ? 'badge--info' : 'badge--muted';
  return html`<span class="badge ${kind}">${source}</span>`;
}

export function outputFrame(text: string): SafeHtml {
  return html`<div class="output-frame">${text}</div>`;
}

export function kv(key: string, value: SafeHtml | string): SafeHtml {
  return html`<dt>${key}</dt><dd>${value}</dd>`;
}

export function formatDuration(startedAt: string, completedAt?: string): string {
  if (!completedAt) return '—';
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return `${mins}m${secs}s`;
}

export function formatAge(timestamp: string): string {
  const ms = Date.now() - new Date(timestamp).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

const EXIT_CODE_LABELS: Record<number, string> = {
  0: 'success',
  1: 'general error',
  2: 'misuse of shell command',
  3: 'cannot execute (curl: URL malformed)',
  6: 'curl: could not resolve host',
  7: 'curl: failed to connect',
  22: 'curl: HTTP error (4xx/5xx)',
  28: 'curl: timeout',
  126: 'permission denied',
  127: 'command not found',
  128: 'invalid exit argument',
  130: 'terminated by Ctrl+C (SIGINT)',
  137: 'killed (SIGKILL / out of memory)',
  139: 'segmentation fault (SIGSEGV)',
  143: 'terminated (SIGTERM)',
};

export function formatExitCode(code: number | undefined): string {
  if (code === undefined) return '';
  const label = EXIT_CODE_LABELS[code];
  if (code >= 129 && code <= 165 && !label) {
    const signal = code - 128;
    return `exit ${code} (signal ${signal})`;
  }
  return label ? `exit ${code} (${label})` : `exit ${code}`;
}

const ERROR_CATEGORY_LABELS: Record<string, string> = {
  setup: 'Setup failed (before execution)',
  input_resolution: 'Template substitution failed',
  spawn_failure: 'Process could not start',
  exit_nonzero: 'Non-zero exit code',
  timeout: 'Timed out',
  cancelled: 'Cancelled',
  upstream_failed: 'Skipped (upstream failed)',
  condition_not_met: 'Skipped (condition not met)',
  flow_ended: 'Flow ended',
};

export function formatErrorCategory(category: string): string {
  return ERROR_CATEGORY_LABELS[category] ?? category;
}
