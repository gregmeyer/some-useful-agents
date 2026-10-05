/**
 * Items: the canonical layer of goal surfaces (ADR-0049). An item is a typed,
 * stable projection of something sua already stores (a thread waiting on you,
 * an agent that keeps failing, a question a run is waiting on). Surfaces
 * (S2) decide what to emphasize; items only say what is true.
 *
 * Ids are stable across reads, so a surface can pin or rank an item and still
 * find it next time: `thread:<id>`, `question:<id>`, `agent:<id>:failing`,
 * `agent:<id>:outcome`, `agent:<id>:draft`, `board-build:<id>`,
 * `system:scheduler`.
 */

export const ITEM_KINDS = [
  'fact', 'metric', 'status', 'alert', 'question', 'decision', 'action', 'progress', 'evidence', 'collection',
] as const;
export type ItemKind = typeof ITEM_KINDS[number];

/** How much it could change what you do now. Sorts critical first. */
export type ItemUrgency = 'critical' | 'high' | 'normal' | 'low';
export const URGENCY_ORDER: Record<ItemUrgency, number> = { critical: 0, high: 1, normal: 2, low: 3 };

/** open: waiting on you; waiting: on someone/something else; in-progress; ok: healthy, shown for context. */
export type ItemState = 'open' | 'waiting' | 'in-progress' | 'ok';

/** Which store the item was read from. */
export type ItemSource = 'inbox' | 'questions' | 'runs' | 'outcomes' | 'scheduler' | 'board-builds' | 'agents' | 'notebooks';

/**
 * What you can do about an item. Typed, and carried out by the store that owns
 * the truth (S3 wires them up): approve / skip an inbox action card, reply in
 * a thread, answer a run's question, retry an agent, activate a draft.
 */
export type ItemAction =
  | { type: 'approve'; label: string; threadId: string; responseId: string }
  | { type: 'skip'; label: string; threadId: string; responseId: string }
  | { type: 'reply'; label: string; threadId: string }
  | { type: 'answer'; label: string; questionId: string; choices: string[] }
  | { type: 'retry'; label: string; agentId: string }
  | { type: 'activate'; label: string; agentId: string }
  | { type: 'open'; label: string; href: string };

export interface ItemRef {
  kind: 'run' | 'thread' | 'outcome' | 'build' | 'agent' | 'board' | 'question';
  id: string;
  href?: string;
}

export interface Item {
  /** Stable across reads (see the module comment). */
  id: string;
  kind: ItemKind;
  title: string;
  /** One plain line under the title. */
  summary?: string;
  urgency: ItemUrgency;
  state: ItemState;
  /** What the item is about. */
  subject: { agentId?: string; runId?: string; threadId?: string; boardId?: string; questionId?: string };
  /** A number or short value, for metric / status items (e.g. failures in a row). */
  value?: number | string;
  actions: ItemAction[];
  /** Where the item's claim comes from. */
  evidence: ItemRef[];
  provenance: {
    source: ItemSource;
    /** `system`, or `agent:<id>` / `run:<id>` when an agent or run produced it. */
    producedBy: string;
    /** ISO time the underlying fact last changed. */
    at: string;
  };
  /** Where to look at it in the dashboard. */
  href: string;
  /**
   * When this problem began, if that's earlier than `provenance.at` (the first
   * failure of a streak). Dismissing holds until there's a new problem, not
   * another round of the same one.
   */
  since?: string;
}
