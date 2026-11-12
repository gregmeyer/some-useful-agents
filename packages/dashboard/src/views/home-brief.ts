/**
 * Home's brief (lib/home-brief.ts): the large item at the top of the main
 * column. A headline in the lead agent's words, its number set large with
 * its week as columns, a few other figures each with a small trend line,
 * and the top thing a list agent found. Numbers and drawings, not
 * sentences: the sentences are in Today's reads beside it.
 */
import { html, unsafeHtml, type SafeHtml } from './html.js';
import { formatAge } from './components.js';
import type { BriefFigure, HomeBrief } from '../lib/home-brief.js';

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayName = (iso: string): string => WEEKDAY[new Date(`${iso}T12:00:00Z`).getUTCDay()] ?? iso;

function fmt(f: BriefFigure, v: number): string {
  return f.kind === 'percent' ? `${v > 0 ? '+' : ''}${String(Math.round(v * 100) / 100)}%` : String(Math.round(v * 100) / 100);
}

/** A figure's last days as a small line, today's point marked. Values are in its title for anyone who can't see it. */
function spark(f: BriefFigure): SafeHtml {
  const vs = f.days.map((d) => d.value);
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const W = 84;
  const H = 24;
  const x = (i: number) => 3 + (i * (W - 6)) / Math.max(1, vs.length - 1);
  const y = (v: number) => (max === min ? H / 2 : H - 4 - ((v - min) * (H - 8)) / (max - min));
  const pts = vs.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const said = `${f.label}, last ${String(vs.length)} days: ${f.days.map((d) => `${dayName(d.day)} ${fmt(f, d.value)}`).join(', ')}`;
  return html`<svg class="home-brief__spark" viewBox="0 0 ${String(W)} ${String(H)}" width="${String(W)}" height="${String(H)}" role="img" aria-label="${said}"><title>${said}</title><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>${unsafeHtml(`<circle cx="${x(vs.length - 1).toFixed(1)}" cy="${y(vs[vs.length - 1]).toFixed(1)}" r="3" class="home-brief__spark-now"/>`)}</svg>`;
}

/** The lead figure's days as columns, today's filled in the accent. */
function columns(f: BriefFigure): SafeHtml {
  const max = Math.max(...f.days.map((d) => d.value), 1);
  const last = f.days.length - 1;
  return html`
    <figure class="home-brief__week" aria-label="${f.label}, last ${String(f.days.length)} days">
      <figcaption class="home-brief__week-title">${f.label}, last ${String(f.days.length)} days</figcaption>
      <ol class="home-brief__cols">${f.days.map((d, i) => html`
        <li class="home-brief__col${i === last ? ' is-today' : ''}" title="${dayName(d.day)} ${d.day}: ${fmt(f, d.value)} ${f.label}">
          <span class="home-brief__col-value">${fmt(f, d.value)}</span>
          <span class="home-brief__col-bar" style="height: ${String(Math.max(4, Math.round((Math.max(0, d.value) / max) * 100)))}%"></span>
          <span class="home-brief__col-day">${i === last ? 'Today' : dayName(d.day)}</span>
        </li>`) as unknown as SafeHtml[]}</ol>
    </figure>`;
}

function figure(f: BriefFigure): SafeHtml {
  const dir = f.kind === 'percent' ? (f.value > 0 ? ' is-up' : f.value < 0 ? ' is-down' : '') : '';
  return html`
    <a class="home-brief__fig" href="/runs/${encodeURIComponent(f.runId)}" title="${f.agent}: open this run">
      <span class="home-brief__fig-value${dir}">${f.kind === 'percent' && f.value !== 0 ? html`<span class="home-brief__arrow" aria-hidden="true">${f.value > 0 ? '▲' : '▼'}</span>` : html``}${f.text}</span>
      <span class="home-brief__fig-label">${f.label}</span>
      ${spark(f)}
      <span class="home-brief__fig-from">${f.agent}</span>
    </a>`;
}

export function renderHomeBrief(b: HomeBrief | undefined, now = new Date()): SafeHtml {
  if (!b) return html``;
  const date = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return html`
    <section class="home-brief" aria-labelledby="home-brief-title" data-home-brief>
      <div class="home-brief__head">
        <span class="home-today__title">Today · ${date}</span>
        <span class="home-brief__from">from ${String(b.agents)} scheduled agent${b.agents === 1 ? '' : 's'} · ${formatAge(b.at)}</span>
      </div>
      <h2 class="home-brief__headline" id="home-brief-title">${b.headline}</h2>
      <div class="home-brief__body">
        <div class="home-brief__lead">
          <span class="home-brief__lead-value">${b.lead.text}</span>
          <span class="home-brief__lead-label">${b.lead.label}</span>
          <span class="home-brief__fig-from">${b.lead.agent}</span>
        </div>
        ${columns(b.lead)}
        ${b.figures.length ? html`<div class="home-brief__figs">${b.figures.map(figure) as unknown as SafeHtml[]}</div>` : html``}
      </div>
      ${b.top ? html`<p class="home-brief__top"><span class="home-brief__top-label">Top story</span> <a href="${b.top.url}" target="_blank" rel="noopener noreferrer">${b.top.title}</a> <span class="home-brief__fig-from">${b.top.agent}</span></p>` : html``}
      <div class="home-brief__acts">
        <a class="btn btn--sm btn--primary" href="/runs/${encodeURIComponent(b.lead.runId)}">Open ${b.lead.agent}</a>
        <a class="btn btn--sm btn--ghost" href="/pulse">Pulse</a>
      </div>
    </section>`;
}
