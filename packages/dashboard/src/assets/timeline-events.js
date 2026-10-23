// A timeline's events (Timeline in a2ui-sua.js): fold runs of the same event
// into one row, and match a search. No DOM here, so it can be tested without a browser.

/** Events that are the same thing happening again: same kind, title, who and tag, and nothing more to say. */
const sameAgain = (a, b) => !a?.body && !b?.body
  && (a?.kind ?? '') === (b?.kind ?? '') && (a?.title ?? '') === (b?.title ?? '')
  && (a?.who ?? '') === (b?.who ?? '') && (a?.tag ?? '') === (b?.tag ?? '') && !!a?.faded === !!b?.faded;

/**
 * Consecutive repeats fold into one row: `{ ...first, count, items }` (items
 * in the order given). A lone event comes back as `{ ...event, count: 1, items: [event] }`.
 */
export function collapseRepeats(events) {
  const out = [];
  for (const e of Array.isArray(events) ? events : []) {
    const last = out[out.length - 1];
    if (last && sameAgain(last.items[0], e)) { last.items.push(e); last.count++; continue; }
    out.push({ ...e, count: 1, items: [e] });
  }
  return out;
}

/** Does the event mention every word of `q` (title, body, who or tag; any case)? */
export function matchEvent(e, q) {
  const words = String(q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = [e?.title, e?.body, e?.who, e?.tag, e?.linkText].filter((x) => typeof x === 'string').join(' ').toLowerCase();
  return words.every((w) => text.includes(w));
}

/** When a folded row happened: its one time, or oldest to newest. `fmt(at)` formats one. */
export function whenRange(row, fmt) {
  const times = (row?.items ?? [row]).map((e) => e?.at).filter(Boolean).sort((a, b) => Date.parse(a) - Date.parse(b));
  if (!times.length) return '';
  const first = fmt(times[0]); const last = fmt(times[times.length - 1]);
  return first === last ? first : `${first} – ${last}`;
}
