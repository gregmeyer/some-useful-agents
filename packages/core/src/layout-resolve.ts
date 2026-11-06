/**
 * A layout as data, resolved for one page: the part of the notebook page
 * mechanism (notebook-layout.ts, ADR-0056) that isn't about notebooks, so a
 * board's page can use it too (board-layout.ts, ADR-0070).
 *
 * A layout is an A2UI document plus two extensions, resolved before the
 * document is validated and sent:
 *
 * - `when: "<flag>"` (or `"!<flag>"`) on any component: drawn only when the
 *   flag holds. A component left out leaves its parent's children, a Columns
 *   loses its width, and a container left empty goes too.
 * - `{ "path": "<prefix>/layout/<key>" }` as a prop value: replaced by that
 *   page's setting, or dropped when there is none.
 *
 * With `data` (the page's data model), a Panel or Disclosure with nothing in
 * it yet (every part under it bound to data that's empty) goes the same way,
 * or stays as a `pending` skeleton while something is still running.
 */
import { validateViewComponents, resolvePointer, type ViewComponent } from './a2ui/view.js';

/** How long a list part may run, so no one part takes over the page. */
export interface ListCap { prop: string; default?: number; max: number }

export interface ResolveLayoutOptions {
  /** The data model's root the layout binds to: `/notebook` or `/board`. */
  prefix: string;
  /** What `when` can test. */
  flags: Readonly<Partial<Record<string, boolean>>>;
  /** The page's settings, for `{ path: "<prefix>/layout/<key>" }` props. */
  values?: Readonly<Partial<Record<string, unknown>>>;
  /** The page's data model; given, empty parts go (or stay as skeletons). */
  data?: unknown;
  /** Something is still running: an empty Panel keeps its place as a skeleton (`pending`). A function says which Panels. */
  pending?: boolean | ((c: ViewComponent) => boolean);
  /** The document as given, before anything else (a chance to add parts). */
  prepare?: (components: readonly ViewComponent[]) => ViewComponent[];
  /** Each kept component, before its values are filled in (strip a page extension, add a prop). */
  part?: (c: ViewComponent) => ViewComponent;
  /** More ways a part can be empty (checked on any component, with `data`). */
  emptyPart?: (c: ViewComponent, data: unknown) => boolean;
  /** Whether an empty Panel may stay as a skeleton (default: when `pending` says so). */
  skeleton?: (c: ViewComponent) => boolean;
  /** List caps by component. */
  caps?: Readonly<Record<string, ListCap>>;
  /** After a component is kept: a chance to drop a side part that doesn't hold (`visit` returns whether a part is kept). */
  after?: (c: ViewComponent, next: ViewComponent, visit: (id: string) => boolean) => void;
}

/** The `{ path: "<prefix>/layout/<key>" }` form. */
export function layoutPathPattern(prefix: string): RegExp {
  return new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\/layout\\/([A-Za-z]+)$`);
}

/** Whether a `when` holds: a flag, or `!flag`. Anything but a string holds. */
export function whenHolds(when: unknown, flags: Readonly<Partial<Record<string, boolean>>>): boolean {
  if (typeof when !== 'string') return true;
  const not = when.startsWith('!');
  const on = !!flags[not ? when.slice(1) : when];
  return not ? !on : on;
}

/** `{ path: "<prefix>/layout/<key>" }` props filled in from `values` (dropped when there's no value). */
export function resolveValues(v: unknown, values: Readonly<Partial<Record<string, unknown>>>, layoutPath: RegExp): unknown {
  if (Array.isArray(v)) return v.map((x) => resolveValues(x, values, layoutPath));
  if (!v || typeof v !== 'object') return v;
  const o = v as Record<string, unknown>;
  if (typeof o.path === 'string' && Object.keys(o).length === 1) {
    const m = layoutPath.exec(o.path);
    if (m) return values[m[1]];
    return v;
  }
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(o)) {
    const r = resolveValues(x, values, layoutPath);
    if (r !== undefined) out[k] = r;
  }
  return out;
}

/** Whether a data value has something to show. */
export const hasSomething = (v: unknown): boolean => (Array.isArray(v) ? v.length > 0 : typeof v === 'string' ? v.trim() !== '' : v !== undefined && v !== null);

export function capLength(c: ViewComponent, caps: Readonly<Record<string, ListCap>>): ViewComponent {
  const cap = caps[c.component];
  if (!cap) return c;
  const v = c[cap.prop];
  // A table that pages is already short.
  if (c.component === 'Table' && c.pageSize !== undefined) return c;
  if (typeof v === 'number') return v > cap.max ? { ...c, [cap.prop]: cap.max } : c;
  return cap.default !== undefined ? { ...c, [cap.prop]: cap.default } : c;
}

/**
 * A part with nothing to show: every data path the parts under it are bound
 * to (not its own title or note, nor the page's settings) is empty. A part
 * bound to nothing is never empty (it says what it says).
 */
export function isEmptyPart(id: string, byId: ReadonlyMap<string, ViewComponent>, data: unknown, layoutPath: RegExp): boolean {
  const paths: string[] = [];
  const collect = (v: unknown) => {
    if (Array.isArray(v)) { v.forEach(collect); return; }
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if (typeof o.path === 'string' && Object.keys(o).length === 1) { if (!layoutPath.test(o.path)) paths.push(o.path); return; }
    Object.values(o).forEach(collect);
  };
  const walk = (cid: string, own: boolean, seen: Set<string>) => {
    const c = byId.get(cid);
    if (!c || seen.has(cid)) return;
    seen.add(cid);
    const { id: _i, component: _c, children, child, title: _t, note: _n, label: _l, ...props } = c;
    collect(own ? props : { ...props, title: c.title, note: c.note, label: c.label });
    for (const k of Array.isArray(children) ? children as string[] : typeof child === 'string' ? [child] : []) walk(k, false, seen);
  };
  walk(id, true, new Set());
  return paths.length > 0 && !paths.some((p) => hasSomething(resolvePointer(data, p)));
}

/**
 * A layout as plain A2UI for one page: components whose `when` doesn't hold
 * are left out (with everything under them), parents lose them (a Columns
 * its width too; one left takes the whole row), containers left empty go,
 * and `<prefix>/layout/<key>` values are filled in. With `data`, a panel or
 * fold with nothing in it yet goes the same way (or stays as a skeleton
 * while something runs), so a drawn page has no empty boxes.
 */
export function resolveLayout(components: readonly ViewComponent[], opts: ResolveLayoutOptions): ViewComponent[] {
  const layoutPath = layoutPathPattern(opts.prefix);
  const values = opts.values ?? {};
  const caps = opts.caps ?? {};
  const all = opts.prepare ? opts.prepare(components) : [...components];
  const byId = new Map(all.map((c) => [c.id, c]));
  const out = new Map<string, ViewComponent>();
  const pendingFor = (c: ViewComponent): boolean => (typeof opts.pending === 'function' ? opts.pending(c) : !!opts.pending);
  const skeleton = opts.skeleton ?? ((c: ViewComponent): boolean => pendingFor(c) && c.component === 'Panel' && typeof c.child === 'string');
  const visit = (id: string, lax = false): boolean => {
    const c = byId.get(id);
    if (!c || !whenHolds(c.when, opts.flags)) return false;
    let pending = false;
    if (!lax && opts.data !== undefined && (c.component === 'Panel' || c.component === 'Disclosure') && isEmptyPart(id, byId, opts.data, layoutPath)) { if (!skeleton(c)) return false; pending = true; }
    if (!lax && !pending && opts.data !== undefined && opts.emptyPart?.(c, opts.data)) return false;
    const kid = c.component === 'Panel' && typeof c.child === 'string' ? byId.get(c.child) : undefined;
    if (!lax && !pending && opts.data !== undefined && kid && skeleton(c) && opts.emptyPart?.(kid, opts.data)) pending = true;
    const { when: _w, ...rest } = opts.part ? opts.part(c) : c;
    if (pending) rest.pending = true;
    const next = capLength(resolveValues(rest, values, layoutPath) as ViewComponent, caps);
    if (Array.isArray(c.children)) {
      const kids = c.children as string[];
      const kept = kids.filter((k) => visit(k, lax || pending));
      if (!kept.length && id !== 'root') return false;
      next.children = kept;
      if (Array.isArray(c.widths) && kept.length !== kids.length) {
        next.widths = kept.length === 1 ? [1] : kept.map((k) => (c.widths as number[])[kids.indexOf(k)] ?? 1);
      }
    } else if (typeof c.child === 'string' && !visit(c.child, lax || pending)) {
      return false;
    }
    opts.after?.(c, next, (sid) => visit(sid));
    out.set(id, next);
    return true;
  };
  visit('root');
  // In the document's own order.
  return all.filter((c) => out.has(c.id)).map((c) => out.get(c.id)!);
}

export interface CheckLayoutOptions {
  /** Whether a `when` names a known flag (without its `!`). */
  knownFlag: (name: string) => boolean;
  /** Says what the flags are, for the error. */
  flagsAre: string;
  /** More checks on the document as given. */
  extra?: (components: Array<Record<string, unknown>>) => string[];
  /** The layout as a page with everything would draw it. */
  resolve: (components: ViewComponent[]) => ViewComponent[];
  /** Validate as a board (its tiles and layout components allowed). */
  board?: boolean;
}

/**
 * Check a layout: as a page with everything would draw it, it must be a
 * valid A2UI view (the catalog's components and props, a root, nothing
 * dangling), and every `when` must name a known flag.
 */
export function checkLayout(components: unknown, opts: CheckLayoutOptions): { ok: true; components: ViewComponent[] } | { ok: false; errors: string[] } {
  if (!Array.isArray(components)) return { ok: false, errors: ['A layout is a list of components.'] };
  const errors: string[] = [];
  for (const c of components as Array<Record<string, unknown>>) {
    if (c && typeof c === 'object' && c.when !== undefined) {
      const w = typeof c.when === 'string' ? c.when.replace(/^!/, '') : '';
      if (!w || !opts.knownFlag(w)) errors.push(`${String(c.id)}: "when" must be ${opts.flagsAre} (or !one).`);
    }
  }
  if (opts.extra) errors.push(...opts.extra(components as Array<Record<string, unknown>>));
  if (errors.length) return { ok: false, errors };
  const v = validateViewComponents(opts.resolve(components as ViewComponent[]), opts.board ? { board: true } : {});
  if (!v.ok) return v;
  return { ok: true, components: components as ViewComponent[] };
}
