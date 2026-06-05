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
  const kind = type === 'shell' ? 'badge--ok' : (type === 'claude-code' || type === 'llm-prompt') ? 'badge--info' : 'badge--muted';
  // `claude-code` is the legacy alias of `llm-prompt`; show the canonical name.
  const label = type === 'claude-code' ? 'llm-prompt' : type;
  return html`<span class="badge ${kind}">${label}</span>`;
}

export function sourceBadge(source: string): SafeHtml {
  const kind = source === 'community' ? 'badge--err' : source === 'examples' ? 'badge--info' : 'badge--muted';
  return html`<span class="badge ${kind}">${source}</span>`;
}

/**
 * Execution-backend badge. Only renders for runs that ran on Temporal — the
 * default (local / undefined) is the common case and gets no chip, keeping
 * color rare and meaningful per DESIGN.md. Returns empty html for local.
 */
export function workflowProviderBadge(provider?: string): SafeHtml {
  if (provider !== 'temporal') return html``;
  return html`<span class="badge badge--info" title="Ran on the Temporal worker backend">temporal</span>`;
}

/**
 * Strip a single enclosing Markdown code fence. LLM nodes routinely wrap their
 * whole output in ```json … ``` (or ```), which renders as literal backticks in
 * the stdout frame. When the entire (trimmed) text is one fenced block, return
 * its inner content; otherwise leave the text untouched.
 */
export function stripEnclosingCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = /^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n?```$/.exec(trimmed);
  return match ? match[1] : text;
}

export function outputFrame(text: string): SafeHtml {
  return html`<div class="output-frame">${stripEnclosingCodeFence(text)}</div>`;
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

// Bare ISO-8601 timestamps that leak into agent/user prose (e.g.
// "2026-05-30T04:15:41.198Z"). Matched loosely; validated via Date before
// rewriting so non-date lookalikes are left untouched.
const ISO_TS_RE = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?\b/g;
const ABS_DATE_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/**
 * Rewrite bare ISO timestamps in free text to a human form:
 * `2026-05-30T04:15:41Z` → `May 30, 2026 (3d ago)`. Reuses `formatAge` for the
 * relative part. Intended to run on plain text BEFORE Markdown rendering.
 */
export function humanizeTimestamps(text: string): string {
  if (!text) return text;
  return text.replace(ISO_TS_RE, (match) => {
    const d = new Date(match);
    if (Number.isNaN(d.getTime())) return match;
    return `${ABS_DATE_FMT.format(d)} (${formatAge(match)})`;
  });
}

// Bare references to run/agent detail pages. Lookbehind avoids matching when the
// slash is already part of a longer path or token.
const REF_RE = /(?<![A-Za-z0-9_/])\/(?:runs|agents)\/[A-Za-z0-9_-]+/g;
// Existing Markdown links and inline code, kept intact so we don't double-link.
const PROTECT_RE = /(\[[^\]]+\]\([^)]+\)|`[^`]+`)/g;

/**
 * Turn bare `/runs/<id>` and `/agents/<id>` references in free text into
 * Markdown links so they become clickable after Markdown rendering. The visible
 * label is the trailing id (e.g. `apple-fm`), not the raw path, so prose stays
 * readable; the href keeps the full path. Existing Markdown links and
 * inline-code spans are left untouched. Runs on plain text BEFORE rendering.
 */
export function linkifyRefs(text: string): string {
  if (!text) return text;
  return text
    .split(PROTECT_RE)
    .map((seg, i) => (i % 2 === 1 ? seg : seg.replace(REF_RE, (m) => {
      const label = m.slice(m.lastIndexOf('/') + 1);
      return `[${label}](${m})`;
    })))
    .join('');
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

export function formatExitCode(code: number | null | undefined): string {
  // DAG/multi-node runs (and some legacy v1 runs) have no run-level exit code —
  // the store returns null, which must render as "no exit code", not "exit null".
  if (code == null) return '';
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
  invalid_output: 'Output failed the task contract',
};

export function formatErrorCategory(category: string): string {
  return ERROR_CATEGORY_LABELS[category] ?? category;
}

// Re-export from core so dashboard views can import from components.
export { cronToHuman } from '@some-useful-agents/core';
