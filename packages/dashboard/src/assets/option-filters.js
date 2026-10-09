// Filters for an options grid (OptionGrid in a2ui-sua.js): what each declared
// filter offers to choose from, and which options the chosen ones keep. A
// filter is a field key, or a built-in: `stage`, or `seen` (still listed vs
// not seen in recent searches). No DOM here, so it can be tested without a browser.

/** Built-in filters: what they're called. */
export const BUILTIN_FILTERS = { stage: 'Stage', seen: 'Listing' };

/** A filter as declared: "condition" or {key: "condition", label: "Condition"}. */
export function filterSpec(f) {
  if (typeof f === 'string') return { key: f };
  if (f && typeof f === 'object' && typeof f.key === 'string') return { key: f.key, ...(typeof f.label === 'string' ? { label: f.label } : {}) };
  return undefined;
}

/** An option's value for a filter, as the chip reads it ('' when it has none). `fmt(key, value)` formats a fact. */
export function filterValue(o, key, fmt) {
  if (key === 'stage') return o?.ruledOut ? '' : String(o?.stage ?? '');
  if (key === 'seen') return o?.notSeenLately ? 'Not seen lately' : 'Current';
  const v = o?.fields?.[key];
  if (v === undefined || v === null || v === '') return '';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return fmt ? String(fmt(key, v)) : (typeof v === 'object' ? JSON.stringify(v) : String(v));
}

/**
 * Each filter worth showing, with its choices and how many options have each:
 * only filters where options differ (two or more values). A choice's count is
 * among the options the other chosen filters (`selected`) keep, so it says
 * what picking it would show. Stages keep their order; other values go most
 * common first, at most `max` of them.
 */
export function filterChoices(options, filters, opts = {}) {
  const { fmt, label, stages = [], max = 12, selected = {} } = opts;
  const out = [];
  for (const spec of (Array.isArray(filters) ? filters : []).map(filterSpec).filter(Boolean)) {
    const values = new Map();
    for (const o of options) {
      const v = filterValue(o, spec.key, fmt);
      if (v) values.set(v, (values.get(v) ?? 0) + 1);
    }
    if (values.size < 2) continue;
    const { [spec.key]: _own, ...others } = selected;
    const counts = new Map();
    for (const o of applyFilters(options, others, fmt)) {
      const v = filterValue(o, spec.key, fmt);
      if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    let choices = [...values.keys()].map((value) => ({ value, count: counts.get(value) ?? 0, total: values.get(value) }));
    choices = spec.key === 'stage'
      ? choices.sort((a, b) => stages.indexOf(a.value) - stages.indexOf(b.value))
      : choices.sort((a, b) => b.total - a.total || a.value.localeCompare(b.value, undefined, { numeric: true }));
    choices = choices.map(({ total: _t, ...c }) => c);
    out.push({ key: spec.key, label: spec.label ?? BUILTIN_FILTERS[spec.key] ?? (label ? label(spec.key) : spec.key), choices: choices.slice(0, max) });
  }
  return out;
}

/** The options every chosen filter keeps. `selected` is {key: value}; an empty value means any. */
export function applyFilters(options, selected, fmt) {
  const chosen = Object.entries(selected ?? {}).filter(([, v]) => typeof v === 'string' && v);
  if (!chosen.length) return options;
  return options.filter((o) => chosen.every(([key, v]) => filterValue(o, key, fmt) === v));
}

/** Drop choices that no longer exist (an option moved, a value changed), so a stale filter can't hide everything. */
export function liveSelection(selected, choices) {
  const out = {};
  for (const [key, v] of Object.entries(selected ?? {})) {
    const f = choices.find((c) => c.key === key);
    if (f && f.choices.some((c) => c.value === v)) out[key] = v;
  }
  return out;
}
