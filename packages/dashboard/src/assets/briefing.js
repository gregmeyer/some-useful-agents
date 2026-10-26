// What the briefing components (ProfileCard, FactSheet, QuoteList, Agenda in
// a2ui-sua.js) work out from their data: groups, a search, a monogram, the
// agenda as plain text. No DOM here, so it can be tested without a browser.

const str = (v) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

/** Items grouped by their `group` in the order groups first appear; ungrouped ones last, under ''. */
export function groupBy(items, key = 'group') {
  const groups = new Map();
  for (const it of Array.isArray(items) ? items : []) {
    const g = str(it?.[key]);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(it);
  }
  const out = [...groups.entries()].filter(([g]) => g).map(([group, list]) => ({ group, items: list }));
  if (groups.has('')) out.push({ group: '', items: groups.get('') });
  return out;
}

/** Does a quote mention every word of `q` (its title, quote, question, group or source; any case)? */
export function matchQuote(it, q) {
  const words = String(q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = [it?.title, it?.quote, it?.ask, it?.group, it?.sourceText, it?.source].map(str).join(' ').toLowerCase();
  return words.every((w) => text.includes(w));
}

/** Up to two initials for a name with no picture: "Dana Reyes" → "DR", "acme" → "A". */
export function monogram(name) {
  const words = str(name).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

/** A source link's short name: its site without www ("linkedin.com"), or a dashboard path's last part. */
export function sourceName(url) {
  const u = str(url);
  if (!u) return '';
  if (u.startsWith('/')) return u.split(/[?#]/)[0].split('/').filter(Boolean).pop() ?? u;
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; }
}

/** A list prop as items with text: strings, or objects with `text` (or `label`). */
export function textItems(list) {
  return (Array.isArray(list) ? list : [])
    .map((x) => (typeof x === 'string' ? { text: x.trim() } : x && typeof x === 'object' ? { ...x, text: str(x.text ?? x.label) } : { text: '' }))
    .filter((x) => x.text);
}

/** The agenda as plain text, to paste into notes or an email. */
export function agendaText({ title, points, questions, watch, pointsLabel, questionsLabel, watchLabel } = {}) {
  const lines = [];
  if (str(title)) lines.push(str(title), '');
  const ps = textItems(points);
  if (ps.length) {
    lines.push(str(pointsLabel) || 'Talking points');
    ps.forEach((p, i) => { lines.push(`${i + 1}. ${p.text}`); if (str(p.note)) lines.push(`   ${str(p.note)}`); });
    lines.push('');
  }
  const qs = textItems(questions);
  if (qs.length) { lines.push(questionsLabel || 'Questions to ask'); qs.forEach((q) => lines.push(`- ${q.text}`)); lines.push(''); }
  const ws = textItems(watch);
  if (ws.length) { lines.push(watchLabel || 'Watch out for'); ws.forEach((w) => lines.push(`- ${w.text}`)); lines.push(''); }
  return lines.join('\n').trimEnd();
}

/**
 * A plan as plain text, for Copy as text: each day or slot, its items
 * (with their notes), then what to do first and what's still open.
 */
export function planText({ title, days, before, open, beforeLabel, openLabel } = {}) {
  const lines = [];
  if (str(title)) lines.push(str(title), '');
  for (const d of Array.isArray(days) ? days : []) {
    const items = textItems(d && d.items);
    if (!items.length) continue;
    lines.push(str(d.when) || 'Anytime');
    items.forEach((it) => { lines.push(`- ${it.text}`); if (str(it.note)) lines.push(`  ${str(it.note)}`); });
    lines.push('');
  }
  const bs = textItems(before);
  if (bs.length) { lines.push(beforeLabel || 'Before you start'); bs.forEach((b) => lines.push(`- ${b.text}`)); lines.push(''); }
  const os = textItems(open);
  if (os.length) { lines.push(openLabel || 'Still open'); os.forEach((o) => lines.push(`- ${o.text}`)); lines.push(''); }
  return lines.join('\n').trim();
}
