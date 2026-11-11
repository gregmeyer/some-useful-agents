/**
 * A run's output, cut into parts the notebook keeper can read whole.
 *
 * The keeper reads at most `cap` characters at a time. An output longer than
 * that used to be cut off there, so a research run over eight options filed
 * the first five and silently dropped the rest. Now a long output is split
 * where its items end and the keeper reads each part in turn.
 */

/** At most this many parts are read; past it the last part says what was left out. */
export const MAX_KEEPER_PARTS = 6;

/** Things beside the list (a headline, a count) small enough to repeat in every part. */
const SMALL_SIBLING = 600;

function listOf(v: unknown): { key?: string; items: unknown[]; rest: Record<string, unknown> } | undefined {
  if (Array.isArray(v)) return v.length > 1 ? { items: v, rest: {} } : undefined;
  if (!v || typeof v !== 'object') return undefined;
  let key: string | undefined;
  let size = 0;
  for (const [k, x] of Object.entries(v)) {
    if (!Array.isArray(x) || x.length < 2 || !x.every((i) => !!i && typeof i === 'object')) continue;
    const n = JSON.stringify(x).length;
    if (n > size) { key = k; size = n; }
  }
  if (!key) return undefined;
  const rest: Record<string, unknown> = {};
  // A large sibling (a table of the same rows, drawn for a page) is the list again: left out.
  for (const [k, x] of Object.entries(v)) if (k !== key && JSON.stringify(x ?? null).length <= SMALL_SIBLING) rest[k] = x;
  return { key, items: (v as Record<string, unknown[]>)[key], rest };
}

function cut(text: string, cap: number): string {
  return text.length > cap ? `${text.slice(0, cap)}\n(truncated)` : text;
}

function textParts(text: string, cap: number): string[] {
  const parts: string[] = [];
  let now = '';
  for (const block of text.split(/\n{2,}/)) {
    if (now && now.length + block.length + 2 > cap) { parts.push(now); now = ''; }
    if (block.length > cap) {
      if (now) { parts.push(now); now = ''; }
      for (let i = 0; i < block.length; i += cap) parts.push(block.slice(i, i + cap));
      continue;
    }
    now = now ? `${now}\n\n${block}` : block;
  }
  if (now) parts.push(now);
  return parts;
}

/**
 * The output as one part when it fits, else as several: a JSON list (or an
 * object holding one) by whole items, anything else by paragraphs.
 */
export function keeperParts(output: string, cap: number, maxParts = MAX_KEEPER_PARTS): string[] {
  if (output.length <= cap) return [output];
  let parts: string[] | undefined;
  try {
    const list = listOf(JSON.parse(output) as unknown);
    if (list) {
      const wrap = (items: unknown[]) => JSON.stringify(list.key ? { ...list.rest, [list.key]: items } : items);
      parts = [];
      let batch: unknown[] = [];
      for (const item of list.items) {
        if (batch.length && wrap([...batch, item]).length > cap) { parts.push(wrap(batch)); batch = []; }
        batch.push(item);
      }
      if (batch.length) parts.push(wrap(batch));
    }
  } catch { /* not JSON: by paragraphs */ }
  parts ??= textParts(output, cap);
  const left = parts.length - maxParts;
  const kept = parts.slice(0, maxParts).map((p) => cut(p, cap));
  if (left > 0) kept[kept.length - 1] += `\n(${String(left)} more part${left === 1 ? '' : 's'} of this output not shown)`;
  return kept.map((p, i) => (kept.length > 1 ? `(part ${String(i + 1)} of ${String(kept.length)} of this output)\n${p}` : p));
}
