/**
 * What the layout planner is given about a board (routes/pulse-layout-plan.ts,
 * routes/dashboard-layout-plan.ts): each agent on it or available to it, and
 * the board's current layout.
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
  /**
   * True when this agent is installed but not yet on the current surface —
   * the planner may surface it via `toAdd`. False/omitted means already
   * on this surface (a "member"). Pill heuristics ignore available
   * agents; only the LLM planner sees them.
   */
  available?: boolean;
  /** Short description from the agent metadata, used by the planner to match available agents against FOCUS. */
  description?: string;
}

export interface CurrentLayout {
  containers?: Array<{ label: string; tiles: string[] }>;
}
