/**
 * Notebooks (goal surfaces G1; mockup screen 22): the list, and one notebook,
 * a header that reads as its cover (what it's for, parameters, a pipeline
 * diagram, a progress ring over its criteria), its surface (options, notes
 * and decisions, evidence), and the forms to add to it, edit it, and close it
 * with a decision.
 */
import { isMeetingNotebook, layoutPreset, NOTEBOOK_LAYOUT_PRESETS, nextFireTime, optionLink, optionPassesStep, optionSteps, criterionLink, type NotebookCriterion, notebookProgress, stepProgress, stepFacts, type NotebookStep, notebookViewData, isRange, rankOptions, type NotebookViewHistory, type NotebookViewOption, type CompiledSurface, type Notebook, type NotebookEntry, type NotebookField, type NotebookFieldValue, type NotebookLayout } from '@some-useful-agents/core';
import { html, render, unsafeHtml, type SafeHtml } from './html.js';
import { notebookSetupEditor, renderDraftsStrip } from './notebook-new.js';
import type { DraftState } from '../lib/notebook-draft.js';
import { pageName, meetingWhenWords, type NotebookEditTurn } from '../lib/notebook-edit.js';
import { notebookLooks } from './notebook-look.js';
import { layout } from './layout.js';
import { working } from './working.js';
import { pageHeader } from './page-header.js';
import { renderSurfaceHost } from '../lib/a2ui-surface.js';
import { isYourStep, topFor, yourStepButton } from '../lib/notebook-steps.js';
import { suaStepAgentName } from '../lib/notebook-step-agents.js';
import { formatMoney, formatFieldValue } from '../lib/field-format.js';
import { handStagesHidden, notebookWidgetMessages, notebookHeaderView, type NotebookHeaderView, type NotebookWidgetHistory } from '../lib/notebook-widgets.js';
import { cronToHuman, formatAge } from './components.js';
import { pictureClass, pictureLabel } from '../lib/notebook-logos.js';
import type { NotebookLive, NotebookTalkLive } from '../lib/notebook-live.js';

const NOTEBOOK_ICON = unsafeHtml('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/><path d="M9 8h6"/></svg>');

const STATUS_LABEL: Record<Notebook['status'], string> = { active: 'active', decided: 'decided', stopped: 'stopped' };

/** Its status chip; an archived notebook says so whatever its status. */
function statusChip(nb: Pick<Notebook, 'status' | 'archivedAt'>): SafeHtml {
  return nb.archivedAt
    ? html`<span class="nb-status nb-status--archived">archived</span>`
    : html`<span class="nb-status nb-status--${nb.status}">${STATUS_LABEL[nb.status]}</span>`;
}

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

/**
 * The options still in the running, best first: furthest stage, then the
 * best price (lower unless the price field says higher is better).
 */
export function decisionLeads(nb: Notebook, entries: readonly NotebookEntry[], limit = 3, history?: NotebookViewHistory): NotebookViewOption[] {
  // With steps, how many it got through (a checked option missing one fact still counts its check); else the stage it was moved to (none comes last).
  const steps = optionSteps(nb.steps ?? []);
  const at = (o: NotebookViewOption) => (steps.length > 1 ? steps.filter((s) => optionPassesStep(nb, o, s)).length : o.stage ? nb.stages.indexOf(o.stage) : -1);
  // Best first by score (or price), then the furthest stage wins (a stable sort keeps the ranking within a stage).
  const ranked = rankOptions(nb, notebookViewData(nb, [...entries], history).notebook.options);
  return ranked.map((o, i) => [o, i] as const)
    .sort((a, b) => at(b[0]) - at(a[0]) || a[1] - b[1])
    .map(([o]) => o)
    .slice(0, limit);
}

/** "Ticks itself when you decide": what ticks a done-when for you, if anything does. */
export function criterionHint(nb: Notebook, c: NotebookCriterion): string | undefined {
  if (c.held) return undefined;
  const link = criterionLink(nb, c.text);
  if (!link) return undefined;
  if (link.kind === 'decide') return 'Ticks itself when you decide.';
  if (link.kind === 'count') return `Ticks itself at ${String(link.n)} in the running.`;
  if (link.kind === 'source') return 'Ticks itself when every fact is sourced.';
  return `Ticks itself when every option you choose passes "${link.check}".`;
}

/** The decision box's example, from the notebook's own leads. */
export function decisionPlaceholder(leads: readonly Pick<NotebookViewOption, 'name'>[]): string {
  if (leads.length >= 2) return `Chose ${leads[0].name}: why it fits. Not ${leads[1].name}: why not.`;
  if (leads.length === 1) return `Chose ${leads[0].name}: why it fits.`;
  return 'What you chose, and why. Or why you stopped looking.';
}

/** "Fit 85 · $120M · 1,200 employees": an option's ranking facts, for the decide list. */
function decideFacts(nb: Notebook, o: NotebookViewOption): SafeHtml {
  const facts = (['score', 'price', 'measure'] as const)
    .map((role) => nb.fields.find((f) => f.role === role))
    .filter((f): f is NotebookField => !!f && o.fields[f.key] !== undefined && o.fields[f.key] !== '')
    // "Fit 91", "1,645 employees" (a count without a unit says what it counts), "$4,023".
    .map((f) => html`<span title="${f.label}">${f.role === 'score' ? `${f.label} ` : ''}${formatFieldValue(f, o.fields[f.key])}${f.role === 'measure' && !f.unit && f.type === 'number' ? ` ${f.label.toLowerCase()}` : ''}</span>`);
  const checks = nb.checks.length ? nb.checks.filter((c) => o.checked.some((d) => d.toLowerCase() === c.toLowerCase())).length : -1;
  if (!facts.length && checks < 0) return html``;
  return html`<span class="nb-decide__facts">${facts as unknown as SafeHtml[]}${checks >= 0 ? html`<span class="nb-decide__checks${checks === nb.checks.length ? ' is-all' : ''}" title="Checks ticked">${String(checks)}/${String(nb.checks.length)} checked</span>` : html``}</span>`;
}

/**
 * Decide…: pick from the options still in the running (best first, with
 * their facts and checks), then say why if you like. One pick when the
 * decide step wants one; any number otherwise. With nothing in the running,
 * just say what you decided. Narrow… is the same list for a narrow step:
 * keep some, the rest are ruled out, and the notebook stays open.
 */
function decideForm(nb: Notebook, candidates: readonly NotebookViewOption[], mode: 'decide' | 'narrow' = 'decide'): SafeHtml {
  const id = encodeURIComponent(nb.id);
  const narrow = mode === 'narrow';
  const step = narrow ? nb.steps?.find((s) => s.kind === 'narrow' && s.status !== 'done') : nb.steps?.find((s) => s.kind === 'decide');
  const target = step?.target;
  const one = !narrow && target === 1;
  const why = narrow ? 'nb-narrow-why' : 'nb-decision';
  const word = narrow ? 'kept' : 'picked';
  if (!candidates.length && !narrow) {
    return html`<form method="POST" action="/notebooks/${id}/decide" class="nb-decide__form">
      <label for="nb-decision" class="nb-progress__label">What did you decide, and why?</label>
      <textarea id="nb-decision" name="decision" rows="4" required class="form-field" placeholder="${decisionPlaceholder([])}"></textarea>
      <button type="submit" class="btn btn--primary btn--sm">Record the decision and close</button>
    </form>`;
  }
  const want = target ? `${String(target)} ` : '';
  // A picture column when any option has one (the kept copy; never the seller's address).
  const thumbs = candidates.some((o) => o.image);
  const count = target ? `0 of ${String(target)} ${word}` : `0 ${word}`;
  // sua's latest picks (from your conversation): marked, and ticked with one button.
  const suggested = candidates.filter((o) => o.suggested).length;
  return html`<form method="POST" action="/notebooks/${id}/${narrow ? 'narrow' : 'decide'}" class="nb-decide__form" data-nb-decide data-nb-mode="${mode}" data-total="${String(candidates.length)}"${target ? html` data-target="${String(target)}"` : html``}>
    <div class="nb-decide__head">
      <h2 class="nb-act__title">${step?.title ?? (narrow ? 'Keep the ones that stay' : 'Pick what you chose')}</h2>
      <span class="nb-decide__count" data-nb-decide-count aria-live="polite">${count}</span>
    </div>
    <p class="nb-decide__hint">${String(candidates.length)} still in, best first.${suggested ? html` <button type="button" class="nb-decide__top" data-nb-decide-sua title="Tick the ones sua recommended in your conversation">Tick sua's picks (${String(suggested)})</button>` : html``}${narrow ? ' The ones you don\'t keep are ruled out (bring any back later); the notebook stays open.' : ''}${target && target > 1 && candidates.length > target ? html` <button type="button" class="nb-decide__top" data-nb-decide-top>${narrow ? 'Keep' : 'Pick'} the top ${String(target)}</button>` : html``}</p>
    <fieldset class="nb-decide__list${thumbs ? ' nb-decide__list--thumbs' : ''}">
      <legend class="sr-only">${narrow ? 'Keep' : one ? 'Pick one' : `Pick ${want || 'any'}`}</legend>
      ${candidates.map((o) => html`<div class="nb-decide__row">
        <label class="nb-decide__pick">
          <input type="${one ? 'radio' : 'checkbox'}" name="chosen" value="${o.id}"${o.chosen && !narrow ? html` checked` : html``}${o.suggested ? html` data-sua-pick` : html``}>
          ${thumbs ? (o.image ? html`<img class="nb-decide__thumb${o.imageKind && o.imageKind !== 'listing' ? ' is-fit' : ''}${o.imageKind === 'logo' ? ` is-logo${o.imageShape === 'wide' ? ' is-wide' : ''}` : ''}" src="${o.image}" alt="" loading="lazy">` : html`<span class="nb-decide__thumb" aria-hidden="true"></span>`) : html``}
          <span class="nb-decide__name">${o.suggested ? html`<span class="nb-decide__sua" title="sua recommended this one">sua</span> ` : html``}${o.title}</span>
          ${decideFacts(nb, o)}
        </label>
        <a class="nb-decide__open" href="/notebooks/${id}/entries/${encodeURIComponent(o.id)}" title="Open ${o.name}" aria-label="Open ${o.name}">↗</a>
      </div>`) as unknown as SafeHtml[]}
    </fieldset>
    <label for="${why}" class="nb-progress__label">${narrow ? 'Why not the rest?' : `Why${one ? ' this one' : ' these'}?`} <span class="nb-decide__optional">optional${narrow ? ', kept as their reason' : ''}</span></label>
    <textarea id="${why}" name="decision" rows="2" class="form-field" placeholder="${narrow ? 'e.g. over budget, or too many miles' : 'In a line or two, so you remember later.'}"></textarea>
    <div class="nb-decide__submit">
      <button type="submit" class="btn btn--primary btn--sm" data-nb-decide-submit${narrow ? html` disabled` : html``}>${narrow ? 'Keep these' : 'Decide and close'}</button>
      ${narrow ? html`` : html`<button type="submit" name="keep" value="1" class="btn btn--sm" title="Mark these as picked (bought, or going with them) and keep looking">Save picks, keep it open</button>`}
    </div>
  </form>`;
}

const STEP_UNIT: Record<NotebookStep['kind'], string> = { profile: 'facts', find: 'found', source: 'facts', check: 'checked', narrow: 'kept', decide: 'chosen', write: 'points' };
/** "today", "tomorrow", "in 3 days", "2 days ago" for a meeting's date. */
function meetingDays(when: string, now = new Date()): string {
  const [y, m, d] = when.split('T')[0].split('-').map(Number);
  const day = Math.round((new Date(y, m - 1, d).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000);
  return day === 0 ? 'today' : day === 1 ? 'tomorrow' : day === -1 ? 'yesterday' : day > 0 ? `in ${String(day)} days` : `${String(-day)} days ago`;
}

/**
 * A meeting notebook's meeting, under what it's for: when (and how soon) and
 * your goal; talking points written days before it say so, with Write again.
 * Without a goal or a date yet, a small form asks (your words, saved as is).
 */
export function meetingLine(nb: Notebook, now = new Date()): SafeHtml {
  if (!isMeetingNotebook(nb)) return html``;
  const id = encodeURIComponent(nb.id);
  const m = nb.meeting ?? {};
  const write = nb.steps?.find((x) => x.kind === 'write' && !x.shape);
  const ageDays = nb.briefing?.at ? Math.floor((now.getTime() - Date.parse(nb.briefing.at)) / 86_400_000) : 0;
  const upcoming = !!m.when && !/ago|yesterday/.test(meetingDays(m.when, now));
  const stale = upcoming && nb.briefing?.points.length && ageDays >= 3 && write && (write.status === 'done' || write.status === 'met');
  // Closed until asked for: one quiet line, then a compact row (date · time · goal · Save) with notes under it.
  const set = !!(m.when || m.goal);
  const form = html`<details class="nb-meeting__edit">
      <summary>${set ? 'Edit' : html`<span class="nb-meeting__add">＋ Add the meeting</span> <span class="nb-meeting__why">when, and what you want from it</span>`}</summary>
      <form method="POST" action="/notebooks/${id}/meeting" class="nb-meeting__form">
        <label class="sr-only" for="nbm-date-${nb.id}">Date</label><input id="nbm-date-${nb.id}" type="date" name="meeting_date" value="${(m.when ?? '').split('T')[0]}" class="form-field nb-meeting__date">
        <label class="sr-only" for="nbm-time-${nb.id}">Time</label><input id="nbm-time-${nb.id}" type="time" name="meeting_time" value="${(m.when ?? '').split('T')[1] ?? ''}" class="form-field nb-meeting__time">
        <label class="sr-only" for="nbm-goal-${nb.id}">Your goal</label><input id="nbm-goal-${nb.id}" type="text" name="meeting_goal" value="${m.goal ?? ''}" class="form-field nb-meeting__goalin" maxlength="300" placeholder="Your goal, e.g. explore a partnership on X">
        <button type="submit" class="btn btn--primary btn--sm">Save</button>
        <label class="sr-only" for="nbm-notes-${nb.id}">Notes</label><input id="nbm-notes-${nb.id}" type="text" name="meeting_notes" value="${m.notes ?? ''}" class="form-field nb-meeting__notes" maxlength="600" placeholder="Notes (optional): what you already know, who else is coming">
      </form>
    </details>`;
  return html`<div class="nb-meeting">
    ${set ? html`<span class="nb-meeting__line">${m.when ? html`<span class="nb-meeting__when">Meeting <strong>${meetingWhenWords(m.when)}</strong> · ${meetingDays(m.when, now)}</span>` : html``}${m.goal ? html`<span class="nb-meeting__goal">Your goal: ${m.goal}</span>` : html``}</span>` : html``}
    ${form}
    ${stale ? html`<form method="POST" action="/notebooks/${id}/steps/${write!.id}/again" class="nb-meeting__stale"><span>The talking points are ${String(ageDays)} days old.</span> <button type="submit" class="nb-step__focus-btn">Write again →</button></form>` : html``}
  </div>`;
}

const STEP_STATUS: Record<NotebookStep['status'], string> = { todo: 'to do', running: 'running', met: 'goal met', stuck: 'stuck', done: 'done' };

/**
 * The notebook's work in steps: each with its agent, how far it is toward
 * its goal ("8 of 10 found") and where it stands. The step being worked on
 * (the first not done) is marked; what it still needs is its tooltip.
 */
export function stepsStrip(nb: Notebook, steps: readonly NotebookStep[], entries: readonly NotebookEntry[], running = false): SafeHtml {
  const current = steps.find((x) => x.status !== 'done');
  const inRunning = entries.filter((e) => e.kind === 'option' && !e.ruledOut).length;
  const focus = topFor(nb, inRunning);
  // All done (or decided): one quiet line per step, no bars.
  const finished = !running && (nb.status === 'decided' || steps.every((x) => x.status === 'done'));
  // The last run's note belongs to the step it ran (it starts with that step's title).
  const lastRun = nb.lastRunAt && nb.lastRunNote ? `Last run ${formatAge(nb.lastRunAt)}: ${nb.lastRunNote}` : '';
  return html`<ol class="nb-steps${finished ? ' nb-steps--done' : ''}" style="--n:${String(Math.min(steps.length, 6))}" aria-label="Steps">
    ${steps.map((step, i) => {
      const p = stepProgress(nb, entries, step);
      const by = step.agentId ?? suaStepAgentName(step.kind) ?? (isYourStep(step) ? 'you' : '');
      // A source step that looks up only some facts names them.
      const only = step.kind === 'source' && step.facts?.length ? stepFacts(nb, step).map((f) => f.label.toLowerCase()).join(', ') : '';
      const pct = p.want ? Math.min(100, Math.round((p.have / p.want) * 100)) : 0;
      const missing = p.missing.length ? `Still needed: ${p.missing.slice(0, 8).join('; ')}${p.missing.length > 8 ? `; and ${String(p.missing.length - 8)} more` : ''}` : '';
      const progress = step.kind === 'decide' && step.status !== 'done' ? (p.have ? `${String(p.have)} of ${String(p.want)} picked` : `pick ${String(p.want)}`)
        : step.kind === 'narrow' && step.status !== 'done' ? (step.target ? `keep ${String(step.target)}` : 'keep the best')
        : step.kind === 'find' && p.have > p.want ? `${String(p.have)} found, goal ${String(p.want)}`
          : step.kind === 'write' && step.shape === 'answer' ? (p.have ? 'answer written' : 'no answer yet')
          : step.kind === 'write' && step.shape === 'plan' ? (p.have ? 'plan written' : 'no plan yet')
          : `${String(p.have)} of ${String(p.want)} ${STEP_UNIT[step.kind]}`;
      const state = step.movedOn ? 'moved on' : STEP_STATUS[step.status];
      const stateKind = step.movedOn ? 'moved' : step.status;
      const tip = [missing || step.note || '', lastRun && nb.lastRunNote!.startsWith(step.title) ? lastRun : ''].filter(Boolean).join('\n');
      // is-live: the step is really running now (a 'running' status left by a restart doesn't spin).
      return html`<li class="nb-step nb-step--${step.status}${step === current ? ' nb-step--current' : ''}${running && step.status === 'running' ? ' is-live' : ''}" title="${tip}">
        <span class="nb-step__n" aria-hidden="true">${step.status === 'done' ? '✓' : String(i + 1)}</span>
        <span class="nb-step__body">
          <span class="nb-step__title" title="${step.title}">${step.title}</span>
          <span class="nb-step__by">${by ? (step.agentId ? html`with <span class="nb-step__agent" title="${by}">${by}</span>` : html`with ${by}`) : html`<span class="nb-step__need">needs an agent</span>`}${only ? html` · <span class="nb-step__facts" title="${only}">${String(step.facts!.length)} ${step.facts!.length === 1 ? 'fact' : 'facts'}</span>` : html``}</span>
          <span class="nb-step__bar" aria-hidden="true"><span style="width:${String(pct)}%"></span></span>
          <span class="nb-step__meta"><span class="nb-step__count">${progress}${step.top ? ` · top ${String(step.top)}` : ''}</span><span class="nb-step__state nb-step__state--${stateKind}">${state}</span></span>
          ${step.why && step.movedOn ? html`<span class="nb-step__why" title="${step.why}">${step.why}</span>` : html``}
          ${!running && nb.status === 'active' && (step.kind === 'check' || step.kind === 'source') && (step.movedOn || step.status === 'stuck') && !p.met && inRunning > focus && (!step.top || step.top > focus)
            ? html`<form method="POST" action="/notebooks/${encodeURIComponent(nb.id)}/steps/${step.id}/top" class="nb-step__focus"><input type="hidden" name="top" value="${String(focus)}"><button type="submit" class="nb-step__focus-btn" title="Work on this step again for just the best ${String(focus)} of the ${String(inRunning)} in the running">${step.kind === 'check' ? 'Check' : 'Source'} the top ${String(focus)} →</button></form>`
            : html``}
          ${!running && nb.status === 'active' && step.kind === 'find' && (step.status === 'done' || step.status === 'met')
            ? html`<form method="POST" action="/notebooks/${encodeURIComponent(nb.id)}/steps/${step.id}/again" class="nb-step__focus"><button type="submit" class="nb-step__focus-btn" title="Run this step's search once more for new ones; the notebook keeps the ones it has">Search again →</button></form>`
            : html``}
          ${!running && nb.status === 'active' && step.kind === 'profile' && (step.status === 'done' || step.status === 'met')
            ? html`<form method="POST" action="/notebooks/${encodeURIComponent(nb.id)}/steps/${step.id}/again" class="nb-step__focus"><button type="submit" class="nb-step__focus-btn" title="Learn about them once more: new facts, and a photo that's clearly them; what it learned stays">Look again →</button></form>`
            : html``}
          ${!running && nb.status === 'active' && step.kind === 'write' && (step.status === 'done' || step.status === 'met')
            ? step.shape === 'answer' || step.shape === 'plan'
              ? html`<form method="POST" action="/notebooks/${encodeURIComponent(nb.id)}/steps/${step.id}/again" class="nb-step__focus"><button type="submit" class="nb-step__focus-btn" title="Write the ${step.shape} once more, from what the notebook has now; this one is replaced">${step.shape === 'plan' ? 'Plan again' : 'Answer again'} →</button></form>`
              : html`<form method="POST" action="/notebooks/${encodeURIComponent(nb.id)}/steps/${step.id}/again" class="nb-step__focus"><button type="submit" class="nb-step__focus-btn" title="${nb.briefing?.by === 'you' ? 'Write the talking points once more, from what the notebook has now; your edits are replaced' : 'Write the talking points once more, from what the notebook has now; these are replaced'}">Write again →</button></form>${nb.briefing?.points.length ? html`<a class="nb-step__focus-btn" href="/notebooks/${encodeURIComponent(nb.id)}/talking-points" title="Reword, reorder, remove or add talking points">Edit the points →</a>` : html``}`
            : html``}
          ${!running && nb.status === 'active' && step === current && (step.kind === 'decide' || step.kind === 'narrow')
            ? html`<button type="button" class="nb-step__focus-btn" data-nb-open-act="${step.kind}" title="${step.kind === 'decide' ? 'Tick the ones you picked; the notebook can stay open' : 'Tick the ones to keep; the rest are ruled out'}">${step.kind === 'decide' ? (p.have ? 'Change the picks' : `Pick ${String(p.want)}`) : 'Narrow'}… →</button>`
            : html``}
        </span>
      </li>`;
    }) as unknown as SafeHtml[]}
  </ol>${current?.status === 'stuck' && current.why && !running ? html`<p class="nb-steps__why"><strong>${current.title}</strong> stopped short. ${current.why}</p>` : html``}`;
}

/**
 * A decision's picks, when it's the usual "Chose A, B and C. Why."
 * (NotebookStore.decide): the chosen options in the order it names them,
 * each "Name: what it is" split so the name stands out, and the why after.
 * Undefined for anything else (it shows as written).
 */
export function decisionPicks(nb: Notebook, entries: readonly NotebookEntry[]): { picks: Array<{ entry: NotebookEntry; name: string; what: string }>; why: string } | undefined {
  const text = nb.decision ?? '';
  const chosen = entries.filter((e) => e.kind === 'option' && e.chosenAt && text.includes(e.title));
  if (!text.startsWith('Chose ') || chosen.length < 2) return undefined;
  const order = chosen.map((e) => ({ e, at: text.indexOf(e.title) })).sort((a, b) => a.at - b.at);
  const last = order[order.length - 1];
  const why = text.slice(last.at + last.e.title.length).replace(/^\.\s*/, '').trim();
  return {
    picks: order.map(({ e }) => {
      const k = e.title.indexOf(': ');
      return { entry: e, name: k > 0 && k < 60 ? e.title.slice(0, k) : e.title, what: k > 0 && k < 60 ? e.title.slice(k + 2) : '' };
    }),
    why,
  };
}

/** A decided notebook's decision: its picks as a list, each linking to its page, then the why; else as written. */
export function decidedBox(nb: Notebook, entries: readonly NotebookEntry[]): SafeHtml {
  const when = formatAge(nb.decidedAt ?? nb.updatedAt);
  const d = decisionPicks(nb, entries);
  if (!d) return html`<div class="nb-decided"><strong>Decided ${when}:</strong> ${nb.decision ?? ''}</div>`;
  const id = encodeURIComponent(nb.id);
  return html`<div class="nb-decided">
    <strong>Decided ${when}</strong> <span class="nb-decided__count">· ${String(d.picks.length)} chosen</span>
    <ul class="nb-decided__list">
      ${d.picks.map((p) => html`<li><a href="/notebooks/${id}/entries/${encodeURIComponent(p.entry.id)}">${p.name}</a>${p.what ? html` <span class="nb-decided__what">${p.what}</span>` : html``}</li>`) as unknown as SafeHtml[]}
    </ul>
    ${d.why ? html`<p class="nb-decided__why">${d.why}</p>` : html``}
  </div>`;
}

/**
 * What's next while a notebook has steps left: a button for the header (Next
 * step, Try again, Finish) with the step it acts on, or a note when
 * the next move is yours (Decide) or the step has no agent yet. Undefined
 * once every step is done (Run runs the pipeline again).
 */
export function nextStepAction(nb: Notebook): { label: string; hint: string; moveOn?: boolean; alt?: { label: string; hint: string; moveOn?: boolean } } | { note: string } | undefined {
  const steps = nb.steps ?? [];
  const i = steps.findIndex((x) => x.status !== 'done');
  if (i < 0) return undefined;
  const step = steps[i];
  const next = steps[i + 1];
  const of = `of ${String(steps.length)}`;
  if (step.status === 'met') {
    if (!next) return { label: 'Finish', hint: `Step ${String(i + 1)} ${of} is done; that was the last.` };
    return isYourStep(next)
      ? { note: `Step ${String(i + 1)} is done. Next: ${next.title}, with ${yourStepButton(next)}.` }
      : { label: 'Next step', hint: `Step ${String(i + 1)} is done. Next: step ${String(i + 2)} ${of}, ${next.title}.` };
  }
  if (isYourStep(step)) return { note: `Next: ${step.title}, with ${yourStepButton(step)}.` };
  // A check or find step without an agent uses sua's checker or finder; source needs one.
  if (!step.agentId && !suaStepAgentName(step.kind)) return { note: `${step.title} needs an agent. Ask sua to pick or build one.` };
  if (step.status !== 'stuck') return { label: 'Next step', hint: `Step ${String(i + 1)} ${of}: ${step.title}` };
  // Short of its goal: Try again, or Move on with what it found; Move on first when its agent got no further.
  const again = { label: 'Try again', hint: `Step ${String(i + 1)} ${of}, ${step.title}, stopped short. Run it again.` };
  const move = { label: 'Move on', hint: `Keep what ${step.title} found and ${next ? `go on to ${next.title}` : 'finish'}.`, moveOn: true };
  return step.stalled ? { ...move, alt: again } : { ...again, alt: move };
}

/** The pipeline's button, once there are no steps left (with steps, the header has Next step). */
function runButton(nb: Notebook): SafeHtml {
  const next = nextStepAction(nb);
  if (next) return 'note' in next ? html`<span class="nb-run__last">${next.note}</span>` : html``;
  return nb.pipeline.length ? html`<form method="POST" action="/notebooks/${encodeURIComponent(nb.id)}/run" class="nb-run__form"><button type="submit" class="btn btn--sm">Run the pipeline now</button></form>` : html``;
}

/**
 * "3 new in the last run": a link to the shortlist showing only those. Only
 * when some are new and some aren't (the first run's are all new).
 */
function newLink(options: readonly NotebookViewOption[]): SafeHtml {
  const fresh = options.filter((o) => o.added === 'new' && !o.ruledOut).length;
  if (fresh === 0 || fresh === options.filter((o) => !o.ruledOut).length) return html``;
  return html` · <a class="nb-hero__new" href="?added=new">${String(fresh)} new in the last run →</a>`;
}

/** What a waiting conversation (or your own step) asks of you, as a label and a button. */
export function waitingWords(kind: 'approve' | 'answer' | 'fail' | 'step', act?: 'decide' | 'narrow'): { label: string; button: string } {
  if (kind === 'step') return { label: 'Your step', button: act === 'narrow' ? 'Narrow…' : 'Decide…' };
  if (kind === 'approve') return { label: 'sua needs your OK', button: 'Review and approve' };
  if (kind === 'fail') return { label: 'Something failed', button: 'See what happened' };
  return { label: 'sua needs your answer', button: 'Answer sua' };
}

/** The button a waiting state is answered with: your step's header control, else the conversation. */
function waitingButton(talk: Extract<NotebookTalkLive, { state: 'waiting' }>): SafeHtml {
  const w = waitingWords(talk.kind, talk.kind === 'step' ? talk.act : undefined);
  return talk.kind === 'step'
    ? html`<button type="button" class="btn btn--sm btn--primary" data-nb-open-act="${talk.act}">${w.button}</button>${talk.threadId ? html`<button type="button" class="btn btn--sm btn--ghost" data-nb-continue="${talk.threadId}">Ask sua</button>` : html``}`
    : html`<button type="button" class="btn btn--sm btn--primary" data-nb-continue="${talk.threadId}">${w.button}</button>`;
}

/**
 * What's live on the notebook, as a bar under its steps: its conversation
 * waiting on you (amber, with the button that opens it), sua replying there,
 * and the step or pass running. Each opens the conversation. The page
 * redraws it as it changes (notebook-page.js.ts, X-Notebook-Live).
 */
export function liveBar(live: NotebookLive | undefined): SafeHtml {
  const talk = live?.talk;
  const work = live?.work ?? [];
  if (!talk && work.length === 0) return html`<div class="nb-live" data-nb-live-bar hidden></div>`;
  const open = (threadId: string, label: string, primary: boolean): SafeHtml => html`<button type="button" class="btn btn--sm${primary ? ' btn--primary' : ' btn--ghost'}" data-nb-continue="${threadId}">${label}</button>`;
  return html`<div class="nb-live" data-nb-live-bar>
      ${talk?.state === 'waiting' ? html`<div class="nb-live__row nb-live__row--waiting" role="status">
        <span class="nb-live__dot" aria-hidden="true"></span>
        <span class="nb-live__text"><strong>${waitingWords(talk.kind).label}</strong> · ${talk.text}</span>
        ${waitingButton(talk)}
      </div>` : html``}
      ${talk?.state === 'working' ? html`<div class="nb-live__row nb-live__row--working" role="status">
        <span class="working__spin" aria-hidden="true"></span>
        <span class="nb-live__text"><strong>${talk.text.replace(/…$/, '')}</strong> on a reply in this notebook's conversation…</span>
        ${open(talk.threadId, 'Watch', false)}
      </div>` : html``}
      ${work.length ? html`<div class="nb-live__row nb-live__row--working" role="status" data-notebook-running>
        <span class="working__spin" aria-hidden="true"></span>
        <span class="nb-live__text"><strong>${work.join(' · ')}…</strong> <span class="nb-live__note">this page updates as it goes</span></span>
      </div>` : html``}
    </div>`;
}

/**
 * Steps folded away (a drawn page's header says so, once the work is mostly
 * done): one line saying how far it got and what's now, opening to the strip.
 */
function foldedSteps(nb: Notebook, steps: readonly NotebookStep[], strip: SafeHtml): SafeHtml {
  const done = steps.filter((x) => x.status === 'done' || x.status === 'met').length;
  const now = steps.find((x) => x.status !== 'done' && x.status !== 'met');
  return html`<details class="nb-hero__steps">
      <summary>Steps: ${String(done)} of ${String(steps.length)} done${now ? html` · now: <b>${now.title}</b>` : html``}</summary>
      ${strip}
    </details>`;
}

function hero(nb: Notebook, stages: PipelineStage[], running?: { step: number; of: number }, widgetsIn = false, coverIn?: { src: string; kind: string; shape?: string }, leads: readonly NotebookViewOption[] = [], entries: readonly NotebookEntry[] = [], busy: readonly string[] = [], live?: NotebookLive, head?: NotebookHeaderView): SafeHtml {
  // A drawn page's NotebookHeader shapes this header; its page has its own parts, so the side box goes.
  const widgets = widgetsIn || !!head;
  const cover = head?.cover === 'none' ? undefined : coverIn;
  const { met, total } = notebookProgress(nb);
  const id = encodeURIComponent(nb.id);
  const human = nb.cadence ? cronToHuman(nb.cadence) : '';
  const next = human && nb.status === 'active' && nb.pipeline.length ? nextFireTime(nb.cadence) : null;
  // A schedule with nothing to run says so, rather than implying it runs.
  // A watch with a find step searches again with it; with neither, there's nothing to run.
  const idle = human && nb.status === 'active' && nb.pipeline.length === 0 && !nb.steps?.some((x) => x.kind === 'find') ? ' once it has a search (add one under Edit)' : '';
  const cadence = human ? `runs ${human.charAt(0).toLowerCase()}${human.slice(1)}${next ? `, next ${formatWhen(next)}` : idle}` : 'runs when you ask';
  return html`
    <section class="nb-hero${widgets ? ' nb-hero--wide' : ''}${head?.side ? ' nb-hero--side' : ''}" aria-labelledby="nb-title">
      <div class="nb-hero__main">
        <div class="nb-hero__titlerow">
          ${cover
            ? html`<img class="${['nb-hero__cover', pictureClass(cover.kind, cover.shape)].filter(Boolean).join(' ')}" src="${cover.src}" alt="" title="${cover.kind === 'illustration' ? 'An illustration' : cover.kind === 'listing' ? 'From a listing' : cover.kind === 'logo' ? 'A logo' : 'An example photo'}">`
            : html`<span class="nb-hero__icon">${NOTEBOOK_ICON}</span>`}
          <div class="nb-hero__names">
            <h1 class="nb-hero__title" id="nb-title">${nb.title}</h1>
            ${head?.subtitle ? html`<p class="nb-hero__subtitle">${head.subtitle}</p>` : html``}
          </div>
          ${statusChip(nb)}
          ${widgets ? html`<div class="nb-hero__acts">${heroActions(nb, entries, leads, running)}</div>` : html``}
        </div>
        ${head?.statement === false ? html`` : nb.statement ? html`<p class="nb-hero__statement">${nb.statement}</p>` : html`<p class="nb-hero__statement nb-hero__statement--empty">Say what this notebook is for under Edit.</p>`}
        ${meetingLine(nb)}
        <div class="nb-hero__chips">
          ${widgets ? html`` : nb.params.map((p) => html`<span class="nb-chip">${p}</span>`) as unknown as SafeHtml[]}
          <span class="nb-hero__meta">started ${formatAge(nb.createdAt)} · ${cadence} · <a href="/notebooks/${id}/workflow">How it was made →</a>${running ? html`` : newLink(leads)}</span>
        </div>
        ${nb.steps?.length
          ? (head?.steps === 'fold' && !running ? foldedSteps(nb, nb.steps, stepsStrip(nb, nb.steps, entries, !!running)) : stepsStrip(nb, nb.steps, entries, !!running))
          : pipelineDiagram(stages)}
        ${liveBar(live ?? { work: [...(running ? [`Running step ${String(running.step)} of ${String(running.of)}`] : []), ...busy] })}
        ${(nb.pipeline.length || nb.steps?.length) && !running && !busy.length && (nb.status === 'active' || (nb.lastRunAt && !nb.steps?.length)) ? html`
          <div class="nb-run">
            ${nb.status === 'active' ? runButton(nb) : html``}
            ${nb.lastRunAt && !nb.steps?.length ? html`<span class="nb-run__last">Last run ${formatAge(nb.lastRunAt)}: ${nb.lastRunNote ?? ''}</span>` : html``}
          </div>` : html``}
        ${nb.status === 'decided' && nb.decision ? decidedBox(nb, entries) : html``}
      </div>
      ${head?.side ? html`<aside class="nb-hero__side nb-hero__side--drawn" aria-label="At a glance">${renderSurfaceHost(`notebook-${nb.id}-header`, head.side, { label: `${nb.title}: at a glance` })}</aside>` : html``}
      ${widgets ? html`` : html`<aside class="nb-hero__side" aria-label="Done when">
        <div class="nb-progress">
          ${progressRing(met, total)}
          <div class="nb-progress__list">
            <span class="nb-progress__label">Done when</span>
            ${total === 0 ? html`<span class="nb-progress__empty">No criteria yet. Add them with Edit, above.</span>` : html``}
            ${nb.criteria.map((c, i) => html`
              <form method="POST" action="/notebooks/${id}/criteria/${String(i)}" class="nb-crit">
                <input type="hidden" name="met" value="${c.met ? '0' : '1'}">
                <button type="submit" class="nb-crit__btn ${c.met ? 'is-met' : ''}" aria-pressed="${c.met ? 'true' : 'false'}" title="${c.met ? 'Mark not met' : 'Mark met'}">${c.met ? '✓' : '○'}</button>
                <span class="nb-crit__text ${c.met ? 'is-met' : ''}"${criterionHint(nb, c) ? html` title="${criterionHint(nb, c)}"` : html``}>${c.text}</span>
              </form>`) as unknown as SafeHtml[]}
          </div>
        </div>
        ${heroActions(nb, entries, leads, running)}
      </aside>`}
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

export { formatMoney, formatFieldValue } from '../lib/field-format.js';

/** An option's facts as chips, in the notebook's field order; its listing as a link. */
function optionFacts(nb: Notebook, e: NotebookEntry, v?: NotebookViewOption): SafeHtml {
  const data = e.data ?? {};
  const facts = nb.fields.filter((f) => data[f.key] !== undefined && f.type !== 'image' && f.type !== 'url');
  const link = nb.fields.find((f) => f.role === 'link' && typeof data[f.key] === 'string');
  if (facts.length === 0 && !link) return html``;
  const seenAgain = e.lastSeenAt && e.lastSeenAt.slice(0, 16) !== e.createdAt.slice(0, 16);
  return html`<div class="nb-facts">
    ${facts.map((f) => html`<span class="nb-fact${f.role === 'price' ? ' nb-fact--price' : ''}" title="${f.label}">${formatFieldValue(f, data[f.key])}</span>`)}
    ${link ? bodyWithLinks(String(data[link.key])) : html``}
    ${v?.priceChange ? priceChangeChip(nb, v.priceChange) : html``}
    ${v?.notSeenLately && !e.ruledOut
      ? html`<span class="nb-fact nb-fact--gone" title="The last ${String(v.missedSearches)} searches found other options but not this one. It may be sold or taken down.">not in the last ${String(v.missedSearches)} searches</span>`
      : seenAgain ? html`<span class="nb-fact nb-fact--seen" title="first seen ${formatAge(e.createdAt)}">seen again ${formatAge(e.lastSeenAt!)}</span>` : html``}
  </div>`;
}

const QUICK_REASONS = ['Not interested', 'Too expensive', 'No reply', 'Failed a check'];

/**
 * An option's place in the funnel: its stage, the next one, and ruling it out
 * (or back in). `back: 'option'` returns to the option's own page after.
 */
export function optionStage(nb: Notebook, e: NotebookEntry, opts: { back?: 'option' } = {}): SafeHtml {
  const base = `/notebooks/${encodeURIComponent(nb.id)}/entries/${e.id}`;
  const to = opts.back === 'option' ? html`<input type="hidden" name="back" value="option">` : html``;
  // With steps, how far it got is the steps' to say: no stage chip or Move button.
  const hidden = handStagesHidden(nb);
  if (e.ruledOut) {
    return html`<div class="nb-stage nb-stage--out">
      <span class="nb-stage__out">${e.ruledOut.gone ? 'No longer available' : html`Ruled out${e.ruledOut.stage && !hidden ? ` at ${e.ruledOut.stage}` : ''}: ${e.ruledOut.reason}`}</span>
      <form method="POST" action="${base}/reinstate">${to}<button type="submit" class="btn btn--sm btn--ghost">Bring back</button></form>
    </div>`;
  }
  const i = nb.stages.findIndex((s) => s === e.stage);
  const next = nb.stages.length && !hidden ? nb.stages[i + 1] : undefined;
  return html`<div class="nb-stage">
    ${e.chosenAt ? html`<span class="nb-stage__chip nb-stage__chip--chosen" title="Picked ${formatAge(e.chosenAt)}">✓ Picked</span>` : html``}
    <form method="POST" action="${base}/choose">${to}${e.chosenAt
      ? html`<input type="hidden" name="on" value="0"><button type="submit" class="btn btn--sm btn--ghost" title="Take the pick back">Unpick</button>`
      : html`<button type="submit" class="btn btn--sm${opts.back === 'option' ? ' btn--primary' : ''}" title="Bought it, or going with it. The notebook stays open.">Pick this one</button>`}</form>
    ${e.stage && !hidden ? html`<span class="nb-stage__chip" title="Stage ${String(i + 1)} of ${String(nb.stages.length)}">${e.stage}</span>` : html``}
    ${next ? html`<form method="POST" action="${base}/stage">${to}<input type="hidden" name="stage" value="${next}"><button type="submit" class="btn btn--sm">Move to ${next} →</button></form>` : html``}
    <details class="nb-ruleout">
      <summary class="btn btn--sm btn--ghost">Rule out…</summary>
      <form method="POST" action="${base}/rule-out" class="nb-ruleout__form">${to}
        <span class="nb-ruleout__label">Why? It stays here, and searches won't suggest it again.</span>
        <div class="nb-ruleout__quick"><button type="submit" name="gone" value="1" class="btn btn--sm" title="Sold, filled or taken down">No longer available</button>${QUICK_REASONS.map((r) => html`<button type="submit" name="quick" value="${r}" class="btn btn--sm">${r}</button>`)}</div>
        <div class="nb-ruleout__row"><input type="text" name="reason" class="form-field" placeholder="or in your words: didn't like the color" aria-label="Reason"><button type="submit" class="btn btn--sm btn--primary">Rule out</button></div>
      </form>
    </details>
  </div>`;
}

/** Found 9 → Checked 2 → Test drive 0 · 3 ruled out: how far options got. */
function funnelStrip(nb: Notebook, entries: readonly NotebookEntry[]): SafeHtml {
  if (nb.stages.length === 0 && !nb.steps?.length) return html``;
  const { funnel, ruledOutCount } = notebookViewData(nb, entries).notebook;
  return html`<ol class="nb-funnel" aria-label="How far options got">
    ${funnel.map((f, i) => html`<li class="nb-funnel__step${f.here ? ' nb-funnel__step--here' : ''}" title="${String(f.reached)} reached ${f.stage}; ${String(f.here)} here now${f.ruledOut ? `; ${String(f.ruledOut)} ruled out here (${f.reasons.map((r) => `${r.reason} ×${String(r.count)}`).join(', ')})` : ''}">
      ${i > 0 ? html`<span class="nb-funnel__arrow" aria-hidden="true">→</span>` : html``}
      <span class="nb-funnel__n">${String(f.reached)}</span> ${f.stage}${f.ruledOut ? html` <span class="nb-funnel__out">−${String(f.ruledOut)}</span>` : html``}
    </li>`)}
    ${ruledOutCount ? html`<li class="nb-funnel__total">${String(ruledOutCount)} ruled out</li>` : html``}
  </ol>`;
}

/** "↓ $300 since Oct 5": a price move, green when it moved the way that's better. */
export function priceChangeChip(nb: Notebook, c: { from: number; to: number; since: string }): SafeHtml {
  const f = nb.fields.find((x) => x.role === 'price');
  const better = f?.better ?? 'lower';
  const down = c.to < c.from;
  const good = (down && better === 'lower') || (!down && better === 'higher');
  const amount = f ? formatFieldValue(f, Math.abs(c.to - c.from)) : String(Math.abs(c.to - c.from));
  const since = new Date(c.since).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return html`<span class="nb-fact ${good ? 'nb-fact--better' : 'nb-fact--worse'}" title="${f ? `${formatFieldValue(f, c.from)} → ${formatFieldValue(f, c.to)}` : ''}">${down ? '↓' : '↑'} ${amount} since ${since}</span>`;
}

function entryCard(nb: Notebook, e: NotebookEntry, v?: NotebookViewOption): SafeHtml {
  return html`
    <li class="nb-entry nb-entry--${e.kind}${e.ruledOut ? ' nb-entry--out' : ''}${v?.image ? ' nb-entry--photo' : ''}" id="entry-${e.id}">
      ${v?.image ? html`<img class="nb-entry__photo" src="${v.image}" alt="" loading="lazy" width="132" height="99">` : html``}
      <div class="nb-entry__head">
        <span class="nb-entry__kind">${KIND_LABEL[e.kind]}</span>
        <strong class="nb-entry__title">${e.title}</strong>
        <form method="POST" action="/notebooks/${encodeURIComponent(nb.id)}/entries/${e.id}/remove" class="nb-entry__remove">
          <button type="submit" class="btn btn--xs btn--ghost" aria-label="Remove “${e.title}”" title="Remove">×</button>
        </form>
      </div>
      ${e.kind === 'option' ? optionFacts(nb, e, v) : html``}
      ${e.kind === 'option' ? optionStage(nb, e) : html``}
      ${e.body ? html`<p class="nb-entry__body">${bodyWithLinks(e.body)}</p>` : html``}
      <span class="nb-entry__by">${e.by === 'you' ? 'you' : e.by.replace(/^agent:/, '')} · ${formatAge(e.createdAt)}${e.runId ? html` · <a href="/runs/${encodeURIComponent(e.runId)}" class="mono">run ${e.runId.slice(0, 8)}</a>` : html``}</span>
    </li>`;
}

function surfaceColumn(nb: Notebook, compiled: CompiledSurface, entries: NotebookEntry[], history?: NotebookViewHistory, settingUp = false): SafeHtml {
  const note = settingUp
    ? html`<p class="nb-setup" role="status"><span class="working__spin" aria-hidden="true"></span>sua is setting up this notebook: what each option records, the stages they go through, and a page that fits what it's for. This page updates when it's done.</p>`
    : html``;
  return html`${note}${surfaceColumnBody(nb, compiled, entries, history)}`;
}

function surfaceColumnBody(nb: Notebook, compiled: CompiledSurface, entries: NotebookEntry[], history?: NotebookViewHistory): SafeHtml {
  const byId = new Map(entries.map((e) => [`nbentry:${e.id}`, e]));
  const views = new Map(notebookViewData(nb, entries, history).notebook.options.map((o) => [o.id, o]));
  const canPhoto = nb.fields.some((f) => f.role === 'image' || f.role === 'link') || entries.some((e) => e.kind === 'option' && optionLink(nb.fields, e.data));
  const regions = compiled.regions.filter((r) => r.entries.length > 0);
  // A page drawn for this notebook shows what it has, even before it has entries.
  if (regions.length === 0 && !nb.layout) {
    return html`
      <section class="nb-start" aria-labelledby="nb-start-title">
        <h2 class="nb-start__title" id="nb-start-title">Tell sua what you're looking for</h2>
        <p class="nb-start__sub">Talk it through the way you would with a friend: who it's for, budget, must-haves, what you've already seen or ruled out. sua files it here as you go (notes, options, limits, what "done" means) and can set up agents to keep looking.</p>
        ${nb.conversationId
          ? html`<p class="nb-start__pointer">sua has said hello and asked its first question. Answer it in <strong>Talk to sua</strong>, beside this, or <a href="/inbox/${encodeURIComponent(nb.conversationId)}" data-nb-continue="${nb.conversationId}">open the conversation</a>.</p>`
          : talkForm(nb, entries, true)}
      </section>`;
  }
  // Ruled-out options sink to the end of their section.
  const out = (id: string) => (byId.get(id)?.ruledOut ? 1 : 0);
  // With fields, options are drawn as widgets (summary, stats, funnel, map,
  // shortlist); the cards stay for notes, evidence and notebooks without fields.
  const widgets = notebookWidgetMessages(nb, entries, history);
  if (widgets) {
    // The widgets tell the whole story (the timeline has the notes and decisions): no second list.
    const rest: typeof regions = [];
    return html`<div class="nb-widgets">
        ${canPhoto ? html`<div class="nb-widgets__tools"><form method="POST" action="/notebooks/${encodeURIComponent(nb.id)}/photos"><button type="submit" class="btn btn--sm btn--ghost" title="Keep a copy of each option's photo, from its listing">Get photos</button></form></div>` : html``}
        ${renderSurfaceHost(`notebook-${nb.id}`, widgets, { label: `${nb.title}: options` })}</div>
      ${rest.map((r) => html`
      <section class="nb-region" data-surface-region="${r.id}">
        <h2 class="nb-region__title">${r.title} <span class="nb-region__count">${String(r.entries.length)}</span></h2>
        <ul class="nb-region__list">${r.entries.map((ce) => { const e = byId.get(ce.item.id); return e ? entryCard(nb, e, views.get(e.id)) : html``; }) as unknown as SafeHtml[]}</ul>
      </section>`) as unknown as SafeHtml[]}`;
  }
  return html`${funnelStrip(nb, entries)}${regions.map((r) => html`
    <section class="nb-region" data-surface-region="${r.id}">
      <h2 class="nb-region__title">${r.title} <span class="nb-region__count">${String(r.entries.length)}</span>
        ${canPhoto && r.entries.some((ce) => byId.get(ce.item.id)?.kind === 'option') ? html`<form method="POST" action="/notebooks/${encodeURIComponent(nb.id)}/photos" class="nb-region__act"><button type="submit" class="btn btn--sm btn--ghost" title="Keep a copy of each option's photo, from its listing">Get photos</button></form>` : html``}</h2>
      <ul class="nb-region__list">${[...r.entries].sort((a, b) => out(a.item.id) - out(b.item.id)).map((ce) => { const e = byId.get(ce.item.id); return e ? entryCard(nb, e, views.get(e.id)) : html``; }) as unknown as SafeHtml[]}</ul>
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
    return { hint: 'Next: your limits (budget, must-haves, deal-breakers).', placeholder: 'e.g. a budget, the must-haves, the deal-breakers, and where to look' };
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
        placeholder="${step.placeholder}" data-enter-sends aria-describedby="nb-talk-keys-${big ? 'big' : 'side'}"></textarea>
      <div class="nb-talk__send">
        <span class="nb-talk__keys" id="nb-talk-keys-${big ? 'big' : 'side'}"><kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line</span>
        <button type="submit" class="btn btn--primary btn--sm">Tell sua</button>
      </div>
    </form>`;
}

/** A finished run of one of the notebook's agents that isn't in it yet. */
export interface UnfiledRunView { id: string; agentId: string; startedAt: string; adding?: boolean }

function sideForms(nb: Notebook, entries: readonly NotebookEntry[], lastWord?: { text: string; at: number }, unfiled: readonly UnfiledRunView[] = [], talkLive?: NotebookTalkLive): SafeHtml {
  const hasEntries = entries.length > 0;
  const id = encodeURIComponent(nb.id);
  return html`
    ${hasEntries || nb.conversationId ? html`
      <section class="nb-side__card nb-talk${talkLive?.state === 'waiting' ? ' is-waiting' : ''}" aria-labelledby="nb-talk-title">
        <h2 class="nb-side__title" id="nb-talk-title">Talk to sua about this notebook</h2>
        ${talkLive?.state === 'waiting'
          ? html`<div class="nb-talk__waiting" role="status">
              <span class="nb-talk__waiting-label">${waitingWords(talkLive.kind).label}</span>
              <span class="nb-talk__waiting-ask">${talkLive.text}</span>
              <span class="nb-talk__waiting-acts">${waitingButton(talkLive)}</span>
            </div>`
          : talkLive?.state === 'working'
            ? html`<p class="nb-talk__working" role="status"><span class="working__spin" aria-hidden="true"></span>${talkLive.text} <button type="button" class="btn btn--sm btn--ghost" data-nb-continue="${talkLive.threadId}">Watch</button></p>`
            : lastWord ? html`<blockquote class="nb-talk__last"><span class="nb-talk__who">sua · ${formatAge(new Date(lastWord.at).toISOString())}</span>${lastWord.text}</blockquote>` : html``}
        ${talkForm(nb, entries)}
        ${nb.conversationId ? html`<button type="button" class="btn btn--sm btn--ghost nb-talk__continue" data-nb-continue="${nb.conversationId}">Continue the conversation</button>` : html``}
      </section>` : html``}
    ${unfiled.length ? html`
      <section class="nb-side__card nb-unfiled" aria-labelledby="nb-unfiled-title">
        <h2 class="nb-side__title" id="nb-unfiled-title">Runs not in this notebook yet</h2>
        <p class="nb-unfiled__lede">Finished, but not filed here. Add what they found, or skip ones that don't belong.</p>
        <ul class="nb-unfiled__list">${unfiled.map((r) => html`
          <li class="nb-unfiled__item">
            <span class="nb-unfiled__what"><a href="/runs/${encodeURIComponent(r.id)}">${r.agentId}</a><span class="nb-unfiled__when">${formatAge(r.startedAt)}</span></span>
            ${r.adding
              ? html`<span class="nb-unfiled__adding" role="status">Adding…</span>`
              : html`<span class="nb-unfiled__acts">
                  <form method="POST" action="/notebooks/${id}/runs/${encodeURIComponent(r.id)}/add"><button type="submit" class="btn btn--sm">Add</button></form>
                  <form method="POST" action="/notebooks/${id}/runs/${encodeURIComponent(r.id)}/skip"><button type="submit" class="btn btn--sm btn--ghost" aria-label="Skip this ${r.agentId} run">Skip</button></form>
                </span>`}
          </li>`) as unknown as SafeHtml[]}</ul>
        ${unfiled.filter((r) => !r.adding).length > 1 ? html`<form method="POST" action="/notebooks/${id}/runs/skip-all" class="nb-unfiled__all"><button type="submit" class="btn btn--sm btn--ghost">Skip all</button></form>` : html``}
      </section>` : html``}
`;
}

/** Add an entry yourself (the header's + Add entry). */
function addEntryForm(nb: Notebook, entries: readonly NotebookEntry[]): SafeHtml {
  const id = encodeURIComponent(nb.id);
  return html`
      <form method="POST" action="/notebooks/${id}/entries" class="nb-form">
        <div class="nb-kinds" role="radiogroup" aria-label="What it is">
          ${(['note', 'option', 'evidence', 'decision'] as const).map((k, i) => html`
            <label class="nb-kind"><input type="radio" name="kind" value="${k}"${i === 0 ? unsafeHtml(' checked') : unsafeHtml('')}><span>${KIND_LABEL[k]}</span></label>`) as unknown as SafeHtml[]}
        </div>
        <input type="text" name="title" required class="form-field" placeholder="${(() => { const o = entries.find((e) => e.kind === 'option'); return o ? `One line, like: ${o.title.length > 60 ? `${o.title.slice(0, 59)}…` : o.title}` : 'One line: what it is and what matters about it'; })()}" autocomplete="off">
        <textarea name="body" rows="3" class="form-field" placeholder="Details (optional)"></textarea>
        <button type="submit" class="btn btn--sm">Add</button>
      </form>
  `;
}

/** The rest of a notebook's own actions, under its Edit page: stop it, keep it as a template, archive or delete it. */
function notebookMoreActions(nb: Notebook): SafeHtml {
  const id = encodeURIComponent(nb.id);
  // One row each: the action, then one sentence on what it does and whether it can be undone.
  const row = (action: SafeHtml, what: string, cls = '') => html`<li class="nbe-manage__row${cls}">${action}<span class="nbe-manage__what">${what}</span></li>`;
  const post = (path: string, name: string, value: string, label: string) =>
    html`<form method="POST" action="/notebooks/${id}/${path}" class="nbe-manage__act"><input type="hidden" name="${name}" value="${value}"><button type="submit" class="btn btn--sm">${label}</button></form>`;
  return html`
      <ul class="nbe-manage" aria-label="Manage this notebook">
        ${nb.status === 'active'
          ? row(post('status', 'status', 'stopped', 'Stop'), 'Pause it: no more searches or steps. Everything stays, and you can reopen it.')
          : row(post('status', 'status', 'active', 'Reopen'), 'Make it active again, to keep searching and working through its steps.')}
        ${row(html`<a class="btn btn--sm nbe-manage__act" href="/notebooks/${id}/template">Save as a template…</a>`, 'Start new notebooks set up like this one, saying what changes each time (like who you\'re meeting).')}
        ${nb.archivedAt
          ? row(post('archive', 'archived', '0', 'Restore'), 'Show it again in your notebooks, Home and Today.')
          : row(post('archive', 'archived', '1', 'Archive'), 'Hide it from your notebooks, Home and Today, and stop its schedule. Nothing is deleted.')}
        <li class="nbe-manage__row nbe-manage__row--danger">
          <details class="nbe-manage__delete">
            <summary><span class="btn btn--sm nbe-manage__act">Delete…</span><span class="nbe-manage__what">Remove it and everything in it. This can't be undone.</span></summary>
            <form method="POST" action="/notebooks/${id}/delete" class="nb-delete__form">
              <p class="nb-delete__what">Delete “${nb.title}” and everything in it (options, notes, history, photos)? Its conversation with sua and the runs that fed it stay. This can't be undone.${nb.archivedAt ? '' : ' To only hide it, archive it instead.'}</p>
              <input type="hidden" name="confirm" value="${nb.id}">
              <button type="submit" class="btn btn--sm btn--warn">Delete this notebook</button>
            </form>
          </details>
        </li>
      </ul>
  `;
}

/** What the Edit page shows (the header's Edit). */
export interface NotebookEditView {
  /** The notebook as it is. */
  nb: Notebook;
  /** As your changes would leave it (the notebook itself when there are none). */
  proposed: Notebook;
  turns: readonly NotebookEditTurn[];
  working: boolean;
  /** Every change not saved yet, against the notebook as it is. */
  pending: readonly string[];
  tab: 'talk' | 'prompt' | 'looks';
  /** Open the preview as the page loads (right after a change was made). */
  openPreview?: boolean;
  /** The look in your changes, when you changed it (null: the shortlist). */
  lookChanged?: NotebookLayout | null;
  markdown: string;
  entries: NotebookEntry[];
  compiled: CompiledSurface;
  history?: NotebookViewHistory;
  agents: ReadonlyArray<{ id: string; description: string }>;
  flash?: { kind: 'error' | 'info' | 'ok'; message: string };
  layoutUndos?: number;
  pagePicking?: boolean;
}

/** Things to say, to start: each fills the box. */
const EDIT_STARTERS = [
  'Add a step to ',
  'Make the page lead with ',
  'Also note each one\'s ',
  'It\'s done when ',
];

/** The notebook in a few lines: what it's for, its limits, done-whens, facts, steps and page. */
function editSummary(nb: Notebook): SafeHtml {
  const row = (label: string, body: SafeHtml | string) => html`<div class="nbe-sum__row"><dt>${label}</dt><dd>${body}</dd></div>`;
  const chips = (xs: readonly string[]) => (xs.length ? html`<span class="nbe-sum__chips">${xs.map((x) => html`<span class="nb-chip">${x}</span>`) as unknown as SafeHtml[]}</span>` : html`<span class="nbe-sum__none">none</span>`);
  return html`<dl class="nbe-sum">
    ${row('For', nb.statement || nb.title)}
    ${row('Limits', chips(nb.params))}
    ${row('Done when', chips(nb.criteria.map((c) => `${c.met ? '✓ ' : ''}${c.text}`)))}
    ${row('Notes', chips(nb.fields.map((f) => f.label)))}
    ${row('Steps', nb.steps?.length ? html`<ol class="nbe-sum__steps">${nb.steps.map((x) => html`<li class="${x.status === 'done' ? 'is-done' : ''}">${x.title}</li>`) as unknown as SafeHtml[]}</ol>` : html`<span class="nbe-sum__none">none</span>`)}
    ${row('Looks like', pageName(nb.layout))}
  </dl>`;
}

function editTurn(t: NotebookEditTurn): SafeHtml {
  return html`
    <li class="nbe-turn nbe-turn--you">${t.you}</li>
    ${t.error ? html`<li class="nbe-turn nbe-turn--sua is-error"><span class="nbe-turn__who">sua</span>${t.error}</li>`
      : t.changes || t.sua ? html`<li class="nbe-turn nbe-turn--sua"><span class="nbe-turn__who">sua</span>
        ${t.sua ? html`<p class="nbe-turn__say">${t.sua}</p>` : html``}
        ${t.changes?.length ? html`<ul class="nbe-turn__changes">${t.changes.map((c) => html`<li>${c}</li>`) as unknown as SafeHtml[]}</ul>` : html``}
      </li>` : html``}`;
}

/**
 * Edit this notebook: say what to change (Talk) or edit it as a document
 * (Prompt); either way it's a proposal shown in the preview beside it, as
 * the notebook's page would draw it, until you save it. The setup form and
 * the notebook's other actions are folded below.
 */
export function renderNotebookEdit(args: NotebookEditView): string {
  const { nb, proposed } = args;
  const id = encodeURIComponent(nb.id);
  const tab = (key: 'talk' | 'prompt' | 'looks', label: string) => html`<a class="nb-tabs__tab${args.tab === key ? ' is-on' : ''}" href="/notebooks/${id}/edit${key === 'talk' ? '' : `?tab=${key}`}"${args.tab === key ? unsafeHtml(' aria-current="page"') : unsafeHtml('')}>${label}</a>`;
  const pending = args.pending.length > 0;
  const talk = html`
    <section class="nbe-talk" aria-label="Say what to change">
      ${editSummary(proposed)}
      ${args.turns.length ? html`<ol class="nbe-turns">${args.turns.map(editTurn) as unknown as SafeHtml[]}
        ${args.working ? html`<li class="nbe-turn nbe-turn--sua is-working" role="status"><span class="nbe-turn__who">sua</span><span class="working__spin" aria-hidden="true"></span>Changing it. The preview opens when it's done.</li>` : html``}</ol>` : html`
        <p class="nbe-talk__lede">Say what to change, the way you'd ask a person. sua changes it and shows you a preview before anything is saved.</p>`}
      <form method="POST" action="/notebooks/${id}/edit/talk" class="nbe-talk__form">
        ${args.turns.length ? html`` : html`<span class="nbe-talk__starters" aria-label="Start with">${EDIT_STARTERS.map((x) => html`<button type="button" class="nbd-chip nbd-chip--add" data-nbe-start="${x}">${x.trim()}…</button>`) as unknown as SafeHtml[]}</span>`}
        <textarea name="text" id="nbe-say" rows="3" class="form-field" required data-enter-sends ${args.working ? unsafeHtml('disabled') : unsafeHtml('')}
          placeholder="e.g. “add a step to learn about her company”, “put who she is at the top”, “stop noting the price”"></textarea>
        <div class="nbe-talk__send">
          <span class="nb-talk__keys"><kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line</span>
          <button type="submit" class="btn btn--primary btn--sm" ${args.working ? unsafeHtml('disabled') : unsafeHtml('')}>Send</button>
        </div>
      </form>
    </section>`;
  const prompt = html`
    <section class="nbe-prompt" aria-label="The notebook as a document">
      <p class="nbe-prompt__lede">The whole notebook as a document. Change anything, then show it in the preview; nothing is saved until you save. A section you leave out stays as it was. Steps read <code>Title (kind target; about who; facts a, b; top 5; with agent)</code>; a write step that answers the question reads <code>(write; answer)</code>, one that makes a plan <code>(write; plan)</code>.</p>
      ${(() => {
        // Enhance: while sua works, say so; once back, what it made sharper (the preview shows the rest).
        const lastTurn = args.turns.at(-1);
        if (args.working && lastTurn?.via === 'enhance') return working({ size: 'panel', title: 'sua is enhancing the prompt', text: 'Making what it\'s for, its limits, done-whens, facts, checks and steps sharper for its goal. The preview opens when it\'s done; nothing is saved until you save.' });
        if (!args.working && lastTurn?.via === 'enhance') {
          return lastTurn.error ? html`<p class="flash flash--error">${lastTurn.error}</p>`
            : html`<div class="nbe-enhanced" role="status"><p class="nbe-enhanced__say"><strong>✦ Enhanced.</strong> ${lastTurn.sua ?? ''}</p>${lastTurn.changes?.length
              // A few changes show; a long list folds (the preview shows them all).
              ? lastTurn.changes.length <= 5
                ? html`<ul class="nbe-turn__changes">${lastTurn.changes.map((c) => html`<li>${c}</li>`) as unknown as SafeHtml[]}</ul>`
                : html`<details class="nbe-enhanced__all"><summary>${String(lastTurn.changes.length)} changes</summary><ul class="nbe-turn__changes">${lastTurn.changes.map((c) => html`<li>${c}</li>`) as unknown as SafeHtml[]}</ul></details>`
              : html``}<p class="nbe-enhanced__note">Below is the enhanced prompt. Save it, change it further, or Discard.</p></div>`;
        }
        return html``;
      })()}
      <form method="POST" action="/notebooks/${id}/edit/prompt" class="nbe-prompt__form">
        <textarea name="markdown" class="form-field nbe-prompt__text" rows="26" spellcheck="false" aria-label="The notebook as markdown" ${args.working ? unsafeHtml('disabled') : unsafeHtml('')}>${args.markdown}</textarea>
        <div class="nbe-prompt__acts">
          <button type="submit" class="btn btn--sm" ${args.working ? unsafeHtml('disabled') : unsafeHtml('')}>Show in the preview</button>
          <button type="submit" class="btn btn--sm btn--primary" formaction="/notebooks/${id}/edit/enhance" title="sua makes it a sharper prompt for its goal: what it's for, limits, done-whens, facts, checks and steps. You see it in the preview before anything is saved." ${args.working ? unsafeHtml('disabled') : unsafeHtml('')}>✦ Enhance this prompt</button>
        </div>
      </form>
      <details class="nbe-fold">
        <summary>Edit field by field</summary>
        <p class="nbe-fold__note">Saves straight away (not through the preview).</p>
        <form method="POST" action="/notebooks/${id}/edit" class="nbd-draft nbe-form">
          <input type="hidden" name="setup" value="1">
          ${notebookSetupEditor({
            title: nb.title, statement: nb.statement, params: nb.params,
            criteria: nb.criteria.map((c) => c.text), met: nb.criteria.map((c) => c.met),
            ...(nb.steps?.length ? { steps: nb.steps } : {}),
            fields: nb.fields, checks: nb.checks, stages: nb.stages, pipeline: nb.pipeline, cadence: nb.cadence,
            ...(nb.meeting ? { meeting: nb.meeting } : {}),
          }, args.agents, { editing: true, offered: args.agents.map((a) => a.id) })}
          <div class="nbd-draft__foot"><button type="submit" class="btn btn--primary">Save</button></div>
        </form>
      </details>
    </section>`;
  const widgetsIn = proposed.fields.length > 0 && args.entries.some((e) => e.kind === 'option');
  return render(layout({ title: `Edit ${nb.title}`, activeNav: 'notebooks', flash: args.flash, wide: true }, html`
    <div class="nbe">
      ${pageHeader({
        crumbs: [{ label: 'Home', href: '/' }, { label: 'Notebooks', href: '/notebooks' }, { label: nb.title, href: `/notebooks/${id}` }, { label: 'Edit' }],
        title: 'Edit this notebook',
        description: 'Say what to change, or edit it as a document. Preview shows the notebook as it would be; nothing changes until you save.',
      })}
      <div class="nbe-work">
        <div class="nbe-tabsrow">
          <nav class="nb-tabs nbe-tabs" aria-label="How to edit">${tab('talk', 'Talk')}${tab('prompt', 'Prompt')}${tab('looks', 'How it looks')}</nav>
          <button type="button" class="btn btn--sm" data-nbe-preview aria-haspopup="dialog">Preview${pending ? ' changes' : ''}</button>
        </div>
        ${pending ? html`<div class="nbe-pending" role="status">
          <details class="nbe-pending__what"><summary><b>${String(args.pending.length)} ${args.pending.length === 1 ? 'change' : 'changes'}</b> not saved yet</summary>
            <ul>${args.pending.map((c) => html`<li>${c}</li>`) as unknown as SafeHtml[]}</ul></details>
          <form method="POST" action="/notebooks/${id}/edit/save"><button type="submit" class="btn btn--primary btn--sm" ${args.working ? unsafeHtml('disabled') : unsafeHtml('')}>Save changes</button></form>
          <form method="POST" action="/notebooks/${id}/edit/discard"><button type="submit" class="btn btn--sm btn--ghost">Discard</button></form>
        </div>` : html``}
        ${args.tab === 'prompt' ? prompt : args.tab === 'looks' ? notebookLooks(nb.id, { now: nb.layout, ...(args.lookChanged !== undefined ? { changed: args.lookChanged } : {}), working: args.working, undos: args.layoutUndos ?? 0 }) : talk}
        <details class="nbe-fold nbe-fold--more"><summary>Manage this notebook</summary>${notebookMoreActions(nb)}</details>
      </div>
      <dialog class="nbe-preview" id="nbe-preview" aria-label="Preview"${args.openPreview ? unsafeHtml(' data-open') : unsafeHtml('')}>
        <div class="nbe-preview__bar">
          <span class="nbe-preview__label">Preview</span>
          <span class="nbe-preview__state${pending ? ' is-changed' : ''}">${pending ? 'with your changes, not saved' : 'as it is now'}</span>
          <span class="nbe-preview__acts">
            ${pending && !args.working ? html`<form method="POST" action="/notebooks/${id}/edit/save"><button type="submit" class="btn btn--primary btn--sm">Save changes</button></form>` : html``}
            <a class="btn btn--sm btn--ghost" href="/notebooks/${id}">Open the notebook</a>
            <button type="button" class="btn btn--sm" data-nbe-close>Close</button>
          </span>
        </div>
        <div class="nbe-preview__page" tabindex="0" aria-label="The notebook as it would be"><div class="nbe-preview__inner" inert>
          ${hero(proposed, [], undefined, widgetsIn, undefined, decisionLeads(proposed, args.entries, Infinity, args.history), args.entries, [], undefined, notebookHeaderView(proposed, args.entries, args.history as NotebookWidgetHistory | undefined))}
          <div class="nb-body__main">${surfaceColumnBody(proposed, args.compiled, args.entries, args.history)}</div>
        </div></div>
      </dialog>
      ${args.working ? unsafeHtml(`<script>(function(){var u=${JSON.stringify(`/notebooks/${nb.id}/edit/state`)};function t(){fetch(u,{headers:{accept:"application/json"}}).then(function(r){return r.json();}).then(function(j){if(j.status!=="working"){var t0=new URLSearchParams(location.search).get("tab");location.replace(location.pathname+"?"+(t0?"tab="+encodeURIComponent(t0)+"&":"")+"preview=1");}else setTimeout(t,2000);}).catch(function(){setTimeout(t,4000);});}setTimeout(t,2000);})();</script>`) : html``}
      ${unsafeHtml('<script>(function(){var d=document.getElementById("nbe-preview");if(!d||!d.showModal)return;document.querySelectorAll("[data-nbe-preview]").forEach(function(b){b.addEventListener("click",function(){d.showModal();});});d.querySelector("[data-nbe-close]").addEventListener("click",function(){d.close();});d.addEventListener("click",function(e){if(e.target===d)d.close();});if(d.hasAttribute("data-open")){d.showModal();var u=new URL(location.href);u.searchParams.delete("preview");history.replaceState(null,"",u.pathname+u.search);}})();</script>')}
      ${unsafeHtml('<script>document.querySelectorAll("[data-nbe-start]").forEach(function(b){b.addEventListener("click",function(){var t=document.getElementById("nbe-say");if(!t)return;t.value=b.getAttribute("data-nbe-start");t.focus();t.setSelectionRange(t.value.length,t.value.length);});});</script>')}
    </div>
  `));
}

/** A step button in the header: Next step / Try again run the step; Move on keeps what it found and goes on. */
function stepButton(nb: Notebook, b: { label: string; hint: string; moveOn?: boolean }, primary: boolean): SafeHtml {
  const id = encodeURIComponent(nb.id);
  const current = nb.steps?.find((x) => x.status !== 'done');
  return html`<form method="POST" action="/notebooks/${id}/${b.moveOn ? 'steps/move-on' : 'run'}" class="nb-next__form">${b.moveOn && current ? html`<input type="hidden" name="step" value="${current.id}">` : html``}<button type="submit" class="btn ${primary ? 'btn--primary ' : ''}btn--sm nb-next" title="${b.hint}" aria-label="${b.label}: ${b.hint}">${b.label}${primary ? ' →' : ''}</button></form>`;
}

/**
 * Download CSV: which options go in. The chosen ones (once you've picked),
 * the ones in the running, or everything with the ruled-out ones and why.
 * The shortlist's own "CSV of these" takes it as you filtered it.
 */
function csvMenu(nb: Notebook, entries: readonly NotebookEntry[], running: readonly NotebookViewOption[]): SafeHtml {
  const href = `/notebooks/${encodeURIComponent(nb.id)}/shortlist.csv`;
  const chosen = running.filter((o) => o.chosen).length;
  const all = entries.filter((e) => e.kind === 'option').length;
  // The last run's new ones, once there are older ones to tell them from.
  const fresh = running.filter((o) => o.added === 'new').length;
  const latest = fresh > 0 && fresh < running.length;
  const item = (rows: string, label: string, n: number, hint: string) =>
    html`<a class="nb-csv__item" href="${href}?rows=${rows}" download title="${hint}">${label} <span class="nb-csv__n">${String(n)}</span></a>`;
  return html`<details class="nb-act nb-csv" data-nb-act>
    <summary class="btn btn--sm btn--ghost">Download / share</summary>
    <div class="nb-act__panel nb-csv__panel">
      <span class="nb-progress__label">Which options?</span>
      ${chosen ? item('chosen', 'Chosen', chosen, 'The options you picked, best first') : html``}
      ${item('running', 'In the running', running.length, chosen ? 'Every option still in, chosen first' : 'Every option still in, best first')}
      ${all > running.length ? item('all', 'Everything, with ruled out', all, 'Ruled-out ones last, with why') : html``}
      ${latest ? item('new', 'New in the last run', fresh, 'Only the options the last run found for the first time') : html``}
      <span class="nb-csv__hint">To pick rows yourself, filter the shortlist and use its <b>CSV of these</b>.</span>
      <span class="nb-progress__label nb-csv__brief-label">To share</span>
      <a class="nb-csv__item" href="/notebooks/${encodeURIComponent(nb.id)}/brief.html" target="_blank" rel="noopener" title="A polished page of where it stands and the options, to send or hand to Claude">Open the brief ↗</a>
      <a class="nb-csv__item" href="/notebooks/${encodeURIComponent(nb.id)}/brief.html?download=1" download title="The brief as one HTML file">Download the brief</a>
      <a class="nb-csv__item" href="/notebooks/${encodeURIComponent(nb.id)}/brief.html?print=1" target="_blank" rel="noopener" title="Opens the brief and your browser's print dialog: choose Save as PDF">Save as PDF ↗</a>
      ${latest ? html`<a class="nb-csv__item" href="/notebooks/${encodeURIComponent(nb.id)}/brief.html?latest=1" target="_blank" rel="noopener" title="The brief of only the options the last run found for the first time">Open the brief of what's new ↗ <span class="nb-csv__n">${String(fresh)}</span></a>
      <a class="nb-csv__item" href="/notebooks/${encodeURIComponent(nb.id)}/brief.html?latest=1&amp;print=1" target="_blank" rel="noopener" title="The brief of what's new with your browser's print dialog">Save what's new as PDF ↗</a>` : html``}
      <span class="nb-progress__label nb-csv__brief-label">Extended: each option in full</span>
      <a class="nb-csv__item" href="/notebooks/${encodeURIComponent(nb.id)}/brief.html?full=1" target="_blank" rel="noopener" title="The brief, then each option in the running as its own page shows it: every fact with its source, its notes, checks and history">Open the extended brief ↗</a>
      <a class="nb-csv__item" href="/notebooks/${encodeURIComponent(nb.id)}/brief.html?full=1&amp;print=1" target="_blank" rel="noopener" title="The extended brief with your browser's print dialog; each option starts a new page">Save extended as PDF ↗</a>
    </div>
  </details>`;
}

/**
 * Whether the header offers Decide…: a notebook without steps (choosing is
 * what it's for), or one whose steps have you pick or narrow. One whose
 * steps end in sua writing something (a meeting's talking points) has
 * nothing to pick from.
 */
export function offersDecide(nb: Pick<Notebook, 'steps'>): boolean {
  return !nb.steps?.length || nb.steps.some((s) => s.kind === 'decide' || s.kind === 'narrow');
}

/**
 * The header's actions: Decide… (or Reopen), + Add entry and Edit, each a
 * button that opens its form below it; one open at a time (notebook-page.js.ts).
 */
function heroActions(nb: Notebook, entries: readonly NotebookEntry[], leads: readonly NotebookViewOption[], running?: { step: number; of: number }): SafeHtml {
  const id = encodeURIComponent(nb.id);
  // While it has steps left, the next one is the header's main button (Decide steps aside).
  const next = nb.status === 'active' ? nextStepAction(nb) : undefined;
  const step = next && 'label' in next ? next : undefined;
  // The current step is a narrow step: Narrow… is the main button.
  const current = nb.steps?.find((x) => x.status !== 'done');
  const narrowing = current?.kind === 'narrow' ? current : undefined;
  return html`
    <div class="nb-acts">
      ${running && nb.steps?.some((x) => x.status !== 'done')
        ? html`<button type="button" class="btn btn--primary btn--sm nb-next" disabled>Working on step ${String(running.step)}…</button><form method="POST" action="/notebooks/${id}/steps/stop" class="nb-next__form"><button type="submit" class="btn btn--sm nb-next" title="Stop this step's run. It keeps what it found so far, and you can move on or try again." aria-label="Stop step ${String(running.step)}">Stop</button></form>`
        : step
          ? html`${stepButton(nb, step, true)}${step.alt ? stepButton(nb, step.alt, false) : html``}`
          : html``}
      ${nb.status === 'active' && narrowing && !running ? html`
        <details class="nb-act nb-decide nb-narrow" data-nb-act data-nb-act-name="narrow">
          <summary class="btn btn--sm btn--primary" title="${narrowing.title}">Narrow…</summary>
          <div class="nb-act__panel nb-act__panel--decide">
            ${decideForm(nb, leads, 'narrow')}
          </div>
        </details>` : html``}
      ${nb.status === 'active' && !offersDecide(nb) ? html`` : nb.status === 'active' ? html`
        <details class="nb-act nb-decide" data-nb-act data-nb-act-name="decide">
          <summary class="btn btn--sm${step || running || narrowing ? '' : ' btn--primary'}">Decide…</summary>
          <div class="nb-act__panel nb-act__panel--decide">
            ${decideForm(nb, leads)}
          </div>
        </details>` : html`
        <form method="POST" action="/notebooks/${id}/status" class="nb-reopen"><input type="hidden" name="status" value="active"><button type="submit" class="btn btn--sm">Reopen</button></form>`}
      <details class="nb-act nb-addself" data-nb-act>
        <summary class="btn btn--sm">+ Add entry</summary>
        <div class="nb-act__panel">
          <h2 class="nb-act__title">Add an entry yourself</h2>
          ${addEntryForm(nb, entries)}
        </div>
      </details>
      <a class="btn btn--sm btn--ghost nb-edit" href="/notebooks/${id}/edit">Edit</a>
      ${entries.some((e) => e.kind === 'option') ? csvMenu(nb, entries, leads) : html``}
    </div>`;
}

export function renderNotebookPage(args: { nb: Notebook; unfiled?: UnfiledRunView[]; cover?: { src: string; kind: string; shape?: string }; entries: NotebookEntry[]; compiled: CompiledSurface; history?: NotebookViewHistory; settingUp?: boolean; stages: PipelineStage[]; running?: { step: number; of: number }; busy?: string[]; lastWord?: { text: string; at: number }; stepsKey?: string; live?: NotebookLive; liveKey?: string; flash?: { kind: 'error' | 'info' | 'ok'; message: string } }): string {
  return render(layout({ title: args.nb.title, activeNav: 'notebooks', flash: args.flash, wide: true }, html`
    <p class="nb-crumbs"><a href="/">Home</a> › <a href="/notebooks">Notebooks</a></p>
    ${args.nb.archivedAt ? html`<div class="nb-archived" role="status">Archived ${formatAge(args.nb.archivedAt)}: hidden from your notebooks, Home and Today, and its schedule is off.
      <form method="POST" action="/notebooks/${encodeURIComponent(args.nb.id)}/archive"><input type="hidden" name="archived" value="0"><button type="submit" class="btn btn--sm">Restore</button></form></div>` : html``}
    ${hero(args.nb, args.stages, args.running, args.nb.fields.length > 0 && args.entries.some((e) => e.kind === 'option'), args.cover, decisionLeads(args.nb, args.entries, Infinity, args.history), args.entries, args.busy ?? [], args.live, notebookHeaderView(args.nb, args.entries, args.history as NotebookWidgetHistory | undefined))}
    ${args.running || args.busy?.length ? unsafeHtml('<script>setTimeout(function () { if (!document.querySelector("textarea:focus, input:focus")) location.reload(); }, 6000);</script>') : html``}
    <div class="nb-body">
      <div class="nb-body__main" data-nb-main="${args.nb.id}" data-nb-count="${String(args.entries.length)}" data-nb-changed="${args.nb.updatedAt}${args.settingUp ? "+setup" : ""}" data-nb-steps="${args.stepsKey ?? ''}" data-nb-live="${args.liveKey ?? ''}" data-page-thread="${args.nb.conversationId ?? ''}">${surfaceColumn(args.nb, args.compiled, args.entries, args.history, args.settingUp)}</div>
      <aside class="nb-body__side">${sideForms(args.nb, args.entries, args.lastWord, args.unfiled, args.live?.talk)}</aside>
    </div>
  `));
}

/** The notebook's sections alone (GET /notebooks/:id/main), for live updates. */
export function renderNotebookMain(nb: Notebook, compiled: CompiledSurface, entries: NotebookEntry[], history?: NotebookViewHistory, settingUp = false): string {
  return render(surfaceColumn(nb, compiled, entries, history, settingUp));
}

/** A notebook on the list page: its cover picture and what it holds. */
export interface NotebookCard {
  nb: Notebook;
  entries: number;
  options: number;
  active: number;
  best?: string;
  bestName?: string;
  furthest?: string;
  /** "1 of 3 done": its done-when criteria. */
  done?: string;
  /** Its done-when criteria, each met or not (the list card's dots). */
  checks?: Array<{ text: string; met: boolean }>;
  cover?: string;
  coverKind?: string;
  /** A logo cover's shape (a wordmark is wide), so it's sized to read. */
  coverShape?: string;
}

export interface NotebookListQuery { q: string; status: 'active' | 'decided' | 'stopped' | 'all' | 'archived'; sort: 'updated' | 'created' | 'title'; page: number; pages: number; total: number; perPage: number }

export function renderNotebooksList(args: {
  notebooks: NotebookCard[];
  openNew?: boolean;
  flash?: { kind: 'error' | 'info' | 'ok'; message: string };
  query?: NotebookListQuery;
  counts?: { active: number; decided: number; stopped: number; all: number; archived?: number };
  /** New notebooks you began drafting but haven't started. */
  drafts?: ReadonlyArray<{ id: string } & DraftState>;
}): string {
  const q: NotebookListQuery = args.query ?? { q: '', status: 'all', sort: 'updated', page: 1, pages: 1, total: args.notebooks.length, perPage: args.notebooks.length || 12 };
  const counts = { archived: 0, ...(args.counts ?? { active: 0, decided: 0, stopped: 0, all: args.notebooks.length }) };
  const href = (over: Partial<Pick<NotebookListQuery, 'q' | 'status' | 'sort' | 'page'>>) => {
    const p = new URLSearchParams();
    const v = { q: q.q, status: q.status, sort: q.sort, page: 1, ...over };
    if (v.q) p.set('q', v.q);
    if (v.status !== 'active') p.set('status', v.status);
    if (v.sort !== 'updated') p.set('sort', v.sort);
    if (v.page > 1) p.set('page', String(v.page));
    const s = p.toString();
    return `/notebooks${s ? `?${s}` : ''}`;
  };
  const tab = (status: NotebookListQuery['status'], label: string) => html`<a class="nb-tabs__tab${q.status === status ? ' is-on' : ''}" href="${href({ status })}"${q.status === status ? unsafeHtml(' aria-current="page"') : unsafeHtml('')}>${label} <span class="nb-tabs__n">${String(counts[status])}</span></a>`;
  const first = q.total ? (q.page - 1) * q.perPage + 1 : 0;
  const last = Math.min(q.total, q.page * q.perPage);
  const empty = q.q || q.status !== 'all'
    ? html`<p class="nb-list__empty">No ${q.status === 'all' ? '' : `${q.status} `}notebooks${q.q ? html` matching “${q.q}”` : html``}. <a href="${href({ q: '', status: 'all' })}">See them all</a></p>`
    : html``;
  return render(layout({ title: 'Notebooks', activeNav: 'notebooks', flash: args.flash, wide: true }, html`
    ${pageHeader({
      crumbs: [{ label: 'Home', href: '/' }, { label: 'Notebooks' }],
      title: 'Notebooks',
      description: "A goal you keep over time: what it's for, what you've found, how far each one got, and what you decided.",
      cta: html`<a class="btn btn--primary btn--sm nbl-new__btn" href="/notebooks/new">+ New notebook</a>`,
    })}
    ${renderDraftsStrip(args.drafts ?? [], 'list')}
    ${counts.all || counts.archived ? html`
      <form method="GET" action="/notebooks" class="nbl-tools" role="search">
        <nav class="nb-tabs" aria-label="Notebooks by status">${tab('active', 'Active')}${tab('decided', 'Decided')}${tab('stopped', 'Stopped')}${tab('all', 'All')}${counts.archived ? tab('archived', 'Archived') : html``}</nav>
        ${q.status !== 'active' ? html`<input type="hidden" name="status" value="${q.status}">` : html``}
        <label class="nbl-tools__search"><span class="sr-only">Search notebooks</span>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg>
          <input type="search" name="q" value="${q.q}" placeholder="Search notebooks" autocomplete="off"></label>
        <label class="nbl-tools__sort"><span class="sr-only">Sort</span>
          <select name="sort" data-autosubmit>
            <option value="updated"${q.sort === 'updated' ? unsafeHtml(' selected') : unsafeHtml('')}>Recently updated</option>
            <option value="created"${q.sort === 'created' ? unsafeHtml(' selected') : unsafeHtml('')}>Newest</option>
            <option value="title"${q.sort === 'title' ? unsafeHtml(' selected') : unsafeHtml('')}>A–Z</option>
          </select>
        </label>
        <noscript><button type="submit" class="btn btn--sm">Apply</button></noscript>
      </form>` : html``}
    <div class="nbl-grid">
      ${args.notebooks.map((c) => {
        const { nb } = c;
        const facts = [
          c.options ? `${String(c.options)} option${c.options === 1 ? '' : 's'}` : `${String(c.entries)} entr${c.entries === 1 ? 'y' : 'ies'}`,
          c.options ? `${String(c.active)} in the running` : '',
        ].filter(Boolean);
        const photo = c.cover && c.coverKind !== 'illustration' && c.coverKind !== 'logo' ? c.cover : undefined;
        const met = c.checks?.filter((x) => x.met).length ?? 0;
        return html`
          <a class="nbl-card nbl-card--${nb.status}" href="/notebooks/${encodeURIComponent(nb.id)}">
            <span class="nbl-card__cover${photo ? ' nbl-card__cover--photo' : ''}"${photo ? html` style="--cover:url('${photo}')"` : html``}>
              ${c.cover
                ? html`<img src="${c.cover}" alt="" loading="lazy" class="${pictureClass(c.coverKind, c.coverShape)}">`
                : coverArt(nb)}
              ${c.cover && pictureLabel(c.coverKind) ? html`<span class="nbl-card__kind">${pictureLabel(c.coverKind)}</span>` : html``}
            </span>
            <span class="nbl-card__body">
              <span class="nbl-card__titlerow"><span class="nbl-card__title">${nb.title}</span>${nb.status === 'active' && !nb.archivedAt ? html`` : statusChip(nb)}</span>
              <span class="nbl-card__statement">${nb.decision ?? nb.statement}</span>
              ${c.best ? html`<span class="nbl-card__lead"><span class="nbl-card__price">${c.best}</span>${c.bestName ? html`<span class="nbl-card__leadname">${c.bestName}</span>` : html``}</span>` : html``}
              <span class="nbl-card__facts">${facts.map((f) => html`<span>${f}</span>`) as unknown as SafeHtml[]}${c.furthest ? html`<span title="Furthest along: ${c.furthest}">at ${c.furthest}</span>` : html``}</span>
              <span class="nbl-card__meta">${c.checks?.length ? html`<span class="nbl-card__met" title="${`Done when: ${c.checks.map((x) => `${x.met ? '✓' : '○'} ${x.text}`).join('; ')}`}"><span class="nbl-card__dots" aria-hidden="true">${c.checks.map((x) => html`<i class="${x.met ? 'is-met' : ''}"></i>`) as unknown as SafeHtml[]}</span>${String(met)} of ${String(c.checks.length)} met</span>` : html``}<span>updated ${formatAge(nb.updatedAt)}</span></span>
            </span>
          </a>`;
      }) as unknown as SafeHtml[]}
    </div>
    ${args.notebooks.length === 0 ? empty : html``}
    ${q.pages > 1 ? html`
      <nav class="nb-pager" aria-label="Pages">
        ${q.page > 1 ? html`<a class="btn btn--sm" href="${href({ page: q.page - 1 })}" rel="prev">‹ Prev</a>` : html`<span class="btn btn--sm is-disabled" aria-disabled="true">‹ Prev</span>`}
        <span class="nb-pager__at">${String(first)}–${String(last)} of ${String(q.total)}</span>
        ${q.page < q.pages ? html`<a class="btn btn--sm" href="${href({ page: q.page + 1 })}" rel="next">Next ›</a>` : html`<span class="btn btn--sm is-disabled" aria-disabled="true">Next ›</span>`}
      </nav>` : html``}
  `));
}

/** What a notebook is about, from its words, for its cover's icon. */
export function notebookKind(nb: Pick<Notebook, 'title' | 'statement'>): 'car' | 'job' | 'music' | 'bike' | 'laptop' | 'home' | 'travel' | 'notebook' {
  const s = `${nb.title} ${nb.statement}`.toLowerCase();
  if (/\b(car|suv|truck|vehicle|sedan|wagon|rav4|forester)\b/.test(s)) return 'car';
  if (/\b(job|role|career|engineer|hire|hiring|position|offer letter)\b/.test(s)) return 'job';
  if (/\b(guitar|piano|instrument|amp|music|synth)\b/.test(s)) return 'music';
  if (/\b(bike|bicycle|cycling)\b/.test(s)) return 'bike';
  if (/\b(laptop|computer|macbook|pc|monitor|phone)\b/.test(s)) return 'laptop';
  if (/\b(house|home|apartment|flat|rent|condo)\b/.test(s)) return 'home';
  if (/\b(trip|travel|flight|hotel|vacation)\b/.test(s)) return 'travel';
  return 'notebook';
}

const KIND_ICON: Record<ReturnType<typeof notebookKind>, string> = {
  car: '<path d="M10 44l5-14a6 6 0 0 1 5.6-4h22.8a6 6 0 0 1 5.6 4l5 14"/><path d="M8 44h48v8a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-2H16v2a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2z"/><circle cx="18" cy="44" r="0.5"/><circle cx="46" cy="44" r="0.5"/><path d="M15 36h34"/>',
  job: '<rect x="8" y="20" width="48" height="32" rx="4"/><path d="M24 20v-5a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v5"/><path d="M8 34h48"/><path d="M30 34v4h4v-4"/>',
  music: '<path d="M26 46V14l24-5v32"/><circle cx="20" cy="46" r="6"/><circle cx="44" cy="41" r="6"/>',
  bike: '<circle cx="16" cy="42" r="10"/><circle cx="48" cy="42" r="10"/><path d="M16 42l10-18h14l8 18M26 24l6 18h-16M40 24l-4-6h-6"/>',
  laptop: '<rect x="12" y="14" width="40" height="26" rx="2"/><path d="M6 48h52l-4-8H10z"/>',
  home: '<path d="M8 30L32 10l24 20"/><path d="M14 26v26h36V26"/><path d="M27 52V38h10v14"/>',
  travel: '<path d="M6 36l52-20-14 36-10-14-14-2z"/><path d="M34 38l-6 10"/>',
  notebook: '<rect x="14" y="8" width="36" height="48" rx="4"/><path d="M22 20h20M22 30h20M22 40h12"/>',
};

/** A notebook's own cover until its options have pictures: its colour, its kind, its stages. */
export function coverArt(nb: Pick<Notebook, 'id' | 'title' | 'statement' | 'stages'>): SafeHtml {
  let h = 0;
  for (const ch of nb.id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  const hue = (h + 170) % 360; // keep near the teal family, but each its own
  const id = `nbc-${nb.id.replace(/[^a-z0-9-]/gi, '')}`;
  const kind = notebookKind(nb);
  const bars = nb.stages.slice(0, 5).map((_, i, a) => `<rect x="${String(16 + i * 22)}" y="${String(150 - (a.length - i) * 7)}" width="16" height="${String((a.length - i) * 7)}" rx="3" fill="#fff" fill-opacity="${(0.55 - i * 0.08).toFixed(2)}"/>`).join('');
  return unsafeHtml(`<svg class="nbl-card__art" viewBox="0 0 320 160" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${kind === 'notebook' ? 'Notebook' : kind}">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${String(hue)} 55% 46%)"/><stop offset="1" stop-color="hsl(${String((hue + 40) % 360)} 60% 32%)"/></linearGradient></defs>
    <rect width="320" height="160" fill="url(#${id})"/>
    <circle cx="270" cy="20" r="70" fill="#fff" fill-opacity="0.08"/><circle cx="300" cy="140" r="46" fill="#fff" fill-opacity="0.06"/>
    <path d="M0 120 C 60 96, 120 140, 190 112 S 290 86, 320 104" fill="none" stroke="#fff" stroke-opacity="0.18" stroke-width="2"/>
    ${bars}
    <g transform="translate(218 38) scale(1.25)" fill="none" stroke="#fff" stroke-opacity="0.92" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${KIND_ICON[kind]}</g>
  </svg>`);
}

/** The notebooks control in Home's header: a button to the list with a joined "+" for a new one, sized like the controls beside it. */
export function renderHomeNotebooksButtons(active: number, total: number): SafeHtml {
  return html`<span class="home-nbgroup" title="Notebooks: goals you keep over time"><a class="btn btn--sm" href="/notebooks">${NOTEBOOK_ICON}${total === 0 ? 'Notebooks' : `${String(active)} notebook${active === 1 ? '' : 's'}`}</a><a class="btn btn--sm home-nbgroup__new" href="/notebooks/new" aria-label="New notebook" title="New notebook">+</a></span>`;
}

/** "today 7:00 am", "tomorrow 7:00 am", "Thu 7:00 am". */
function formatWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(now)) / 86_400_000);
  return diff === 0 ? `today ${time}` : diff === 1 ? `tomorrow ${time}` : `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${time}`;
}
