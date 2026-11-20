/**
 * Components written for A2UI v0.9, made valid A2UI v1.0 (ADR-0084). Layouts
 * saved before the move, presets, and what a model writes from habit still
 * draw. The 1.0 processor still takes v0.9's `path`, `call` and `checks`; it
 * refuses only:
 * - a Text `variant` of h1–h5 (1.0 has caption and body; a heading is
 *   markdown in the text), which becomes "## …" in a literal text, or is
 *   dropped from a bound one;
 * - a TextField's `validationRegexp` (1.0 checks it with `@checks`), which
 *   becomes a `regex` check;
 * - a component id that isn't a Unicode identifier (UAX #31: a letter or _,
 *   then letters, digits or _; so no hyphens), which is renamed, with every
 *   reference to it (child, children, a template's componentId, a Modal's
 *   trigger and content).
 * Pure; returns new objects only where something changed.
 */

const IDENT = /^[\p{XID_Start}_][\p{XID_Continue}]*$/u;
/** A component id 1.0 accepts, from any string ("rest_tile__system-runs-today" → "rest_tile__system_runs_today"). */
export function a2uiId(s: string): string {
  if (IDENT.test(s)) return s;
  const t = [...s].map((ch) => (/[\p{XID_Continue}]/u.test(ch) ? ch : '_')).join('');
  return /^[\p{XID_Start}_]/u.test(t) ? t : `_${t}`;
}
const REF_KEYS = new Set(['child', 'children', 'componentId', 'trigger', 'content']);
const HEADING: Record<string, string> = { h1: '# ', h2: '## ', h3: '### ', h4: '#### ', h5: '##### ' };

/**
 * A value's bindings in 1.0 form: `{path}` → `{"@path"}`, `{call, args}` →
 * `{"@call", args}`, recursively (a function's args bind too). A template's
 * `{path, componentId}` (a list's children) keeps its plain `path`, as 1.0
 * has it. The 1.0 processor still validates the old forms, but draws only
 * the new ones: a surface sent to the browser goes through this.
 */
function bindings(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(bindings);
  if (!v || typeof v !== 'object') return v;
  const o = v as Record<string, unknown>;
  if (typeof o.componentId === 'string') return o;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(o)) {
    const key = k === 'path' && typeof x === 'string' ? '@path' : k === 'call' && typeof x === 'string' ? '@call' : k;
    out[key] = bindings(x);
  }
  return out;
}

/** A component as 1.0 draws it: normalised (normalizeComponent), its bindings in 1.0 form and its checks as `@checks`. */
export function componentForRender<T>(c: T): T {
  const n = normalizeComponent(c);
  if (!n || typeof n !== 'object' || Array.isArray(n)) return n;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(n as Record<string, unknown>)) {
    if (k === 'id' || k === 'component') { out[k] = x; continue; }
    out[k === 'checks' ? '@checks' : k] = k === 'children' && x && typeof x === 'object' && !Array.isArray(x) ? x : bindings(x);
  }
  return out as T;
}

export function normalizeComponent<T>(c: T): T {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return c;
  const o = c as Record<string, unknown>;
  if (o.component === 'Text' && typeof o.variant === 'string' && HEADING[o.variant]) {
    const { variant, ...rest } = o;
    const text = typeof rest.text === 'string' && !/^#{1,6}\s/.test(rest.text) ? `${HEADING[variant as string]}${rest.text}` : rest.text;
    return { ...rest, text } as T;
  }
  // A VegaChart written for A2UI's own vegachart catalog: sua's catalog has the same component (ADR-0089).
  if (o.component === 'VegaChart' && typeof o['@catalogId'] === 'string' && /vegachart/i.test(o['@catalogId'])) {
    const { '@catalogId': _cat, ...rest } = o;
    return rest as T;
  }
  if (o.component === 'TextField' && typeof o.validationRegexp === 'string') {
    const { validationRegexp, ...rest } = o;
    const checks = Array.isArray(rest['@checks']) ? rest['@checks'] : Array.isArray(rest.checks) ? rest.checks : [];
    const { checks: _old, ...kept } = rest;
    return { ...kept, '@checks': [...checks, { condition: { '@call': 'regex', args: { value: rest.value, pattern: validationRegexp } }, message: 'Doesn’t match the expected format.' }] } as T;
  }
  return c;
}

export function normalizeComponents<T>(list: readonly T[]): T[] {
  const fixed = list.map((c) => normalizeComponent(c));
  // Ids 1.0 refuses: renamed (kept unique), and every reference follows.
  const ids = new Set(fixed.map((c) => (c as { id?: unknown })?.id).filter((x): x is string => typeof x === 'string'));
  const renamed = new Map<string, string>();
  for (const id of ids) {
    if (IDENT.test(id)) continue;
    let to = a2uiId(id);
    for (let n = 2; ids.has(to) || [...renamed.values()].includes(to); n++) to = `${a2uiId(id)}_${String(n)}`;
    renamed.set(id, to);
  }
  if (!renamed.size) return fixed;
  const ref = (v: unknown, key: string | undefined): unknown => {
    if (typeof v === 'string') return key && REF_KEYS.has(key) ? renamed.get(v) ?? v : v;
    if (Array.isArray(v)) return v.map((x) => ref(x, key));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, ref(x, k)]));
    return v;
  };
  return fixed.map((c) => {
    if (!c || typeof c !== 'object') return c;
    const o = ref(c, undefined) as Record<string, unknown>;
    return (typeof o.id === 'string' && renamed.has(o.id) ? { ...o, id: renamed.get(o.id) } : o) as T;
  });
}

/** Components as 1.0 draws them (ids made valid, references kept, bindings in 1.0 form): what goes to the browser. */
export function componentsForRender<T>(list: readonly T[]): T[] {
  return normalizeComponents(list).map((c) => componentForRender(c));
}
