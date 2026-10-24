/**
 * sua's "Change the page" card (`notebook-layout`) from a notebook's
 * conversation: draw the notebook's page as a new A2UI layout (COMPONENTS),
 * switch it to a preset (PRESET), or undo the last change (UNDO "1"). The card
 * previews what it adds, removes and changes; applying it refuses when the
 * page changed since it was proposed.
 */
import {
  checkNotebookLayout, describeLayoutChange, layoutPreset, notebookLayoutOf,
  type InboxActionMeta, type InboxActionStatus, type Notebook, type NotebookLayout,
} from '@some-useful-agents/core';
import { notebooksOf } from './notebook-chat.js';
import type { getContext } from '../context.js';

type Ctx = ReturnType<typeof getContext>;

/** The page a card's inputs ask for, against the notebook as it is now. */
export function layoutFromInputs(nb: Notebook, inputs: Readonly<Record<string, string>>): { layout?: NotebookLayout; undo?: true } | { error: string } {
  if (inputs.UNDO === '1') return { undo: true };
  const preset = (inputs.PRESET ?? '').trim();
  if (preset && !inputs.COMPONENTS) {
    const p = layoutPreset(preset);
    return p ? { layout: p.layout } : { error: `There's no "${preset}" layout.` };
  }
  let raw: unknown;
  try { raw = JSON.parse(inputs.COMPONENTS ?? ''); } catch { return { error: 'COMPONENTS must be the page as a JSON list of A2UI components.' }; }
  const list = raw && typeof raw === 'object' && !Array.isArray(raw) && Array.isArray((raw as { components?: unknown }).components) ? (raw as { components: unknown }).components : raw;
  const v = checkNotebookLayout(list);
  if (!v.ok) return { error: `That page can't be drawn: ${v.errors.slice(0, 4).join('; ')}` };
  return { layout: { ...(layoutPreset(preset) ? { preset } : {}), components: v.components } };
}

/** Its current layout as the card's base: what the preview was against. */
const baseOf = (nb: Notebook) => JSON.stringify(nb.layout ?? null);

/** The card's preview: what changes on the page, stamped with the page it was against. */
export function previewNotebookLayout(ctx: Ctx, action: InboxActionMeta): InboxActionMeta {
  const nb = notebooksOf(ctx).get(action.inputs.NOTEBOOK ?? '');
  if (!nb) return action;
  const want = layoutFromInputs(nb, action.inputs);
  if ('error' in want) return action;
  const now = notebookLayoutOf(nb);
  const changes = want.undo
    ? [{ what: 'layout', before: '—', after: notebooksOf(ctx).layoutUndos(nb.id) ? 'back to how it was before the last change' : 'nothing to undo' }]
    : describeLayoutChange(now, want.layout!);
  return { ...action, base: { version: 0, yaml: baseOf(nb) }, surfaceChanges: changes, inputs: { ...action.inputs, NOTEBOOK_TITLE: nb.title } };
}

export function executeNotebookLayout(ctx: Ctx, meta: InboxActionMeta): { status: InboxActionStatus; summary?: string; refusalReason?: string } {
  const store = notebooksOf(ctx);
  const nb = store.get(meta.inputs.NOTEBOOK ?? '');
  if (!nb) return { status: 'failed', refusalReason: 'That notebook is gone.' };
  if (meta.base && meta.base.yaml !== baseOf(nb)) {
    return { status: 'failed', refusalReason: 'The notebook\'s page changed since this was proposed. Ask again to get a change against what it shows now.' };
  }
  const want = layoutFromInputs(nb, meta.inputs);
  if ('error' in want) return { status: 'failed', refusalReason: want.error };
  const link = `[the notebook](/notebooks/${encodeURIComponent(nb.id)})`;
  try {
    if (want.undo) {
      return store.undoLayout(nb.id)
        ? { status: 'completed', summary: `Put ${link}'s page back how it was before the last change.` }
        : { status: 'failed', refusalReason: 'There\'s no change to the page to undo.' };
    }
    store.setLayout(nb.id, want.layout, 'sua');
    return { status: 'completed', summary: `Changed ${link}'s page. Undo it from the notebook's Edit page, or ask me.` };
  } catch (err) {
    return { status: 'failed', refusalReason: err instanceof Error ? err.message : String(err) };
  }
}
