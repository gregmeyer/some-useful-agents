/**
 * A notebook as an A2UI 1.0 surface for an MCP host that draws A2UI
 * (ADR-0090). A host has the A2UI basic catalog, not sua's, so this is a
 * compact page in basic components only: the title, what it's for, where it
 * stands (the answer, the plan, the decision), what it rests on, the options
 * in the running, what's still open and the done-whens.
 *
 * Over MCP it travels as A2UI's MCP binding has it: the layout once, as the
 * `a2ui://notebook` resource (`application/a2ui+json`), and each notebook's
 * data as an `updateDataModel` message in notebook-read's result, which names
 * that resource in `_meta.ui.resourceUri`. Pure.
 */
import type { NotebookReadoutJson } from '../notebook-readout.js';

export const NOTEBOOK_SURFACE_URI = 'a2ui://notebook';
export const A2UI_MIME = 'application/a2ui+json';
export const NOTEBOOK_SURFACE_ID = 'sua_notebook';
const BASIC_CATALOG_ID = 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json';

const text = (id: string, path: string, variant?: 'caption' | 'body') => ({ id, component: 'Text', text: { '@path': path }, ...(variant ? { variant } : {}) });
const list = (id: string, path: string, item: string) => ({ id, component: 'List', children: { path, componentId: item } });

/** The layout: createSurface and updateComponents, every value bound to the data (`notebookSurfaceData`). */
export function notebookSurfaceTemplate(): Array<Record<string, unknown>> {
  const components = [
    { id: 'root', component: 'Column', children: ['title', 'purpose', 'stands', 'lead', 'rests_h', 'rests', 'options_h', 'options', 'open_h', 'open', 'done_h', 'done', 'link'] },
    text('title', '/title'),
    text('purpose', '/for', 'caption'),
    text('stands', '/stands', 'caption'),
    text('lead', '/lead'),
    text('rests_h', '/labels/rests'), list('rests', '/rests', 'rests_item'), text('rests_item', 'text'),
    text('options_h', '/labels/options'), list('options', '/options', 'option_item'), text('option_item', 'text'),
    text('open_h', '/labels/open'), list('open', '/open', 'open_item'), text('open_item', 'text'),
    text('done_h', '/labels/done'), list('done', '/done', 'done_item'), text('done_item', 'text'),
    text('link', '/link', 'caption'),
  ];
  return [
    { version: '1.0', createSurface: { surfaceId: NOTEBOOK_SURFACE_ID, catalogId: BASIC_CATALOG_ID } },
    { version: '1.0', updateComponents: { surfaceId: NOTEBOOK_SURFACE_ID, components } },
  ];
}

const items = (xs: readonly string[]) => xs.filter(Boolean).map((t) => ({ text: t }));

/** One notebook's data for the layout, as the updateDataModel message notebook-read returns. `base`: the dashboard's address, for its link. */
export function notebookSurfaceData(j: NotebookReadoutJson, base = ''): Record<string, unknown> {
  const a = j.answer, p = j.plan, b = j.briefing;
  const stands = a ? `${a.writeup ? 'Write-up' : 'Answer'} · ${a.confidence} confidence` : p ? 'Plan' : j.decision ? 'Decided' : b ? 'Briefing' : j.status === 'active' ? 'In progress' : j.status;
  const lead = a?.text ?? p?.summary ?? j.decision ?? b?.points[0]?.text ?? (j.options ? `${String(j.options.inTheRunning.length)} in the running` : '');
  const rests = a ? a.findings : p ? p.items.map((i) => `**${i.when}** ${i.title}`) : b ? b.points.map((x) => x.text) : [];
  const options = (j.options?.inTheRunning ?? []).slice(0, 10).map((o) => {
    const facts = Object.entries(o.facts).slice(0, 4).map(([k, v]) => `${k} ${v}`).join(' · ');
    return `**${o.title}**${o.picked ? ' (chosen)' : ''}${facts ? ` · ${facts}` : ''}`;
  });
  const open = [...(a?.open ?? []), ...(p?.open ?? []), ...(b?.questions ?? [])].slice(0, 6);
  const done = j.doneWhen.map((c) => `${c.met ? '✓' : '○'} ${c.text}`);
  const value = {
    title: `## ${j.title}`, for: j.for, stands, lead,
    rests: items(rests), options: items(options), open: items(open), done: items(done),
    labels: {
      rests: rests.length ? (a ? '**What it rests on**' : p ? '**The plan**' : '**Talking points**') : '',
      options: options.length ? `**In the running** (${String(j.options!.inTheRunning.length)})` : '',
      open: open.length ? '**Still open**' : '',
      done: done.length ? '**Done when**' : '',
    },
    link: `${base}${j.link}`,
  };
  return { version: '1.0', updateDataModel: { surfaceId: NOTEBOOK_SURFACE_ID, path: '/', value } };
}
