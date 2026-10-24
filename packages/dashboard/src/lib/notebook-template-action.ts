/**
 * sua's "Save the template" card (`notebook-template`), from the notebook's
 * conversation on its Save as a template page: the notebook's setup made to
 * fit any time it's used (what changes each time as `{subject}`, limits that
 * only fit this time dropped), saved under a name. The card shows the
 * template's words; saving the same name again replaces it.
 */
import {
  templateSubjectGuess, templateWithEdits,
  type InboxActionMeta, type InboxActionStatus, type Notebook, type NotebookTemplate, type NotebookTemplateEdits, type NotebookTemplateSetup,
} from '@some-useful-agents/core';
import { notebooksOf } from './notebook-chat.js';
import { templateNameFrom } from '../views/notebook-template.js';
import type { getContext } from '../context.js';

type Ctx = ReturnType<typeof getContext>;

/** The template saved from this notebook, if any (the most recently changed). */
export function templateOfNotebook(ctx: Ctx, nb: Notebook): NotebookTemplate | undefined {
  return notebooksOf(ctx).listTemplates(200, { archived: 'include' })
    .filter((t) => t.fromNotebook === nb.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

/** What the page previews before anything is saved: sua's first guess at what changes each time. */
export function draftTemplate(nb: Notebook): { name: string; setup: NotebookTemplateSetup } {
  const example = templateSubjectGuess(nb);
  return {
    name: templateNameFrom(nb.title, example),
    setup: templateWithEdits(nb, example ? { subject: { label: 'Who or what it’s about', example } } : {}),
  };
}

const list = (raw: string | undefined): string[] | undefined => {
  if (raw === undefined) return undefined;
  try {
    const v = JSON.parse(raw) as unknown;
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  } catch { /* one per line */ }
  return raw.split('\n').map((x) => x.trim()).filter(Boolean);
};
const map = (raw: string | undefined): Record<string, string> | undefined => {
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => typeof x === 'string')) as Record<string, string>;
  } catch { /* not a map */ }
  return undefined;
};

/** The card's inputs as the edits saveTemplate takes. */
export function templateEditsFromInputs(inputs: Readonly<Record<string, string>>): NotebookTemplateEdits {
  const label = (inputs.SUBJECT_LABEL ?? '').trim();
  const example = (inputs.SUBJECT_EXAMPLE ?? '').trim();
  const params = list(inputs.PARAMS);
  const criteria = list(inputs.CRITERIA);
  const checks = list(inputs.CHECKS);
  const stepTitles = map(inputs.STEP_TITLES);
  const fieldLabels = map(inputs.FIELD_LABELS);
  return {
    ...(inputs.STATEMENT !== undefined ? { statement: inputs.STATEMENT } : {}),
    ...(params ? { params } : {}), ...(criteria ? { criteria } : {}), ...(checks ? { checks } : {}),
    ...(stepTitles ? { stepTitles } : {}), ...(fieldLabels ? { fieldLabels } : {}),
    ...(label && example ? { subject: { label, example } } : {}),
  };
}

/** The card's preview: the template's words as they'll be saved. */
export function previewNotebookTemplate(ctx: Ctx, action: InboxActionMeta): InboxActionMeta {
  const nb = notebooksOf(ctx).get(action.inputs.NOTEBOOK ?? '');
  if (!nb) return action;
  const setup = templateWithEdits(nb, templateEditsFromInputs(action.inputs));
  const was = templateOfNotebook(ctx, nb);
  const joined = (xs: readonly string[]) => xs.join('; ') || '(none)';
  const row = (what: string, after: string, before?: string) => ({ what, before: before !== undefined && before !== after ? before : '—', after });
  return {
    ...action,
    inputs: { ...action.inputs, NOTEBOOK_TITLE: nb.title },
    surfaceChanges: [
      row('name', (action.inputs.NAME ?? '').trim() || nb.title, was?.name),
      ...(setup.subject ? [row('asks each time', `${setup.subject.label} (this time: ${setup.subject.example})`, was?.setup.subject ? `${was.setup.subject.label} (this time: ${was.setup.subject.example})` : undefined)] : []),
      row("what it's for", setup.statement || '(none)', was?.setup.statement),
      row('limits', joined(setup.params), was ? joined(was.setup.params) : undefined),
      row('done when', joined(setup.criteria), was ? joined(was.setup.criteria) : undefined),
      ...(setup.checks.length ? [row('checks', joined(setup.checks), was ? joined(was.setup.checks) : undefined)] : []),
      ...(setup.steps.length ? [row('steps', setup.steps.map((s, i) => `${String(i + 1)}. ${s.title}`).join('; '), was ? was.setup.steps.map((s, i) => `${String(i + 1)}. ${s.title}`).join('; ') : undefined)] : []),
      ...(setup.fields.length ? [row('facts each notes', setup.fields.map((f) => f.label).join(', '), was ? was.setup.fields.map((f) => f.label).join(', ') : undefined)] : []),
    ],
  };
}

export function executeNotebookTemplate(ctx: Ctx, meta: InboxActionMeta): { status: InboxActionStatus; summary?: string; refusalReason?: string } {
  const nb = notebooksOf(ctx).get(meta.inputs.NOTEBOOK ?? '');
  if (!nb) return { status: 'failed', refusalReason: 'That notebook is gone.' };
  try {
    const t = notebooksOf(ctx).saveTemplate((meta.inputs.NAME ?? '').trim() || nb.title, nb.id, undefined, templateEditsFromInputs(meta.inputs));
    return { status: 'completed', summary: `Saved the template **${t.name}** (${t.description}). See it on [its page](/notebooks/${encodeURIComponent(nb.id)}/template); start a notebook from it on [New notebook](/notebooks/new).` };
  } catch (err) {
    return { status: 'failed', refusalReason: err instanceof Error ? err.message : String(err) };
  }
}
