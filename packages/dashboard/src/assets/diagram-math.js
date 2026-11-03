// An answer's diagram arithmetic for the browser, so a reader can move a
// what-if (the amount, the longest term, the rung count) and watch the
// drawing follow without a round trip, and without anything being written:
// `recomputeDiagram` mirrors core/notebooks.ts and `layoutDiagram` mirrors
// dashboard lib/answer-art.ts (a test keeps each pair the same). No DOM.

const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const pct = (n) => Math.round(n * 1000) / 10;
const monthWord = (m) => (m % 12 === 0 ? `${String(m / 12)} yr` : `${String(m)} mo`);
const monthWords = (m) => (m === 0 ? 'Now' : monthWord(m));

/** The value a diagram has for a what-if key now. */
export function diagramParamValue(d, key) {
  if (d.type === 'split') return key === 'amount' ? d.total ?? d.parts.reduce((t, p) => t + p.amount, 0) : undefined;
  if (d.type !== 'ladder') return undefined;
  if (key === 'months') return Math.max(...d.rungs.map((r) => r.end));
  if (key === 'count') return d.rungs.length;
  return d.rungs.every((r) => r.amount !== undefined) ? d.rungs.reduce((t, r) => t + (r.amount ?? 0), 0) : undefined;
}

/** A what-if's value in words: "$25,000", "5 yr", "5 rungs". */
export function diagramParamWords(key, value) {
  if (key === 'amount') return money(value);
  if (key === 'months') return monthWord(value);
  return `${String(value)} rung${value === 1 ? '' : 's'}`;
}

/** The diagram at other values of its what-ifs ({ amount: 30000 }); at the written values, as it was. Pure. */
export function recomputeDiagram(d, values) {
  const want = (key) => {
    const v = values?.[key];
    const p = d.type !== 'flow' ? d.params?.find((x) => x.key === key) : undefined;
    return p && typeof v === 'number' && Number.isFinite(v) ? Math.max(p.min, Math.min(p.max, v)) : undefined;
  };
  const share = (amounts, total) => {
    const sum = amounts.reduce((t, a) => t + a, 0);
    if (!(sum > 0)) return amounts.map(() => Math.round(total / amounts.length));
    const out = amounts.map((a) => Math.round((a / sum) * total));
    out[out.length - 1] += Math.round(total) - out.reduce((t, a) => t + a, 0);
    return out;
  };
  if (d.type === 'split') {
    const amount = want('amount');
    const now = diagramParamValue(d, 'amount') ?? 0;
    if (amount === undefined || amount === now) return d;
    const amounts = share(d.parts.map((p) => p.amount), amount);
    return { ...d, total: amount, parts: d.parts.map((p, i) => ({ ...p, amount: amounts[i] })) };
  }
  if (d.type !== 'ladder') return d;
  const months = want('months') ?? diagramParamValue(d, 'months') ?? 0;
  const count = want('count') ?? d.rungs.length;
  const total = want('amount') ?? diagramParamValue(d, 'amount');
  const longest = diagramParamValue(d, 'months') ?? 0;
  if (months === longest && count === d.rungs.length && total === diagramParamValue(d, 'amount')) return d;
  if (count !== d.rungs.length) {
    const each = total !== undefined ? share(Array.from({ length: count }, () => 1), total) : [];
    const rungs = Array.from({ length: count }, (_, i) => {
      const end = Math.max(i + 1, Math.round((months * (i + 1)) / count));
      return { label: `${monthWord(end)} rung`, start: 0, end, ...(total !== undefined ? { amount: each[i] } : {}) };
    });
    return { ...d, rungs };
  }
  const amounts = total !== undefined ? share(d.rungs.map((r) => r.amount ?? 0), total) : [];
  const scale = longest > 0 ? months / longest : 1;
  return {
    ...d,
    rungs: d.rungs.map((r, i) => {
      const start = Math.round(r.start * scale);
      const end = Math.max(start + 1, Math.round(r.end * scale));
      return { ...r, start, end, ...(total !== undefined ? { amount: amounts[i] } : {}) };
    }),
  };
}

/** A diagram in words, a line a part. */
export function diagramLines(d) {
  if (d.type === 'ladder') return d.rungs.map((r) => `${r.label}: months ${String(r.start)}–${String(r.end)}${r.amount !== undefined ? `, ${money(r.amount)}` : ''}${r.rate ? ` at ${r.rate}` : ''}`);
  if (d.type === 'split') return d.parts.map((p) => `${p.label}: ${money(p.amount)}${p.note ? ` (${p.note})` : ''}`);
  return d.nodes.map((n, i) => `${String(i + 1)}. ${n.label}${n.note ? ` (${n.note})` : ''}`);
}

function monthTicks(max) {
  const step = [1, 3, 6, 12, 24, 60].find((s) => max / s <= 6) ?? 120;
  const out = [];
  for (let m = 0; m < max; m += step) out.push(m);
  return [...out, max];
}

/** Where each bar goes (in % of the width), with its words and text version. Pure. */
export function layoutDiagram(d) {
  const lines = diagramLines(d);
  if (d.type === 'ladder') {
    const max = Math.max(...d.rungs.map((r) => r.end));
    return {
      type: 'ladder', lines,
      axis: monthTicks(max).map((m) => ({ at: pct(m / max), label: monthWords(m) })),
      rungs: d.rungs.map((r) => ({
        label: r.label, left: pct(r.start / max), width: Math.max(2, pct((r.end - r.start) / max)),
        note: [r.amount !== undefined ? money(r.amount) : '', r.rate ?? '', `due ${monthWords(r.end).replace('Now', '0 mo')}`].filter(Boolean).join(' · '),
      })),
    };
  }
  if (d.type === 'split') {
    const sum = d.parts.reduce((t, p) => t + p.amount, 0);
    return {
      type: 'split', lines, total: money(d.total ?? sum),
      parts: d.parts.map((p) => ({ label: p.label, width: pct(p.amount / sum), amount: money(p.amount), ...(p.note ? { note: p.note } : {}) })),
    };
  }
  return { type: 'flow', lines, nodes: d.nodes };
}
