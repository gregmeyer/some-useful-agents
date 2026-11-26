/**
 * What the `template-save` card shows (views/inbox-detail.ts), kept apart
 * from lib/template-actions.ts so the view doesn't load the inbox engine.
 */
import { cleanTemplateSetup, layoutPreset, type NotebookTemplateSetup } from '@some-useful-agents/core';

/** The card's setup, as it will be saved (undefined when it doesn't parse). Pure. */
export function cardSetup(raw: string | undefined): NotebookTemplateSetup | undefined {
  try {
    const v = JSON.parse(raw ?? '') as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? cleanTemplateSetup(v).setup : undefined;
  } catch { return undefined; }
}

/** Its page, by the ready-made page's label ("Comparison"), when it has one. Pure. */
export function layoutLabel(setup: NotebookTemplateSetup): string | undefined {
  const id = setup.layout?.preset;
  return id ? layoutPreset(id)?.label : undefined;
}
