/**
 * Daily run digest — the first `cadence` inbox producer.
 *
 * Failures already push `run-failure` threads, but successful runs have no
 * inbox surface, so a day of green runs is invisible in the review queue. This
 * posts ONE low-priority `cadence` thread each morning summarizing the previous
 * local day's runs: a counts header plus one line per agent (a short output
 * snippet for successes; a link to the existing failure thread for failures —
 * never restating the error).
 *
 * Shape mirrors the two established patterns: a pure builder →
 * `AddMessageInput` (like `run-failure-inbox.ts`) plus a `setInterval` + `unref`
 * + stop-fn loop (like `inbox-sweeper.ts`). Idempotency lives in the data: the
 * `cadence:daily-digest:<yyyy-mm-dd>` dedupeKey makes `inboxStore.add` a no-op
 * after the first post, so the loop can fire-and-forget every tick and a boot
 * after downtime (past the post hour) still posts yesterday's digest once.
 *
 * The publish-to-UI hook is injected (not imported from routes/) so this lib
 * module stays free of a routes/ dependency — same discipline as the sweeper.
 */
import type { AddMessageInput, Run, RunStatus } from '@some-useful-agents/core';
import type { getContext } from '../context.js';

type Ctx = ReturnType<typeof getContext>;

/** Local hour (0–23) at/after which the previous day's digest may post. */
export const DEFAULT_POST_HOUR = 8;
/** Loop cadence. Coarse — the dedupeKey + morning-gate do the real scheduling. */
export const DIGEST_INTERVAL_MS = 15 * 60 * 1000;
/** dedupeKey prefix; the summarized local day is appended. */
export const DIGEST_DEDUPE_PREFIX = 'cadence:daily-digest:';
/** Max chars for a per-agent output teaser. */
const SNIPPET_CAP = 140;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Default-on; `SUA_DAILY_DIGEST=0` opts out. Checked per tick. */
export function isDailyDigestEnabled(): boolean {
  return process.env.SUA_DAILY_DIGEST !== '0';
}

export interface DigestAgentSummary {
  agentName: string;
  total: number;
  completed: number;
  failed: number;
  /** running / pending / cancelled — surfaced only in the header count. */
  other: number;
  /** Short teaser from the latest completed run's output. */
  snippet?: string;
  /** Existing `run-failure` thread id to link, when the agent had failures. */
  failureThreadId?: string;
}

export interface DailyDigestInput {
  /** The summarized local day, `YYYY-MM-DD`. */
  date: string;
  agents: DigestAgentSummary[];
}

function truncate(s: string, cap: number): string {
  return s.length > cap ? `${s.slice(0, cap - 1).trimEnd()}…` : s;
}

/** Fields, in priority order, that make a good human summary of a JSON output. */
const SUMMARY_KEYS = ['headline', 'summary', 'title', 'message', 'text', 'label', 'status', 'name'];

function tryParseObject(s: string): Record<string, unknown> | undefined {
  const t = s.trim();
  if (!t.startsWith('{') || !t.endsWith('}')) return undefined;
  try {
    const o = JSON.parse(t);
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : undefined;
  } catch { return undefined; }
}

/** Pull a display string out of a parsed JSON output object. */
function summarizeObject(obj: Record<string, unknown>): string | undefined {
  // Metric shape: `label` + `value`.
  if (typeof obj.label === 'string' && (typeof obj.value === 'string' || typeof obj.value === 'number')) {
    return `${obj.label}: ${obj.value}`;
  }
  // A well-known summary field, value only (no key noise).
  for (const k of SUMMARY_KEYS) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  // Otherwise the first scalar/array field as `key: value`.
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && v.trim()) return `${k}: ${v.trim()}`;
    if (typeof v === 'number' || typeof v === 'boolean') return `${k}: ${v}`;
    if (Array.isArray(v)) return `${k}: ${v.length} item${v.length === 1 ? '' : 's'}`;
  }
  return undefined;
}

/** First line with real content — skips code fences and structural-only lines. */
export function firstLineSnippet(result: string | undefined | null, cap = SNIPPET_CAP): string | undefined {
  if (!result) return undefined;
  const lines = result.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return undefined;
  const meaningful = lines.find((l) =>
    !/^```/.test(l) &&            // code fence (``` or ```json)
    /[A-Za-z0-9]/.test(l) &&      // has actual content
    !/^[{}[\](),:"'`]+$/.test(l), // not purely structural punctuation
  );
  return truncate(meaningful ?? lines[0], cap);
}

/**
 * A useful one-line summary of a run's output. Agents commonly emit a final
 * JSON object (per the signal/widget convention), so this extracts the
 * meaningful field (`headline` / `summary` / a `label: value` metric) instead
 * of dumping raw JSON. Handles a whole-output object, a ```json fence, or a
 * trailing JSON line after prose. Falls back to the first meaningful text line.
 */
export function summarizeRunOutput(result: string | undefined | null, cap = SNIPPET_CAP): string | undefined {
  if (!result) return undefined;
  let text = result.trim();
  const fence = text.match(/^```[a-z]*\s*\n([\s\S]*?)\n```$/i);
  if (fence) text = fence[1].trim();

  // Whole output is a JSON object, or a trailing JSON line follows prose.
  let obj = tryParseObject(text);
  if (!obj) {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0 && !obj; i--) obj = tryParseObject(lines[i]);
  }
  if (obj) {
    const s = summarizeObject(obj);
    if (s) return truncate(s, cap);
  }
  return firstLineSnippet(text, cap);
}

function prettyDate(ymd: string): string {
  const [, m, d] = ymd.split('-').map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${d}`;
}

const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`;

/**
 * Build the digest inbox message from already-grouped data (no store access,
 * so it's unit-testable). Returns `null` when the day had zero runs, so the
 * caller skips posting on empty days.
 */
export function buildDailyDigestMessage(input: DailyDigestInput): AddMessageInput | null {
  const totalRuns = input.agents.reduce((s, a) => s + a.total, 0);
  if (totalRuns === 0) return null;

  const ok = input.agents.reduce((s, a) => s + a.completed, 0);
  const failed = input.agents.reduce((s, a) => s + a.failed, 0);
  const other = input.agents.reduce((s, a) => s + a.other, 0);
  const agentCount = input.agents.length;

  const headerParts = [plural(totalRuns, 'run'), `${ok} ok`, `${failed} failed`];
  if (other > 0) headerParts.push(`${other} other`);
  headerParts.push(plural(agentCount, 'agent'));

  // Failures first (they may need attention), then busiest agents.
  const sorted = [...input.agents].sort((a, b) =>
    (b.failed - a.failed) || (b.total - a.total) || a.agentName.localeCompare(b.agentName));

  const lines = sorted.map((a) => {
    if (a.failed > 0) {
      const counts = a.completed > 0 ? `${a.completed} ok, ${a.failed} failed` : `${a.failed} failed`;
      const link = a.failureThreadId ? ` → [open thread](/inbox/${a.failureThreadId})` : '';
      return `- ✗ **${a.agentName}** (${counts})${link}`;
    }
    if (a.completed > 0) {
      const snip = a.snippet ? ` — "${a.snippet}"` : '';
      return `- ✓ **${a.agentName}** (${a.completed})${snip}`;
    }
    return `- • **${a.agentName}** (${plural(a.total, 'run')})`;
  });

  const body = [
    `Your agents ran on ${prettyDate(input.date)}.`,
    '',
    headerParts.join(' · '),
    '',
    ...lines,
    '',
    'Open the [runs page](/runs) for full detail.',
  ].join('\n');

  return {
    priority: 'low',
    source: 'cadence',
    title: `Daily digest — ${plural(totalRuns, 'run')}, ${plural(agentCount, 'agent')} (${prettyDate(input.date)})`,
    body,
    dedupeKey: `${DIGEST_DEDUPE_PREFIX}${input.date}`,
  };
}

/** Local YYYY-MM-DD for a Date. */
function localYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export type DigestOutcome =
  | 'posted' | 'skipped-empty' | 'skipped-early' | 'skipped-exists'
  | 'skipped-disabled' | 'skipped-no-store';

export interface RunDailyDigestOpts {
  /** Injectable clock for tests. Defaults to now. */
  now?: Date;
  /** Local hour gate. Defaults to DEFAULT_POST_HOUR. */
  postHour?: number;
  /** Called with (messageId, status) after a NEW digest is posted (UI refresh). */
  onPosted?: (messageId: string, status: string) => void;
  /**
   * Return true to exclude an agent from the digest — used to drop internal
   * system agents (inbox-triage, agent-analyzer, …) the operator never
   * reviews. `_`-prefixed agents are always excluded regardless.
   */
  excludeAgent?: (agentName: string) => boolean;
}

/**
 * Post the previous local day's digest, if it's morning and not already posted.
 * Idempotent + non-throwing at the caller (the loop wraps it). Returns an
 * outcome for telemetry/tests.
 */
export function runDailyDigestOnce(ctx: Ctx, opts: RunDailyDigestOpts = {}): DigestOutcome {
  if (!isDailyDigestEnabled()) return 'skipped-disabled';
  if (!ctx.inboxStore || !ctx.runStore) return 'skipped-no-store';

  const now = opts.now ?? new Date();
  const postHour = opts.postHour ?? DEFAULT_POST_HOUR;
  if (now.getHours() < postHour) return 'skipped-early';

  // Previous local calendar day: [yesterday 00:00, today 00:00).
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const dayStart = new Date(todayStart);
  dayStart.setDate(dayStart.getDate() - 1);
  const targetDate = localYMD(dayStart);

  const dedupeKey = `${DIGEST_DEDUPE_PREFIX}${targetDate}`;
  if (ctx.inboxStore.findByDedupeKey(dedupeKey)) return 'skipped-exists';

  const runs = ctx.runStore.queryRuns({
    since: dayStart.toISOString(),
    until: todayStart.toISOString(),
    limit: 500,
  }).rows;

  // Group by agent × status, dropping internal/system agents so the digest is
  // about the operator's own agents. `runs` is startedAt DESC, so the first
  // completed run per agent is the latest — use it for the summary.
  const byAgent = new Map<string, { runs: Run[]; latestCompleted?: Run }>();
  for (const r of runs) {
    if (r.agentName.startsWith('_')) continue;
    if (opts.excludeAgent?.(r.agentName)) continue;
    let g = byAgent.get(r.agentName);
    if (!g) { g = { runs: [] }; byAgent.set(r.agentName, g); }
    g.runs.push(r);
    if (!g.latestCompleted && r.status === 'completed') g.latestCompleted = r;
  }
  if (byAgent.size === 0) return 'skipped-empty';

  const countBy = (rs: Run[], s: RunStatus) => rs.filter((r) => r.status === s).length;
  const agents: DigestAgentSummary[] = [];
  for (const [agentName, g] of byAgent) {
    const completed = countBy(g.runs, 'completed');
    const failed = countBy(g.runs, 'failed');
    agents.push({
      agentName,
      total: g.runs.length,
      completed,
      failed,
      other: g.runs.length - completed - failed,
      snippet: summarizeRunOutput(g.latestCompleted?.result),
      failureThreadId: failed > 0
        ? ctx.inboxStore.findActiveByAgentAndSource(agentName, 'run-failure')?.id
        : undefined,
    });
  }

  const msg = buildDailyDigestMessage({ date: targetDate, agents });
  if (!msg) return 'skipped-empty';

  const added = ctx.inboxStore.add(msg);
  opts.onPosted?.(added.id, added.status);
  return 'posted';
}

/**
 * Start the periodic digest loop. Returns a stop-fn for `close()`. Unref'd so
 * it never keeps the process alive; try/catch so a hiccup skips the tick.
 */
export function startDailyDigest(
  ctx: Ctx,
  opts: Pick<RunDailyDigestOpts, 'onPosted' | 'excludeAgent'> = {},
): () => void {
  const tick = () => {
    try {
      runDailyDigestOnce(ctx, opts);
    } catch (err) {
      console.warn('[daily-digest] tick failed:', err instanceof Error ? err.message : String(err));
    }
  };
  tick(); // fire once at boot (catch-up after downtime)
  const timer = setInterval(tick, DIGEST_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
