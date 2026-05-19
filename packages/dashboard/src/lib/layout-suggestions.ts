/**
 * Suggestion pills for the "Improve layout" wizard on `/pulse`.
 *
 * Pure heuristic — no LLM, no DB queries. Called by the modal-init
 * route with already-gathered agent metadata + the current layout JSON.
 *
 * Each pill carries a short `label` (for the chip) and a longer `prompt`
 * that fills the FOCUS textarea when the user clicks it. Dynamic pills
 * include the actual affected agent ids inline in the prompt so the
 * downstream layout-planner can act on them directly.
 *
 * Output is ordered dynamic-first (state-specific = more useful), then
 * static fillers. Capped at 5 to keep the pill row scannable.
 */

export interface LayoutSuggestionAgent {
  id: string;
  title?: string;
  /** ISO timestamp of the most recent run; null/undefined when never run. */
  lastRunAt?: string | null;
  /** 0-1 fraction over recent runs; null/undefined when no run history. */
  successRate?: number | null;
  /** Count of runs in the last 30 days. */
  runCount30d?: number | null;
}

export interface CurrentLayout {
  containers?: Array<{ label: string; tiles: string[] }>;
}

export interface LayoutSuggestion {
  /** Stable identifier — UI uses it to toggle the active-pill class. */
  id: string;
  /** Short text rendered inside the pill chip. */
  label: string;
  /**
   * Longer prompt that fills the FOCUS textarea when the pill is clicked.
   * For dynamic pills, names the affected agent ids inline so the
   * downstream layout-planner can act directly.
   */
  prompt: string;
  /** True when state-derived (computed from agent/layout state); false for static defaults. */
  dynamic: boolean;
}

const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const FAIL_RATE_THRESHOLD = 0.5;
const MAX_SUGGESTIONS = 5;
const MAX_DYNAMIC = 3;

/** Heuristic match for "this looks like a monitoring agent." */
const MONITORING_RE = /\b(monitor|monitoring|health|uptime|watch|alert|status|ping|check)\b/i;

/** Compact a list of ids for inclusion in a prompt string. */
function formatIds(ids: string[]): string {
  if (ids.length <= 6) return ids.join(', ');
  return `${ids.slice(0, 5).join(', ')} (and ${ids.length - 5} more)`;
}

/** True when this agent's id is referenced by any container in the layout. */
function isInLayout(agentId: string, layout: CurrentLayout | null): boolean {
  if (!layout?.containers) return false;
  return layout.containers.some((c) => c.tiles.includes(agentId));
}

/** True when the agent hasn't run in 30+ days (or has lastRunAt but it's old). */
function isStale(agent: LayoutSuggestionAgent, now: number): boolean {
  if (!agent.lastRunAt) return false; // never-run is handled separately
  const ts = new Date(agent.lastRunAt).getTime();
  if (!Number.isFinite(ts)) return false;
  return now - ts > STALE_THRESHOLD_MS;
}

/** True when the agent has run AND its success rate is below threshold. */
function isFailing(agent: LayoutSuggestionAgent): boolean {
  if (agent.successRate === undefined || agent.successRate === null) return false;
  if (!(agent.runCount30d && agent.runCount30d > 0)) return false;
  return agent.successRate < FAIL_RATE_THRESHOLD;
}

/** True when the agent's id or title looks like a monitoring tool. */
function looksLikeMonitoring(agent: LayoutSuggestionAgent): boolean {
  if (MONITORING_RE.test(agent.id)) return true;
  if (agent.title && MONITORING_RE.test(agent.title)) return true;
  return false;
}

/** Compute the dynamic (state-derived) suggestions. Up to MAX_DYNAMIC entries, ordered by signal strength. */
function computeDynamicSuggestions(
  agents: LayoutSuggestionAgent[],
  layout: CurrentLayout | null,
  now: number,
): LayoutSuggestion[] {
  const out: LayoutSuggestion[] = [];

  // 1. Failing agents — highest signal, surface first.
  const failing = agents.filter(isFailing);
  if (failing.length >= 1) {
    const ids = failing.map((a) => a.id);
    out.push({
      id: 'surface-failing',
      label: `Surface ${failing.length} failing agent${failing.length === 1 ? '' : 's'}`,
      prompt: `Surface the ${failing.length} agent${failing.length === 1 ? '' : 's'} that ${failing.length === 1 ? 'has' : 'have'} been failing recently (${formatIds(ids)}). Place them in a "Needs attention" container at the top.`,
      dynamic: true,
    });
  }

  // 2. Agents not yet in any container.
  const ungrouped = agents.filter((a) => !isInLayout(a.id, layout));
  if (ungrouped.length >= 2) {
    const ids = ungrouped.map((a) => a.id);
    out.push({
      id: 'group-ungrouped',
      label: `Group ${ungrouped.length} ungrouped agent${ungrouped.length === 1 ? '' : 's'}`,
      prompt: `Group these agents that aren't yet in a container into one or more topic-based containers: ${formatIds(ids)}.`,
      dynamic: true,
    });
  }

  // 3. Stale agents (haven't run in 30+ days).
  const stale = agents.filter((a) => isStale(a, now));
  if (stale.length >= 1) {
    const ids = stale.map((a) => a.id);
    out.push({
      id: 'collapse-stale',
      label: `Hide ${stale.length} stale agent${stale.length === 1 ? '' : 's'}`,
      prompt: `These ${stale.length} agent${stale.length === 1 ? '' : 's'} haven't run in 30+ days (${formatIds(ids)}). Hide or collapse them into a low-priority container at the bottom.`,
      dynamic: true,
    });
  }

  // 4. Monitoring cluster.
  const monitoring = agents.filter(looksLikeMonitoring);
  if (monitoring.length >= 2) {
    const ids = monitoring.map((a) => a.id);
    out.push({
      id: 'cluster-monitoring',
      label: `Combine ${monitoring.length} monitoring agents`,
      prompt: `Combine these monitoring/health-check agents into a single "Monitoring" container: ${formatIds(ids)}.`,
      dynamic: true,
    });
  }

  return out.slice(0, MAX_DYNAMIC);
}

/** Always-on default suggestions. Order matters — first entries fill in if dynamic pills are scarce. */
const STATIC_SUGGESTIONS: LayoutSuggestion[] = [
  {
    id: 'group-by-topic',
    label: 'Group by topic',
    prompt: 'Group similar agents into topic-based containers (Monitoring, Daily news, Personal, etc.).',
    dynamic: false,
  },
  {
    id: 'rank-by-reliability',
    label: 'Rank by reliability',
    prompt: 'Rank agents by recent success rate. Surface the most reliable ones first; collapse or hide unreliable ones.',
    dynamic: false,
  },
  {
    id: 'surface-daily',
    label: 'Surface daily-run agents',
    prompt: 'Surface the agents I run daily at the top of the layout. Collapse or hide the rest.',
    dynamic: false,
  },
  {
    id: 'pin-most-reliable',
    label: 'Pin top 5 reliable',
    prompt: 'Pin my 5 most reliable agents (highest recent success rate) to the top of the layout.',
    dynamic: false,
  },
];

/**
 * Compute up to MAX_SUGGESTIONS pills for the modal. Dynamic pills first
 * (capped at MAX_DYNAMIC); static fillers fill the remaining slots.
 *
 * @param now Override the wall clock — primarily for tests. Defaults to Date.now().
 */
export function computeLayoutSuggestions(
  agents: LayoutSuggestionAgent[],
  layout: CurrentLayout | null,
  now: number = Date.now(),
): LayoutSuggestion[] {
  const dynamic = computeDynamicSuggestions(agents, layout, now);
  const remaining = MAX_SUGGESTIONS - dynamic.length;
  const fillers = STATIC_SUGGESTIONS.slice(0, Math.max(0, remaining));
  return [...dynamic, ...fillers];
}
