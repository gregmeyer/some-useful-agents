/**
 * Notebooks (goal surfaces G1; mockup screen 22): the list, and one notebook,
 * a header that reads as its cover (what it's for, parameters, a pipeline
 * diagram, a progress ring over its criteria), its surface (options, notes
 * and decisions, evidence), and the forms to add to it, edit it, and close it
 * with a decision.
 */
import { showsTldrCard } from './notebook-tldr.js';
import type { NotebookMadeBy } from '../lib/notebook-made-by.js';
import { countParts } from '../lib/notebook-card.js';
import { shortDay, whatsNewLines, type WhatsNew } from '../lib/notebook-whats-new.js';
import { answerTracePages, answerNewSources, answerSubjects, notebookTags, openConflicts, isMeetingNotebook, layoutPreset, NOTEBOOK_LAYOUT_PRESETS, nextFireTime, optionLink, optionPassesStep, optionSteps, criterionLink, type NotebookCriterion, notebookProgress, stepProgress, stepFacts, type NotebookStep, notebookViewData, isRange, rankOptions, type NotebookViewHistory, type NotebookViewOption, type CompiledSurface, type Notebook, type NotebookEntry, type NotebookField, type NotebookFieldValue, type NotebookGiven, type NotebookLayout } from '@some-useful-agents/core';
import { html, render, unsafeHtml, type SafeHtml } from './html.js';
import { notebookSetupEditor, renderDraftsStrip } from './notebook-new.js';
import { attachPick, givenFilePick } from './given-file.js';
import type { DraftState } from '../lib/notebook-draft.js';
import { pageName, meetingWhenWords, type NotebookEditTurn } from '../lib/notebook-edit.js';
import { stepsCard } from './steps-card.js';
import { notebookLooks } from './notebook-look.js';
import { layout } from './layout.js';
import { working } from './working.js';
import { pageHeader } from './page-header.js';
import { renderSurfaceHost } from '../lib/a2ui-surface.js';
import { isYourStep, topFor, updateSteps, yourStepButton } from '../lib/notebook-steps.js';
import { editStarters } from '../lib/notebook-edit-starters.js';
import { suaStepAgentName } from '../lib/notebook-step-agents.js';
import { formatMoney, formatFieldValue } from '../lib/field-format.js';
import { handStagesHidden, notebookWidgetMessages, notebookHeaderView, type NotebookHeaderView, type NotebookWidgetHistory } from '../lib/notebook-widgets.js';
import { cronToHuman, formatAge } from './components.js';
import { sameWords } from './brief-document.js';
import { pictureClass, pictureLabel } from '../lib/notebook-logos.js';
import type { NotebookLive, NotebookTalkLive } from '../lib/notebook-live.js';

const NOTEBOOK_ICON = unsafeHtml('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/><path d="M9 8h6"/></svg>');

const STATUS_LABEL: Record<Notebook['status'], string> = { active: 'active', decided: 'decided', stopped: 'stopped' };

/**
 * The star toggle: a small form so it works without script. On a list
 * card it sits beside the card's link (a form can't go inside a link).
 */
export function starButton(nb: Pick<Notebook, 'id' | 'title' | 'starredAt'>, cls: string, back?: string): SafeHtml {
  const on = !!nb.starredAt;
  return html`<form method="POST" action="/notebooks/${encodeURIComponent(nb.id)}/star" class="${cls}"><input type="hidden" name="starred" value="${on ? '0' : '1'}">${back ? html`<input type="hidden" name="back" value="${back}">` : html``}<button type="submit" class="btn-star${on ? ' is-starred' : ''}" aria-pressed="${on ? 'true' : 'false'}" title="${on ? 'Unstar' : 'Star'}" aria-label="${on ? 'Unstar' : 'Star'} ${nb.title}">${on ? '★' : '☆'}</button></form>`;
}

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
  if (link.kind === 'written') return 'Ticks itself when the answer has it.';
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

/** What the header says while sua checks a conflict about who they are. */
export const CHECKING_WHO = 'Checking who they are now';

const siteOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

/**
 * Where what was found disagrees with who the notebook is about (core
 * NotebookAboutOne.conflicts), at the top until it's settled: the question,
 * each side with its source and date, then Check it (sua looks it up as of
 * today) or the side you know is right.
 */
export function conflictLine(nb: Notebook, checking = false): SafeHtml {
  const open = (['person', 'company'] as const).flatMap((who) => openConflicts(nb.about?.[who]).map((c) => ({ who, c })));
  if (!open.length) return html``;
  const id = encodeURIComponent(nb.id);
  return html`${open.map(({ who, c }) => {
    const at = `/notebooks/${id}/about/${who}/conflicts/${encodeURIComponent(c.fact)}`;
    return html`<div class="nb-conflict" role="status">
      <p class="nb-conflict__q"><span class="nb-conflict__tag">Not settled</span> ${c.question}</p>
      <ul class="nb-conflict__sides">${c.claims.map((x) => html`<li><strong>${x.value}</strong>${x.source || x.when ? html` <span class="nb-conflict__src">${x.source ? html`<a href="${x.source}" target="_blank" rel="noopener">${siteOf(x.source)} ↗</a>` : html``}${x.source && x.when ? ' · ' : ''}${x.when ?? ''}</span>` : html``}</li>`) as unknown as SafeHtml[]}</ul>
      <div class="nb-conflict__acts">
        ${checking ? working({ text: 'sua is checking it…' }) : html`<form method="POST" action="${at}/check"><button type="submit" class="btn btn--sm btn--primary" title="sua looks it up as of today, with both sides as leads, and keeps the answer with its source">Check it</button></form>`}
        ${c.claims.map((x) => html`<form method="POST" action="${at}/settle"><input type="hidden" name="value" value="${x.value}"><button type="submit" class="btn btn--sm btn--ghost">It's ${x.value}</button></form>`) as unknown as SafeHtml[]}
      </div>
    </div>`;
  }) as unknown as SafeHtml[]}`;
}

const STEP_STATUS: Record<NotebookStep['status'], string> = { todo: 'to do', running: 'running', met: 'goal met', stuck: 'stuck', done: 'done' };

/**
 * What a step offers you, once it's run (the step strip, and the folded
 * steps line): Search again, Look again, Write again (and Edit the points),
 * Check or Source the top N when it came out short, and Narrow or Pick when
 * it's yours and current. Nothing while the notebook is working.
 */
function stepActions(nb: Notebook, step: NotebookStep, p: Pick<ReturnType<typeof stepProgress>, 'met' | 'have' | 'want'>, o: { running: boolean; current?: NotebookStep; inRunning: number; focus: number; how?: boolean }): SafeHtml {
  const { running, current, inRunning, focus } = o;
  return html`
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
    ? step.shape === 'answer' || step.shape === 'plan' || step.shape === 'writeup'
      ? html`<form method="POST" action="/notebooks/${encodeURIComponent(nb.id)}/steps/${step.id}/again" class="nb-step__focus"><button type="submit" class="nb-step__focus-btn" title="Write the ${step.shape === 'writeup' ? 'write-up' : step.shape} once more, from what the notebook has now; this one is replaced">${step.shape === 'plan' ? 'Plan again' : step.shape === 'writeup' ? 'Write up again' : 'Answer again'} →</button></form>`
      : html`<form method="POST" action="/notebooks/${encodeURIComponent(nb.id)}/steps/${step.id}/again" class="nb-step__focus"><button type="submit" class="nb-step__focus-btn" title="${nb.briefing?.by === 'you' ? 'Write the talking points once more, from what the notebook has now; your edits are replaced' : 'Write the talking points once more, from what the notebook has now; these are replaced'}">Write again →</button></form>${nb.briefing?.points.length ? html`<a class="nb-step__focus-btn" href="/notebooks/${encodeURIComponent(nb.id)}/talking-points" title="Reword, reorder, remove or add talking points">Edit the points →</a>` : html``}`
    : html``}
  ${!running && nb.status === 'active' && step === current && (step.kind === 'decide' || step.kind === 'narrow')
    ? html`<button type="button" class="nb-step__focus-btn" data-nb-open-act="${step.kind}" title="${step.kind === 'decide' ? 'Tick the ones you picked; the notebook can stay open' : 'Tick the ones to keep; the rest are ruled out'}">${step.kind === 'decide' ? (p.have ? 'Change the picks' : `Pick ${String(p.want)}`) : 'Narrow'}… →</button>`
    : html``}
  ${o.how ? html`<a class="nb-step__focus-btn nb-step__how" href="/notebooks/${encodeURIComponent(nb.id)}/workflow?step=${encodeURIComponent(step.id)}" title="The runs this step made, the agents they called, and what each left">How →</a>` : html``}`;
}

/**
 * What made the notebook, as a link at the end of the header's meta line:
 * how many agents and runs, into How it was made (which names them; so do
 * the step chips). Before anything has run, just "How it was made →".
 */
export function madeByLink(nb: Pick<Notebook, 'id'>, m: NotebookMadeBy | undefined): SafeHtml {
  const href = `/notebooks/${encodeURIComponent(nb.id)}/workflow`;
  if (!m || m.runs === 0) return html`<a href="${href}">How it was made →</a>`;
  return html`<a class="nb-hero__madeby" href="${href}">Made by ${String(m.agents.length)} agent${m.agents.length === 1 ? '' : 's'} in ${String(m.runs)} run${m.runs === 1 ? '' : 's'} →</a>`;
}

/**
 * What's new since the last run (a briefing rerun): what it learned, changed
 * or found that the run before didn't, or that a recheck found nothing new.
 */
/**
 * Sources found after an answer was written (ADR-0083): how many, how many
 * primary or from outside what it's about, and Answer again to write it from
 * them. Nothing while it's closed, has no answer, or nothing came since.
 */
export function answerBehindBand(nb: Notebook, entries: readonly NotebookEntry[]): SafeHtml {
  const step = nb.steps?.find((s) => s.kind === 'write' && s.shape === 'answer');
  const n = step && nb.status === 'active' && (step.status === 'done' || step.status === 'met') ? answerNewSources(nb, entries) : undefined;
  if (!step || !n) return html``;
  const kinds = [n.primary ? `${String(n.primary)} primary` : '', n.outside ? `${String(n.outside)} from outside ${answerSubjects(nb).join(', ')}` : ''].filter(Boolean).join(', ');
  return html`<form class="nb-new nb-behind" method="POST" action="/notebooks/${encodeURIComponent(nb.id)}/steps/${step.id}/again" role="status">
    <span><b>${String(n.pages)} source${n.pages === 1 ? '' : 's'} found after the answer was written</b>${kinds ? `: ${kinds}` : ''}. The answer doesn't use ${n.pages === 1 ? 'it' : 'them'} yet.</span>
    <button type="submit" class="btn btn--sm" title="Write the answer once more, from what the notebook has now; this one is replaced">Answer again →</button>
  </form>`;
}

export function whatsNewBand(w: WhatsNew | undefined): SafeHtml {
  if (!w) return html``;
  const day = shortDay;
  if (w.empty) return html`<p class="nb-new nb-new--none" role="status">Looked again ${day(w.at)}: nothing new since ${day(w.since)}.</p>`;
  return html`<section class="nb-new" aria-labelledby="nb-new-h">
    <h2 class="nb-new__h" id="nb-new-h">What's new since ${day(w.since)}</h2><span class="nb-new__at">looked again ${day(w.at)}</span>
    <ul class="nb-new__list">${whatsNewLines(w).map((l) => html`<li>${l}</li>`) as unknown as SafeHtml[]}</ul>
  </section>`;
}

/** How far a step got ("4 of 5 found", "write-up written", "pick 3") and where it stands ("moved on"), as the strip and the chips say it. */
function stepWords(step: NotebookStep, p: ReturnType<typeof stepProgress>): { progress: string; state: string; stateKind: string } {
  const progress = step.kind === 'decide' && step.status !== 'done' ? (p.have ? `${String(p.have)} of ${String(p.want)} picked` : `pick ${String(p.want)}`)
    : step.kind === 'narrow' && step.status !== 'done' ? (step.target ? `keep ${String(step.target)}` : 'keep the best')
    : step.kind === 'find' && p.have > p.want ? `${String(p.have)} ${p.unit ?? 'found'}, goal ${String(p.want)}`
      : p.unit ? `${String(p.have)} of ${String(p.want)} ${p.unit}`
      : step.kind === 'write' && step.shape === 'answer' ? (p.have ? 'answer written' : 'no answer yet')
      : step.kind === 'write' && step.shape === 'plan' ? (p.have ? 'plan written' : 'no plan yet')
      : step.kind === 'write' && step.shape === 'writeup' ? (p.have ? 'write-up written' : 'no write-up yet')
      : `${String(p.have)} of ${String(p.want)} ${STEP_UNIT[step.kind]}`;
  return { progress, state: step.movedOn ? 'moved on' : STEP_STATUS[step.status], stateKind: step.movedOn ? 'moved' : step.status };
}

/**
 * The notebook's work in steps: each with its agent, how far it is toward
 * its goal ("8 of 10 found") and where it stands. The step being worked on
 * (the first not done) is marked; what it still needs is its tooltip.
 */
export function stepsStrip(nb: Notebook, steps: readonly NotebookStep[], entries: readonly NotebookEntry[], running = false, madeBy?: NotebookMadeBy): SafeHtml {
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
      const { progress, state, stateKind } = stepWords(step, p);
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
          ${stepActions(nb, step, p, { running, current, inRunning, focus, how: !!madeBy?.stepPass[step.id] })}
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
  // Put away: nothing starts until it's restored.
  if (nb.archivedAt) return { note: 'Archived: restore it on its Edit page to work on its steps.' };
  // It depends on something of yours it doesn't have: the box above asks for it.
  const waiting = (nb.given ?? []).filter((g) => g.state === 'missing');
  if (waiting.length) return { note: `Waiting on you: paste ${waiting.map((g) => g.label).join(' and ')} above, or go on without it.` };
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

/**
 * The step buttons for a notebook whose conversation waits only on its step
 * cards: the header's own (Next step, or Try again / Move on), with "Next
 * step" worded as the step it starts. They act on those cards (one queue,
 * ADR-0055), so one press starts the step. None: it isn't that, or the next
 * step is yours or needs an agent.
 */
function waitingStepButtons(talk: Extract<NotebookTalkLive, { state: 'waiting' }>, nb: Notebook | undefined): Array<{ label: string; hint: string; moveOn?: boolean }> {
  if (!nb || talk.kind !== 'approve' || !talk.stepCards) return [];
  const next = nextStepAction(nb);
  if (!next || 'note' in next) return [];
  const steps = nb.steps ?? [];
  const i = steps.findIndex((x) => x.status !== 'done');
  const n = i + (steps[i]?.status === 'met' ? 2 : 1);
  const named = (b: { label: string; hint: string; moveOn?: boolean }) => (b.label === 'Next step' ? { ...b, label: `Start step ${String(n)}` } : b);
  return [named(next), ...(next.alt ? [named(next.alt)] : [])];
}

/** The button a waiting state is answered with: your step's header control, the step's own buttons, else the conversation. */
function waitingButton(talk: Extract<NotebookTalkLive, { state: 'waiting' }>, nb?: Notebook): SafeHtml {
  const steps = waitingStepButtons(talk, nb);
  if (steps.length && nb && talk.kind !== 'step') {
    return html`${steps.map((b, k) => stepButton(nb, b, k === 0)) as unknown as SafeHtml[]}<button type="button" class="btn btn--sm btn--ghost" data-nb-continue="${talk.threadId}">Ask sua</button>`;
  }
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
export function liveBar(live: NotebookLive | undefined, nb?: Notebook): SafeHtml {
  const talk = live?.talk;
  const work = live?.work ?? [];
  if (!talk && work.length === 0) return html`<div class="nb-live" data-nb-live-bar hidden></div>`;
  const open = (threadId: string, label: string, primary: boolean): SafeHtml => html`<button type="button" class="btn btn--sm${primary ? ' btn--primary' : ' btn--ghost'}" data-nb-continue="${threadId}">${label}</button>`;
  return html`<div class="nb-live" data-nb-live-bar>
      ${talk?.state === 'waiting' ? html`<div class="nb-live__row nb-live__row--waiting" role="status">
        <span class="nb-live__dot" aria-hidden="true"></span>
        <span class="nb-live__text"><strong>${waitingStepButtons(talk, nb).length ? 'Ready when you are' : waitingWords(talk.kind).label}</strong> · ${talk.text}</span>
        ${waitingButton(talk, nb)}
      </div>` : html``}
      ${talk?.state === 'working' ? html`<div class="nb-live__row nb-live__row--working" role="status">
        <span class="working__spin" aria-hidden="true"></span>
        <span class="nb-live__text"><strong>${talk.text.replace(/…$/, '')}</strong> on a reply in this answer's conversation…</span>
        ${open(talk.threadId, 'Watch', false)}
      </div>` : html``}
      ${work.length ? html`<div class="nb-live__working" data-notebook-running>
        ${working({ size: 'panel', title: `${work[0].replace(/…$/, '')}…`, text: `${work.length > 1 ? `Also: ${work.slice(1).map((w) => w.replace(/…$/, '')).join(', ')}. ` : ''}This page updates as it goes; you can leave and come back.`, ...(live?.since ? { since: live.since } : {}) })}
      </div>
      <a class="nb-live__pin" href="#nb-title" data-nb-live-pin hidden>${working({ text: `${work[0].replace(/…$/, '')}…` })}</a>` : html``}
    </div>`;
}

/** Update all: each done profile, find and write step again, in order (two or more of them); nothing while it's working. */
function updateAllButton(nb: Notebook, running: boolean): SafeHtml {
  const again = updateSteps(nb);
  return !running && nb.status === 'active' && again.length >= 2
    ? html`<form method="POST" action="/notebooks/${encodeURIComponent(nb.id)}/update" class="nb-step__focus"><button type="submit" class="nb-step__focus-btn nb-step__update" title="${again.map((s) => s.title).join(', then ')}; then what's new since the last run">Update all →</button></form>`
    : html``;
}

/**
 * The steps while nothing runs and none is stuck: one chip each, in order
 * ("✓ Find 4/5", "✓ Source 18/20 · short", "○ Pick 3 · yours"), each opening
 * a small card with what the step did and what it offers (stepActions), then
 * Update all, then All steps for the full strip. They took ~270px of the page
 * as cards; folded, a line. Running or stuck, the page shows the strip.
 */
function stepChips(nb: Notebook, steps: readonly NotebookStep[], entries: readonly NotebookEntry[], strip: SafeHtml, madeBy?: NotebookMadeBy): SafeHtml {
  const current = steps.find((x) => x.status !== 'done' && x.status !== 'met');
  const inRunning = entries.filter((e) => e.kind === 'option' && !e.ruledOut).length;
  const focus = topFor(nb, inRunning);
  return html`<div class="nb-chips" role="list" aria-label="Steps">
    ${steps.map((step) => {
      const p = stepProgress(nb, entries, step);
      const { progress, state, stateKind } = stepWords(step, p);
      const finished = step.status === 'done' || step.status === 'met';
      const short = !!step.movedOn && !p.met;
      const yours = step === current && (step.kind === 'decide' || step.kind === 'narrow');
      const mark = finished ? '✓' : step.status === 'stuck' ? '!' : '○';
      const word = step.title.split(/\s+/)[0] ?? step.title;
      const count = step.kind === 'decide' ? (p.have ? `${String(p.have)}/${String(p.want)}` : String(p.want))
        : step.kind === 'narrow' ? (step.target ? String(step.target) : '')
        : step.kind === 'write' || step.kind === 'profile' ? ''
        : p.want ? `${String(p.have)}/${String(p.want)}` : '';
      const by = step.agentId ?? suaStepAgentName(step.kind) ?? (isYourStep(step) ? 'you' : '');
      const kind = short ? 'short' : yours ? 'yours' : finished ? 'done' : step.status;
      return html`<details class="nb-chip-step nb-chip-step--${kind}" role="listitem" data-nb-act>
        <summary class="nb-chip-step__chip" title="${step.title}: ${progress}${short ? ', moved on short of its goal' : ''}"><span aria-hidden="true">${mark}</span> ${word}${count ? html` <span class="nb-chip-step__count">${count}</span>` : html``}${short ? html` <span class="nb-chip-step__tag">· short</span>` : yours ? html` <span class="nb-chip-step__tag">· yours</span>` : html``}</summary>
        <div class="nb-chip-step__card">
          <b class="nb-chip-step__title">${step.title}</b>
          ${by ? html`<span class="nb-chip-step__by">with ${by}</span>` : html``}
          <span class="nb-chip-step__meta">${progress}${step.top ? ` · top ${String(step.top)}` : ''} · <span class="nb-step__state nb-step__state--${stateKind}">${state}</span></span>
          ${step.why && step.movedOn ? html`<span class="nb-chip-step__why">${step.why}</span>` : step.note && !finished ? html`<span class="nb-chip-step__why">${step.note}</span>` : html``}
          <span class="nb-chip-step__acts">${stepActions(nb, step, p, { running: false, current, inRunning, focus, how: !!madeBy?.stepPass[step.id] })}</span>
        </div>
      </details>`;
    }) as unknown as SafeHtml[]}
    <span class="nb-chips__end">${updateAllButton(nb, false)}</span>
    <details class="nb-chips__all"><summary>All steps</summary>${strip}</details>
  </div>`;
}

function hero(nb: Notebook, stages: PipelineStage[], running?: { step: number; of: number }, widgetsIn = false, coverIn?: { src: string; kind: string; shape?: string }, leads: readonly NotebookViewOption[] = [], entries: readonly NotebookEntry[] = [], busy: readonly string[] = [], live?: NotebookLive, head?: NotebookHeaderView, madeBy?: NotebookMadeBy, fresh?: WhatsNew, reading: Record<string, 'working' | 'failed'> = {}): SafeHtml {
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
  // Really running (its pipeline is going), not a "running" status left behind.
  const isRunning = !!running;
  const leftRunning = !!nb.steps?.some((x) => x.status === 'running');
  const stuck = !!nb.steps?.some((x) => x.status === 'stuck');
  const waiting = live?.talk?.state === 'waiting';
  const asked = askedLine(nb);
  const kind = head?.subtitle ?? answerKind(nb);
  // One band at a time: what needs you (the live bar) first, then an answer behind its sources, then what's new.
  const behind = isRunning || waiting ? html`` : answerBehindBand(nb, entries);
  const band = isRunning || waiting ? html`` : String(behind).trim() ? behind : whatsNewBand(fresh);
  const steps = nb.steps?.length
    ? (!isRunning && !stuck && !leftRunning ? stepChips(nb, nb.steps, entries, stepsStrip(nb, nb.steps, entries, false, madeBy), madeBy) : html`${stepsStrip(nb, nb.steps, entries, isRunning, madeBy)}<p class="nb-hero__update">${updateAllButton(nb, isRunning)}</p>`)
    : pipelineDiagram(stages);
  const runRow = (nb.pipeline.length || nb.steps?.length) && !running && !busy.length && (nb.status === 'active' || (nb.lastRunAt && !nb.steps?.length)) ? html`
          <div class="nb-run">
            ${nb.status === 'active' ? runButton(nb) : html``}
            ${nb.lastRunAt && !nb.steps?.length ? html`<span class="nb-run__last">Last run ${formatAge(nb.lastRunAt)}: ${nb.lastRunNote ?? ''}</span>` : html``}
          </div>` : html``;
  const doneWhen = !widgets || total > 0 ? html`<div class="nb-progress nb-details__done">
          ${progressRing(met, total)}
          <div class="nb-progress__list">
            <span class="nb-progress__label">Done when</span>
            ${total === 0 ? html`<span class="nb-progress__empty">No criteria yet. Add them with Edit.</span>` : html``}
            ${nb.criteria.map((c, i) => html`
              <form method="POST" action="/notebooks/${id}/criteria/${String(i)}" class="nb-crit">
                <input type="hidden" name="met" value="${c.met ? '0' : '1'}">
                <button type="submit" class="nb-crit__btn ${c.met ? 'is-met' : ''}" aria-pressed="${c.met ? 'true' : 'false'}" title="${c.met ? 'Mark not met' : 'Mark met'}">${c.met ? '✓' : '○'}</button>
                <span class="nb-crit__text ${c.met ? 'is-met' : ''}"${criterionHint(nb, c) ? html` title="${criterionHint(nb, c)}"` : html``}>${c.text}</span>
              </form>`) as unknown as SafeHtml[]}
          </div>
        </div>` : html``;
  return html`
    <section class="nb-hero${widgets ? ' nb-hero--wide' : ''}${head?.side ? ' nb-hero--side' : ''}" aria-labelledby="nb-title" data-nb-edit="/notebooks/${id}/edit">
      <div class="nb-hero__main">
        <div class="nb-hero__titlerow">
          ${cover
            ? html`<img class="${['nb-hero__cover', pictureClass(cover.kind, cover.shape)].filter(Boolean).join(' ')}" src="${cover.src}" alt="" title="${cover.kind === 'illustration' ? 'An illustration' : cover.kind === 'listing' ? 'From a listing' : cover.kind === 'logo' ? 'A logo' : 'An example photo'}">`
            : html`<span class="nb-hero__icon">${NOTEBOOK_ICON}</span>`}
          <div class="nb-hero__names">
            ${kind ? html`<p class="nb-hero__subtitle">${kind}</p>` : html``}
            <div class="nb-hero__nameline"><h1 class="nb-hero__title" id="nb-title">${nb.title}</h1>${starButton(nb, 'nb-hero__star')}${nb.status === 'active' && !nb.archivedAt ? html`` : statusChip(nb)}</div>
          </div>
          <div class="nb-hero__acts">${heroActions(nb, entries, leads, running, !!fresh && !fresh.empty)}</div>
        </div>
        ${String(asked).trim() ? asked : head?.statement === false || (nb.statement && sameWords(nb.statement, nb.title)) ? html`` : nb.statement ? html`<p class="nb-hero__statement">${nb.statement}</p>` : html`<p class="nb-hero__statement nb-hero__statement--empty">Say what this answer is for under Edit.</p>`}
        ${conflictLine(nb, busy.includes(CHECKING_WHO))}
        <p class="nb-hero__meta">started ${formatAge(nb.createdAt)}${sourcesCount(entries)}${nb.askedIn ? html` · <a href="/inbox/${encodeURIComponent(nb.askedIn)}" title="The conversation you asked it in">From this conversation →</a>` : html``}</p>
        ${isRunning && nb.steps?.length ? html`<div class="nb-hero__steps">${stepsCard(nb, { still: true })}</div>` : html``}
        ${liveBar(live ?? { work: [...(running ? [`Running step ${String(running.step)} of ${String(running.of)}`] : []), ...busy] }, nb)}
        ${band}
        ${nb.status === 'decided' && nb.decision ? decidedBox(nb, entries) : html``}
        <details class="nb-details" data-nb-details${stuck ? html` open data-nb-details-needs` : html``}>
          <summary class="nb-details__summary">Steps and details</summary>
          <div class="nb-details__body">
            ${steps}
            ${givenAdds(nb, reading)}
            ${widgets || !nb.params.length ? html`` : html`<div class="nb-hero__chips">${nb.params.map((p) => html`<span class="nb-chip">${p}</span>`) as unknown as SafeHtml[]}</div>`}
            <p class="nb-hero__meta nb-details__meta">${cadence}${running ? html`` : newLink(leads)} · ${madeByLink(nb, madeBy)}</p>
            ${runRow}
            ${doneWhen}
          </div>
        </details>
      </div>
      ${head?.side ? html`<aside class="nb-hero__side nb-hero__side--drawn" aria-label="At a glance">${renderSurfaceHost(`notebook-${nb.id}-header`, head.side, { label: `${nb.title}: at a glance` })}</aside>` : html``}
    </section>`;
}

/** The kind of answer for the header's eyebrow: its ready-made page's name (Shortlist, Meeting brief…), else none. */
function answerKind(nb: Pick<Notebook, 'layout'>): string {
  const name = pageName(nb.layout);
  return name === 'Made for this answer' ? '' : name;
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

function surfaceColumn(nb: Notebook, compiled: CompiledSurface, entries: NotebookEntry[], history?: NotebookViewHistory, settingUp = false, running = false, pictures: readonly string[] = []): SafeHtml {
  const note = settingUp
    ? html`<p class="nb-setup" role="status"><span class="working__spin" aria-hidden="true"></span>sua is setting up this answer: what each option records, the stages they go through, and a page that fits what it's for. This page updates when it's done.</p>`
    : html``;
  return html`${note}${surfaceColumnBody(nb, compiled, entries, history, running)}${picturesSection(nb, entries, pictures)}`;
}

/**
 * Pictures added to the answer (an agent's graphic, added from a
 * conversation): each at the column's width, its title under it and a link
 * to the run that made it. Drawn under whatever page it has, so any layout
 * shows them.
 */
export function picturesSection(nb: Notebook, entries: readonly NotebookEntry[], ids: readonly string[]): SafeHtml {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const notes = ids.map((id) => byId.get(id)).filter((e): e is NotebookEntry => !!e);
  if (!notes.length) return html``;
  const enc = encodeURIComponent;
  return html`<section class="nb-pictures" aria-labelledby="nb-pictures-${nb.id}">
    <h2 class="nb-region__title" id="nb-pictures-${nb.id}">Pictures <span class="nb-region__count">${String(notes.length)}</span></h2>
    ${notes.map((e) => {
      const src = `/notebooks/${enc(nb.id)}/entries/${enc(e.id)}/photo`;
      return html`<figure class="nb-picture">
        <a href="${src}" target="_blank" rel="noopener"><img src="${src}" alt="${e.title}" loading="lazy"></a>
        <figcaption><strong>${e.title}</strong>${e.runId ? html` · <a href="/runs/${enc(e.runId)}">the run that made it</a>` : html``}</figcaption>
      </figure>`;
    }) as unknown as SafeHtml[]}
  </section>`;
}

function surfaceColumnBody(nb: Notebook, compiled: CompiledSurface, entries: NotebookEntry[], history?: NotebookViewHistory, running = false): SafeHtml {
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
  // While a step runs, a part with nothing yet keeps its place as a skeleton.
  const widgets = notebookWidgetMessages(nb, entries, history, { pending: running, tldrCard: showsTldrCard(nb, entries, history) });
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
  if (nb.experimentId) {
    return { hint: 'Ask what the results mean, or what to try next.', placeholder: 'e.g. why did the pay-first build do worse, or what would you change and run again?' };
  }
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
    <form method="POST" action="/notebooks/${encodeURIComponent(nb.id)}/ask" class="nb-talk__form ${big ? 'nb-talk__form--big' : ''}" data-ask-fix data-attach>
      <label class="nb-talk__next" for="nb-talk-${big ? 'big' : 'side'}">${step.hint}</label>
      <textarea id="nb-talk-${big ? 'big' : 'side'}" name="text" required rows="${big ? '4' : '3'}" class="form-field"
        placeholder="${step.placeholder}" data-enter-sends aria-describedby="nb-talk-keys-${big ? 'big' : 'side'}"></textarea>
      <div class="nb-talk__send">
        <span class="nb-talk__keys" id="nb-talk-keys-${big ? 'big' : 'side'}"><kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line</span>
        <span class="nb-talk__acts">${attachPick()}<button type="submit" class="btn btn--primary btn--sm">Tell sua</button></span>
      </div>
    </form>`;
}

/** A finished run of one of the notebook's agents that isn't in it yet. */
export interface UnfiledRunView { id: string; agentId: string; startedAt: string; adding?: boolean }

/** How many sources the side card lists before "and N more". */
const RAIL_SOURCES = 3;

/**
 * The side card of its sources (the answer prototype): how many pages it
 * learned from, the first few with whether their quote was found on them
 * (found ones first), and how many more. Each opens its page. None until it
 * has learned from a page. The full list, with each quote, is on the page.
 */
export function sourcesRail(entries: readonly NotebookEntry[]): SafeHtml {
  const pages = answerTracePages(entries);
  if (!pages.length) return html``;
  const rank = (e: NotebookEntry) => (e.trace?.status === 'found' ? 0 : e.trace?.status === 'missing' ? 2 : 1);
  const shown = [...pages].sort((a, b) => rank(a) - rank(b)).slice(0, RAIL_SOURCES);
  const found = pages.filter((e) => e.trace?.status === 'found').length;
  const missing = pages.filter((e) => e.trace?.status === 'missing').length;
  const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const status = (e: NotebookEntry) => e.trace?.status === 'found' ? html`<span class="nb-rail__st nb-rail__st--found">✓ found</span>`
    : e.trace?.status === 'missing' ? html`<span class="nb-rail__st nb-rail__st--missing">✗ not found</span>`
    : e.trace ? html`<span class="nb-rail__st">can't check</span>` : html`<span class="nb-rail__st">not checked yet</span>`;
  const more = pages.length - shown.length;
  return html`<section class="nb-side__card nb-rail" aria-labelledby="nb-rail-title">
    <h2 class="nb-side__title" id="nb-rail-title">Sources · ${String(pages.length)}</h2>
    <ul class="nb-rail__list">
      ${shown.map((e) => html`<li class="nb-rail__row"><a href="${e.fingerprint!}" target="_blank" rel="noopener" class="nb-rail__link"><span class="nb-rail__name">${e.title.split(' (found by')[0]}</span><span class="nb-rail__host">${host(e.fingerprint!)}</span></a>${status(e)}</li>`) as unknown as SafeHtml[]}
    </ul>
    <p class="nb-rail__more">${more ? `and ${String(more)} more · ` : ''}${found} quote${found === 1 ? '' : 's'} found on their pages${missing ? `, ${String(missing)} not found` : ''}. Each finding on the page opens its sources, quote and all.</p>
  </section>`;
}

function sideForms(nb: Notebook, entries: readonly NotebookEntry[], lastWord?: { text: string; at: number }, unfiled: readonly UnfiledRunView[] = [], talkLive?: NotebookTalkLive, followUps: readonly FollowUp[] = []): SafeHtml {
  const hasEntries = entries.length > 0;
  const id = encodeURIComponent(nb.id);
  const canTalk = hasEntries || !!nb.conversationId;
  const follow = followUpPanel(nb, followUps);
  const canFollow = !!String(follow).trim();
  // Which tab opens first: talking to sua while it waits on you or is replying, or while its steps aren't done; a follow-up once they are.
  const done = !(nb.steps ?? []).some((s) => s.status !== 'done' && s.status !== 'met' && s.kind !== 'decide' && s.kind !== 'narrow');
  // "Ready when you are" (your step is next) isn't sua asking you something: only a real question or a reply under way opens Tell sua first.
  const asking = talkLive?.state === 'waiting' && talkLive.kind !== 'step' && !talkLive.stepCards;
  const talkFirst = !canFollow || (canTalk && (asking || talkLive?.state === 'working' || !done || !nb.steps?.length));
  const tab = (key: 'follow' | 'talk', label: string, on: boolean) => html`<button type="button" role="tab" class="nb-askcard__tab${on ? ' is-on' : ''}" aria-selected="${on ? 'true' : 'false'}" aria-controls="nb-tab-${key}" data-nb-tab="${key}">${label}</button>`;
  return html`
    ${sourcesRail(entries)}
    ${canTalk || canFollow ? html`<div class="nb-side__card nb-askcard" data-nb-askcard>
      ${canTalk && canFollow ? html`<div class="nb-askcard__tabs" role="tablist" aria-label="Ask or tell sua">${tab('follow', 'Ask a follow-up', !talkFirst)}${tab('talk', 'Tell sua about this one', talkFirst)}</div>` : html``}
      ${canFollow ? html`<div class="nb-askcard__panel" id="nb-tab-follow" role="tabpanel" data-nb-tabpanel="follow"${canTalk && talkFirst ? html` hidden` : html``}>${follow}</div>` : html``}
    ${canTalk ? html`
      <section class="nb-askcard__panel nb-talk${talkLive?.state === 'waiting' ? ' is-waiting' : ''}" id="nb-tab-talk" role="tabpanel" data-nb-tabpanel="talk" aria-labelledby="nb-talk-title"${canFollow && !talkFirst ? html` hidden` : html``}>
        <h2 class="nb-side__title${canFollow ? ' sr-only' : ''}" id="nb-talk-title">Talk to sua about this answer</h2>
        ${talkLive?.state === 'waiting'
          ? html`<div class="nb-talk__waiting" role="status">
              <span class="nb-talk__waiting-label">${waitingStepButtons(talkLive, nb).length ? 'Ready when you are' : waitingWords(talkLive.kind).label}</span>
              <span class="nb-talk__waiting-ask">${talkLive.text}</span>
              <span class="nb-talk__waiting-acts">${waitingButton(talkLive, nb)}</span>
            </div>`
          : talkLive?.state === 'working'
            ? html`<p class="nb-talk__working" role="status"><span class="working__spin" aria-hidden="true"></span>${talkLive.text} <button type="button" class="btn btn--sm btn--ghost" data-nb-continue="${talkLive.threadId}">Watch</button></p>`
            : lastWord ? html`<blockquote class="nb-talk__last"><span class="nb-talk__who">sua · ${formatAge(new Date(lastWord.at).toISOString())}</span>${lastWord.text}</blockquote>` : html``}
        ${talkForm(nb, entries)}
        ${nb.conversationId ? html`<button type="button" class="btn btn--sm btn--ghost nb-talk__continue" data-nb-continue="${nb.conversationId}">Continue the conversation</button>` : html``}
      </section>` : html``}
    </div>` : html``}
    ${unfiled.length ? html`
      <section class="nb-side__card nb-unfiled" aria-labelledby="nb-unfiled-title">
        <h2 class="nb-side__title" id="nb-unfiled-title">Runs not in this answer yet</h2>
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
      <ul class="nbe-manage" aria-label="Manage this answer">
        ${nb.status === 'active'
          ? row(post('status', 'status', 'stopped', 'Stop'), 'Pause it: no more searches or steps. Everything stays, and you can reopen it.')
          : row(post('status', 'status', 'active', 'Reopen'), 'Make it active again, to keep searching and working through its steps.')}
        ${row(html`<a class="btn btn--sm nbe-manage__act" href="/notebooks/${id}/template">Save as a template…</a>`, 'Start new answers set up like this one, saying what changes each time (like who you\'re meeting).')}
        <li class="nbe-manage__row">
          <details class="nbe-manage__delete">
            <summary><span class="btn btn--sm nbe-manage__act">Clear and run again…</span><span class="nbe-manage__what">A fresh answer with the same setup and none of what this one found; this one ${nb.archivedAt ? 'stays' : 'is'} archived.</span></summary>
            <form method="POST" action="/notebooks/${id}/rerun" class="nb-delete__form">
              <p class="nb-delete__what">A new answer with the same setup (what it's for, limits, done-whens, checks, steps, its page) starts its first step. This one ${nb.archivedAt ? 'stays' : 'is'} archived with its options, notes, answer and history; nothing is deleted. No template is made.</p>
              <button type="submit" class="btn btn--sm btn--primary">Run it again</button>
            </form>
          </details>
        </li>
        ${nb.archivedAt
          ? row(post('archive', 'archived', '0', 'Restore'), 'Show it again in your answers, Home and Today.')
          : row(post('archive', 'archived', '1', 'Archive'), 'Hide it from your answers, Home and Today, and stop its schedule. Nothing is deleted.')}
        <li class="nbe-manage__row nbe-manage__row--danger">
          <details class="nbe-manage__delete">
            <summary><span class="btn btn--sm nbe-manage__act">Delete…</span><span class="nbe-manage__what">Remove it and everything in it. This can't be undone.</span></summary>
            <form method="POST" action="/notebooks/${id}/delete" class="nb-delete__form">
              <p class="nb-delete__what">Delete “${nb.title}” and everything in it (options, notes, history, photos)? Its conversation with sua and the runs that fed it stay. This can't be undone.${nb.archivedAt ? '' : ' To only hide it, archive it instead.'}</p>
              <input type="hidden" name="confirm" value="${nb.id}">
              <button type="submit" class="btn btn--sm btn--warn">Delete this answer</button>
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
  /** Tags in use on your notebooks, most used first (what the Add box suggests). */
  tagVocabulary?: readonly string[];
}

/**
 * Edit → Tags: the notebook's tags, each with a remove button, a box to add
 * your own (suggesting tags you already use), and sua's tags you removed with
 * a way to put them back. Each is its own small form; it saves straight away.
 */
function notebookTagEditor(nb: Notebook, tab: NotebookEditView['tab'], vocabulary: readonly string[]): SafeHtml {
  const id = encodeURIComponent(nb.id);
  const tags = notebookTags(nb);
  const mine = new Set(nb.tags?.added ?? []);
  const removed = (nb.tags?.removed ?? []).filter((t) => (nb.tags?.auto ?? []).includes(t));
  const suggest = vocabulary.filter((t) => !tags.includes(t));
  const form = (name: 'add' | 'remove' | 'restore', value: string, inner: SafeHtml, cls: string) =>
    html`<form method="POST" action="/notebooks/${id}/tags" class="${cls}"><input type="hidden" name="tab" value="${tab}"><input type="hidden" name="${name}" value="${value}">${inner}</form>`;
  return html`<section class="nbe-card nbe-tags" id="nbe-tags" aria-labelledby="nbe-tags-h">
    <h2 class="nbe-card__h" id="nbe-tags-h">Tags</h2>
    <p class="nbe-tags__hint">For filtering your answers. Changes save straight away, and sua keeps them when it tags again.</p>
    ${tags.length
      ? html`<ul class="nbe-tags__list" aria-label="This notebook's tags">${tags.map((t) => html`<li>${form('remove', t, html`<span class="nbe-tag__name">${t}</span>${mine.has(t) ? html`<span class="nbe-tag__by">yours</span>` : html``}<button type="submit" class="nbe-tag__x" aria-label="Remove the tag ${t}" title="Remove">×</button>`, 'nbe-tag')}</li>`) as unknown as SafeHtml[]}</ul>`
      : html`<p class="nbe-tags__none">${nb.tags?.at || removed.length ? 'No tags.' : 'No tags yet. sua adds them in the background; open Answers to start it.'}</p>`}
    <form method="POST" action="/notebooks/${id}/tags" class="nbe-tags__add">
      <input type="hidden" name="tab" value="${tab}">
      <label class="sr-only" for="nbe-tag-add">Add a tag</label>
      <input id="nbe-tag-add" type="text" name="add" maxlength="24" required placeholder="Add a tag, e.g. used cars" autocomplete="off" list="nbe-tags-all">
      <datalist id="nbe-tags-all">${suggest.map((t) => html`<option value="${t}"></option>`) as unknown as SafeHtml[]}</datalist>
      <button type="submit" class="btn btn--sm">Add</button>
    </form>
    ${removed.length ? html`<p class="nbe-tags__removed"><span>You removed:</span>${removed.map((t) => form('restore', t, html`<span class="nbe-tag__name">${t}</span><button type="submit" class="nbe-tag__back">Put back</button>`, 'nbe-tag nbe-tag--removed')) as unknown as SafeHtml[]}</p>` : html``}
  </section>`;
}


/** The notebook in a few lines: what it's for, its limits, done-whens, facts, steps and page. */
function editSummary(nb: Notebook): SafeHtml {
  const row = (label: string, body: SafeHtml | string) => html`<div class="nbe-sum__row"><dt>${label}</dt><dd>${body}</dd></div>`;
  const chips = (xs: readonly string[]) => (xs.length ? html`<span class="nbe-sum__chips">${xs.map((x) => html`<span class="nb-chip">${x}</span>`) as unknown as SafeHtml[]}</span>` : html`<span class="nbe-sum__none">none</span>`);
  return html`<dl class="nbe-sum">
    ${row('For', nb.statement || nb.title)}
    ${row('Limits', chips(nb.params))}
    ${row('Done when', chips(nb.criteria.map((c) => `${c.met ? '✓ ' : ''}${c.text}`)))}
    ${row('Facts', chips(nb.fields.map((f) => f.label)))}
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
  // The starters, each with what can really finish it for this notebook (as it would be with your changes).
  const starters = editStarters(proposed, args.entries.some((e) => e.kind === 'option'));
  const talk = html`
    <section class="nbe-talk" aria-label="Say what to change">
      ${editSummary(proposed)}
      ${args.turns.length ? html`<ol class="nbe-turns">${args.turns.map(editTurn) as unknown as SafeHtml[]}
        ${args.working ? html`<li class="nbe-turn nbe-turn--sua is-working" role="status"><span class="nbe-turn__who">sua</span><span class="working__spin" aria-hidden="true"></span>Changing it. The preview opens when it's done.</li>` : html``}</ol>` : html`
        <p class="nbe-talk__lede">Say what to change, the way you'd ask a person. “Do it better” has sua sharpen the whole answer and draw its page again.</p>`}
      <form method="POST" action="/notebooks/${id}/edit/talk" class="nbe-talk__form">
        <label class="sr-only" for="nbe-say">What to change</label>
        <textarea name="text" id="nbe-say" rows="3" class="form-field" required data-enter-sends ${args.working ? unsafeHtml('disabled') : unsafeHtml('')}
          placeholder="e.g. “add a step to learn about her company”, “put who she is at the top”, “stop noting the price”"></textarea>
        <div class="nbe-talk__send">
          ${args.turns.length ? html`<span class="nb-talk__keys"><kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line</span>` : html`<span class="nbe-talk__starters" aria-label="Start with">${starters.map((x, i) => html`<button type="button" class="nbd-chip nbd-chip--add" data-nbe-start="${x.text}" aria-controls="nbe-opts-${String(i)}" aria-expanded="false">${x.label}</button>`) as unknown as SafeHtml[]}</span>`}
          <button type="submit" class="btn btn--primary btn--sm" title="Enter sends; Shift+Enter starts a new line" ${args.working ? unsafeHtml('disabled') : unsafeHtml('')}>Send</button>
        </div>
        ${args.turns.length ? html`` : starters.map((x, i) => (x.options.length ? html`<div class="nbe-talk__options" id="nbe-opts-${String(i)}" data-nbe-options hidden>
          <span class="nbe-talk__ask">${x.ask}:</span>
          ${x.options.map((o) => html`<button type="button" class="nbd-chip" data-nbe-fill="${o.text}" title="${o.text}">${o.label}</button>`) as unknown as SafeHtml[]}
          <span class="nbe-talk__or">or finish it your own way.</span>
        </div>` : html``)) as unknown as SafeHtml[]}
      </form>
    </section>`;
  const prompt = html`
    <section class="nbe-prompt" aria-label="The answer as a document">
      <p class="nbe-prompt__lede">The whole answer as a document. Change anything, then show it in the preview; nothing is saved until you save. A section you leave out stays as it was. Steps read <code>Title (kind target; about who; facts a, b; top 5; with agent)</code>; a write step that answers the question reads <code>(write; answer)</code>, one that makes a plan <code>(write; plan)</code>, one that writes a shortlist up <code>(write; writeup)</code>.</p>
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
        <textarea name="markdown" class="form-field nbe-prompt__text" rows="26" spellcheck="false" aria-label="The answer as markdown" ${args.working ? unsafeHtml('disabled') : unsafeHtml('')}>${args.markdown}</textarea>
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
        crumbs: [{ label: 'Home', href: '/' }, { label: 'Answers', href: '/notebooks' }, { label: nb.title, href: `/notebooks/${id}` }, { label: 'Edit' }],
        title: 'Edit this answer',
        description: 'Preview shows the answer as it would be. Nothing changes until you save.',
      })}
      <div class="nbe-cols">
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
        ${args.tab === 'prompt' ? prompt : args.tab === 'looks' ? notebookLooks(nb.id, { now: nb.layout, ...(nb.layoutBy ? { by: nb.layoutBy } : {}), ...(args.lookChanged !== undefined ? { changed: args.lookChanged } : {}), working: args.working, undos: args.layoutUndos ?? 0 }) : talk}
      </div>
      <aside class="nbe-rail" aria-label="This answer">
        ${notebookTagEditor(nb, args.tab, args.tagVocabulary ?? [])}
        ${givenRail(nb)}
        <section class="nbe-card" aria-labelledby="nbe-manage-h">
          <h2 class="nbe-card__h" id="nbe-manage-h">Manage</h2>
          ${notebookMoreActions(nb)}
        </section>
      </aside>
      </div>
      <dialog class="nbe-preview" id="nbe-preview" aria-label="Preview"${args.openPreview ? unsafeHtml(' data-open') : unsafeHtml('')}>
        <div class="nbe-preview__bar">
          <span class="nbe-preview__label">Preview</span>
          <span class="nbe-preview__state${pending ? ' is-changed' : ''}">${pending ? 'with your changes, not saved' : 'as it is now'}</span>
          <span class="nbe-preview__acts">
            ${pending && !args.working ? html`<form method="POST" action="/notebooks/${id}/edit/save"><button type="submit" class="btn btn--primary btn--sm">Save changes</button></form>` : html``}
            <a class="btn btn--sm btn--ghost" href="/notebooks/${id}">Open the answer</a>
            <button type="button" class="btn btn--sm" data-nbe-close>Close</button>
          </span>
        </div>
        <div class="nbe-preview__page" tabindex="0" aria-label="The answer as it would be"><div class="nbe-preview__inner" inert>
          ${hero(proposed, [], undefined, widgetsIn, undefined, decisionLeads(proposed, args.entries, Infinity, args.history), args.entries, [], undefined, notebookHeaderView(proposed, args.entries, args.history as NotebookWidgetHistory | undefined))}
          <div class="nb-body__main">${surfaceColumnBody(proposed, args.compiled, args.entries, args.history)}</div>
        </div></div>
      </dialog>
      ${args.working ? unsafeHtml(`<script>(function(){var u=${JSON.stringify(`/notebooks/${nb.id}/edit/state`)};function t(){fetch(u,{headers:{accept:"application/json"}}).then(function(r){return r.json();}).then(function(j){if(j.status!=="working"){var t0=new URLSearchParams(location.search).get("tab");location.replace(location.pathname+"?"+(t0?"tab="+encodeURIComponent(t0)+"&":"")+"preview=1");}else setTimeout(t,2000);}).catch(function(){setTimeout(t,4000);});}setTimeout(t,2000);})();</script>`) : html``}
      ${unsafeHtml('<script>(function(){var d=document.getElementById("nbe-preview");if(!d||!d.showModal)return;document.querySelectorAll("[data-nbe-preview]").forEach(function(b){b.addEventListener("click",function(){d.showModal();});});d.querySelector("[data-nbe-close]").addEventListener("click",function(){d.close();});d.addEventListener("click",function(e){if(e.target===d)d.close();});if(d.hasAttribute("data-open")){d.showModal();var u=new URL(location.href);u.searchParams.delete("preview");history.replaceState(null,"",u.pathname+u.search);}})();</script>')}
      ${unsafeHtml(`<script>(function(){
        var t=document.getElementById("nbe-say");if(!t)return;
        function put(v){t.value=v;t.focus();t.setSelectionRange(v.length,v.length);}
        var starts=document.querySelectorAll("[data-nbe-start]");
        // A starter fills the box and shows what can finish it for this notebook; one of those fills the whole sentence, to send or change.
        starts.forEach(function(b){b.addEventListener("click",function(){
          put(b.getAttribute("data-nbe-start"));
          starts.forEach(function(o){var on=o===b;o.setAttribute("aria-expanded",on?"true":"false");o.classList.toggle("is-on",on);var g=document.getElementById(o.getAttribute("aria-controls"));if(g)g.hidden=!on;});
        });});
        document.querySelectorAll("[data-nbe-fill]").forEach(function(b){b.addEventListener("click",function(){put(b.getAttribute("data-nbe-fill"));});});
      })();</script>`)}
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
 * Download / share: the brief (to send, print or hand to Claude), its
 * extended form, and CSVs of which options go in: the chosen ones (once
 * you've picked), the ones in the running, or everything with the ruled-out
 * ones and why. The shortlist's own "CSV of these" takes it as you filtered
 * it. A notebook that ends in sua writing (a meeting or company briefing, an
 * answer, a plan) has nothing to pick: the brief comes first, and its
 * findings as a spreadsheet last.
 */
/**
 * Download / share for a notebook that shows an experiment: its brief (the
 * finding, the numbers behind it and how it was run), as a page, a PDF or a
 * file. It has no options, so none of the shortlist's rows apply.
 */
/** An experiment's formats: its brief (open, PDF, HTML) and the file for another sua. */
function experimentFormats(nb: Pick<Notebook, 'id'>): SafeHtml {
  const id = encodeURIComponent(nb.id);
  return html`
      <span class="nb-progress__label">To share</span>
      <div class="nb-share__row"><span class="nb-share__what">The brief</span><span class="nb-share__as">
        <a href="/notebooks/${id}/brief.html" target="_blank" rel="noopener" title="The experiment's finding, the numbers behind it and how it was run, as a page to send or print" aria-label="Open the brief">Open ↗</a>
        <a href="/notebooks/${id}/brief.pdf" download title="The brief as a PDF file named after the notebook" aria-label="Download the brief as PDF">PDF</a>
        <a href="/notebooks/${id}/brief.html?download=1" download title="The brief as one HTML file" aria-label="Download the brief as HTML">HTML</a>
      </span></div>
      <span class="nb-csv__hint">The numbers are as the experiment stood when you open it. Its own page has every run.</span>
      ${toAnotherSua(id)}`;
}

/** Download / share → To another sua: the whole notebook as a file another sua imports. */
function toAnotherSua(id: string): SafeHtml {
  return html`<span class="nb-progress__label nb-csv__brief-label">To another sua</span>
    <div class="nb-share__row"><span class="nb-share__what">Answer file</span><span class="nb-share__as"><a href="/notebooks/${id}/export.suanb" download title="A copy of the whole notebook (options, facts, pictures, write-up, steps) and the agents and tools of yours it runs, to import into sua on another machine: New notebook → Import a notebook file" aria-label="Download the notebook file">Download</a></span></div>`;
}

/**
 * Whether Download / share has anything to offer: options, or (for one that
 * ends in sua writing, like an answer) what it wrote or the sources it filed
 * as evidence. An answer can explain from sources alone, with no options.
 */
function hasSomethingToShare(nb: Notebook, entries: readonly NotebookEntry[]): boolean {
  if (entries.some((e) => e.kind === 'option')) return true;
  if (offersDecide(nb)) return false;
  return Boolean(nb.answer || nb.briefing || nb.plan) || entries.some((e) => e.kind === 'evidence');
}

/** Whether the page, brief and PDF show the TL;DR card: Auto (when it adds a chart or a photo), Always, Never. */
function tldrCardSwitch(nb: Notebook): SafeHtml {
  const now = nb.tldrCard ?? 'auto';
  const opt = (mode: 'auto' | 'always' | 'never', label: string, hint: string) => html`<button type="submit" name="mode" value="${mode}" class="nb-share__mode${now === mode ? ' is-on' : ''}" title="${hint}"${now === mode ? unsafeHtml(' aria-pressed="true"') : unsafeHtml(' aria-pressed="false"')}>${label}</button>`;
  return html`<form method="POST" action="/notebooks/${encodeURIComponent(nb.id)}/tldr-card" class="nb-share__row"><span class="nb-share__what">TL;DR card on the page</span><span class="nb-share__as">${opt('auto', 'Auto', 'When it adds something the page doesn\u2019t say: a chart of the options, or a photo')}${opt('always', 'Always', 'On the page, the brief and the PDF')}${opt('never', 'Never', 'Not on the page, the brief or the PDF; the TL;DR picture is still here')}</span></form>`;
}

/** Every format it can be shared in (the print version, the picture, the spreadsheets, the file): More's lower half. */
function formatsPanel(nb: Notebook, entries: readonly NotebookEntry[], running: readonly NotebookViewOption[], whatsNewToo = false): SafeHtml {
  const id = encodeURIComponent(nb.id);
  const href = `/notebooks/${id}/shortlist.csv`;
  const chosen = running.filter((o) => o.chosen).length;
  const all = entries.filter((e) => e.kind === 'option').length;
  // The last run's new ones, once there are older ones to tell them from.
  const fresh = running.filter((o) => o.added === 'new').length;
  const latest = fresh > 0 && fresh < running.length;
  const written = !offersDecide(nb);
  const item = (rows: string, label: string, n: number, hint: string) =>
    html`<a class="nb-csv__item" href="${href}?rows=${rows}" download title="${hint}">${label} <span class="nb-csv__n">${String(n)}</span></a>`;
  // A written one whose findings are all evidence has no rows for the spreadsheet.
  const csv = written && all === 0
    ? html``
    : written
    ? html`<span class="nb-progress__label nb-csv__brief-label">The findings as a spreadsheet</span>
      ${item('running', 'What it found (CSV)', running.length, 'Every finding still in, with its facts and sources')}
      ${all > running.length ? item('all', 'With what it set aside', all, 'Set-aside findings last, with why') : html``}`
    : html`<span class="nb-progress__label nb-csv__brief-label">The options as a spreadsheet</span>
      ${chosen ? item('chosen', 'Chosen', chosen, 'The options you picked, best first') : html``}
      ${item('running', 'In the running', running.length, chosen ? 'Every option still in, chosen first' : 'Every option still in, best first')}
      ${all > running.length ? item('all', 'Everything, with ruled out', all, 'Ruled-out ones last, with why') : html``}
      ${latest ? item('new', 'New in the last run', fresh, 'Only the options the last run found for the first time') : html``}
      <span class="nb-csv__hint">To pick rows yourself, filter the shortlist and use its <b>CSV of these</b>.</span>`;
  // To share: one row a thing (the brief, the picture…), its forms as short links at the right, so the menu stays a few rows however many forms there are.
  const open = (what: string, path: string, hint: string) => html`<a href="/notebooks/${id}/${path}" target="_blank" rel="noopener" title="${hint}" aria-label="Open ${what}">Open ↗</a>`;
  const save = (what: string, as: string, path: string, hint: string) => html`<a href="/notebooks/${id}/${path}" download title="${hint}" aria-label="Download ${what} as ${as}">${as}</a>`;
  const row = (name: string, n: number | undefined, links: SafeHtml) => html`<div class="nb-share__row"><span class="nb-share__what">${name}${n !== undefined ? html` <span class="nb-csv__n">${String(n)}</span>` : html``}</span><span class="nb-share__as">${links}</span></div>`;
  const share = html`<span class="nb-progress__label">To share</span>
      ${row('Print version', undefined, html`${open('the brief', 'brief.html', written ? 'A polished page of what sua wrote and what it found, to send or hand to Claude' : 'A polished page of where it stands and the options, to send or hand to Claude')}${save('the brief', 'PDF', 'brief.pdf', 'The brief as a PDF file named after the notebook, ready to send: its pictures inside it, page numbers, no print dialog')}${save('the brief', 'HTML', 'brief.html?download=1', 'The brief as one HTML file')}`)}
      ${row('TL;DR picture', undefined, html`${open('the TL;DR picture', 'tldr.png', written ? 'One picture of what it found: the answer in a sentence and its first findings' : 'One picture that sums it up: the best lead, the numbers, and the options as ranked bars')}${save('the TL;DR picture', 'PNG', 'tldr.png?download=1', 'The TL;DR as a PNG file, to drop into a message')}<a href="/notebooks/${id}/tldr" title="Say how you want the picture drawn: for LinkedIn, more editorial, more creative" aria-label="Redraw the TL;DR picture">Redraw…</a>`)}
      ${tldrCardSwitch(nb)}
      ${whatsNewToo ? row("The brief with what's new", undefined, html`${open("the brief with what's new", 'brief.html?new=1', "The brief, with what's new since the last run at the top (the plain brief leaves it out)")}${save("the brief with what's new", 'PDF', 'brief.pdf?new=1', "The brief as a PDF, with what's new since the last run")}`) : html``}
      ${latest && !written ? row("What's new", fresh, html`${open("the brief of what's new", 'brief.html?latest=1', 'The brief of only the options the last run found for the first time')}${save("the brief of what's new", 'PDF', 'brief.pdf?latest=1', "The brief of what's new as a PDF file")}`) : html``}
      ${running.length === 0 ? html`` : row(written ? 'Every finding in full' : 'Each option in full', undefined, html`${open('the extended brief', 'brief.html?full=1', written ? 'The brief, then each finding as its own page shows it: every fact with its source, its notes and checks' : 'The brief, then each option in the running as its own page shows it: every fact with its source, its notes, checks and history')}${save('the extended brief', 'PDF', 'brief.pdf?full=1', `The extended brief as a PDF file; ${written ? 'each finding' : 'each option'} starts a new page`)}`)}`;
  return html`${share}${csv}${toAnotherSua(id)}`;
}

/**
 * Whether the header offers Decide…: a notebook without steps (choosing is
 * what it's for), or one whose steps have you pick or narrow. One whose
 * steps end in sua writing something (a meeting's talking points) has
 * nothing to pick from.
 */
export function offersDecide(nb: Pick<Notebook, 'steps' | 'experimentId'>): boolean {
  // One that shows an experiment has results to read, not options to pick from.
  if (nb.experimentId) return false;
  return !nb.steps?.length || nb.steps.some((s) => s.kind === 'decide' || s.kind === 'narrow');
}

/** The foot of an answer: Ask a follow-up (a new answer, asked in this one's conversation), and the ones asked so far. */
/** A follow-up asked from an answer, and how far it got. */
export interface FollowUp { id: string; title: string; state: 'working' | 'done' }

/** Ask a follow-up (beside the answer, a tab of the ask card): the box, and the follow-ups so far with where each stands. */
export function followUpPanel(nb: Pick<Notebook, 'id' | 'archivedAt' | 'experimentRun' | 'experimentId'>, followUps: readonly FollowUp[]): SafeHtml {
  if (nb.archivedAt || nb.experimentRun || nb.experimentId) return html``;
  return html`<section class="nb-follow" id="nb-follow" aria-labelledby="nb-follow-h">
    <h2 class="nb-follow__title sr-only" id="nb-follow-h">Ask a follow-up</h2>
    ${followUps.length ? html`<ul class="nb-follow__items">${followUps.map((f) => html`<li class="nb-follow__item"><a href="/notebooks/${encodeURIComponent(f.id)}">${f.title}</a><span class="nb-follow__state nb-follow__state--${f.state}">${f.state === 'done' ? 'Done →' : 'Under way'}</span></li>`) as unknown as SafeHtml[]}</ul>` : html``}
    <form method="POST" action="/notebooks/${encodeURIComponent(nb.id)}/follow-up" class="nb-follow__form">
      <textarea name="question" class="form-field nb-follow__input" rows="2" required aria-label="Your follow-up question" placeholder="What do you want to find out next?"></textarea>
      <button type="submit" class="btn btn--primary btn--sm">Ask</button>
    </form>
    <p class="nb-follow__hint">A new answer of its own. sua works out how to answer it and goes straight through, and it links back here.</p>
  </section>`;
}

/** What you asked, in your words, under the title: only when it says more than the title and what it's for. */
function askedLine(nb: Pick<Notebook, 'asked' | 'title' | 'statement'>): SafeHtml {
  const asked = (nb.asked ?? '').replace(/\s+/g, ' ').trim();
  if (!asked || sameWords(asked, nb.title) || (nb.statement && sameWords(asked, nb.statement))) return html``;
  const shown = asked.length > 240 ? `${asked.slice(0, 239).trimEnd()}…` : asked;
  return html`<p class="nb-hero__asked"><span class="nb-hero__asked-label">You asked</span> “${shown}”</p>`;
}

/** The header's count of the pages it learned from, and how many of their quotes were found on them (" · 12 sources, 9 checked"). */
export function sourcesCount(entries: readonly NotebookEntry[]): string {
  const pages = answerTracePages(entries);
  if (!pages.length) return '';
  const found = pages.filter((e) => e.trace?.status === 'found').length;
  return ` · ${String(pages.length)} source${pages.length === 1 ? '' : 's'}${found ? `, ${String(found)} checked` : ''}`;
}

/**
 * The header's actions, as few as the moment needs (the answer prototype):
 * the one thing to do now (the next step, Try again with Move on, Narrow…,
 * Decide…, Reopen, Stop while it runs), Print, and More. More holds the rest,
 * every one still a click away: Edit, + Add entry, Decide… or Narrow… when
 * they aren't the main thing, and every format to share it in. One panel open
 * at a time (notebook-page.js.ts); a panel inside More keeps More open.
 */
function heroActions(nb: Notebook, entries: readonly NotebookEntry[], leads: readonly NotebookViewOption[], running?: { step: number; of: number }, whatsNewToo = false): SafeHtml {
  const id = encodeURIComponent(nb.id);
  // While it has steps left, the next one is the header's main button (Decide steps aside).
  const next = nb.status === 'active' ? nextStepAction(nb) : undefined;
  const step = next && 'label' in next ? next : undefined;
  // The current step is a narrow step: Narrow… is the main button.
  const current = nb.steps?.find((x) => x.status !== 'done');
  const narrowing = nb.status === 'active' && current?.kind === 'narrow' && !running ? current : undefined;
  const isRunning = !!running && !!nb.steps?.some((x) => x.status !== 'done');
  const decides = nb.status === 'active' && offersDecide(nb);
  // Decide… is the main thing when nothing else is.
  const decideFirst = decides && !step && !isRunning && !narrowing;
  const shareable = !nb.experimentId && hasSomethingToShare(nb, entries);
  const narrowPanel = (primary: boolean) => html`
    <details class="nb-act nb-decide nb-narrow" data-nb-act data-nb-act-name="narrow">
      <summary class="btn btn--sm${primary ? ' btn--primary' : ''}" title="${narrowing?.title ?? ''}">Narrow…</summary>
      <div class="nb-act__panel nb-act__panel--decide">${decideForm(nb, leads, 'narrow')}</div>
    </details>`;
  const decidePanel = (primary: boolean) => html`
    <details class="nb-act nb-decide" data-nb-act data-nb-act-name="decide">
      <summary class="btn btn--sm${primary ? ' btn--primary' : ''}">Decide…</summary>
      <div class="nb-act__panel nb-act__panel--decide">${decideForm(nb, leads)}</div>
    </details>`;
  const reopen = html`<form method="POST" action="/notebooks/${id}/status" class="nb-reopen"><input type="hidden" name="status" value="active"><button type="submit" class="btn btn--sm btn--primary">Reopen</button></form>`;
  const primary = isRunning
    ? html`<form method="POST" action="/notebooks/${id}/steps/stop" class="nb-next__form"><button type="submit" class="btn btn--sm nb-next" title="Stop this step's run. It keeps what it found so far, and you can move on or try again." aria-label="Stop step ${String(running!.step)}">Stop</button></form>`
    : nb.experimentId ? html`<a class="btn btn--sm btn--primary" href="/experiments/${encodeURIComponent(nb.experimentId)}">Open the experiment</a>`
    : step ? html`${stepButton(nb, step, true)}${step.alt ? stepButton(nb, step.alt, false) : html``}`
    : narrowing ? narrowPanel(true)
    : decideFirst ? decidePanel(true)
    : nb.status !== 'active' ? reopen
    : html``;
  return html`
    <div class="nb-acts">
      ${primary}
      ${shareable && !isRunning ? html`<a class="btn btn--sm btn--ghost nb-print" href="/notebooks/${id}/brief.html" target="_blank" rel="noopener" title="The answer as a page to print, save as a PDF or send">Print</a>` : html``}
      <details class="nb-act nb-more" data-nb-act data-nb-act-name="more">
        <summary class="btn btn--sm btn--ghost">More</summary>
        <div class="nb-act__panel nb-more__panel">
          <div class="nb-more__acts">
            <a class="btn btn--sm btn--ghost nb-edit" href="/notebooks/${id}/edit" title="Change what it's for, its steps, checks and page (e)">Edit</a>
            ${narrowing ? html`` : nb.status === 'active' && current?.kind === 'narrow' ? narrowPanel(false) : html``}
            ${decides && !decideFirst ? decidePanel(false) : html``}
            <details class="nb-act nb-addself" data-nb-act>
              <summary class="btn btn--sm">+ Add entry</summary>
              <div class="nb-act__panel">
                <h2 class="nb-act__title">Add an entry yourself</h2>
                ${addEntryForm(nb, entries)}
              </div>
            </details>
          </div>
          ${nb.experimentId ? experimentFormats(nb) : shareable ? formatsPanel(nb, entries, leads, whatsNewToo) : html``}
        </div>
      </details>
    </div>`;
}

/**
 * What the notebook depends on from you (ADR-0077). Each missing thing with
 * why, a box to paste it into, and Go on without it. One you went on
 * without is a quiet line that says so, with a way to add it after all.
 * One you gave is a folded row with what sua read from it (the short form
 * its steps use), so you can see it and fix it; `reading` says which are
 * being read now or couldn't be. Nothing when it depends on nothing of yours.
 */
export function givenCard(nb: Pick<Notebook, 'id' | 'given' | 'archivedAt'> & { steps?: Notebook['steps']; experimentRun?: Notebook['experimentRun'] }, reading: Record<string, 'working' | 'failed'> = {}, notUsed?: GivenNotUsed, part: 'all' | 'needs' | 'fresh' = 'all'): SafeHtml {
  const given = nb.given ?? [];
  const missing = given.filter((g) => g.state === 'missing' && !g.optional);
  const wanted = given.filter((g) => g.state === 'missing' && g.optional);
  const skipped = given.filter((g) => g.state === 'skipped');
  const have = given.filter((g) => g.state === 'given');
  if (nb.archivedAt || !given.length) return html``;
  // What you added since its steps last ran: read first, then offered (nothing runs again unless you press it).
  const stale = notUsed && notUsed.given.length && !notUsed.given.some((g) => reading[g.key] === 'working') ? notUsed : undefined;
  const names = (l: readonly string[]) => (l.length === 1 ? l[0] : `${l.slice(0, -1).join(', ')} and ${l[l.length - 1]}`);
  const act = (key: string) => `/notebooks/${encodeURIComponent(nb.id)}/given/${encodeURIComponent(key)}`;
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  // Unfolded until a step has worked from it; after that it's a line to open.
  const fresh = !(nb.steps ?? []).some((s) => s.tries > 0);
  const box = (g: NotebookGiven, label: string) => html`
        <form method="POST" action="${act(g.key)}" class="nb-given__form">
          <label class="nb-given__label" for="nb-given-${g.key}">${label}</label>
          <textarea id="nb-given-${g.key}" name="text" rows="6" class="form-field nb-given__text" required minlength="20" placeholder="Paste the text here, or choose a file below."></textarea>
          ${givenFilePick(`nb-given-${g.key}`)}
          <div class="nb-given__acts"><button type="submit" class="btn btn--primary btn--sm">Use this</button></div>
        </form>`;
  const reread = (g: NotebookGiven, label: string) => html`<form method="POST" action="${act(g.key)}" class="nb-given__again"><input type="hidden" name="reread" value="1"><button type="submit" class="btn btn--sm">${label}</button></form>`;
  const cutNote = (g: NotebookGiven) => (g.cut ? html`<p class="nb-given__note">Your paste was longer than sua keeps, so its end is missing. If something below is missing, paste a shorter copy under Edit.</p>` : html``);
  const got = (g: NotebookGiven) => {
    if (reading[g.key] === 'working') return html`
      <div class="nb-given__item nb-given__item--reading" role="status"><span class="nb-given__mark">sua is reading ${g.label} into a short form.</span> Nothing searches until that's done, usually within a minute. This page updates by itself.</div>`;
    if (!g.read) return html`
      <div class="nb-given__item nb-given__item--unread">
        <p class="nb-given__say">${reading[g.key] === 'failed' ? html`<span class="nb-given__mark">sua couldn't read ${g.label} into a short form.</span>` : html`<span class="nb-given__mark">sua hasn't read ${g.label} yet.</span>`} Steps are using the first part of the text as you pasted it.</p>
        ${cutNote(g)}
        ${reread(g, reading[g.key] === 'failed' ? 'Read it again' : 'Read it')}
      </div>`;
    return html`
      <details class="nb-given__item nb-given__item--read"${fresh ? unsafeHtml(' open') : unsafeHtml('')}>
        <summary><span class="nb-given__mark">${cap(g.label)}, as sua read it:</span> ${g.read.summary || `${String(g.read.facts.length)} ${g.read.facts.length === 1 ? 'fact' : 'facts'}`}</summary>
        <p class="nb-given__note">This is what every step works from, in place of the text you pasted. Each line is taken from your paste.</p>
        ${cutNote(g)}
        <dl class="nb-given__facts">${g.read.facts.map((f) => html`<div><dt>${f.label}</dt><dd>${f.value}${f.byYou ? html` <span class="nb-given__yours">yours</span>` : html``}</dd></div>`) as unknown as SafeHtml[]}</dl>
        <div class="nb-given__acts"><a class="btn btn--sm" href="/notebooks/${encodeURIComponent(nb.id)}/edit#nbe-given-h">Fix this</a>${reread(g, 'Read it again')}</div>
      </details>`;
  };
  const staleHtml = stale ? html`
      <div class="nb-given__item nb-given__item--new" role="status">
        <p class="nb-given__say"><span class="nb-given__mark">${cap(names(stale.given.map((g) => g.label)))} ${stale.given.length === 1 ? 'was' : 'were'} added after ${names(stale.steps.map((x) => x.title))} last ran,</span> so ${stale.steps.length === 1 ? 'it doesn\'t' : 'they don\'t'} use it yet. Nothing runs again unless you say so.</p>
        <form method="POST" action="/notebooks/${encodeURIComponent(nb.id)}/given-update" class="nb-given__again"><button type="submit" class="btn btn--primary btn--sm">${givenUpdateLabel(stale.steps)}</button></form>
      </div>` : html``;
  const missingHtml = missing.map((g) => html`
      <div class="nb-given__item nb-given__item--missing">
        <p class="nb-given__say"><strong>sua needs ${g.label}.</strong> ${g.link ? html`It couldn't read <a href="${g.link}" target="_blank" rel="noopener">${hostOf(g.link)}</a>. ` : html``}${g.why ?? ''} Nothing runs until you paste it or go on without it, so nothing is guessed.</p>
        ${box(g, `Paste ${g.label}`)}
        <form method="POST" action="${act(g.key)}" class="nb-given__skip"><input type="hidden" name="skip" value="1"><button type="submit" class="btn btn--sm">Go on without it</button><span class="nb-given__hint">Results won't be matched to it, and the notebook will say so.</span></form>
      </div>`) as unknown as SafeHtml[];
  const skippedHtml = skipped.map((g) => html`
      <details class="nb-given__item nb-given__item--skipped">
        <summary><span class="nb-given__mark">Not matched to ${g.label}:</span> it wasn't given, so nothing here is based on it. <span class="nb-given__add">Add it</span></summary>
        ${box(g, `Paste ${g.label}`)}
      </details>`) as unknown as SafeHtml[];
  const wantedHtml = wanted.map((g) => html`
      <details class="nb-given__item nb-given__item--skipped">
        <summary><span class="nb-given__mark">If you have ${g.label}:</span> ${g.why ?? 'its steps work from it when it\'s here.'} Nothing waits for it. <span class="nb-given__add">Add it</span></summary>
        ${box(g, `Paste ${g.label}`)}
      </details>`) as unknown as SafeHtml[];
  if (part === 'needs') {
    // What needs you, above the title: a step waits on it, it isn't used yet, or sua is reading it (or couldn't).
    const waiting = have.filter((g) => !g.read || reading[g.key]);
    if (!stale && !missing.length && !skipped.length && !waiting.length) return html``;
    return html`<section class="nb-given" data-nb-given aria-label="What this answer needs from you">${staleHtml}${missingHtml}${skippedHtml}${waiting.map(got) as unknown as SafeHtml[]}</section>`;
  }
  if (part === 'fresh') {
    // Just read, and no step has worked from it yet: open under the header, so you can check what sua read before it's used.
    const just = have.filter((g) => g.read && fresh && !reading[g.key]);
    return just.length ? html`<section class="nb-given nb-given--fresh" data-nb-given aria-label="What sua read from what you gave">${just.map(got) as unknown as SafeHtml[]}</section>` : html``;
  }
  return html`<section class="nb-given" data-nb-given aria-label="What you gave this answer">
    ${staleHtml}
    ${missingHtml}
    ${skippedHtml}
    ${wantedHtml}
    ${have.map(got) as unknown as SafeHtml[]}
    ${givenAdd(nb, 'nb-given-new')}
  </section>`;
}

/**
 * The header's add row, after its steps: Add the meeting (a meeting's
 * notebook), what you gave that a step has already worked from (one folded
 * line, "You gave: …"), what it could use if you have it, and Add a file or
 * paste. One opens at a time (`data-nb-act`). What needs you is above the
 * title instead (givenCard 'needs'); a just-read one is under the header
 * (givenCard 'fresh').
 */
export function givenAdds(nb: Notebook, reading: Record<string, 'working' | 'failed'> = {}): SafeHtml {
  const given = nb.archivedAt ? [] : nb.given ?? [];
  const fresh = !(nb.steps ?? []).some((x) => x.tries > 0);
  const used = given.filter((g) => g.state === 'given' && g.read && !fresh && !reading[g.key]);
  const wanted = given.filter((g) => g.state === 'missing' && g.optional);
  const add = givenAdd(nb, 'nb-given-new', undefined, true);
  const meeting = meetingLine(nb);
  if (!used.length && !wanted.length && !String(add).trim() && !String(meeting).trim()) return html``;
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  const act = (key: string) => `/notebooks/${encodeURIComponent(nb.id)}/given/${encodeURIComponent(key)}`;
  const facts = (g: NotebookGiven) => html`
          <div class="nb-hero__addpart">
            <p class="nb-given__note"><span class="nb-given__mark">${cap(g.label)}, as sua read it:</span> ${g.read!.summary}</p>
            <dl class="nb-given__facts">${g.read!.facts.map((f) => html`<div><dt>${f.label}</dt><dd>${f.value}${f.byYou ? html` <span class="nb-given__yours">yours</span>` : html``}</dd></div>`) as unknown as SafeHtml[]}</dl>
            <div class="nb-given__acts"><a class="btn btn--sm" href="/notebooks/${encodeURIComponent(nb.id)}/edit#nbe-given-h">Fix this</a><form method="POST" action="${act(g.key)}" class="nb-given__again"><input type="hidden" name="reread" value="1"><button type="submit" class="btn btn--sm">Read it again</button></form></div>
          </div>`;
  const gave = used.length
    ? html`<details class="nb-hero__add" data-nb-act data-nb-act-name="gave"><summary>${used.length === 1 ? `You gave: ${used[0].label}` : `You gave ${String(used.length)} things`}</summary><div class="nb-hero__addpanel">${used.map(facts) as unknown as SafeHtml[]}</div></details>`
    : html``;
  return html`<div class="nb-hero__adds" role="group" aria-label="Add to this answer">
    ${meeting}
    ${gave}
    ${wanted.map((g) => html`<details class="nb-hero__add" data-nb-act data-nb-act-name="want-${g.key}"><summary>If you have ${g.label}</summary>
      <div class="nb-hero__addpanel"><p class="nb-given__note">${g.why ?? 'Its steps work from it when it\'s here.'} Nothing waits for it.</p>
        <form method="POST" action="${act(g.key)}" class="nb-given__form">
          <label class="nb-given__label" for="nb-want-${g.key}">Paste ${g.label}</label>
          <textarea id="nb-want-${g.key}" name="text" rows="6" class="form-field nb-given__text" required minlength="20" placeholder="Paste the text here, or choose a file below."></textarea>
          ${givenFilePick(`nb-want-${g.key}`)}
          <div class="nb-given__acts"><button type="submit" class="btn btn--primary btn--sm">Use this</button></div>
        </form></div></details>`) as unknown as SafeHtml[]}
    ${add}
  </div>`;
}

/** What you added that its steps haven't worked from, and the steps that would. */
export interface GivenNotUsed { given: ReadonlyArray<Pick<NotebookGiven, 'key' | 'label'>>; steps: ReadonlyArray<{ kind: string; title: string }> }

/** The button that runs those steps again. */
export function givenUpdateLabel(steps: ReadonlyArray<{ kind: string }>): string {
  const profile = steps.some((s) => s.kind === 'profile');
  const write = steps.some((s) => s.kind === 'write');
  if (profile && write) return 'Update the profile and brief with this';
  if (profile) return 'Update the profile with this';
  if (steps.length === 1 && write) return 'Write it again with this';
  return 'Run its steps again with this';
}

/**
 * Add something of yours to a notebook, asked for or not: say what it is,
 * then paste it or choose a file. A folded row until opened. `id` keeps its
 * fields apart when the page has two; `to` is where its form returns.
 * Nothing for an archived notebook or an experiment's copy.
 */
export function givenAdd(nb: Pick<Notebook, 'id'> & { archivedAt?: string; experimentRun?: Notebook['experimentRun'] }, id: string, to?: 'edit', inline = false): SafeHtml {
  if (nb.archivedAt || nb.experimentRun) return html``;
  // In the header's add row: a link-like line whose form opens under the row.
  if (inline) return html`
      <details class="nb-hero__add" data-nb-given-add data-nb-act data-nb-act-name="add-file">
        <summary title="A profile saved as a PDF, a résumé, your notes: its steps work from it.">＋ Add a file or paste</summary>
        <div class="nb-hero__addpanel">${givenAddForm(nb, id, to)}</div>
      </details>`;
  return html`
      <details class="nb-given__item nb-given__item--add" data-nb-given-add>
        <summary><span class="nb-given__mark">Add a file or paste</span> <span class="nb-given__hint">A profile saved as a PDF, a résumé, your notes: its steps work from it.</span></summary>
        ${givenAddForm(nb, id, to)}
      </details>`;
}

/** The form that adds a file or paste (givenAdd's, in either place). */
function givenAddForm(nb: Pick<Notebook, 'id'>, id: string, to?: 'edit'): SafeHtml {
  return html`
        <form method="POST" action="/notebooks/${encodeURIComponent(nb.id)}/given" class="nb-given__form">
          ${to ? html`<input type="hidden" name="to" value="${to}">` : html``}
          <label class="nb-given__label" for="${id}-label">What is it?</label>
          <input id="${id}-label" name="label" type="text" class="form-field__input nb-given__name" required maxlength="80" autocomplete="off" list="${id}-kinds" placeholder="Their LinkedIn profile">
          <datalist id="${id}-kinds"><option value="Their LinkedIn profile"></option><option value="My résumé"></option><option value="The job description"></option><option value="My notes"></option></datalist>
          <label class="nb-given__label" for="${id}-text">Its text</label>
          <textarea id="${id}-text" name="text" rows="6" class="form-field nb-given__text" required minlength="20" placeholder="Paste the text here, or choose a file below."></textarea>
          ${givenFilePick(`${id}-text`, `${id}-label`)}
          <div class="nb-given__acts"><button type="submit" class="btn btn--sm">Add it</button><span class="nb-given__hint">sua reads it into a short form you can check. The file itself isn't kept.</span></div>
        </form>`;
}

/** Edit's rail: what you gave the notebook (see, replace or remove each; fix what sua read from it), and what it's still waiting on. */
export function givenRail(nb: Pick<Notebook, 'id' | 'given'> & { archivedAt?: string; experimentRun?: Notebook['experimentRun'] }): SafeHtml {
  const given = nb.given ?? [];
  if (!given.length && (nb.archivedAt || nb.experimentRun)) return html``;
  const act = (key: string) => `/notebooks/${encodeURIComponent(nb.id)}/given/${encodeURIComponent(key)}`;
  const words = (g: NotebookGiven) => (g.state === 'given'
    ? (g.read ? `read into ${String(g.read.facts.length)} ${g.read.facts.length === 1 ? 'fact' : 'facts'}, given to every step` : `${String((g.text ?? '').length.toLocaleString('en-US'))} characters, given to every step as pasted`)
    : g.state === 'skipped' ? 'not given: you went on without it' : g.optional ? 'not added: nothing waits for it' : 'waiting on you');
  return html`<section class="nbe-card nbe-given" aria-labelledby="nbe-given-h">
          <h2 class="nbe-card__h" id="nbe-given-h">What you gave it</h2>
          ${given.map((g) => html`
          <details class="nbe-given__item"${g.read ? unsafeHtml(' open') : unsafeHtml('')}>
            <summary><span class="nbe-given__label">${g.label}</span><span class="nbe-given__state">${words(g)}</span></summary>
            ${g.read ? html`<form method="POST" action="${act(g.key)}" class="nbe-given__form">
              <label class="nbe-given__sub" for="nbe-given-facts-${g.key}">What sua read from it</label>
              <textarea id="nbe-given-facts-${g.key}" name="facts" rows="${String(Math.min(16, Math.max(6, g.read.facts.length + 1)))}" class="form-field" placeholder="Label: value">${g.read.facts.map((f) => `${f.label}: ${f.value}`).join('\n')}</textarea>
              <span class="nbe-given__state">One per line, as Label: value. Change, add or delete lines; the ones you change are marked as yours.</span>
              <button type="submit" class="btn btn--sm">Save</button>
            </form>` : html``}
            <form method="POST" action="${act(g.key)}" class="nbe-given__form">
              <label class="${g.read ? 'nbe-given__sub' : 'sr-only'}" for="nbe-given-${g.key}">${g.read ? 'The text you pasted' : g.label}</label>
              <textarea id="nbe-given-${g.key}" name="text" rows="6" class="form-field" required minlength="20" placeholder="Paste the text here.">${g.text ?? ''}</textarea>
              ${givenFilePick(`nbe-given-${g.key}`)}
              <button type="submit" class="btn btn--sm">${g.state === 'given' ? 'Replace' : 'Use this'}</button>
            </form>
            <form method="POST" action="${act(g.key)}"><input type="hidden" name="remove" value="1"><button type="submit" class="btn btn--sm btn--ghost">Remove</button></form>
          </details>`) as unknown as SafeHtml[]}
          ${!given.length ? html`<p class="nbe-given__state">Nothing yet. Add a profile, a résumé or your notes, and its steps work from it.</p>` : html``}
          ${givenAdd(nb, 'nbe-given-new', 'edit')}
        </section>`;
}

/**
 * Where each entry came from, for a printed or saved copy of the page: on
 * the page a finding links to its own page in the dashboard, which a PDF's
 * reader can't open, so printing swaps those links for the source's
 * (NOTEBOOK_PAGE_JS). Only web addresses; an entry with none has no link in
 * the printed copy.
 */
export function printLinks(nb: Pick<Notebook, 'fields'>, entries: readonly NotebookEntry[]): SafeHtml {
  const web = (u: unknown) => (typeof u === 'string' && /^https?:\/\/\S+$/i.test(u.trim()) ? u.trim() : undefined);
  const map: Record<string, string> = {};
  for (const e of entries) {
    const u = (e.kind === 'option' ? optionLink(nb.fields, e.data) : undefined) ?? web(e.fingerprint);
    if (u) map[e.id] = u;
  }
  // "<" escaped so a link can never close the script element.
  return html`<script type="application/json" data-nb-print-links>${unsafeHtml(JSON.stringify(map).replace(/</g, '\\u003c'))}</script>`;
}

const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'the link'; } };

export function renderNotebookPage(args: { followUps?: readonly FollowUp[]; nb: Notebook; unfiled?: UnfiledRunView[]; cover?: { src: string; kind: string; shape?: string }; entries: NotebookEntry[]; compiled: CompiledSurface; history?: NotebookViewHistory; settingUp?: boolean; stages: PipelineStage[]; running?: { step: number; of: number }; busy?: string[]; lastWord?: { text: string; at: number }; stepsKey?: string; live?: NotebookLive; liveKey?: string; madeBy?: NotebookMadeBy; whatsNew?: WhatsNew; reading?: Record<string, 'working' | 'failed'>; givenNotUsed?: GivenNotUsed; pictures?: readonly string[]; flash?: { kind: 'error' | 'info' | 'ok'; message: string } }): string {
  return render(layout({ title: args.nb.title, activeNav: 'notebooks', flash: args.flash, wide: true }, html`
    <p class="nb-crumbs"><a href="/">Home</a> › <a href="/notebooks">Answers</a></p>
    ${args.nb.archivedAt ? html`<div class="nb-archived" role="status">Archived ${formatAge(args.nb.archivedAt)}: hidden from your answers, Home and Today, and its schedule is off.
      <form method="POST" action="/notebooks/${encodeURIComponent(args.nb.id)}/archive"><input type="hidden" name="archived" value="0"><button type="submit" class="btn btn--sm">Restore</button></form></div>` : html``}
    ${givenCard(args.nb, args.reading, args.givenNotUsed, 'needs')}
    ${hero(args.nb, args.stages, args.running, args.nb.fields.length > 0 && args.entries.some((e) => e.kind === 'option'), args.cover, decisionLeads(args.nb, args.entries, Infinity, args.history), args.entries, args.busy ?? [], args.live, notebookHeaderView(args.nb, args.entries, args.history as NotebookWidgetHistory | undefined), args.madeBy, args.whatsNew, args.reading)}
    ${givenCard(args.nb, args.reading, args.givenNotUsed, 'fresh')}
    
    ${printLinks(args.nb, args.entries)}
    <div class="nb-body">
      <div class="nb-body__main" data-nb-main="${args.nb.id}" data-nb-count="${String(args.entries.length)}" data-nb-changed="${args.nb.updatedAt}${args.settingUp ? "+setup" : ""}" data-nb-steps="${args.stepsKey ?? ''}" data-nb-live="${args.liveKey ?? ''}" data-nb-running="${args.running || args.busy?.length ? '1' : ''}" data-page-thread="${args.nb.conversationId ?? ''}">${surfaceColumn(args.nb, args.compiled, args.entries, args.history, args.settingUp, !!args.running, args.pictures ?? [])}</div>
      <aside class="nb-body__side">${sideForms(args.nb, args.entries, args.lastWord, args.unfiled, args.live?.talk, args.followUps ?? [])}</aside>
    </div>
  `));
}

/** The notebook's sections alone (GET /notebooks/:id/main), for live updates. */
export function renderNotebookMain(nb: Notebook, compiled: CompiledSurface, entries: NotebookEntry[], history?: NotebookViewHistory, settingUp = false, running = false, pictures: readonly string[] = []): string {
  return render(surfaceColumn(nb, compiled, entries, history, settingUp, running, pictures));
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

export interface NotebookListQuery { q: string; status: 'active' | 'decided' | 'stopped' | 'all' | 'starred' | 'archived'; sort: 'updated' | 'created' | 'title'; page: number; pages: number; total: number; perPage: number; /** The tag the list is filtered by. */ tag?: string }

/** Tags listed before "More tags". */
const TAGS_SHOWN = 12;
/** Tags on a card, at most. */
const CARD_TAGS = 3;

/** Ways to start, as you'd say them on New notebook (each opens it with the words filled in). */
const STARTS = [
  { title: 'Choose between options', text: 'A quiet 2-bed rental in Fremont under $2,600, decide by next month', get: 'A shortlist, each option checked against what you need.' },
  { title: 'Answer a question', text: 'Which project-management tools suit a 10-person agency, and what do they cost?', get: 'A written answer, with where each part came from.' },
  { title: 'Prepare for a meeting', text: "Prepare for my meeting with a logistics startup's head of sales", get: 'A brief on who they are, with talking points.' },
] as const;

/** The Notebooks page before you have any (or with none on this tab): what a notebook is, and ways to start one. */
function renderNotebooksEmpty(templates: ReadonlyArray<{ id: string; name: string }>, none?: { title: string; where: SafeHtml }): SafeHtml {
  return html`<section class="nbl-empty" aria-labelledby="nbl-empty-h">
    <h2 class="nbl-empty__h" id="nbl-empty-h">${none?.title ?? 'No notebooks yet'}</h2>
    ${none ? html`<p class="nbl-empty__where">${none.where}</p>` : html``}
    <p class="nbl-empty__lede">Say what you're after and sua finds options, checks each one against what you need, and keeps what you decide. Start from one of these, or describe your own.</p>
    <ul class="nbl-empty__starts">
      ${STARTS.map((s) => html`<li><a class="nbl-empty__start" href="/notebooks/new?text=${encodeURIComponent(s.text)}">
        <span class="nbl-empty__title">${s.title}</span>
        <span class="nbl-empty__text">“${s.text}”</span>
        <span class="nbl-empty__get">${s.get}</span>
      </a></li>`) as unknown as SafeHtml[]}
    </ul>
    ${templates.length ? html`<p class="nbl-empty__tpl">Or start from one of your templates: ${templates.map((t, i) => html`${i ? ', ' : ''}<a href="/notebooks/new#nbd-tpl-h">${t.name}</a>`) as unknown as SafeHtml[]}</p>` : html``}
    <a class="btn btn--primary nbl-empty__go" href="/notebooks/new">Describe your own →</a>
  </section>`;
}

export function renderNotebooksList(args: {
  notebooks: NotebookCard[];
  openNew?: boolean;
  flash?: { kind: 'error' | 'info' | 'ok'; message: string };
  query?: NotebookListQuery;
  counts?: { active: number; decided: number; stopped: number; all: number; starred?: number; archived?: number };
  /** New notebooks you began drafting but haven't started. */
  drafts?: ReadonlyArray<{ id: string } & DraftState>;
  /** Your templates, offered when you have no notebooks yet. */
  templates?: ReadonlyArray<{ id: string; name: string }>;
  /** The tags on this tab's notebooks, most used first, each with how many have it. */
  tags?: ReadonlyArray<{ tag: string; count: number }>;
  /** A search or tag that found nothing on this tab: the tabs where it does match. */
  elsewhere?: ReadonlyArray<{ status: 'all' | 'archived'; count: number }>;
}): string {
  const q: NotebookListQuery = args.query ?? { q: '', status: 'all', sort: 'updated', page: 1, pages: 1, total: args.notebooks.length, perPage: args.notebooks.length || 12 };
  const counts = { archived: 0, starred: 0, ...(args.counts ?? { active: 0, decided: 0, stopped: 0, all: args.notebooks.length }) };
  const href = (over: Partial<Pick<NotebookListQuery, 'q' | 'status' | 'sort' | 'page' | 'tag'>>) => {
    const p = new URLSearchParams();
    const v = { q: q.q, status: q.status, sort: q.sort, page: 1, tag: q.tag, ...over };
    if (v.q) p.set('q', v.q);
    if (v.tag) p.set('tag', v.tag);
    if (v.status !== 'active') p.set('status', v.status);
    if (v.sort !== 'updated') p.set('sort', v.sort);
    if (v.page > 1) p.set('page', String(v.page));
    const s = p.toString();
    return `/notebooks${s ? `?${s}` : ''}`;
  };
  const tab = (status: NotebookListQuery['status'], label: string) => html`<a class="nb-tabs__tab${q.status === status ? ' is-on' : ''}" href="${href({ status })}"${q.status === status ? unsafeHtml(' aria-current="page"') : unsafeHtml('')}>${label} <span class="nb-tabs__n">${String(counts[status])}</span></a>`;
  const first = q.total ? (q.page - 1) * q.perPage + 1 : 0;
  const last = Math.min(q.total, q.page * q.perPage);
  // Nothing on this tab: a search says so; otherwise where yours are (e.g. all archived), and ways to start one.
  const label = { active: 'Active', decided: 'Decided', stopped: 'Stopped', all: 'All', starred: 'Starred', archived: 'Archived' } as const;
  const elsewhere = (['active', 'decided', 'stopped', 'starred', 'archived'] as const).filter((st) => st !== q.status && counts[st] > 0);
  // A tag in the row: a link that filters by it (the one in use clears the filter).
  const tagLink = (t: { tag: string; count: number }) => t.tag === q.tag
    ? html`<a class="nbl-tag is-on" href="${href({ tag: undefined })}" aria-current="true" title="Show all tags">${t.tag} <span class="nbl-tag__n">${String(t.count)}</span><span class="sr-only"> (showing; clear)</span></a>`
    : html`<a class="nbl-tag" href="${href({ tag: t.tag })}">${t.tag} <span class="nbl-tag__n">${String(t.count)}</span></a>`;
  const allTags = args.tags ?? [];
  // The one in use is always among the first, never folded away.
  const tagsFirst = [...allTags.filter((t) => t.tag === q.tag), ...allTags.filter((t) => t.tag !== q.tag)].slice(0, TAGS_SHOWN);
  const tagsMore = allTags.filter((t) => !tagsFirst.includes(t));
  const tagRow = allTags.length ? html`
      <nav class="nbl-tags" aria-label="Notebooks by tag">
        <span class="nbl-tags__label">Tags</span>
        ${tagsFirst.map(tagLink) as unknown as SafeHtml[]}
        ${tagsMore.length ? html`<details class="nbl-tags__more"><summary>${String(tagsMore.length)} more</summary><span class="nbl-tags__rest">${tagsMore.map(tagLink) as unknown as SafeHtml[]}</span></details>` : html``}
      </nav>` : html``;
  const empty = q.q || q.tag
    ? html`<p class="nb-list__empty">No ${q.status === 'all' ? '' : `${q.status} `}notebooks ${q.tag ? html`tagged “${q.tag}”` : html``}${q.q && q.tag ? ' and ' : ''}${q.q ? html`matching “${q.q}”` : html``}. ${(args.elsewhere ?? []).map((e) => html`<a href="${href({ status: e.status })}">${String(e.count)} under ${e.status === 'all' ? 'All' : 'Archived'}</a>. `) as unknown as SafeHtml[]}<a href="${href({ q: '', tag: undefined })}">Clear the ${q.q && q.tag ? 'search and tag' : q.tag ? 'tag' : 'search'}</a></p>`
    : renderNotebooksEmpty(args.templates ?? [], {
      title: q.status === 'all' ? 'No answers in use' : `No ${q.status} answers`,
      where: html`Yours are under ${elsewhere.map((st, i) => html`${i ? (i === elsewhere.length - 1 ? ' and ' : ', ') : ''}<a href="${href({ status: st })}">${label[st]} (${String(counts[st])})</a>`) as unknown as SafeHtml[]}.`,
    });
  return render(layout({ title: 'Answers', activeNav: 'notebooks', flash: args.flash, wide: true }, html`
    ${pageHeader({
      crumbs: [{ label: 'Home', href: '/' }, { label: 'Answers' }],
      title: 'Answers',
      description: 'What you asked sua to find out: each answer with its sources, how far it got, and what you decided.',
      cta: html`<a class="btn btn--primary btn--sm nbl-new__btn" href="/notebooks/new">+ Ask a question</a>`,
    })}
    ${renderDraftsStrip(args.drafts ?? [], 'list')}
    ${counts.all || counts.archived ? html`
      <form method="GET" action="/notebooks" class="nbl-tools" role="search">
        <nav class="nb-tabs" aria-label="Answers by status">${tab('active', 'Active')}${tab('decided', 'Decided')}${tab('stopped', 'Stopped')}${tab('all', 'All')}${counts.starred || q.status === 'starred' ? tab('starred', '★ Starred') : html``}${counts.archived ? tab('archived', 'Archived') : html``}</nav>
        ${q.status !== 'active' ? html`<input type="hidden" name="status" value="${q.status}">` : html``}
        ${q.tag ? html`<input type="hidden" name="tag" value="${q.tag}">` : html``}
        <label class="nbl-tools__search"><span class="sr-only">Search answers</span>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg>
          <input type="search" name="q" value="${q.q}" placeholder="Search answers" autocomplete="off"></label>
        <label class="nbl-tools__sort"><span class="sr-only">Sort</span>
          <select name="sort" data-autosubmit>
            <option value="updated"${q.sort === 'updated' ? unsafeHtml(' selected') : unsafeHtml('')}>Recently updated</option>
            <option value="created"${q.sort === 'created' ? unsafeHtml(' selected') : unsafeHtml('')}>Newest</option>
            <option value="title"${q.sort === 'title' ? unsafeHtml(' selected') : unsafeHtml('')}>A–Z</option>
          </select>
        </label>
        <noscript><button type="submit" class="btn btn--sm">Apply</button></noscript>
      </form>${tagRow}` : html``}
    <div class="nbl-grid">
      ${args.notebooks.map((c) => {
        const { nb } = c;
        const facts = countParts(c);
        const photo = c.cover && c.coverKind !== 'illustration' && c.coverKind !== 'logo' ? c.cover : undefined;
        const met = c.checks?.filter((x) => x.met).length ?? 0;
        // The tag filtered by first, so the card shows why it's here.
        const tags = notebookTags(nb);
        const cardTags = [...tags.filter((t) => t === q.tag), ...tags.filter((t) => t !== q.tag)].slice(0, CARD_TAGS);
        return html`
          <div class="nbl-cardwrap">
          ${starButton(nb, 'nbl-card__star', href({ page: q.page }))}
          <a class="nbl-card nbl-card--${nb.status}${nb.starredAt ? ' is-starred' : ''}" href="/notebooks/${encodeURIComponent(nb.id)}">
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
              ${cardTags.length ? html`<span class="nbl-card__tags"><span class="sr-only">Tags: </span>${cardTags.map((t) => html`<span class="nbl-card__tag">${t}</span>`) as unknown as SafeHtml[]}${tags.length > cardTags.length ? html`<span class="nbl-card__tagmore" title="${tags.slice(cardTags.length).join(', ')}">+${String(tags.length - cardTags.length)}</span>` : html``}</span>` : html``}
              <span class="nbl-card__meta">${c.checks?.length ? html`<span class="nbl-card__met" title="${`Done when: ${c.checks.map((x) => `${x.met ? '✓' : '○'} ${x.text}`).join('; ')}`}"><span class="nbl-card__dots" aria-hidden="true">${c.checks.map((x) => html`<i class="${x.met ? 'is-met' : ''}"></i>`) as unknown as SafeHtml[]}</span>${String(met)} of ${String(c.checks.length)} met</span>` : html``}<span>updated ${formatAge(nb.updatedAt)}</span></span>
            </span>
          </a>
          </div>`;
      }) as unknown as SafeHtml[]}
    </div>
    ${counts.all || counts.archived ? (args.notebooks.length === 0 ? empty : html``) : renderNotebooksEmpty(args.templates ?? [])}
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
  return unsafeHtml(`<svg class="nbl-card__art" viewBox="0 0 320 160" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${kind === 'notebook' ? 'Answer' : kind}">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${String(hue)} 55% 46%)"/><stop offset="1" stop-color="hsl(${String((hue + 40) % 360)} 60% 32%)"/></linearGradient></defs>
    <rect width="320" height="160" fill="url(#${id})"/>
    <circle cx="270" cy="20" r="70" fill="#fff" fill-opacity="0.08"/><circle cx="300" cy="140" r="46" fill="#fff" fill-opacity="0.06"/>
    <path d="M0 120 C 60 96, 120 140, 190 112 S 290 86, 320 104" fill="none" stroke="#fff" stroke-opacity="0.18" stroke-width="2"/>
    ${bars}
    <g transform="translate(218 38) scale(1.25)" fill="none" stroke="#fff" stroke-opacity="0.92" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${KIND_ICON[kind]}</g>
  </svg>`);
}

/**
 * The notebook's drawing for its TL;DR picture: the same colour, waves and
 * icon as its card's cover (coverArt), set for a frame of any shape. The icon
 * sits in the middle, so a tall frame (a spotlight's side) or a wide one (a
 * cover's band) crops only the edges; the stage bars are left out (at that
 * size they read as a chart). A data: address of SVG text: no script,
 * nothing loaded from elsewhere, so it travels in a PNG or a saved file.
 */
export function drawnCoverSrc(nb: Pick<Notebook, 'id' | 'title' | 'statement' | 'stages'>): string {
  let h = 0;
  for (const ch of nb.id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  const hue = (h + 170) % 360;
  const kind = notebookKind(nb);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${kind === 'notebook' ? 'Answer' : kind}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${String(hue)} 55% 46%)"/><stop offset="1" stop-color="hsl(${String((hue + 40) % 360)} 60% 32%)"/></linearGradient></defs>
<rect width="600" height="600" fill="url(#g)"/>
<circle cx="480" cy="110" r="190" fill="#fff" fill-opacity="0.08"/><circle cx="110" cy="520" r="150" fill="#fff" fill-opacity="0.06"/>
<path d="M0 420 C 120 370, 220 470, 330 410 S 520 340, 600 380" fill="none" stroke="#fff" stroke-opacity="0.18" stroke-width="4"/>
<path d="M0 470 C 140 430, 240 510, 360 460 S 540 400, 600 430" fill="none" stroke="#fff" stroke-opacity="0.1" stroke-width="3"/>
<g transform="translate(220 210) scale(2.5)" fill="none" stroke="#fff" stroke-opacity="0.92" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${KIND_ICON[kind]}</g>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg.replace(/\s+/g, ' ')).toString('base64')}`;
}

/** The notebooks control in Home's header: a button to the list with a joined "+" for a new one, sized like the controls beside it. */
export function renderHomeNotebooksButtons(active: number, total: number): SafeHtml {
  return html`<span class="home-nbgroup" title="Answers: what you asked sua to find out"><a class="btn btn--sm" href="/notebooks">${NOTEBOOK_ICON}${total === 0 ? 'Answers' : `${String(active)} answer${active === 1 ? '' : 's'}`}</a><a class="btn btn--sm home-nbgroup__new" href="/notebooks/new" aria-label="Ask a question" title="Ask a question">+</a></span>`;
}

/** "today 7:00 am", "tomorrow 7:00 am", "Thu 7:00 am". */
function formatWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(now)) / 86_400_000);
  return diff === 0 ? `today ${time}` : diff === 1 ? `tomorrow ${time}` : `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${time}`;
}
