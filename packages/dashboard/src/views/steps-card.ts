/**
 * The compact steps card (the answer prototype's "steps" list): each of an
 * answer's steps as one row, a mark for where it stands (✓ done, a spinner
 * running, ! stopped short, ● yours and waiting, ○ to do), its title and its
 * own note ("5 of 5 found"). Real steps and their own notes only: nothing
 * is shown that the step didn't record.
 */
import { html, type SafeHtml } from './html.js';
import type { Notebook, NotebookStep } from '@some-useful-agents/core';

const yours = (s: Pick<NotebookStep, 'kind'>) => s.kind === 'decide' || s.kind === 'narrow';

export function stepsCard(nb: Pick<Notebook, 'steps'>, opts: { label?: string } = {}): SafeHtml {
  const steps = nb.steps ?? [];
  if (!steps.length) return html``;
  // Yours is "waiting" once every step of sua's before it is done.
  const waitingAt = steps.findIndex((s) => s.status !== 'done' && s.status !== 'met');
  const rows = steps.map((s, i) => {
    const state = s.status === 'running' ? 'running'
      : s.status === 'done' || s.status === 'met' ? 'done'
      : s.status === 'stuck' ? 'stuck'
      : yours(s) && i === waitingAt ? 'yours'
      : 'todo';
    const mark = state === 'running' ? html`<span class="working__spin" aria-hidden="true"></span>`
      : html`<span class="steps-card__mark" aria-hidden="true">${state === 'done' ? '✓' : state === 'stuck' ? '!' : state === 'yours' ? '●' : '○'}</span>`;
    const note = state === 'yours' ? 'yours' : s.note ?? '';
    const said = { done: 'done', running: 'running', stuck: 'stopped short', yours: 'waiting for you', todo: 'to do' }[state];
    return html`<li class="steps-card__row steps-card__row--${state}">${mark}<span class="steps-card__title">${s.title}<span class="sr-only"> (${said})</span></span><span class="steps-card__note">${note}</span></li>`;
  });
  return html`<div class="steps-card">${opts.label ? html`<span class="steps-card__label">${opts.label}</span>` : html``}<ol class="steps-card__list">${rows as unknown as SafeHtml[]}</ol></div>`;
}
