// Chart arithmetic shared by the A2UI chart components (a2ui-sua.js): round
// axis ticks, the point nearest the pointer, and what a hovered point says.
// No DOM here, so it can be tested without a browser.

/** Round tick values covering [lo, hi]: steps of 1, 2, 2.5 or 5 × 10^k, about `count` of them. */
export function niceTicks(lo, hi, count = 4) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
  if (hi < lo) [lo, hi] = [hi, lo];
  if (hi === lo) { const h = Math.abs(hi) / 2 || 1; lo -= h; hi += h; }
  const span = hi - lo;
  const raw = span / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

/** The point nearest (x, y) within `reach`, or undefined. Points are `{ px, py }` in the same units. */
export function nearestPoint(points, x, y, reach) {
  let best; let bestD = reach * reach;
  for (const p of points) {
    const d = (p.px - x) ** 2 + (p.py - y) ** 2;
    if (d <= bestD) { best = p; bestD = d; }
  }
  return best;
}

/** A value written out in full: "$3,450", "178,000". */
export function fullValue(n, money) {
  const s = Math.round(n * 100) / 100;
  const t = Math.abs(s) >= 100 ? Math.round(s).toLocaleString('en-US') : s.toLocaleString('en-US');
  return money ? `${s < 0 ? '-' : ''}$${t.replace('-', '')}` : t;
}

/**
 * What a hovered point says: its name, both values in full, and where it
 * stands (best, ruled out and why, its stage, inside or outside the limits).
 */
export function pointNote({ name, x, y, xLabel, yLabel, xMoney, yMoney, best, bestWord, ruledOut, stage, inLimits }) {
  const status = [];
  if (ruledOut) status.push(ruledOut.gone ? 'no longer available' : `ruled out${ruledOut.reason ? `: ${ruledOut.reason}` : ''}`);
  else {
    if (best) status.push(bestWord || 'best');
    if (stage) status.push(stage);
    if (inLimits === false) status.push('outside your limits');
  }
  return {
    name: String(name ?? '').trim() || 'Untitled',
    values: `${yLabel} ${fullValue(y, yMoney)} · ${xLabel} ${fullValue(x, xMoney)}`,
    status: status.join(' · '),
  };
}

/** Where a point opens: a path on this dashboard ("/notebooks/…"), or nothing. Other sites never open from a chart. */
export function pointHref(v) {
  return typeof v === 'string' && /^\/(?!\/)/.test(v) && !/[\s\\]/.test(v) ? v : undefined;
}
