/**
 * Notebooks (goal surfaces G1; mockup screen 22): the list, and one notebook,
 * a header that reads as its cover (what it's for, parameters, a pipeline
 * diagram, a progress ring over its criteria), its surface (options, notes
 * and decisions, evidence), and the forms to add to it, edit it, and close it
 * with a decision.
 */
import { notebookProgress, notebookViewData, isRange, type CompiledSurface, type Notebook, type NotebookEntry, type NotebookField, type NotebookFieldValue } from '@some-useful-agents/core';
import { html, render, unsafeHtml, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { cronToHuman, formatAge } from './components.js';

const NOTEBOOK_ICON = unsafeHtml('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/><path d="M9 8h6"/></svg>');

const STATUS_LABEL: Record<Notebook['status'], string> = { active: 'active', decided: 'decided', stopped: 'stopped' };

/** A progress ring over the criteria: met of total. */
export function progressRing(met: number, total: number, size = 78): SafeHtml {
  const r = size / 2 - 8;
  const c = 2 * Math.PI * r;
  const frac = total === 0 ? 0 : met / total;
  const half = size / 2;
  return unsafeHtml(`<svg class="nb-ring" role="img" aria-label="${String(met)} of ${String(total)} criteria met" width="${String(size)}" height="${String(size)}" viewBox="0 0 ${String(size)} ${String(size)}">
    <defs><linearGradient id="nb-ring-grad" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="var(--color-primary)"/><stop offset="1" stop-color="var(--color-ok)"/></linearGradient></defs>
    <circle cx="${String(half)}" cy="${String(half)}" r="${r.toFixed(1)}" fill="none" stroke="var(--color-border)" stroke-width="8"/>
    <circle cx="${String(half)}" cy="${String(half)}" r="${r.toFixed(1)}" fill="none" stroke="url(#nb-ring-grad)" stroke-width="8" stroke-linecap="round"
      stroke-dasharray="${(c * frac).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${String(half)} ${String(half)})"/>
    <text x="${String(half)}" y="${String(half + 5)}" text-anchor="middle" class="nb-ring__label">${total ? `${String(met)}/${String(total)}` : '—'}</text>
  </svg>`);
}

export interface PipelineStage { agentId: string; status: 'ok' | 'failed' | 'never' | 'running'; note: string }

/** The pipeline as connected nodes, each with its last run. */
function pipelineDiagram(stages: PipelineStage[]): SafeHtml {
  if (stages.length === 0) return html``;
  const w = 640;
  const pad = 70;
  const step = stages.length > 1 ? (w - pad * 2) / (stages.length - 1) : 0;
  const xs = stages.map((_, i) => (stages.length > 1 ? pad + step * i : w / 2));
  const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => (ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&quot;'));
  const glyph = { ok: '✓', failed: '!', never: '○', running: '◌' } as const;
  const nodes = stages.map((s, i) => `
    <g class="nb-pipe__node nb-pipe__node--${s.status}">
      <circle cx="${xs[i].toFixed(0)}" cy="28" r="15"/>
      <text x="${xs[i].toFixed(0)}" y="33" text-anchor="middle" class="nb-pipe__glyph">${glyph[s.status]}</text>
      <text x="${xs[i].toFixed(0)}" y="58" text-anchor="middle" class="nb-pipe__name">${esc(s.agentId.slice(0, 22))}</text>
      <text x="${xs[i].toFixed(0)}" y="71" text-anchor="middle" class="nb-pipe__note">${esc(s.note)}</text>
    </g>`).join('');
  const line = stages.length > 1 ? `<path d="M${xs[0].toFixed(0)} 28 H ${xs[xs.length - 1].toFixed(0)}" class="nb-pipe__line"/><path d="M${xs[0].toFixed(0)} 28 H ${xs[xs.length - 1].toFixed(0)}" class="nb-pipe__flow"/>` : '';
  const label = `Pipeline: ${stages.map((s) => `${s.agentId} (${s.note})`).join(', ')}`;
  return unsafeHtml(`<svg class="nb-pipe" role="img" aria-label="${esc(label)}" width="100%" height="76" viewBox="0 0 ${String(w)} 76" preserveAspectRatio="xMidYMid meet">${line}${nodes}</svg>`);
}

function hero(nb: Notebook, stages: PipelineStage[], running?: { step: number; of: number }): SafeHtml {
  const { met, total } = notebookProgress(nb);
  const id = encodeURIComponent(nb.id);
  const human = nb.cadence ? cronToHuman(nb.cadence) : '';
  const cadence = human ? `runs ${human.charAt(0).toLowerCase()}${human.slice(1)}` : 'runs when you ask';
  return html`
    <section class="nb-hero" aria-labelledby="nb-title">
      <div class="nb-hero__main">
        <div class="nb-hero__titlerow">
          <span class="nb-hero__icon">${NOTEBOOK_ICON}</span>
          <h1 class="nb-hero__title" id="nb-title">${nb.title}</h1>
          <span class="nb-status nb-status--${nb.status}">${STATUS_LABEL[nb.status]}</span>
        </div>
        ${nb.statement ? html`<p class="nb-hero__statement">${nb.statement}</p>` : html`<p class="nb-hero__statement nb-hero__statement--empty">Say what this notebook is for under Edit.</p>`}
        <div class="nb-hero__chips">
          ${nb.params.map((p) => html`<span class="nb-chip">${p}</span>`) as unknown as SafeHtml[]}
          <span class="nb-hero__meta">started ${formatAge(nb.createdAt)} · ${cadence}</span>
        </div>
        ${pipelineDiagram(stages)}
        ${nb.pipeline.length ? html`
          <div class="nb-run">
            ${running
              ? html`<span class="nb-run__now" data-notebook-running role="status">Running step ${String(running.step)} of ${String(running.of)}… this page updates as it goes.</span>`
              : nb.status === 'active'
                ? html`<form method="POST" action="/notebooks/${encodeURIComponent(nb.id)}/run" class="nb-run__form"><button type="submit" class="btn btn--sm">Run the pipeline now</button></form>`
                : html``}
            ${nb.lastRunAt && !running ? html`<span class="nb-run__last">Last run ${formatAge(nb.lastRunAt)}: ${nb.lastRunNote ?? ''}</span>` : html``}
          </div>` : html``}
        ${nb.status === 'decided' && nb.decision ? html`<div class="nb-decided"><strong>Decided ${formatAge(nb.decidedAt ?? nb.updatedAt)}:</strong> ${nb.decision}</div>` : html``}
      </div>
      <aside class="nb-hero__side" aria-label="Done when">
        <div class="nb-progress">
          ${progressRing(met, total)}
          <div class="nb-progress__list">
            <span class="nb-progress__label">Done when</span>
            ${total === 0 ? html`<span class="nb-progress__empty">No criteria yet. Add them under Edit.</span>` : html``}
            ${nb.criteria.map((c, i) => html`
              <form method="POST" action="/notebooks/${id}/criteria/${String(i)}" class="nb-crit">
                <input type="hidden" name="met" value="${c.met ? '0' : '1'}">
                <button type="submit" class="nb-crit__btn ${c.met ? 'is-met' : ''}" aria-pressed="${c.met ? 'true' : 'false'}" title="${c.met ? 'Mark not met' : 'Mark met'}">${c.met ? '✓' : '○'}</button>
                <span class="nb-crit__text ${c.met ? 'is-met' : ''}">${c.text}</span>
              </form>`) as unknown as SafeHtml[]}
          </div>
        </div>
        ${nb.status === 'active' ? html`
          <details class="nb-decide">
            <summary class="btn btn--primary btn--sm">Decide…</summary>
            <form method="POST" action="/notebooks/${id}/decide" class="nb-decide__form">
              <label for="nb-decision" class="nb-progress__label">What did you decide, and why?</label>
              <textarea id="nb-decision" name="decision" rows="4" required class="form-field" placeholder="Buy the 2019 RAV4 XLE: clean history, under budget. The CR-V had an accident."></textarea>
              <button type="submit" class="btn btn--primary btn--sm">Record the decision and close</button>
            </form>
          </details>` : html`
          <form method="POST" action="/notebooks/${id}/status" class="nb-reopen"><input type="hidden" name="status" value="active"><button type="submit" class="btn btn--sm">Reopen</button></form>`}
      </aside>
    </section>`;
}

const KIND_LABEL: Record<NotebookEntry['kind'], string> = { note: 'note', option: 'option', evidence: 'evidence', decision: 'decision' };

const URL_RE = /(https?:\/\/[^\s<>"'()]+)/g;

/**
 * An entry's text with its web addresses as links. A listing URL is long and
 * unreadable, so the link reads as its site ("cargurus.com ↗"); the full
 * address is the tooltip. Only http(s) addresses become links.
 */
export function bodyWithLinks(text: string): SafeHtml {
  const parts = text.split(URL_RE);
  return html`${parts.map((part, i) => {
    if (i % 2 === 0) return part;
    const trail = /[.,;:!?]+$/.exec(part)?.[0] ?? '';
    const url = trail ? part.slice(0, -trail.length) : part;
    let site = url;
    try { site = new URL(url).hostname.replace(/^www\./, ''); } catch { /* keep the address */ }
    return html`<a href="${url}" class="nb-entry__link" target="_blank" rel="noopener noreferrer" title="${url}">${site} ↗</a>${trail}`;
  })}`;
}

/** "$4,023", "149,652 mi", "2010": one field's value as people read it. */
export function formatFieldValue(f: NotebookField, v: NotebookFieldValue): string {
  if (isRange(v)) {
    if (v.min === v.max) return formatFieldValue(f, v.min);
    // "$150,000–$180,000", "120–150 sq ft": the unit once, at the end.
    const one = (n: number) => (f.type === 'money' ? `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : n.toLocaleString('en-US', { maximumFractionDigits: 2 }));
    return `${one(v.min)}–${one(v.max)}${f.unit && f.type !== 'money' ? ` ${f.unit}` : ''}`;
  }
  if (typeof v === 'number') {
    const n = v.toLocaleString('en-US', { maximumFractionDigits: 2 });
    if (f.type === 'money') return `$${n}`;
    // Years and ids read without separators.
    if (f.type === 'number' && !f.unit && Number.isInteger(v) && v >= 1900 && v <= 2100) return String(v);
    return f.unit ? `${n} ${f.unit}` : n;
  }
  return v;
}

/** An option's facts as chips, in the notebook's field order; its listing as a link. */
function optionFacts(nb: Notebook, e: NotebookEntry): SafeHtml {
  const data = e.data ?? {};
  const facts = nb.fields.filter((f) => data[f.key] !== undefined && f.type !== 'image' && f.type !== 'url');
  const link = nb.fields.find((f) => f.role === 'link' && typeof data[f.key] === 'string');
  if (facts.length === 0 && !link) return html``;
  const seenAgain = e.lastSeenAt && e.lastSeenAt.slice(0, 16) !== e.createdAt.slice(0, 16);
  return html`<div class="nb-facts">
    ${facts.map((f) => html`<span class="nb-fact${f.role === 'price' ? ' nb-fact--price' : ''}" title="${f.label}">${formatFieldValue(f, data[f.key])}</span>`)}
    ${link ? bodyWithLinks(String(data[link.key])) : html``}
    ${seenAgain ? html`<span class="nb-fact nb-fact--seen" title="first seen ${formatAge(e.createdAt)}">seen again ${formatAge(e.lastSeenAt!)}</span>` : html``}
  </div>`;
}

const QUICK_REASONS = ['Not interested', 'Too expensive', 'No reply', 'Failed a check'];

/** An option's place in the funnel: its stage, the next one, and ruling it out (or back in). */
function optionStage(nb: Notebook, e: NotebookEntry): SafeHtml {
  const base = `/notebooks/${encodeURIComponent(nb.id)}/entries/${e.id}`;
  if (e.ruledOut) {
    return html`<div class="nb-stage nb-stage--out">
      <span class="nb-stage__out">Ruled out${e.ruledOut.stage ? ` at ${e.ruledOut.stage}` : ''}: ${e.ruledOut.reason}</span>
      <form method="POST" action="${base}/reinstate"><button type="submit" class="btn btn--sm btn--ghost">Bring back</button></form>
    </div>`;
  }
  const i = nb.stages.findIndex((s) => s === e.stage);
  const next = nb.stages.length ? nb.stages[i + 1] : undefined;
  return html`<div class="nb-stage">
    ${e.stage ? html`<span class="nb-stage__chip" title="Stage ${String(i + 1)} of ${String(nb.stages.length)}">${e.stage}</span>` : html``}
    ${next ? html`<form method="POST" action="${base}/stage"><input type="hidden" name="stage" value="${next}"><button type="submit" class="btn btn--sm">Move to ${next} →</button></form>` : html``}
    <details class="nb-ruleout">
      <summary class="btn btn--sm btn--ghost">Rule out…</summary>
      <form method="POST" action="${base}/rule-out" class="nb-ruleout__form">
        <span class="nb-ruleout__label">Why? It stays here, and searches won't suggest it again.</span>
        <div class="nb-ruleout__quick">${QUICK_REASONS.map((r) => html`<button type="submit" name="quick" value="${r}" class="btn btn--sm">${r}</button>`)}</div>
        <div class="nb-ruleout__row"><input type="text" name="reason" class="form-field" placeholder="or in your words: didn't like the color" aria-label="Reason"><button type="submit" class="btn btn--sm btn--primary">Rule out</button></div>
      </form>
    </details>
  </div>`;
}

/** Found 9 → Checked 2 → Test drive 0 · 3 ruled out: how far options got. */
function funnelStrip(nb: Notebook, entries: readonly NotebookEntry[]): SafeHtml {
  if (nb.stages.length === 0) return html``;
  const { funnel, ruledOutCount } = notebookViewData(nb, entries).notebook;
  return html`<ol class="nb-funnel" aria-label="How far options got">
    ${funnel.map((f, i) => html`<li class="nb-funnel__step${f.here ? ' nb-funnel__step--here' : ''}" title="${String(f.reached)} reached ${f.stage}; ${String(f.here)} here now${f.ruledOut ? `; ${String(f.ruledOut)} ruled out here (${f.reasons.map((r) => `${r.reason} ×${String(r.count)}`).join(', ')})` : ''}">
      ${i > 0 ? html`<span class="nb-funnel__arrow" aria-hidden="true">→</span>` : html``}
      <span class="nb-funnel__n">${String(f.reached)}</span> ${f.stage}${f.ruledOut ? html` <span class="nb-funnel__out">−${String(f.ruledOut)}</span>` : html``}
    </li>`)}
    ${ruledOutCount ? html`<li class="nb-funnel__total">${String(ruledOutCount)} ruled out</li>` : html``}
  </ol>`;
}

function entryCard(nb: Notebook, e: NotebookEntry): SafeHtml {
  return html`
    <li class="nb-entry nb-entry--${e.kind}${e.ruledOut ? ' nb-entry--out' : ''}" id="entry-${e.id}">
      <div class="nb-entry__head">
        <span class="nb-entry__kind">${KIND_LABEL[e.kind]}</span>
        <strong class="nb-entry__title">${e.title}</strong>
        <form method="POST" action="/notebooks/${encodeURIComponent(nb.id)}/entries/${e.id}/remove" class="nb-entry__remove">
          <button type="submit" class="btn btn--xs btn--ghost" aria-label="Remove “${e.title}”" title="Remove">×</button>
        </form>
      </div>
      ${e.kind === 'option' ? optionFacts(nb, e) : html``}
      ${e.kind === 'option' ? optionStage(nb, e) : html``}
      ${e.body ? html`<p class="nb-entry__body">${bodyWithLinks(e.body)}</p>` : html``}
      <span class="nb-entry__by">${e.by === 'you' ? 'you' : e.by.replace(/^agent:/, '')} · ${formatAge(e.createdAt)}${e.runId ? html` · <a href="/runs/${encodeURIComponent(e.runId)}" class="mono">run ${e.runId.slice(0, 8)}</a>` : html``}</span>
    </li>`;
}

function surfaceColumn(nb: Notebook, compiled: CompiledSurface, entries: NotebookEntry[]): SafeHtml {
  const byId = new Map(entries.map((e) => [`nbentry:${e.id}`, e]));
  const regions = compiled.regions.filter((r) => r.entries.length > 0);
  if (regions.length === 0) {
    return html`
      <section class="nb-start" aria-labelledby="nb-start-title">
        <h2 class="nb-start__title" id="nb-start-title">Tell sua what you're looking for</h2>
        <p class="nb-start__sub">Talk it through the way you would with a friend: who it's for, budget, must-haves, what you've already seen or ruled out. sua files it here as you go (notes, options, limits, what "done" means) and can set up agents to keep looking.</p>
        ${talkForm(nb, entries, true)}
      </section>`;
  }
  // Ruled-out options sink to the end of their section.
  const out = (id: string) => (byId.get(id)?.ruledOut ? 1 : 0);
  return html`${funnelStrip(nb, entries)}${regions.map((r) => html`
    <section class="nb-region" data-surface-region="${r.id}">
      <h2 class="nb-region__title">${r.title} <span class="nb-region__count">${String(r.entries.length)}</span></h2>
      <ul class="nb-region__list">${[...r.entries].sort((a, b) => out(a.item.id) - out(b.item.id)).map((ce) => { const e = byId.get(ce.item.id); return e ? entryCard(nb, e) : html``; }) as unknown as SafeHtml[]}</ul>
    </section>`) as unknown as SafeHtml[]}`;
}

/**
 * The next useful thing to tell sua, from where the notebook is: what it's
 * for, then limits, then candidates, then the first unmet criterion, then a
 * pipeline, then deciding. Drives the talk box's hint and ghost text.
 */
export function nextStep(nb: Notebook, entries: readonly NotebookEntry[]): { hint: string; placeholder: string } {
  const options = entries.filter((e) => e.kind === 'option');
  const notes = entries.filter((e) => e.kind === 'note');
  const goal = (nb.statement || nb.title).replace(/[.!?]+$/, '');
  const short = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
  if (nb.status === 'decided') {
    return { hint: 'Decided. Anything learned since is still worth keeping.', placeholder: `e.g. how the decision is working out, or anything that would change it` };
  }
  if (!nb.statement && notes.length === 0) {
    return { hint: "Start with what it's for and what matters most.", placeholder: `e.g. what "${short(nb.title)}" is for, who it's for, and what matters most` };
  }
  if (nb.params.length === 0) {
    return { hint: 'Next: the limits sua should hold to.', placeholder: `e.g. budget, size, must-haves and deal-breakers for "${short(goal)}"` };
  }
  if (options.length === 0) {
    return { hint: "Next: candidates. Anything you've already seen?", placeholder: 'e.g. paste a link, or describe one you saw (what, price, where) and what you thought of it' };
  }
  const open = nb.criteria.find((c) => !c.met);
  if (open && nb.pipeline.length > 0) {
    return { hint: `Next: “${short(open.text, 60)}”.`, placeholder: `e.g. what you know about “${short(open.text)}” for the ${short(options[0].title, 40)}` };
  }
  if (nb.pipeline.length === 0) {
    return { hint: `${String(options.length)} option${options.length === 1 ? '' : 's'} so far. sua can keep looking for you.`, placeholder: 'e.g. "keep looking every morning", or tell sua about another one you saw' };
  }
  if (open) {
    return { hint: `Next: “${short(open.text, 60)}”.`, placeholder: `e.g. what you know about “${short(open.text)}”` };
  }
  return { hint: 'Every criterion is met. Ready to decide?', placeholder: `e.g. "go with the ${short(options[0].title, 40)}, because…"` };
}

/** The one box: tell sua, and it files it (opens the notebook's conversation beside the page). */
function talkForm(nb: Notebook, entries: readonly NotebookEntry[], big = false): SafeHtml {
  const step = nextStep(nb, entries);
  return html`
    <form method="POST" action="/notebooks/${encodeURIComponent(nb.id)}/ask" class="nb-talk__form ${big ? 'nb-talk__form--big' : ''}" data-ask-fix>
      <label class="nb-talk__next" for="nb-talk-${big ? 'big' : 'side'}">${step.hint}</label>
      <textarea id="nb-talk-${big ? 'big' : 'side'}" name="text" required rows="${big ? '4' : '3'}" class="form-field"
        placeholder="${step.placeholder}"></textarea>
      <button type="submit" class="btn btn--primary btn--sm">Tell sua</button>
    </form>`;
}

function sideForms(nb: Notebook, entries: readonly NotebookEntry[], lastWord?: { text: string; at: number }): SafeHtml {
  const hasEntries = entries.length > 0;
  const id = encodeURIComponent(nb.id);
  return html`
    ${hasEntries || nb.conversationId ? html`
      <section class="nb-side__card nb-talk" aria-labelledby="nb-talk-title">
        <h2 class="nb-side__title" id="nb-talk-title">Talk to sua about this notebook</h2>
        ${lastWord ? html`<blockquote class="nb-talk__last"><span class="nb-talk__who">sua · ${formatAge(new Date(lastWord.at).toISOString())}</span>${lastWord.text}</blockquote>` : html``}
        ${talkForm(nb, entries)}
        ${nb.conversationId ? html`<button type="button" class="btn btn--sm btn--ghost nb-talk__continue" data-nb-continue="${nb.conversationId}">Continue the conversation</button>` : html``}
      </section>` : html``}
    <details class="nb-side__card nb-addself">
      <summary class="nb-side__title">Add an entry yourself</summary>
      <form method="POST" action="/notebooks/${id}/entries" class="nb-form">
        <div class="nb-kinds" role="radiogroup" aria-label="What it is">
          ${(['note', 'option', 'evidence', 'decision'] as const).map((k, i) => html`
            <label class="nb-kind"><input type="radio" name="kind" value="${k}"${i === 0 ? unsafeHtml(' checked') : unsafeHtml('')}><span>${KIND_LABEL[k]}</span></label>`) as unknown as SafeHtml[]}
        </div>
        <input type="text" name="title" required class="form-field" placeholder="One line: 2019 RAV4 XLE, 54k mi, $24,900" autocomplete="off">
        <textarea name="body" rows="3" class="form-field" placeholder="Details (optional)"></textarea>
        <button type="submit" class="btn btn--sm">Add</button>
      </form>
    </details>
    <details class="nb-side__card nb-edit">
      <summary class="nb-side__title">Edit this notebook</summary>
      <form method="POST" action="/notebooks/${id}/edit" class="nb-form">
        <label class="nb-label">Title<input type="text" name="title" value="${nb.title}" required class="form-field"></label>
        <label class="nb-label">What it's for<textarea name="statement" rows="2" class="form-field">${nb.statement}</textarea></label>
        <label class="nb-label">Parameters, one per line<textarea name="params" rows="3" class="form-field">${nb.params.join('\n')}</textarea></label>
        <label class="nb-label">Done when, one per line<textarea name="criteria" rows="3" class="form-field">${nb.criteria.map((c) => c.text).join('\n')}</textarea></label>
        <label class="nb-label">Stages an option moves through, one per line<textarea name="stages" rows="3" class="form-field" placeholder="Found&#10;Applied&#10;Interview&#10;Offer">${nb.stages.join('\n')}</textarea></label>
        <label class="nb-label">Pipeline: agent ids, one per line<textarea name="pipeline" rows="3" class="form-field mono">${nb.pipeline.join('\n')}</textarea></label>
        <label class="nb-label">Runs (five-field schedule, or empty for when you ask)<input type="text" name="cadence" value="${nb.cadence}" class="form-field mono" placeholder="0 7 * * *"></label>
        <button type="submit" class="btn btn--sm">Save</button>
      </form>
      ${nb.status === 'active' ? html`<form method="POST" action="/notebooks/${id}/status" class="nb-form"><input type="hidden" name="status" value="stopped"><button type="submit" class="btn btn--sm btn--ghost">Stop this notebook</button></form>` : html``}
    </details>`;
}

export function renderNotebookPage(args: { nb: Notebook; entries: NotebookEntry[]; compiled: CompiledSurface; stages: PipelineStage[]; running?: { step: number; of: number }; lastWord?: { text: string; at: number }; flash?: { kind: 'error' | 'info' | 'ok'; message: string } }): string {
  return render(layout({ title: args.nb.title, activeNav: 'inbox', flash: args.flash, wide: true }, html`
    <p class="nb-crumbs"><a href="/">Home</a> › <a href="/notebooks">Notebooks</a></p>
    ${hero(args.nb, args.stages, args.running)}
    ${args.running ? unsafeHtml('<script>setTimeout(function () { if (!document.querySelector("textarea:focus, input:focus")) location.reload(); }, 6000);</script>') : html``}
    <div class="nb-body">
      <div class="nb-body__main" data-nb-main="${args.nb.id}" data-nb-count="${String(args.entries.length)}">${surfaceColumn(args.nb, args.compiled, args.entries)}</div>
      <aside class="nb-body__side">${sideForms(args.nb, args.entries, args.lastWord)}</aside>
    </div>
  `));
}

/** The notebook's sections alone (GET /notebooks/:id/main), for live updates. */
export function renderNotebookMain(nb: Notebook, compiled: CompiledSurface, entries: NotebookEntry[]): string {
  return render(surfaceColumn(nb, compiled, entries));
}

export function renderNotebooksList(args: { notebooks: Array<{ nb: Notebook; entries: number }>; openNew?: boolean; flash?: { kind: 'error' | 'info' | 'ok'; message: string } }): string {
  return render(layout({ title: 'Notebooks', activeNav: 'inbox', flash: args.flash, wide: true }, html`
    <p class="nb-crumbs"><a href="/">Home</a> › Notebooks</p>
    <div class="nb-list__head">
      <div>
        <h1 class="nb-list__title">Notebooks</h1>
        <p class="nb-list__sub">A goal you keep over time: what it's for, when it's done, what you've found, and what you decided.</p>
      </div>
    </div>
    <div class="nb-list">
      <details class="nb-card nb-card--new" id="new"${args.notebooks.length === 0 || args.openNew ? unsafeHtml(' open') : unsafeHtml('')}>
        <summary class="nb-card__new">+ New notebook</summary>
        <form method="POST" action="/notebooks" class="nb-form">
          <label class="nb-label">Title<input type="text" name="title" required class="form-field" placeholder="Buy a used car"></label>
          <label class="nb-label">What it's for<textarea name="statement" rows="2" class="form-field" placeholder="Find a reliable used SUV for family trips, and decide by Oct 15."></textarea></label>
          <label class="nb-label">Parameters, one per line<textarea name="params" rows="3" class="form-field" placeholder="SUV, AWD&#10;under $26,000&#10;under 60k miles"></textarea></label>
          <label class="nb-label">Done when, one per line<textarea name="criteria" rows="3" class="form-field" placeholder="At least one car that fits&#10;Clean history on the top choice&#10;A decision recorded"></textarea></label>
          <button type="submit" class="btn btn--primary btn--sm">Start the notebook</button>
        </form>
      </details>
      ${args.notebooks.map(({ nb, entries }) => {
        const { met, total } = notebookProgress(nb);
        return html`
          <a class="nb-card" href="/notebooks/${encodeURIComponent(nb.id)}">
            ${progressRing(met, total, 56)}
            <span class="nb-card__text">
              <span class="nb-card__title">${nb.title} <span class="nb-status nb-status--${nb.status}">${STATUS_LABEL[nb.status]}</span></span>
              <span class="nb-card__statement">${nb.decision ?? nb.statement}</span>
              <span class="nb-card__meta">${String(entries)} entr${entries === 1 ? 'y' : 'ies'} · updated ${formatAge(nb.updatedAt)}</span>
            </span>
          </a>`;
      }) as unknown as SafeHtml[]}
    </div>
  `));
}

/** The Notebooks line on Home (under the goal): no nav item until they've proven themselves. */
export function renderHomeNotebooksLine(active: number, total: number): SafeHtml {
  return html`<span class="home-notebooks" title="Notebooks: goals you keep over time">${NOTEBOOK_ICON}<a href="/notebooks">${total === 0 ? 'Notebooks' : `${String(active)} notebook${active === 1 ? '' : 's'}`}</a><a href="/notebooks?new=1" class="home-notebooks__new" aria-label="New notebook">+ New</a></span>`;
}
