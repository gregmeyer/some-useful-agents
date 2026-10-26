/**
 * The brief of a notebook whose page was drawn for it (a meeting briefing, a
 * report): its own page, in its order and treatments, as one self-contained
 * file to share or print. Each part of the page prints as plain HTML (no
 * scripts): a cover, ruled facts, the agenda with its numerals, what they
 * said, tables and lists in full where the page cuts them short. The
 * extended brief adds everything behind it: every quote with its source,
 * every fact with its page, each option in full. A shortlist keeps the
 * shortlist brief (notebook-brief.ts).
 */
import { meetingWhenWords } from '../lib/notebook-edit.js';
import { resolveNotebookLayout, resolvePointer, splitNotebookHeader, notebookLayoutOf, type Notebook, type NotebookEntry, type ViewComponent } from '@some-useful-agents/core';
import { html, render, unsafeHtml, type SafeHtml } from './html.js';
import { notebookLayoutFlags, notebookLayoutValues, notebookWidgetData, emptyPartsGo, type NotebookWidgetHistory } from '../lib/notebook-widgets.js';
import { optionInFull, type BriefPicture } from './notebook-brief.js';
import type { NotebookOptionHistory } from '../lib/notebook-option.js';

/** Whether a notebook's brief is its drawn page (not the shortlist). */
export function briefIsPage(nb: Pick<Notebook, 'layout'>): boolean {
  return !!nb.layout && nb.layout.preset !== 'shortlist';
}

type Data = ReturnType<typeof notebookWidgetData>;

const isUrl = (u: unknown): u is string => typeof u === 'string' && /^https?:\/\//i.test(u);
const site = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const fmtDate = (d: Date) => d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
const boldOnly = (s: string): SafeHtml => html`${s.split(/\*\*([^*\n]+)\*\*/).map((part, i) => (i % 2 ? html`<strong>${part}</strong>` : html`${part}`)) as unknown as SafeHtml[]}`;
const monogram = (name: string) => name.normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
const text = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const items = (v: unknown): Array<Record<string, unknown> & { text: string }> => list(v)
  .map((x) => (typeof x === 'string' ? { text: x } : x && typeof x === 'object' ? { ...(x as Record<string, unknown>), text: text((x as { text?: unknown; label?: unknown }).text ?? (x as { label?: unknown }).label) } : { text: '' }))
  .filter((x) => x.text);

/** Up to `n` quotes, in their order, one per theme (group) before a second from any. Pure. */
export function briefQuotes<T extends { group?: unknown }>(all: readonly T[], n: number): T[] {
  const picked = new Set<number>();
  for (let round = 0; picked.size < Math.min(n, all.length); round++) {
    const seen = new Map<string, number>();
    all.forEach((q, i) => {
      const g = typeof q.group === 'string' ? q.group : '';
      const k = (seen.get(g) ?? 0) + 1;
      seen.set(g, k);
      if (picked.size < n && k === round + 1) picked.add(i);
    });
  }
  return all.filter((_, i) => picked.has(i));
}

interface Printing {
  byId: Map<string, ViewComponent>;
  data: Data;
  full: boolean;
  /** A kept picture of who it's about, as the file can carry it (embedded when saved). */
  about: (src: string) => string | undefined;
}

/** A prop's value: a literal, or bound to the notebook's data. */
function val(p: Printing, v: unknown): unknown {
  if (v && typeof v === 'object' && !Array.isArray(v) && typeof (v as { path?: unknown }).path === 'string') return resolvePointer(p.data, (v as { path: string }).path);
  return v;
}

function kids(c: ViewComponent): string[] {
  return [...(Array.isArray(c.children) ? c.children as string[] : []), ...(typeof c.child === 'string' ? [c.child] : [])];
}

function node(p: Printing, id: string | undefined): SafeHtml {
  const c = id ? p.byId.get(id) : undefined;
  if (!c) return html``;
  const v = (k: string) => val(p, c[k]);
  switch (c.component) {
    case 'Column': case 'Card': return html`<div class="stack">${kids(c).map((k) => node(p, k)) as unknown as SafeHtml[]}</div>`;
    case 'Row': return html`<div class="row">${kids(c).map((k) => node(p, k)) as unknown as SafeHtml[]}</div>`;
    case 'Columns': {
      const ks = kids(c);
      const w = ks.map((_, i) => Number((c.widths as number[] | undefined)?.[i] ?? 1));
      return html`<div class="cols" style="grid-template-columns: ${w.map((n) => `minmax(0, ${String(n)}fr)`).join(' ')}">${ks.map((k) => html`<div>${node(p, k)}</div>`) as unknown as SafeHtml[]}</div>`;
    }
    case 'Panel': {
      const t = text(c.treatment) || 'plain';
      return html`<section class="part part--${t}"><div class="part__head"><h2>${text(v('title'))}</h2>${text(v('note')) ? html`<span class="part__note">${text(v('note'))}</span>` : html``}</div>${node(p, c.child as string)}</section>`;
    }
    case 'Disclosure': return html`<section class="part part--aside"><div class="part__head"><h2>${text(v('label'))}</h2></div>${node(p, c.child as string)}</section>`;
    case 'Callout': return html`<div class="callout">${text(v('label')) ? html`<div class="eyebrow">${text(v('label'))}</div>` : html``}<p>${boldOnly(text(v('text')))}</p>${text(v('next')) ? html`<p class="muted"><b>${text(v('nextLabel')) || 'Next:'}</b> ${text(v('next'))}</p>` : html``}</div>`;
    case 'Text': return html`<p>${text(v('text'))}</p>`;
    case 'Metric': return html`<p class="metric"><span class="eyebrow">${text(v('label'))}</span> <b>${text(v('value'))}${text(v('unit'))}</b></p>`;
    case 'Badge': return html`<span class="chip">${text(v('text'))}</span>`;
    case 'Link': return isUrl(v('url')) ? html`<a href="${v('url') as string}">${text(v('text')) || site(v('url') as string)}</a>` : html``;
    case 'ChipList': return html`<p class="chips">${items(v('items')).map((x) => html`<span class="chip">${x.text}</span>`) as unknown as SafeHtml[]}</p>`;
    case 'KeyValue': return html`<dl class="kv">${list(v('items')).map((x) => { const o = x as { label?: unknown; value?: unknown }; return html`<dt>${text(o.label)}</dt><dd>${text(o.value)}</dd>`; }) as unknown as SafeHtml[]}</dl>`;
    case 'StatStrip': return html`<p class="stats">${list(v('items')).map((x) => { const o = x as { label?: unknown; value?: unknown }; return html`<span><b>${text(o.value)}</b> ${text(o.label)}</span>`; }) as unknown as SafeHtml[]}</p>`;
    case 'ProfileCard': {
      const name = text(v('name'));
      if (!name) return html``;
      const src = text(v('image'));
      const img = src ? p.about(src) : undefined;
      const from = v('imageFrom');
      const links = list(v('links')).map((l) => (typeof l === 'string' ? { url: l, label: '' } : l as { url?: unknown; label?: unknown })).filter((l) => isUrl(l.url));
      const cover = c.variant === 'cover';
      return html`<div class="profile${cover ? ' profile--cover' : ''}">
        ${img ? html`<img class="profile__pic" src="${img}" alt="Photo of ${name}">` : html`<div class="profile__pic profile__mono" aria-hidden="true">${monogram(name)}</div>`}
        <div>
          <div class="profile__name">${name}</div>
          ${text(v('role')) || text(v('org')) ? html`<div class="muted">${text(v('role'))}${text(v('role')) && text(v('org')) ? ' · ' : ''}${text(v('org')) ? html`<b>${text(v('org'))}</b>` : html``}</div>` : html``}
          ${text(v('about')) ? html`<p>${text(v('about'))}</p>` : html``}
          ${links.length ? html`<p class="links">${links.map((l) => html`<a href="${l.url as string}">${text(l.label) || site(l.url as string)}</a>`) as unknown as SafeHtml[]}</p>` : html``}
          ${img && isUrl(from) ? html`<p class="fine">Photo: <a href="${from}">${site(from)}</a></p>` : html``}
        </div>
        ${text(v('quote')) ? html`<blockquote class="pull">${text(v('quote'))}</blockquote>` : html``}
      </div>`;
    }
    case 'FactSheet': {
      const facts = list(v('facts')) as Array<{ label?: unknown; value?: unknown; url?: unknown; group?: unknown }>;
      const groups: Array<{ g: string; f: typeof facts }> = [];
      for (const f of facts) { const g = text(f.group); const at = groups.find((x) => x.g === g); if (at) at.f.push(f); else groups.push({ g, f: [f] }); }
      const missing = items(v('missing')).map((x) => x.text);
      return html`<div class="facts">${groups.map((x) => html`${x.g ? html`<div class="eyebrow">${x.g}</div>` : html``}<dl>${x.f.map((f) => html`<dt>${text(f.label)}</dt><dd>${text(f.value)}${isUrl(f.url) ? html` <a class="src" href="${f.url}">${site(f.url)}</a>` : html``}</dd>`) as unknown as SafeHtml[]}</dl>`) as unknown as SafeHtml[]}
        ${missing.length ? html`<p class="fine"><b>Not found:</b> ${missing.join(', ')}</p>` : html``}</div>`;
    }
    case 'Agenda': {
      const points = items(v('points'));
      const qs = items(v('questions'));
      const watch = items(v('watch'));
      return html`<div class="agenda">
        ${points.length ? html`<ol class="${c.variant === 'numerals' ? 'numerals' : ''}">${points.map((x) => {
          // What a point rests on, by name (an answer's findings name their sources).
          const from = list(x.refs).map((r) => text((r as { label?: unknown }).label)).filter(Boolean);
          return html`<li><b>${x.text}</b>${text(x.note) ? html`<span class="muted">${text(x.note)}</span>` : html``}${c.component === 'Agenda' && from.length && !text(x.note) ? html`<span class="muted">From ${from.join(', ')}</span>` : html``}</li>`;
        }) as unknown as SafeHtml[]}</ol>` : html``}
        ${qs.length ? html`<div class="eyebrow">${text(v('questionsLabel')) || 'Questions to ask'}</div><ul>${qs.map((x) => html`<li>${x.text}</li>`) as unknown as SafeHtml[]}</ul>` : html``}
        ${watch.length ? html`<div class="eyebrow">${text(v('watchLabel')) || 'Watch out for'}</div><ul>${watch.map((x) => html`<li>${x.text}</li>`) as unknown as SafeHtml[]}</ul>` : html``}
      </div>`;
    }
    case 'Changes': {
      const groups: Array<[string, string]> = [['new', 'New'], ['price', 'Price changes'], ['changed', 'Changed'], ['gone', 'Gone'], ['missing', 'Not seen lately']];
      const all = list(v('items')) as Array<{ kind?: unknown; title?: unknown; detail?: unknown }>;
      if (!all.length) return html`<p class="muted">${text(v('empty')) || 'Nothing changed since last time.'}</p>`;
      return html`<div class="agenda">${groups.map(([k, label]) => {
        const xs = all.filter((x) => x.kind === k);
        return xs.length ? html`<div class="eyebrow">${label}</div><ul>${xs.map((x) => html`<li><b>${text(x.title)}</b>${text(x.detail) ? html` <span class="muted">${text(x.detail)}</span>` : html``}</li>`) as unknown as SafeHtml[]}</ul>` : html``;
      }) as unknown as SafeHtml[]}</div>`;
    }
    case 'Itinerary': {
      const days = list(v('days')).map((d) => ({ when: text((d as { when?: unknown }).when), items: items((d as { items?: unknown }).items) })).filter((d) => d.items.length);
      const before = items(v('before'));
      const open = items(v('open'));
      return html`<div class="agenda">
        ${days.map((d) => html`<div class="eyebrow">${d.when || 'Anytime'}</div><ul>${d.items.map((x) => {
          const from = list(x.refs).map((r) => text((r as { label?: unknown }).label)).filter(Boolean);
          return html`<li><b>${x.text}</b>${text(x.note) ? html` <span class="muted">${text(x.note)}</span>` : html``}${from.length ? html` <span class="muted">(${from.join(', ')})</span>` : html``}</li>`;
        }) as unknown as SafeHtml[]}</ul>`) as unknown as SafeHtml[]}
        ${before.length ? html`<div class="eyebrow">${text(v('beforeLabel')) || 'Before you start'}</div><ul>${before.map((x) => html`<li>${x.text}</li>`) as unknown as SafeHtml[]}</ul>` : html``}
        ${open.length ? html`<div class="eyebrow">${text(v('openLabel')) || 'Still open'}</div><ul>${open.map((x) => html`<li>${x.text}</li>`) as unknown as SafeHtml[]}</ul>` : html``}
      </div>`;
    }
    case 'QuoteList': {
      const all = list(v('items')) as Array<{ quote?: unknown; title?: unknown; source?: unknown; at?: unknown; ask?: unknown; group?: unknown }>;
      // A few, not every one: 3 to 5 (as many as the page shows), one per theme before a second from any; the extended brief has every one (below).
      const shown = briefQuotes(all, Math.min(5, Math.max(3, typeof c.maxItems === 'number' ? c.maxItems : 4)));
      return html`<div class="quotes">${shown.map((q, i) => html`<figure class="${c.lead && i === 0 ? 'lead' : ''}">
          <blockquote>${text(q.quote)}</blockquote>
          <figcaption>${text(q.group) ? html`<span class="tag">${text(q.group)}</span> ` : html``}${text(q.title)}${isUrl(q.source) ? html` · <a href="${q.source}">${site(q.source)}</a>` : html``}${text(q.at) ? html` · ${text(q.at)}` : html``}</figcaption>
          ${text(q.ask) ? html`<p class="ask"><b>Ask</b> ${text(q.ask)}</p>` : html``}
        </figure>`) as unknown as SafeHtml[]}
        ${all.length > shown.length ? html`<p class="fine">And ${String(all.length - shown.length)} more${p.full ? ', below' : ' in the extended brief'}.</p>` : html``}</div>`;
    }
    case 'Table': case 'OptionGrid': {
      const rows = list(v(c.component === 'Table' ? 'rows' : 'options')) as Array<Record<string, unknown>>;
      const cols = c.component === 'Table'
        ? (Array.isArray(c.columns) ? c.columns as Array<{ key: string; label: string }> : [])
        : [{ key: 'name', label: 'Option' }, { key: 'stage', label: 'Stage' }, { key: 'link', label: 'Link' }];
      const shown = rows.filter((r) => !r.ruledOut).slice(0, p.full ? 200 : 15);
      const cell = (x: unknown) => (isUrl(x) ? html`<a href="${x}">${site(x)}</a>` : x && typeof x === 'object' ? text((x as { label?: unknown }).label) : text(x));
      return html`<div class="tbl"><table><thead><tr>${cols.map((k) => html`<th>${k.label}</th>`) as unknown as SafeHtml[]}</tr></thead>
        <tbody>${shown.map((r) => html`<tr>${cols.map((k) => html`<td>${cell(r[k.key])}</td>`) as unknown as SafeHtml[]}</tr>`) as unknown as SafeHtml[]}</tbody></table></div>`;
    }
    case 'Timeline': {
      const ev = list(v('events')) as Array<{ at?: unknown; title?: unknown; body?: unknown }>;
      return html`<ul class="plain">${ev.slice(0, p.full ? 80 : 8).map((e) => html`<li><span class="fine">${text(e.at) ? new Date(text(e.at)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</span> ${text(e.title)}</li>`) as unknown as SafeHtml[]}</ul>`;
    }
    case 'Coverage': return html`<ul class="plain">${(list(v('sources')) as Array<{ name?: unknown; found?: unknown; status?: unknown }>).map((s) => html`<li>${text(s.name)} <span class="fine">· ${text(s.status) === 'found' ? `${text(s.found)} found` : text(s.status)}</span></li>`) as unknown as SafeHtml[]}</ul>`;
    case 'Steps': return html`<ul class="plain">${(list(v('steps')) as Array<{ text?: unknown; met?: unknown }>).map((s) => html`<li>${s.met ? '✓' : '○'} ${text(s.text)}</li>`) as unknown as SafeHtml[]}</ul>`;
    case 'Funnel': return html`<ul class="plain">${(list(v('stages')) as Array<{ label?: unknown; stage?: unknown; value?: unknown; reached?: unknown }>).map((s) => html`<li>${text(s.label ?? s.stage)} <span class="fine">· ${text(s.value ?? s.reached)}</span></li>`) as unknown as SafeHtml[]}</ul>`;
    case 'Checklist': return html`<div>${(list(v('groups')) as Array<{ title?: unknown; items?: unknown }>).map((g) => html`<div class="eyebrow">${text(g.title)}</div><ul class="plain">${(list(g.items) as Array<{ text?: unknown; done?: unknown }>).map((x) => html`<li>${x.done ? '✓' : '○'} ${text(x.text)}</li>`) as unknown as SafeHtml[]}</ul>`) as unknown as SafeHtml[]}</div>`;
    // Charts and agent HTML don't print here; the notebook has them.
    default: return html``;
  }
}

/** Everything behind the page (the extended brief): every quote, every fact with its page, each option in full. */
function behindThePage(nb: Notebook, entries: readonly NotebookEntry[], d: Data['notebook'], history: (NotebookWidgetHistory & Partial<Pick<NotebookOptionHistory, 'sightings'>>) | undefined, pic: BriefPicture | undefined): SafeHtml {
  const active = d.options.filter((o) => !o.ruledOut);
  return html`
    ${d.quotes.length ? html`<section class="part part--feature appendix"><div class="part__head"><h2>Everything they said</h2><span class="part__note">${String(d.quotes.length)}</span></div>
      <div class="quotes">${d.quotes.map((q) => html`<figure><blockquote>${q.quote}</blockquote><figcaption>${q.group ? html`<span class="tag">${q.group}</span> ` : html``}${q.title}${q.source ? html` · <a href="${q.source}">${q.source}</a>` : html``}${q.at ? html` · ${q.at}` : html``}</figcaption>${q.ask ? html`<p class="ask"><b>Ask</b> ${q.ask}</p>` : html``}</figure>`) as unknown as SafeHtml[]}</div></section>` : html``}
    ${d.facts.length ? html`<section class="part part--feature appendix"><div class="part__head"><h2>Every fact, with its page</h2></div>
      <div class="facts"><dl>${d.facts.map((f) => html`<dt>${f.group} · ${f.label}</dt><dd>${f.value}${f.url ? html` <a class="src" href="${f.url}">${f.url}</a>` : html``}</dd>`) as unknown as SafeHtml[]}</dl></div></section>` : html``}
    ${active.length ? html`<section class="fullset appendix"><h2>Each one in full<span class="part__note">${String(active.length)}</span></h2>${active.map((o, i) => optionInFull(nb, o, i + 1, entries, history, pic)) as unknown as SafeHtml[]}</section>` : html``}`;
}

export function renderPageBrief(args: { nb: Notebook; entries: readonly NotebookEntry[]; history?: NotebookWidgetHistory & Partial<Pick<NotebookOptionHistory, 'sightings'>>; now?: Date; print?: boolean; full?: boolean; pictures?: BriefPicture; aboutPicture?: (src: string) => string | undefined }): string {
  const { nb } = args;
  const now = args.now ?? new Date();
  const data = notebookWidgetData(nb, args.entries, args.history);
  const layout = notebookLayoutOf(nb);
  const resolved = resolveNotebookLayout(layout.components, notebookLayoutFlags(nb, args.entries.some((e) => e.kind === 'option')), notebookLayoutValues(nb), emptyPartsGo(layout, data));
  const { header, side, rest } = splitNotebookHeader(resolved);
  // The side part comes as a small page with its own root: only its parts join the page's (its root would be taken for the page's).
  const byId = new Map([...(side ?? []).slice(1), ...rest].map((c) => [c.id, c]));
  const p: Printing = { byId, data, full: !!args.full, about: args.aboutPicture ?? ((src) => src) };
  const subtitle = header && typeof header.subtitle === 'string' ? header.subtitle : nb.layout?.about?.split(':')[0];
  const sideId = side?.[0]?.children ? (side[0].children as string[])[0] : undefined;
  const pic = args.pictures ?? ((o) => o.image);
  const body = html`<title>${nb.title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;700&display=swap">
<style>
/* A drawn page, printed: its parts in their treatments (DESIGN.md "Notebook pages"). */
:root {
  --bg: #faf9f7; --surface: #ffffff; --raised: #f5f4f2; --line: #e7e5e4; --line-strong: #d6d3d1;
  --text: #1c1917; --muted: #78716c; --subtle: #a8a29e; --accent: #0f766e; --accent-soft: #ccfbf1;
  --mono: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace; --sans: system-ui, -apple-system, "Segoe UI", sans-serif;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #1a1918; --surface: #242220; --raised: #2e2c2a; --line: #3d3a37; --line-strong: #57534e;
  --text: #e7e5e4; --muted: #a8a29e; --subtle: #78716c; --accent: #2dd4bf; --accent-soft: rgba(45, 212, 191, 0.12); color-scheme: dark;
} }
:root[data-theme="dark"] {
  --bg: #1a1918; --surface: #242220; --raised: #2e2c2a; --line: #3d3a37; --line-strong: #57534e;
  --text: #e7e5e4; --muted: #a8a29e; --subtle: #78716c; --accent: #2dd4bf; --accent-soft: rgba(45, 212, 191, 0.12); color-scheme: dark;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.6 var(--sans); }
a { color: var(--accent); }
.brief { max-width: 62rem; margin: 0 auto; padding-inline: 1rem; padding-block: 2.5rem 3rem; display: grid; gap: 1.75rem; }
.brief > *, .stack > *, .cols > * { min-width: 0; }
.eyebrow { font: 600 0.6875rem/1.2 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin: 0.75rem 0 0.35rem; }
.masthead { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 1.5rem; align-items: start; border-bottom: 2px solid var(--text); padding-bottom: 1rem; }
.masthead .eyebrow { color: var(--accent); margin-top: 0; }
h1 { margin: 0.25rem 0 0; font: 700 1.75rem/1.2 var(--mono); text-wrap: balance; }
.goal { margin: 0.5rem 0 0; color: var(--muted); max-width: 65ch; }
.masthead aside { max-width: 20rem; font-size: 0.875rem; }
.stack { display: grid; gap: 1.5rem; }
.row { display: flex; flex-wrap: wrap; gap: 1rem; }
.cols { display: grid; gap: 1.75rem; align-items: start; }
@media (max-width: 760px) { .cols, .masthead { grid-template-columns: 1fr !important; } }
.part__head { display: flex; align-items: baseline; gap: 0.5rem; margin-bottom: 0.75rem; }
h2 { margin: 0; font: 700 1rem/1.3 var(--mono); }
.part__note { margin-left: auto; font-size: 0.75rem; color: var(--muted); }
.part--plain { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 1rem; }
.part--lede h2 { font: 600 0.6875rem/1 var(--mono); letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent); }
.part--feature { border-top: 2px solid var(--text); padding-top: 0.75rem; }
.part--feature h2 { font-size: 1.0625rem; }
.part--aside { border-left: 1px solid var(--line-strong); padding-left: 1rem; }
.part--aside h2, .part--band h2 { font: 600 0.6875rem/1 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.part--band { background: var(--raised); border-radius: 10px; padding: 0.75rem 1rem; }
.callout p { margin: 0.25rem 0 0; font-size: 1.0625rem; }
.muted { color: var(--muted); } .fine { font-size: 0.75rem; color: var(--muted); margin: 0.35rem 0 0; }
.chips { display: flex; flex-wrap: wrap; gap: 0.35rem; margin: 0; }
.chip { font: 0.75rem/1.7 var(--mono); padding: 0 0.5rem; border: 1px solid var(--line); border-radius: 6px; }
.stats { display: flex; flex-wrap: wrap; gap: 1rem; margin: 0; } .stats b { font: 700 1.25rem var(--mono); }
.profile { display: grid; grid-template-columns: 4.5rem minmax(0, 1fr); gap: 0.75rem 1rem; align-items: start; }
.profile--cover { grid-template-columns: 9rem minmax(0, 1fr); }
.profile__pic { width: 100%; aspect-ratio: 1; border-radius: 10px; object-fit: contain; background: var(--raised); border: 1px solid var(--line); }
.profile__mono { display: grid; place-items: center; font: 700 1.75rem var(--mono); color: var(--accent); background: var(--accent-soft); border: 0; }
.profile--cover .profile__mono { font-size: 3rem; }
.profile__name { font: 700 1.25rem/1.2 var(--mono); }
.profile--cover .profile__name { font-size: 1.75rem; }
.profile p { margin: 0.5rem 0 0; max-width: 65ch; }
.links { display: flex; flex-wrap: wrap; gap: 0.75rem; font: 0.75rem var(--mono); }
.pull { grid-column: 1 / -1; margin: 0.25rem 0 0; padding-left: 1rem; border-left: 3px solid var(--accent); font-size: 1.1875rem; line-height: 1.45; }
.facts dl { margin: 0; }
.facts dt { padding-top: 0.5rem; border-top: 1px solid var(--line); font: 600 0.625rem/1.2 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.facts dd { margin: 0.2rem 0 0.5rem; overflow-wrap: anywhere; }
.src { font-size: 0.75rem; margin-left: 0.25rem; }
.agenda ol { margin: 0 0 1rem; padding: 0; list-style: none; counter-reset: pt; display: grid; gap: 0.75rem; }
.agenda ol li { counter-increment: pt; display: grid; grid-template-columns: 2rem minmax(0, 1fr); column-gap: 0.5rem; }
.agenda ol li::before { content: counter(pt); grid-row: span 2; font: 700 0.875rem var(--mono); color: var(--accent); }
.agenda ol.numerals li::before { font-size: 1.75rem; line-height: 1; }
.agenda ol li span { grid-column: 2; font-size: 0.875rem; }
.agenda ul { margin: 0 0 1rem; padding-left: 1.2rem; display: grid; gap: 0.3rem; }
.quotes { display: grid; gap: 1rem; }
.quotes figure { margin: 0; padding-left: 0.75rem; border-left: 2px solid var(--line); }
.quotes figure.lead { border-left: 3px solid var(--accent); } .quotes figure.lead blockquote { font-size: 1.1875rem; }
.quotes blockquote { margin: 0; }
.quotes figcaption { font-size: 0.75rem; color: var(--muted); margin-top: 0.25rem; overflow-wrap: anywhere; }
.tag { font: 600 0.625rem/1 var(--mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--accent); }
.ask { margin: 0.3rem 0 0; font-size: 0.875rem; } .ask b { font: 600 0.625rem var(--mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--accent); }
.plain { margin: 0; padding-left: 1.1rem; display: grid; gap: 0.25rem; font-size: 0.875rem; }
.kv { display: grid; grid-template-columns: max-content 1fr; gap: 0.25rem 1rem; margin: 0; }
.kv dt { color: var(--muted); } .kv dd { margin: 0; }
.tbl { overflow-x: auto; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); }
table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
th, td { text-align: left; padding: 0.4rem 0.75rem; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font: 600 0.6875rem var(--mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
.fullset { display: grid; gap: 1.5rem; }
.full { border-top: 2px solid var(--line-strong); padding-top: 1rem; display: grid; gap: 0.5rem; }
.full__head { display: flex; gap: 0.75rem; align-items: baseline; } .full__name { margin: 0; font-size: 1rem; }
.full__facts { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 0.3rem 1rem; margin: 0; font-size: 0.875rem; }
.full__facts div { display: contents; } .full__facts dt { color: var(--muted); } .full__facts dd { margin: 0; overflow-wrap: anywhere; }
.full h4 { margin: 0.25rem 0; font: 600 0.6875rem var(--mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
.full ul { margin: 0; padding-left: 1.1rem; font-size: 0.875rem; } .full p { margin: 0 0 0.5rem; font-size: 0.875rem; }
/* A picture sits in its frame, whole (never cropped), however big the file. */
.pic { flex: none; display: block; position: relative; overflow: hidden; max-width: 100%; border-radius: 8px; background: var(--raised); }
.pic img { display: block; width: 100%; height: 100%; object-fit: contain; }
.pic.is-tile { background: #fff; border: 1px solid var(--line); }
.pic.is-tile img { padding: 3px; }
.pic.is-logo img { padding: 4px; }
.pic.is-empty { background: transparent; }
.pic--thumb { width: 3rem; height: 2.25rem; }
.pic--hero { width: 100%; max-width: 18rem; aspect-ratio: 4 / 3; border-radius: 10px; }
.pic__kind { position: absolute; left: 0.4rem; bottom: 0.4rem; padding: 0.1rem 0.4rem; border-radius: 4px; background: rgba(28, 25, 23, 0.7); color: #fff; font: 500 0.625rem/1.4 var(--mono); letter-spacing: 0.04em; }
footer { color: var(--subtle); font-size: 0.75rem; border-top: 1px solid var(--line); padding-top: 0.75rem; }
@media print {
  :root, :root[data-theme="dark"] { --bg: #ffffff; --surface: #ffffff; --raised: #f5f4f2; --line: #e7e5e4; --line-strong: #d6d3d1; --text: #1c1917; --muted: #57534e; --subtle: #78716c; --accent: #0f766e; --accent-soft: #ccfbf1; color-scheme: light; }
  @page { margin: 16mm 14mm; }
  body { font-size: 10.5pt; }
  .brief { max-width: none; padding: 0; gap: 1rem; }
  .part, figure, .profile, .agenda li, tr, .full { break-inside: avoid; }
  h2 { break-after: avoid; }
  .appendix:first-of-type, .fullset { break-before: page; }
  .profile__mono, .part--band, .tag { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
</style>
<main class="brief">
  <header class="masthead">
    <div>
      <div class="eyebrow">${subtitle ?? 'Notebook brief'}${args.full ? ' · extended' : ''} · ${fmtDate(now)}</div>
      <h1>${nb.title}</h1>
      ${nb.statement && !(header && header.statement === false) ? html`<p class="goal">${nb.statement}</p>` : html``}
      ${nb.meeting?.when || nb.meeting?.goal ? html`<p class="goal">${nb.meeting.when ? html`<b>Meeting ${meetingWhenWords(nb.meeting.when)}</b>` : html``}${nb.meeting.when && nb.meeting.goal ? html` · ` : html``}${nb.meeting.goal ? html`Your goal: ${nb.meeting.goal}` : html``}</p>` : html``}
    </div>
    ${sideId ? html`<aside>${node(p, sideId)}</aside>` : html``}
  </header>
  ${node(p, 'root')}
  ${args.full ? behindThePage(nb, args.entries, data.notebook, args.history, pic) : html``}
  <footer>From the notebook as it was on ${fmtDate(now)}: facts as their pages gave them, each with its source. Made with sua.</footer>
</main>
${args.print ? unsafeHtml('<script>addEventListener("load", () => setTimeout(() => print(), 300));</script>') : html``}`;
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n${render(body).replace('<main class="brief">', '</head>\n<body>\n<main class="brief">')}\n</body>\n</html>\n`;
}
