import { sanitizeHtml, substitutePlaceholders, type AgentSignal, type OutputWidgetSchema, type ViewComponent } from '@some-useful-agents/core';
import { normalizeSignal } from '../views/pulse-templates.js';
import { extractField, parseJsonFromOutput } from '../views/output-widgets.js';

/**
 * Converts the pre-A2UI widgets (a `signal` template + mapping, an
 * `outputWidget`) into an A2UI view (W3, docs/a2ui-views.md), so everything can
 * draw through one renderer.
 *
 * The values aren't re-derived: the same extraction the old renderers use
 * (slot mapping, field extraction, ai-template substitution + sanitizing) runs
 * here on the server and lands in the view's data at `/data/...`; the view
 * only lays them out. So a converted widget shows exactly the old values.
 *
 * Anything the catalog can't express yet returns `{ unsupported }` with the
 * reason, and the caller keeps the old renderer.
 */
export type LegacyView =
  | { components: ViewComponent[]; data: Record<string, unknown> }
  | { unsupported: string };

type C = ViewComponent;
const text = (id: string, value: unknown, variant?: string): C => ({ id, component: 'Text', text: value as never, ...(variant ? { variant } : {}) });
const col = (id: string, children: string[]): C => ({ id, component: 'Column', children });
const row = (id: string, children: string[]): C => ({ id, component: 'Row', children });
const bind = (path: string) => ({ path });

function str(v: unknown): string {
  if (v === undefined || v === null) return '';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

/** Status words → a tone (same buckets as the status template). */
export function statusTone(status: unknown): 'ok' | 'warn' | 'err' | 'neutral' {
  const s = String(status ?? '').toLowerCase();
  if (['healthy', 'ok', 'up', 'pass', 'passing', 'success', 'green'].includes(s)) return 'ok';
  if (['degraded', 'warn', 'warning', 'slow', 'yellow'].includes(s)) return 'warn';
  if (['down', 'error', 'failed', 'failing', 'critical', 'red', 'fail'].includes(s)) return 'err';
  return 'neutral';
}

/** A metric's tone from `signal.thresholds` (first match wins; same rule as the tile palette in views/pulse.ts). */
function thresholdTone(signal: AgentSignal, value: number): 'ok' | 'warn' | 'err' | 'neutral' | undefined {
  const toneOf = (palette: string) => (/green/.test(palette) ? 'ok' : /orange|yellow|amber/.test(palette) ? 'warn' : /red/.test(palette) ? 'err' : 'neutral');
  if (signal.thresholds?.length && Number.isFinite(value)) {
    for (const t of signal.thresholds) {
      if ((t.above !== undefined && value > t.above) || (t.below !== undefined && value < t.below)) return toneOf(t.palette);
    }
  }
  // No threshold matched: the signal's own accent, when it's a status colour.
  const accentTone = signal.accent ? toneOf(String(signal.accent)) : 'neutral';
  return accentTone === 'neutral' ? undefined : accentTone;
}

/** A signal template + its resolved slot values (views/pulse-templates extractMappedValues). */
export function legacySignalView(signal: AgentSignal, slots: Record<string, unknown>): LegacyView {
  const { template } = normalizeSignal(signal);
  const data: Record<string, unknown> = { slots: { ...slots } };
  const s = (name: string) => bind(`/data/slots/${name}`);
  const has = (name: string) => slots[name] !== undefined && slots[name] !== null && slots[name] !== '';
  switch (template) {
    case 'metric': {
      const prev = Number(slots.previous); const cur = Number(slots.value);
      const tone = thresholdTone(signal, cur);
      if (tone) (data.slots as Record<string, unknown>)._tone = tone;
      if (has('previous') && Number.isFinite(prev) && Number.isFinite(cur)) {
        const d = cur - prev;
        (data.slots as Record<string, unknown>)._delta = `${d >= 0 ? '+' : ''}${Number(d.toFixed(2))} vs previous`;
      }
      return { data, components: [{
        id: 'root', component: 'Metric', label: has('label') ? s('label') : signal.title, value: s('value'),
        ...(has('unit') ? { unit: s('unit') } : {}),
        ...((data.slots as Record<string, unknown>)._delta ? { delta: s('_delta') } : {}),
        ...(tone ? { tone: s('_tone') } : {}),
      }] };
    }
    case 'text-headline':
    case undefined: {
      const kids = ['headline', ...(has('body') ? ['body'] : [])];
      return { data, components: [col('root', kids), text('headline', s('headline'), 'h4'), ...(has('body') ? [text('body', s('body'))] : [])] };
    }
    case 'status': {
      (data.slots as Record<string, unknown>)._tone = statusTone(slots.status);
      const kids = ['badge', ...(has('label') ? ['label'] : []), ...(has('message') ? ['message'] : [])];
      return { data, components: [
        col('root', kids),
        { id: 'badge', component: 'Badge', text: s('status'), tone: s('_tone') },
        ...(has('label') ? [text('label', s('label'), 'h5')] : []),
        ...(has('message') ? [text('message', s('message'))] : []),
      ] };
    }
    case 'comparison': {
      const kids = [...(has('title') ? ['title'] : []), 'sides'];
      return { data, components: [
        col('root', kids),
        ...(has('title') ? [text('title', s('title'), 'h5')] : []),
        row('sides', ['left', 'right']),
        { id: 'left', component: 'Metric', label: s('left_label'), value: s('left_value') },
        { id: 'right', component: 'Metric', label: s('right_label'), value: s('right_value') },
      ] };
    }
    case 'key-value': {
      let pairs: unknown = slots.pairs;
      if (typeof pairs === 'string') { try { pairs = JSON.parse(pairs); } catch { pairs = []; } }
      const items = Array.isArray(pairs)
        ? pairs.map((p) => (p && typeof p === 'object'
          ? { label: str((p as Record<string, unknown>).label ?? (p as Record<string, unknown>).key), value: str((p as Record<string, unknown>).value) }
          : { label: '', value: str(p) }))
        : pairs && typeof pairs === 'object'
          ? Object.entries(pairs as Record<string, unknown>).map(([k, v]) => ({ label: k, value: str(v) }))
          : [];
      (data.slots as Record<string, unknown>)._items = items;
      return { data, components: [
        col('root', [...(has('title') ? ['title'] : []), 'kv']),
        ...(has('title') ? [text('title', s('title'), 'h5')] : []),
        { id: 'kv', component: 'KeyValue', items: s('_items') },
      ] };
    }
    case 'story': {
      const kids = [...(has('time_period') ? ['when'] : []), 'what', ...(has('what_it_means') ? ['means'] : [])];
      return { data, components: [
        col('root', kids),
        ...(has('time_period') ? [text('when', s('time_period'), 'caption')] : []),
        text('what', s('what_changed'), 'h5'),
        ...(has('what_it_means') ? [text('means', s('what_it_means'))] : []),
      ] };
    }
    case 'table': {
      let rows: unknown = slots.rows;
      if (typeof rows === 'string') { try { rows = JSON.parse(rows); } catch { rows = []; } }
      if (!Array.isArray(rows)) rows = [];
      const list = rows as unknown[];
      const objects = list.map((r) => (r && typeof r === 'object' && !Array.isArray(r) ? r as Record<string, unknown> : { value: r }));
      const named = Array.isArray(slots.columns) ? (slots.columns as unknown[]).map(String) : undefined;
      const keys = (named?.length ? named : Object.keys(objects[0] ?? { value: '' })).slice(0, 12);
      if (keys.length === 0) return { unsupported: 'table has no columns' };
      (data.slots as Record<string, unknown>)._rows = objects;
      return { data, components: [{
        id: 'root', component: 'Table', rows: s('_rows'),
        columns: keys.map((k) => ({ key: k, label: k, ...(objects.some((o) => /^https?:\/\//.test(str(o[k]))) ? { format: 'link' } : {}) })),
      }] };
    }
    case 'time-series': {
      let values: unknown = slots.values;
      if (typeof values === 'string') { try { values = JSON.parse(values); } catch { values = []; } }
      (data.slots as Record<string, unknown>)._values = Array.isArray(values) ? values : [];
      return { data, components: [{
        id: 'root', component: 'Sparkline', values: s('_values'),
        label: has('label') ? s('label') : signal.title,
        ...(has('current') ? { current: s('current') } : {}),
      }] };
    }
    case 'funnel': {
      let stages: unknown = slots.stages;
      if (typeof stages === 'string') { try { stages = JSON.parse(stages); } catch { stages = []; } }
      (data.slots as Record<string, unknown>)._stages = Array.isArray(stages) ? stages : [];
      return { data, components: [{ id: 'root', component: 'Funnel', stages: s('_stages') }] };
    }
    case 'image':
      return { data, components: [{ id: 'root', component: 'Image', url: s('imageUrl'), ...(has('alt') ? { description: s('alt') } : {}), fit: 'cover' }] };
    case 'text-image':
      return { data, components: [
        row('root', ['img', 'txt']),
        { id: 'img', component: 'Image', url: s('imageUrl'), fit: 'cover', variant: 'mediumFeature' },
        text('txt', s('text')),
      ] };
    case 'media': {
      const url = String(slots.url ?? '');
      // YouTube / Vimeo are embedded by the old renderer (a frame A2UI doesn't have).
      if (/youtube\.com|youtu\.be|vimeo\.com/i.test(url)) return { unsupported: 'the "media" template with a YouTube/Vimeo link' };
      const isVideo = slots.mediaType === 'video' || /\.(mp4|webm|mov)(\?|$)/i.test(url);
      const kids = [...(has('title') ? ['title'] : []), 'm', ...(has('caption') ? ['caption'] : [])];
      return { data, components: [
        col('root', kids),
        ...(has('title') ? [text('title', s('title'), 'h5')] : []),
        isVideo ? { id: 'm', component: 'Video', url: s('url') } : { id: 'm', component: 'Image', url: s('url'), fit: 'cover' },
        ...(has('caption') ? [text('caption', s('caption'), 'caption')] : []),
      ] };
    }
    default:
      return { unsupported: `the "${template}" template` };
  }
}

/** Control types that don't change what a static widget shows (handled around the tile). */
const PASSIVE_CONTROLS = new Set(['replay', 'copy', 'capture-image']);

/** An outputWidget for one run's output (the text the old renderer gets). */
export function legacyWidgetView(widget: OutputWidgetSchema, output: string): LegacyView {
  // The dashboard widget maps sort/filter/paginate onto its tables, view-switch
  // onto Tabs and field-toggle onto Disclosures; other widget types can't.
  const active = (widget.controls ?? []).filter((c) => !PASSIVE_CONTROLS.has(c.type));
  if (active.length && widget.type !== 'dashboard') return { unsupported: `widget controls (${[...new Set(active.map((c) => c.type))].join(', ')})` };
  const fields: Record<string, string> = {};
  for (const f of widget.fields ?? []) {
    const v = extractField(output, f.name);
    if (v !== undefined) fields[f.name] = v;
  }
  const data: Record<string, unknown> = { fields };
  const fieldPath = (name: string) => bind(`/data/fields/${name}`);
  const shown = (widget.fields ?? []).filter((f) => f.type === 'table' || fields[f.name] !== undefined);
  if (shown.some((f) => f.type === 'action')) return { unsupported: 'action fields' };
  // A preview field (a file the run wrote) becomes a link to the dashboard's file viewer.
  const previews: Record<string, string> = {};
  for (const f of shown) if (f.type === 'preview' && fields[f.name]) previews[f.name] = `/output-file?path=${encodeURIComponent(fields[f.name])}`;
  if (Object.keys(previews).length) data.previews = previews;
  const previewLink = (f: { name: string; label?: string }, cid: string): C =>
    ({ id: cid, component: 'Link', text: `Open ${f.label ?? f.name}`, url: bind(`/data/previews/${f.name}`) });
  const id = (f: { name: string }, suffix = '') => `f_${f.name.replace(/[^\w-]/g, '_')}${suffix}`;

  switch (widget.type) {
    case 'ai-template': {
      if (!widget.template) return { unsupported: 'an ai-template with no template' };
      // The old renderer's substitution, server-side; SanitizedHtml re-sanitizes before sending.
      let parsed: unknown;
      parsed = parseJsonFromOutput(output);
      const outputs: Record<string, unknown> = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...(parsed as object) } : {};
      Object.assign(outputs, fields);
      const re = /\{\{\s*outputs\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
      for (let m = re.exec(widget.template); m; m = re.exec(widget.template)) {
        if (outputs[m[1]] === undefined) { const v = extractField(output, m[1]); if (v !== undefined) outputs[m[1]] = v; }
      }
      data.html = sanitizeHtml(substitutePlaceholders(widget.template, { outputs, result: output }));
      return { data, components: [{ id: 'root', component: 'SanitizedHtml', html: bind('/data/html') }] };
    }
    case 'key-value': {
      data.items = shown.filter((f) => f.type !== 'preview').map((f) => ({ label: f.label ?? f.name, value: fields[f.name] ?? '' }));
      const links = shown.filter((f) => f.type === 'preview' && previews[f.name]);
      if (!links.length) return { data, components: [{ id: 'root', component: 'KeyValue', items: bind('/data/items') }] };
      return { data, components: [col('root', ['kv', ...links.map((f) => id(f))]), { id: 'kv', component: 'KeyValue', items: bind('/data/items') }, ...links.map((f) => previewLink(f, id(f)))] };
    }
    case 'raw': {
      const comps: C[] = [];
      const kids: string[] = [];
      for (const f of shown) {
        kids.push(id(f));
        if (f.type === 'preview') {
          comps.push(previewLink(f, id(f)));
        } else if (f.type === 'code') {
          comps.push(col(id(f), [id(f, '_l'), id(f, '_v')]), text(id(f, '_l'), f.label ?? f.name, 'caption'), { id: id(f, '_v'), component: 'Code', text: fieldPath(f.name) });
        } else if (f.type === 'badge') {
          comps.push(row(id(f), [id(f, '_l'), id(f, '_v')]), text(id(f, '_l'), `${f.label ?? f.name}:`, 'caption'), { id: id(f, '_v'), component: 'Badge', text: fieldPath(f.name) });
        } else {
          comps.push(col(id(f), [id(f, '_l'), id(f, '_v')]), text(id(f, '_l'), f.label ?? f.name, 'caption'), text(id(f, '_v'), fieldPath(f.name)));
        }
      }
      if (!kids.length) return { unsupported: 'a widget with no fields in this output' };
      return { data, components: [col('root', kids), ...comps] };
    }
    case 'dashboard': {
      const parsed = parseJsonFromOutput(output);
      const arrays: Record<string, unknown> = {};
      const controls = widget.controls ?? [];
      const tableFields = new Set(shown.filter((f) => f.type === 'table').map((f) => f.name));
      // sort / filter / paginate: props on the table they name.
      const tableProps: Record<string, Record<string, unknown>> = {};
      for (const c of controls) {
        if (c.type !== 'sort' && c.type !== 'filter' && c.type !== 'paginate') continue;
        if (!tableFields.has(c.field)) return { unsupported: `a ${c.type} control on "${c.field}", which isn't a table field` };
        const p = (tableProps[c.field] ??= {});
        if (c.type === 'sort') { p.sortColumns = c.columns.slice(0, 12); if (c.default) p.defaultSort = c.default; }
        if (c.type === 'filter') { p.filterColumns = c.columns.slice(0, 12); if (c.placeholder) p.filterPlaceholder = c.placeholder; }
        if (c.type === 'paginate') p.pageSize = Math.min(200, Math.max(1, c.pageSize));
      }
      const comps: C[] = [];
      const made = new Set<string>();
      /** Components for one field (ids suffixed so a field can appear in several tabs). */
      const fieldComp = (f: (typeof shown)[number], sfx: string): { cid: string; slot: 'top' | 'stats' | 'rest' } => {
        const label = f.label ?? f.name;
        const cid = id(f, sfx);
        const push = (...cs: C[]) => { if (!made.has(cid)) { comps.push(...cs); made.add(cid); } };
        if (f.type === 'table') {
          if (!(f.name in arrays)) {
            const value = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>)[f.name] : undefined;
            arrays[f.name] = Array.isArray(value) ? value : [];
          }
          const cols = (f.columns ?? []).length
            ? (f.columns ?? []).map((c) => ({ key: c.name, label: c.label ?? c.name, ...(c.format === 'link' ? { format: 'link' } : {}) }))
            : Object.keys((arrays[f.name] as Record<string, unknown>[])[0] ?? { value: '' }).slice(0, 12).map((k) => ({ key: k, label: k }));
          push(col(cid, [`${cid}_l`, `${cid}_t`]), text(`${cid}_l`, label, 'caption'),
            { id: `${cid}_t`, component: 'Table', rows: bind(`/data/arrays/${f.name}`), columns: cols, ...(tableProps[f.name] ?? {}) });
          return { cid, slot: 'rest' };
        }
        if (f.type === 'metric') { push({ id: cid, component: 'Metric', label, value: fieldPath(f.name) }); return { cid, slot: 'top' }; }
        if (f.type === 'badge') {
          push(col(cid, [`${cid}_v`, `${cid}_l`]), { id: `${cid}_v`, component: 'Badge', text: fieldPath(f.name) }, text(`${cid}_l`, label, 'caption'));
          return { cid, slot: 'top' };
        }
        if (f.type === 'stat') { push({ id: cid, component: 'Metric', label, value: fieldPath(f.name) }); return { cid, slot: 'stats' }; }
        if (f.type === 'preview') { push(previewLink(f, cid)); return { cid, slot: 'rest' }; }
        if (f.type === 'code') {
          push(col(cid, [`${cid}_l`, `${cid}_v`]), text(`${cid}_l`, label, 'caption'), { id: `${cid}_v`, component: 'Code', text: fieldPath(f.name) });
          return { cid, slot: 'rest' };
        }
        push(col(cid, [`${cid}_l`, `${cid}_v`]), text(`${cid}_l`, label, 'caption'), text(`${cid}_v`, fieldPath(f.name)));
        return { cid, slot: 'rest' };
      };
      /** The old layout for a set of fields: hero metrics/badges in a row, stats in a row, the rest stacked. */
      const layout = (fs: typeof shown, sfx: string): string | undefined => {
        const top: string[] = []; const stats: string[] = []; const rest: string[] = [];
        for (const f of fs) { const { cid, slot } = fieldComp(f, sfx); (slot === 'top' ? top : slot === 'stats' ? stats : rest).push(cid); }
        const groups: string[] = [];
        if (top.length) { comps.push(row(`top${sfx}`, top)); groups.push(`top${sfx}`); }
        if (stats.length) { comps.push(row(`stats${sfx}`, stats)); groups.push(`stats${sfx}`); }
        groups.push(...rest);
        if (!groups.length) return undefined;
        comps.push(col(`body${sfx}`, groups));
        return `body${sfx}`;
      };
      // field-toggle: those fields move into a Disclosure (open when default is "shown").
      const toggles = controls.filter((c): c is Extract<typeof c, { type: 'field-toggle' }> => c.type === 'field-toggle');
      const toggled = new Set(toggles.flatMap((t) => t.fields));
      // view-switch: one tab per view (default first); fields in no view stay above the tabs.
      const sw = controls.find((c): c is Extract<typeof c, { type: 'view-switch' }> => c.type === 'view-switch');
      const inViews = new Set(sw ? sw.views.flatMap((v) => v.fields) : []);
      const parts: string[] = [];
      const always = layout(shown.filter((f) => !toggled.has(f.name) && !inViews.has(f.name)), '');
      if (always) parts.push(always);
      if (sw) {
        const views = [...sw.views].sort((x, y) => (x.id === sw.default ? -1 : y.id === sw.default ? 1 : 0));
        const tabs = views.map((v) => ({ v, body: layout(shown.filter((f) => v.fields.includes(f.name) && !toggled.has(f.name)), `_v_${v.id.replace(/[^\w-]/g, '_')}`) }))
          .filter((t): t is { v: (typeof views)[number]; body: string } => !!t.body);
        if (tabs.length) { comps.push({ id: 'views', component: 'Tabs', tabs: tabs.map((t) => ({ title: t.v.id, child: t.body })) }); parts.push('views'); }
      }
      toggles.forEach((t, i) => {
        const body = layout(shown.filter((f) => t.fields.includes(f.name)), `_t${i}`);
        if (body) { comps.push({ id: `toggle${i}`, component: 'Disclosure', label: t.label, child: body, open: t.default === 'shown' }); parts.push(`toggle${i}`); }
      });
      data.arrays = arrays;
      if (!parts.length) return { unsupported: 'a widget with no fields in this output' };
      return { data, components: [col('root', parts), ...comps] };
    }
    default:
      return { unsupported: `the "${widget.type}" widget` };
  }
}

/**
 * An interactive widget's tile: the last result (the static conversion, when
 * there is one) above a form for the agent's inputs and a Run button. The
 * button sends a `run-agent` A2UI action ({agent, in_<NAME>: value}); the page runs
 * the agent in place (views/widget-replay.js.ts).
 */
export function legacyInteractiveView(args: {
  agentId: string;
  inputs: Record<string, { type?: string; values?: Array<string | number>; default?: unknown; description?: string }>;
  widget: OutputWidgetSchema;
  /** The last completed run's output, if any. */
  lastOutput?: string;
  previousInputs?: Record<string, string>;
}): LegacyView {
  const { widget } = args;
  const names = Object.keys(args.inputs).filter((n) => !widget.runInputs?.length || widget.runInputs.includes(n));
  let result: LegacyView | undefined;
  if (args.lastOutput !== undefined) {
    result = legacyWidgetView(widget, args.lastOutput);
    if ('unsupported' in result) return result;
  }
  const form: Record<string, unknown> = {};
  const comps: C[] = [];
  const fieldIds: string[] = [];
  for (const name of names) {
    const spec = args.inputs[name];
    const prior = args.previousInputs?.[name] ?? (spec.default !== undefined ? String(spec.default) : '');
    const fid = `in_${name.replace(/[^\w-]/g, '_')}`;
    fieldIds.push(fid);
    const label = spec.description ? `${name}: ${spec.description}` : name;
    if (spec.type === 'enum' && spec.values?.length || spec.type === 'boolean') {
      const values = spec.type === 'boolean' ? ['true', 'false'] : (spec.values ?? []).map(String);
      form[name] = [values.includes(prior) ? prior : values[0]];
      comps.push({ id: fid, component: 'ChoicePicker', label, variant: 'mutuallyExclusive', displayStyle: 'chips',
        options: values.map((v) => ({ label: v, value: v })), value: bind(`/data/form/${name}`) });
    } else {
      form[name] = prior;
      comps.push({ id: fid, component: 'TextField', label, value: bind(`/data/form/${name}`), ...(spec.type === 'number' ? { variant: 'number' } : {}) });
    }
  }
  const runLabel = args.lastOutput !== undefined ? widget.replayLabel ?? 'Run again' : widget.askLabel ?? 'Run';
  comps.push(
    { id: 'run', component: 'Button', variant: 'primary', child: 'run_label', action: { event: {
      name: 'run-agent',
      // A2UI action context values are flat (a literal or one binding each),
      // so each input travels as `in_<NAME>`.
      context: { agent: args.agentId, ...Object.fromEntries(names.map((n) => [`in_${n}`, bind(`/data/form/${n}`)])) },
    } } },
    text('run_label', runLabel),
  );
  const resultKids: string[] = [];
  const out: C[] = [];
  const data: Record<string, unknown> = { form };
  if (result && !('unsupported' in result)) {
    // Re-root the static view under this one.
    for (const c of result.components) out.push(c.id === 'root' ? { ...c, id: 'result' } : c);
    Object.assign(data, result.data);
    resultKids.push('result');
  }
  return { data, components: [col('root', [...resultKids, ...fieldIds, 'run']), ...out, ...comps] };
}
