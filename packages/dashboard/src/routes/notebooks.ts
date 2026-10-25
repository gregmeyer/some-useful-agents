/**
 * Notebooks (goal surfaces G1): GET /notebooks, POST /notebooks (start one),
 * GET /notebooks/:id (its page), and the forms on it: add / remove an entry,
 * tick a criterion, edit, decide, stop / reopen. Every form redirects back
 * with a flash.
 */
import { Router, type Request, type Response } from 'express';
import { renderNotFoundPage } from '../views/not-found.js';
import { renderNotebookWorkflow } from '../views/notebook-workflow.js';
import { renderNotebookOptionPage } from '../views/notebook-option.js';
import { navOrder, notebookOptionData, optionNeighbours, optionPage } from '../lib/notebook-option.js';
import { notebookWidgetData, notebookWidgetMessages } from '../lib/notebook-widgets.js';
import { render } from '../views/html.js';
import { renderNotebookNew, renderDraftReview, renderSuggestionPills } from '../views/notebook-new.js';
import { renderTemplateSave, renderTemplatePreview, templateEditsFrom, type TemplatePreview } from '../views/notebook-template.js';
import { templateOfNotebook, draftTemplate } from '../lib/notebook-template-action.js';
import { conversationWorking } from '../lib/conversation-working.js';
import { renderSurfaceHost } from '../lib/a2ui-surface.js';
import { notebookSuggestions } from '../lib/notebook-suggestions.js';
import { startNotebookDraft, readDraft, searchAgents, listDrafts, discardDraft, saveDraftEdits, draftSteps, stepsFromForm } from '../lib/notebook-draft.js';
import {
  NotebookStore, SurfaceStore, notebookLineage, notebookCsv, shortName, compileSurface, notebookEntryItems, notebookViewData, notebookPhotoPath, validateScheduleInterval, markdownToText,
  type Notebook,
  type NotebookEntry,
  type NotebookEntryKind,
} from '@some-useful-agents/core';
import { layoutPreset } from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { createNotebookFrom } from '../lib/notebook-create.js';
import { decideNotebookPage } from '../lib/notebook-page.js';
import { confirmDoneStepsAndSay, fitStepAgents, focusStepOnTop, hasOpenSteps, stopNotebookStep } from '../lib/notebook-steps.js';
import { actOnStep, reconcileStepCards, stepsKey } from '../lib/notebook-step-queue.js';
import { notebookLive, notebookLiveKey } from '../lib/notebook-live.js';
import { parseFlash } from './inbox-shared.js';
import { renderNotebookPage, renderNotebookEdit, renderNotebooksList, formatFieldValue, type PipelineStage } from '../views/notebooks.js';
import { renderNotebookBrief, type BriefPicture } from '../views/notebook-brief.js';
import { notebookCard, notebookCover, notebookCoverSrc, notebookLead } from '../lib/notebook-card.js';
import { startNotebookPipeline, pipelineRunning, startNotebookSetup, setupRunning, unfiledRuns, addingRun, addRunToNotebook, skipUnfiledRuns } from '../lib/notebook-pipeline.js';
import { keepPhotos, startListingPhotos } from '../lib/notebook-photos.js';
import { optionIllustration, illustrationKind } from '../lib/notebook-illustrations.js';
import { notebookThread, setThreadOptionFocus, optionNavIntent } from '../lib/notebook-chat.js';
import { startNotebookPictures, picturesRunning } from '../lib/notebook-pictures.js';
import { startNotebookFacets } from '../lib/notebook-facets.js';
import { publishInboxEvent, publishInboxChanged, isAjax } from './inbox-shared.js';
import { runTriageAgent } from './inbox-engine.js';
import { renderNotebookMain, nextStep } from '../views/notebooks.js';

export const notebooksRouter: Router = Router();

const store = (req: Request) => NotebookStore.fromHandle(getContext(req.app.locals).runStore.databaseHandle());
const lines = (v: unknown): string[] => (typeof v === 'string' ? v.split(/\r?\n/) : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const back = (id: string, flash: string, hash = '') => `/notebooks/${encodeURIComponent(id)}?flash=${encodeURIComponent(flash)}${hash}`;
/** Back to the notebook (at the option's card), or to the option's own page when its form says `back=option`. */
const backFrom = (req: Request, id: string, entryId: string, flash: string) => (req.body?.back === 'option'
  ? `/notebooks/${encodeURIComponent(id)}/entries/${encodeURIComponent(entryId)}?flash=${encodeURIComponent(flash)}`
  : back(id, flash, `#entry-${entryId}`));

const LIST_PAGE = 12;

/** The store, plus recent runs of an agent, for the widgets' timeline. */
function widgetHistory(ctx: ReturnType<typeof getContext>, s: NotebookStore): NotebookStore & { recentRuns(agentId: string): Array<{ id: string; status: string; startedAt: string; error?: string }> } {
  return Object.assign(Object.create(s) as NotebookStore, {
    // A run another agent started belongs to its parent's search, not the notebook's.
    recentRuns: (agentId: string) => ctx.runStore.listRuns({ agentName: agentId, limit: 10 })
      .filter((r) => !r.parentRunId)
      .map((r) => ({ id: r.id, status: r.status, startedAt: r.startedAt, ...(r.error ? { error: r.error } : {}) })),
  });
}

notebooksRouter.get('/notebooks', (req: Request, res: Response) => {
  // The old "+ New notebook" form opened with ?new=1; it's a page now.
  if (req.query.new === '1') { res.redirect(302, `/notebooks/new${req.query.flash ? `?flash=${encodeURIComponent(str(req.query.flash))}` : ''}`); return; }
  const s = store(req);
  const q = str(req.query.q).trim().slice(0, 100);
  const status = (['active', 'decided', 'stopped', 'all', 'archived'] as const).find((v) => v === req.query.status) ?? 'active';
  const sort = (['updated', 'created', 'title'] as const).find((v) => v === req.query.sort) ?? 'updated';
  // Archived notebooks show only under Archived; All means everything not archived.
  const all = s.list();
  const archived = s.list({ archived: 'only' });
  const counts = { active: 0, decided: 0, stopped: 0, all: all.length, archived: archived.length };
  for (const nb of all) counts[nb.status]++;
  const needle = q.toLowerCase();
  const matches = (status === 'archived' ? archived : all)
    .filter((nb) => status === 'all' || status === 'archived' || nb.status === status)
    .filter((nb) => !needle || [nb.title, nb.statement, nb.decision ?? '', ...nb.params].some((t) => t.toLowerCase().includes(needle)))
    .sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title) : sort === 'created' ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt));
  const pages = Math.max(1, Math.ceil(matches.length / LIST_PAGE));
  const page = Math.min(pages, Math.max(1, Number(req.query.page) || 1));
  const shown = matches.slice((page - 1) * LIST_PAGE, page * LIST_PAGE);
  // Options with no picture get one in the background (once each), so covers fill in.
  const ctx = getContext(req.app.locals);
  for (const nb of shown.filter((n) => n.status === 'active' && n.fields.length).slice(0, 4)) {
    try { startNotebookPictures(ctx, nb.id); } catch { /* covers are a nicety */ }
  }
  const notebooks = shown.map((nb) => notebookCard(s, nb));
  res.type('html').send(renderNotebooksList({
    notebooks, openNew: req.query.new === '1', flash: parseFlash(req),
    query: { q, status, sort, page, pages, total: matches.length, perPage: LIST_PAGE }, counts,
    drafts: listDrafts(ctx),
  }));
});

/** A form value that may repeat (chips) or be one newline-separated text. */
const many = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : lines(v)).map((x) => x.trim()).filter(Boolean);

/** A title from what was said, when none was given ("Skip the draft"). */
const titleFrom = (text: string): string => {
  const first = text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0] ?? '';
  return first.length <= 60 ? first.replace(/[.!?]$/, '') : `${first.slice(0, 57).replace(/\s+\S*$/, '')}…`;
};

// New notebook (views/notebook-new.ts): say it, sua drafts it, you check it.
notebooksRouter.get('/notebooks/new', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const sug = notebookSuggestions(ctx);
  // ?draft=<id>: back to a draft you left (its sentence, and the draft as you last changed it).
  const draftId = str(req.query.draft);
  const d = draftId ? readDraft(ctx, draftId) : undefined;
  const others = listDrafts(ctx).filter((x) => x.id !== draftId);
  res.type('html').send(renderNotebookNew({
    text: d?.text ?? str(req.query.text).slice(0, 1000), suggestions: sug.items, refreshing: sug.refreshing,
    flash: parseFlash(req) ?? (draftId && !d ? { kind: 'info', message: 'That draft is gone (started, discarded or expired).' } : undefined),
    ...(d ? { draft: { id: draftId, state: d, agents: searchAgents(ctx) } } : {}),
    others,
    templates: store(req).listTemplates(),
    archivedTemplates: store(req).listTemplates(50, { archived: 'only' }),
  }));
});

/** Keep your changes to a draft as you make them (notebook-new.js.ts posts its form here). */
notebooksRouter.post('/notebooks/draft/:id/edits', (req: Request, res: Response) => {
  const ok = saveDraftEdits(getContext(req.app.locals), String(req.params.id), (req.body ?? {}) as Record<string, unknown>);
  res.status(ok ? 204 : 404).end();
});

notebooksRouter.post('/notebooks/draft/:id/discard', (req: Request, res: Response) => {
  discardDraft(getContext(req.app.locals), String(req.params.id));
  if (isAjax(req)) { res.status(204).end(); return; }
  res.redirect(303, str(req.body?.back) === 'list' ? '/notebooks' : '/notebooks/new');
});

/** The pills, redrawn when a refresh finishes (notebook-new.js.ts). */
notebooksRouter.get('/notebooks/suggestions', (req: Request, res: Response) => {
  const sug = notebookSuggestions(getContext(req.app.locals));
  res.json({ refreshing: sug.refreshing, html: render(renderSuggestionPills(sug.items, sug.refreshing)) });
});

notebooksRouter.post('/notebooks/draft', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const from = str(req.body?.from) ? readDraft(ctx, str(req.body?.from)) : undefined;
  const out = startNotebookDraft(ctx, str(req.body?.text), from?.status === 'ready' ? { id: str(req.body?.from), draft: from.draft, change: str(req.body?.change) } : undefined);
  if (typeof out !== 'string') { res.status(400).json({ error: out.error }); return; }
  // Drafting the sentence again: the draft you were on is replaced.
  const replaced = str(req.body?.replace);
  if (replaced && replaced !== out) discardDraft(ctx, replaced);
  res.status(202).json({ id: out });
});

notebooksRouter.get('/notebooks/draft/:id', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const d = readDraft(ctx, String(req.params.id));
  if (!d) { res.status(404).json({ status: 'gone', error: 'That draft has expired. Draft it again.' }); return; }
  if (d.status === 'working') { res.json({ status: 'working' }); return; }
  if (d.status === 'failed') { res.json({ status: 'failed', error: d.error }); return; }
  res.json({ status: 'ready', html: render(renderDraftReview(String(req.params.id), d.draft, searchAgents(ctx), d.error)) });
});

notebooksRouter.post('/notebooks', (req: Request, res: Response) => {
  try {
    const statement = str(req.body?.statement);
    const ctx = getContext(req.app.locals);
    const known = new Set(searchAgents(ctx).map((a) => a.id));
    let cadence = str(req.body?.cadence).trim();
    if (cadence) { try { validateScheduleInterval(cadence, {}); } catch { cadence = ''; } }
    // The steps sua will take, as you left them on the draft; and from a draft,
    // what to note, the stages and the checks (so setup is skipped).
    const { steps } = draftSteps(stepsFromForm(req.body ?? {}), known);
    const fields = many(req.body?.field).map((f) => { try { return JSON.parse(f) as unknown; } catch { return undefined; } }).filter(Boolean);
    const nb = createNotebookFrom(ctx, {
      title: str(req.body?.title).trim() || titleFrom(statement),
      statement,
      params: many(req.body?.params),
      criteria: many(req.body?.criteria),
      pipeline: many(req.body?.pipeline).filter((id) => known.has(id)),
      cadence,
      ...(steps ? { steps } : {}),
      ...(fields.length ? {
        fields,
        stages: many(req.body?.stages).flatMap((x) => x.split(/\s*(?:→|->|,)\s*/)).filter(Boolean),
        checks: many(req.body?.checks),
      } : {}),
    });
    // Started from a draft: it's done with.
    if (str(req.body?.draft)) discardDraft(ctx, str(req.body?.draft));
    res.redirect(303, back(nb.id, 'Notebook started. sua is setting up what to track for it; tell it what you know.'));
  } catch (err) {
    res.redirect(303, `/notebooks/new?flash=${encodeURIComponent(err instanceof Error ? err.message : String(err))}`);
  }
});

/** How this notebook was made: its runs, the runs they started, and what each left. */
notebooksRouter.get('/notebooks/:id/workflow', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const s = store(req);
  const nb = s.get(String(req.params.id));
  if (!nb) { res.status(404).type('html').send(renderNotFoundPage({ path: req.originalUrl, message: 'No such notebook.' })); return; }
  res.type('html').send(renderNotebookWorkflow({ nb, lineage: notebookLineage(s, ctx.runStore, nb.id), pass: str(req.query.pass) }));
});

notebooksRouter.get('/notebooks/:id', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const s = store(req);
  const found = s.get(String(req.params.id));
  if (!found) { res.status(404).redirect(303, `/notebooks?flash=${encodeURIComponent('No such notebook.')}`); return; }
  // Done-whens the notebook's own work now meets tick themselves (enough options, a decision…).
  const nb = s.autoMeetCriteria(found.id).nb;
  // The conversation's step cards match the steps as they are (one queue: ADR-0055).
  reconcileStepCards(ctx, nb.id);
  // A notebook with options but no fields (kept before fields existed, or
  // filled by talking): set it up once, in the background; the page redraws.
  if (s.needsSetup(nb.id)) startNotebookSetup(ctx, nb.id);
  // Facts that contradict an option's own text (mixed up by a model) are repaired from the text.
  s.reconcileOptionFacts(nb.id);
  // Options with a listing link get its photo; ones with no picture yet get a
  // representative one or a drawing (each tried once).
  if (nb.fields.length) {
    try { startListingPhotos(ctx, s, nb.id); } catch { /* a nicety */ }
    startNotebookPictures(ctx, nb.id);
    // Long facts get short labels for the shortlist's filter chips.
    try { startNotebookFacets(ctx, nb.id); } catch { /* a nicety */ }
  }
  const entries = s.entries(nb.id);
  const surface = SurfaceStore.fromHandle(ctx.runStore.databaseHandle()).current(`notebook:${nb.id}`);
  const compiled = compileSurface(surface.doc, notebookEntryItems(nb, entries));
  // Each pipeline agent's last run, for the diagram.
  const running = pipelineRunning(ctx, nb.id);
  const stages: PipelineStage[] = nb.pipeline.map((agentId, i) => {
    if (running && running.step === i + 1) return { agentId, status: 'running', note: 'running now' };
    const last = ctx.runStore.listRuns({ agentName: agentId, limit: 1 })[0];
    if (!last) return { agentId, status: 'never', note: ctx.agentStore.getAgent(agentId) ? 'not run yet' : 'not installed' };
    return { agentId, status: last.status === 'failed' ? 'failed' : 'ok', note: last.status === 'failed' ? 'failed' : last.status === 'completed' ? 'ran' : last.status };
  });
  // sua's latest word in the notebook's conversation, so the page shows it remembers.
  const last = nb.conversationId ? ctx.inboxStore?.listResponses(nb.conversationId).filter((r) => r.role === 'triage').pop() : undefined;
  const lastWord = last ? { text: markdownToText(last.body.replace(/<plan>[\s\S]*?<\/plan>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 240) + (last.body.length > 240 ? '…' : ''), at: last.createdAt } : undefined;
  // The same picture as the notebook's card: the lead option's, else the cover.
  const coverPhoto = notebookCoverSrc(s, nb, notebookLead(nb, entries));
  // What sua is doing for this notebook in the background (shown as working in the header).
  const unfiled = unfiledRuns(ctx, nb).map((r) => ({ ...r, adding: addingRun(ctx, r.id) }));
  const busy = [
    ...(picturesRunning(ctx, nb.id) ? ['Finding photos'] : []),
    ...(ctx.notebookListingPhotos?.has(nb.id) ? ['Getting listing photos'] : []),
    ...(ctx.notebookFacets?.has(nb.id) ? ['Labelling facts for filters'] : []),
    ...(unfiled.some((r) => r.adding) ? ['Adding a run'] : []),
  ];
  // What's live: the conversation waiting on you or replying, and the notebook's own work.
  const live = notebookLive(ctx, s.get(nb.id) ?? nb, running ? { step: running.step, of: running.of } : undefined, busy);
  res.type('html').send(renderNotebookPage({ nb, unfiled, busy, live, liveKey: notebookLiveKey(live), ...(coverPhoto ? { cover: coverPhoto } : {}), entries, compiled, history: widgetHistory(ctx, s), settingUp: setupRunning(ctx, nb.id), stages, running: running ? { step: running.step, of: running.of } : undefined, ...(lastWord ? { lastWord } : {}), stepsKey: stepsKey(ctx, s.get(nb.id) ?? nb), flash: parseFlash(req) }));
});

notebooksRouter.post('/notebooks/:id/entries', (req: Request, res: Response) => {
  const id = String(req.params.id);
  try {
    const kind = str(req.body?.kind) as NotebookEntryKind;
    const entry = store(req).addEntry(id, { kind, title: str(req.body?.title), body: str(req.body?.body), by: 'you' });
    res.redirect(303, back(id, `Added the ${kind}.`, `#entry-${entry.id}`));
  } catch (err) {
    res.redirect(303, back(id, err instanceof Error ? err.message : String(err)));
  }
});

notebooksRouter.post('/notebooks/:id/entries/:entry/remove', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const removed = store(req).removeEntry(id, String(req.params.entry));
  res.redirect(303, back(id, removed ? 'Removed.' : 'That entry was already gone.'));
});

// An option's kept photo. Served as an image only: never sniffed, never run.
/** An option's illustration, drawn now (so earlier drawings improve too). */
function drawOption(nb: Notebook, entry: NotebookEntry): string {
  const name = shortName(entry.title);
  // A company's tile shows its own name's initials (the org field), not the option's title.
  const orgKey = nb.fields.find((f) => f.role === 'org')?.key;
  const org = orgKey && typeof entry.data?.[orgKey] === 'string' ? (entry.data[orgKey] as string) : undefined;
  const kind = illustrationKind(nb, name);
  return optionIllustration({ kind, name: kind === 'job' && org ? org : name, seed: entry.id });
}

/** A saved brief's pictures, inside the file: each up to 600KB, 8MB in all; past that, none. */
const BRIEF_PICTURE_MAX = 600 * 1024;
const BRIEF_PICTURES_MAX = 8 * 1024 * 1024;
function embeddedPictures(s: NotebookStore, nb: Notebook, entries: readonly NotebookEntry[]): BriefPicture {
  let total = 0;
  const cache = new Map<string, string | undefined>();
  return (o) => {
    if (cache.has(o.id)) return cache.get(o.id);
    let uri: string | undefined;
    const photo = o.image ? s.photo(o.id) : undefined;
    const entry = photo?.kind === 'illustration' ? entries.find((e) => e.id === o.id) : undefined;
    const bytes = entry ? Buffer.from(drawOption(nb, entry)) : photo ? Buffer.from(photo.bytes) : undefined;
    if (bytes && bytes.length <= BRIEF_PICTURE_MAX && total + bytes.length <= BRIEF_PICTURES_MAX) {
      total += bytes.length;
      uri = `data:${entry ? 'image/svg+xml' : photo!.contentType};base64,${bytes.toString('base64')}`;
    }
    cache.set(o.id, uri);
    return uri;
  };
}

// Not them: the photo goes, and isn't used for them again (the page they're on is kept as it is).
notebooksRouter.post('/notebooks/:id/about/:who/photo/reject', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const who = String(req.params.who);
  const done = (who === 'person' || who === 'company') && store(req).rejectAboutPhoto(id, who);
  res.redirect(303, `/notebooks/${encodeURIComponent(id)}?${done ? 'ok' : 'info'}=${encodeURIComponent(done ? 'Removed that photo; it won\u2019t be used again. Search again on the Learn about step to look for another.' : 'There was no photo to remove.')}`);
});

// A kept picture of who a notebook is about (a profile step): a person's photo, a company's logo.
notebooksRouter.get('/notebooks/:id/about/:who/photo', (req: Request, res: Response) => {
  const who = String(req.params.who);
  const photo = who === 'person' || who === 'company' ? store(req).aboutPhoto(String(req.params.id), who) : undefined;
  if (!photo || !/^image\/(jpeg|png|gif|webp)$/.test(photo.contentType)) { res.status(404).end(); return; }
  res.setHeader('Content-Type', photo.contentType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-cache');
  res.end(Buffer.from(photo.bytes));
});

notebooksRouter.get('/notebooks/:id/entries/:entry/photo', (req: Request, res: Response) => {
  const s = store(req);
  const photo = s.photo(String(req.params.entry));
  if (!photo) { res.status(404).end(); return; }
  // An illustration is drawn here, each time (so earlier drawings improve too).
  if (photo.kind === 'illustration') {
    const nb = s.get(String(req.params.id));
    const entry = nb ? s.entries(nb.id, 1000).find((e) => e.id === String(req.params.entry)) : undefined;
    if (nb && entry) {
      const svg = drawOption(nb, entry);
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
      // Drawn on every request (cheap), so the browser always asks: a better drawing shows at once.
      res.setHeader('Cache-Control', 'private, no-cache');
      res.end(svg);
      return;
    }
  }
  // A picture can change at the same address (a drawing becomes a logo, a better photo is found):
  // the browser asks each time and gets a 304 while it hasn't.
  const etag = `"${photo.kind}-${photo.fetchedAt}"`;
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'private, no-cache');
  if (req.headers['if-none-match'] === etag) { res.status(304).end(); return; }
  res.setHeader('Content-Type', photo.contentType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.end(Buffer.from(photo.bytes));
});

// Look for photos now (they're also fetched after each search).
notebooksRouter.post('/notebooks/:id/photos', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const s = store(req);
  if (!s.get(id)) { res.redirect(303, `/notebooks?flash=${encodeURIComponent('No such notebook.')}`); return; }
  const { kept, tried } = await keepPhotos(s, id);
  // Anything still without a picture: sua finds a representative one or draws it.
  const drawing = startNotebookPictures(getContext(req.app.locals), id);
  res.redirect(303, back(id, `${tried === 0 ? 'No listing photos left to try.' : `Found ${String(kept)} listing photo${kept === 1 ? '' : 's'}.`}${drawing ? ' sua is finding or drawing pictures for the rest; they appear here when ready.' : ''}`));
});

// An option's stage, ruling it out (it stays, with why), and bringing it back.
// One option's page: every fact with its source, the price over time, its checks and its history.
notebooksRouter.get('/notebooks/:id/entries/:entry', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const s = store(req);
  const nb = s.get(String(req.params.id));
  const entries = nb ? s.entries(nb.id, 1000) : [];
  const entry = entries.find((e) => e.id === String(req.params.entry));
  if (!nb || !entry) { res.status(404).type('html').send(renderNotFoundPage({ path: req.originalUrl, message: nb ? 'No such option in this notebook.' : 'No such notebook.' })); return; }
  // A note or decision has no page of its own: its place in the notebook.
  if (entry.kind !== 'option') { res.redirect(302, `/notebooks/${encodeURIComponent(nb.id)}#entry-${entry.id}`); return; }
  const data = notebookOptionData(nb, entries, entry.id, widgetHistory(ctx, s));
  if (!data) { res.status(404).type('html').send(renderNotFoundPage({ path: req.originalUrl, message: 'No such option in this notebook.' })); return; }
  res.type('html').send(renderNotebookOptionPage({ nb, entry, data, others: entries.filter((x) => x.kind === 'option' && x.id !== entry.id), flash: parseFlash(req) }));
});

/** Merge another option (the same one, found again) into this one: back to this option's page. */
notebooksRouter.post('/notebooks/:id/entries/:entry/merge', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const keep = String(req.params.entry);
  const page = (flash: string) => `/notebooks/${encodeURIComponent(id)}/entries/${encodeURIComponent(keep)}?flash=${encodeURIComponent(flash)}`;
  try {
    const copy = store(req).entries(id, 1000).find((e) => e.id === str(req.body?.copy) && e.kind === 'option');
    if (!copy) { res.redirect(303, page('Pick the copy to merge in.')); return; }
    store(req).mergeOptions(id, keep, [copy.id]);
    res.redirect(303, page(`Merged “${copy.title}” into this one.`));
  } catch (err) {
    res.redirect(303, page(err instanceof Error ? err.message : String(err)));
  }
});

notebooksRouter.post('/notebooks/:id/entries/:entry/stage', (req: Request, res: Response) => {
  const id = String(req.params.id);
  try {
    const e = store(req).moveOption(id, String(req.params.entry), str(req.body?.stage));
    res.redirect(303, backFrom(req, id, e.id, `${e.title} → ${e.stage ?? ''}`));
  } catch (err) {
    res.redirect(303, backFrom(req, id, String(req.params.entry), err instanceof Error ? err.message : String(err)));
  }
});

notebooksRouter.post('/notebooks/:id/entries/:entry/rule-out', (req: Request, res: Response) => {
  const id = String(req.params.id);
  try {
    const gone = req.body?.gone === '1';
    const e = store(req).ruleOut(id, String(req.params.entry), str(req.body?.reason).trim() || str(req.body?.quick), 'you', { gone });
    res.redirect(303, backFrom(req, id, e.id, gone ? `${e.title}: no longer available.` : `Ruled out: ${e.title}. Searches won't suggest it again.`));
  } catch (err) {
    res.redirect(303, backFrom(req, id, String(req.params.entry), err instanceof Error ? err.message : String(err)));
  }
});

/** Pick an option (`on=0` takes the pick back); the notebook stays open. */
notebooksRouter.post('/notebooks/:id/entries/:entry/choose', (req: Request, res: Response) => {
  const id = String(req.params.id);
  try {
    const on = req.body?.on !== '0';
    const e = store(req).choose(id, String(req.params.entry), on);
    res.redirect(303, backFrom(req, id, e.id, on ? `Picked ${e.title}.` : `Took back the pick: ${e.title}.`));
  } catch (err) {
    res.redirect(303, backFrom(req, id, String(req.params.entry), err instanceof Error ? err.message : String(err)));
  }
});

// Tick (or untick) one of the notebook's checks for an option.
/**
 * Set the notebook's steps: `steps` is a JSON list of {title, kind, agentId?,
 * target?} (an empty list removes them). Agents must be installed. JSON in
 * or a form post; JSON gets the notebook back.
 */
notebooksRouter.post('/notebooks/:id/steps', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const wantsJson = !!req.is('application/json');
  try {
    const raw: unknown = typeof req.body?.steps === 'string' ? JSON.parse(req.body.steps) : req.body?.steps;
    if (!Array.isArray(raw)) throw new Error('Steps must be a list.');
    const ctx = getContext(req.app.locals);
    const unknownAgent = raw.map((x) => (x && typeof x === 'object' ? (x as { agentId?: unknown }).agentId : undefined))
      .find((a) => typeof a === 'string' && a && !ctx.agentStore.getAgent(a));
    if (unknownAgent) throw new Error(`No agent "${String(unknownAgent)}".`);
    // An agent that can't do its step comes off it (sua's finder or checker does it), said in the flash.
    const fit = fitStepAgents(ctx, raw);
    store(req).setSteps(id, fit.steps);
    // Steps the notebook's work already covers are done (sua says so in its conversation).
    const already = confirmDoneStepsAndSay(ctx, id);
    const nb = store(req).get(id)!;
    if (wantsJson) { res.json({ steps: nb.steps ?? [], ...(fit.notes.length ? { notes: fit.notes } : {}) }); return; }
    const done = already.done.length ? ` ${String(already.done.length)} already done.` : '';
    const fixed = fit.notes.length ? ` ${fit.notes.join(' ')}` : '';
    res.redirect(303, back(id, nb.steps?.length ? `Saved ${String(nb.steps.length)} steps.${done}${fixed}` : 'Steps removed.'));
  } catch (err) {
    const msg = err instanceof SyntaxError ? 'Steps must be valid JSON.' : err instanceof Error ? err.message : String(err);
    if (wantsJson) { res.status(400).json({ error: msg }); return; }
    res.redirect(303, back(id, msg));
  }
});

notebooksRouter.post('/notebooks/:id/entries/:entry/check', (req: Request, res: Response) => {
  const id = String(req.params.id);
  try {
    const item = str(req.body?.item).trim();
    if (!item) throw new Error('Which check?');
    store(req).checkOption(id, String(req.params.entry), item, req.body?.done === '1' || req.body?.done === 'true');
    res.redirect(303, back(id, 'Saved.'));
  } catch (err) {
    res.redirect(303, back(id, err instanceof Error ? err.message : String(err)));
  }
});

notebooksRouter.post('/notebooks/:id/entries/:entry/reinstate', (req: Request, res: Response) => {
  const id = String(req.params.id);
  try {
    const e = store(req).reinstate(id, String(req.params.entry));
    res.redirect(303, backFrom(req, id, e.id, `Brought back: ${e.title}.`));
  } catch (err) {
    res.redirect(303, backFrom(req, id, String(req.params.entry), err instanceof Error ? err.message : String(err)));
  }
});

// Archive (hide from lists, Home, Today and schedules; nothing deleted) or restore.
/** The template a notebook's template page shows: the one saved from it, else sua's first guess. */
function templatePreviewFor(ctx: ReturnType<typeof getContext>, nb: Notebook): TemplatePreview {
  const t = templateOfNotebook(ctx, nb);
  return t ? { name: t.name, setup: t.setup, saved: true, uses: t.uses, updatedAt: t.updatedAt } : { ...draftTemplate(nb), saved: false };
}

/** Make a template: a preview of it, a conversation with sua that drafts it, and the words by hand. */
notebooksRouter.get('/notebooks/:id/template', (req: Request, res: Response) => {
  const nb = store(req).get(String(req.params.id));
  if (!nb) { res.status(404).redirect(303, `/notebooks?flash=${encodeURIComponent('No such notebook.')}`); return; }
  const ctx = getContext(req.app.locals);
  const s = store(req);
  const entries = s.entries(nb.id, 1000);
  const widgets = notebookWidgetMessages(nb, entries, widgetHistory(ctx, s));
  const msg = nb.conversationId ? ctx.inboxStore?.get(nb.conversationId) : undefined;
  res.type('html').send(renderTemplateSave({
    nb, preview: templatePreviewFor(ctx, nb), flash: parseFlash(req),
    ...(widgets ? { page: renderSurfaceHost(`notebook-${nb.id}`, widgets, { label: `${nb.title}: its page` }) } : {}),
    ...(msg && conversationWorking(ctx, msg) ? { working: true } : {}),
  }));
});

/** The template's preview alone, so the page can redraw it as sua saves new versions. */
notebooksRouter.get('/notebooks/:id/template/preview', (req: Request, res: Response) => {
  const nb = store(req).get(String(req.params.id));
  if (!nb) { res.status(404).end(); return; }
  res.type('html').send(render(renderTemplatePreview(templatePreviewFor(getContext(req.app.locals), nb))));
});

/**
 * Keep this notebook's setup as a template (its options aren't kept). From
 * the review page (`review=1`), with its edited texts and subject.
 */
notebooksRouter.post('/notebooks/:id/template', (req: Request, res: Response) => {
  const id = String(req.params.id);
  try {
    const s = store(req);
    const nb = s.get(id);
    if (!nb) throw new Error('No such notebook.');
    const edits = req.body?.review === '1' ? templateEditsFrom(req.body as Record<string, unknown>, nb) : undefined;
    const t = s.saveTemplate(str(req.body?.name), id, undefined, edits);
    res.redirect(303, back(id, `Saved as the template “${t.name}” (${t.description}). Start a notebook from it on New notebook, or ask sua: start a notebook from my ${t.name} template.`));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (req.body?.review === '1') res.redirect(303, `/notebooks/${encodeURIComponent(id)}/template?error=${encodeURIComponent(msg)}`);
    else res.redirect(303, back(id, msg));
  }
});

/** Archive a template (kept, not offered), or restore it with archived=0. */
notebooksRouter.post('/notebooks/templates/:tid/archive', (req: Request, res: Response) => {
  const s = store(req);
  const t = s.getTemplate(String(req.params.tid));
  const restore = req.body?.archived === '0';
  const done = t ? s.archiveTemplate(t.id, !restore) : false;
  const msg = !done ? 'No such template.' : restore ? `Restored the template “${t!.name}”.` : `Archived the template “${t!.name}”. sua won't offer it; restore it under Archived templates.`;
  res.redirect(303, `/notebooks/new?flash=${encodeURIComponent(msg)}`);
});

/** Remove a template (the notebooks made from it stay). */
notebooksRouter.post('/notebooks/templates/:tid/delete', (req: Request, res: Response) => {
  const gone = store(req).deleteTemplate(String(req.params.tid));
  res.redirect(303, `/notebooks/new?flash=${encodeURIComponent(gone ? 'Template removed. Notebooks made from it stay.' : 'No such template.')}`);
});

notebooksRouter.post('/notebooks/:id/archive', (req: Request, res: Response) => {
  const id = String(req.params.id);
  try {
    const s = store(req);
    if (req.body?.archived === '0') {
      s.unarchive(id);
      res.redirect(303, back(id, 'Restored. It shows in your notebooks again.'));
    } else {
      const nb = s.archive(id);
      res.redirect(303, `/notebooks?flash=${encodeURIComponent(`Archived “${nb.title}”. Find it under Archived to restore it.`)}`);
    }
  } catch (err) {
    res.redirect(303, back(id, err instanceof Error ? err.message : String(err)));
  }
});

// Delete a notebook and everything in it. The form names the notebook (confirm), so a stray post can't.
notebooksRouter.post('/notebooks/:id/delete', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = String(req.params.id);
  const s = store(req);
  const nb = s.get(id);
  if (!nb) { res.redirect(303, `/notebooks?flash=${encodeURIComponent('That notebook was already gone.')}`); return; }
  if (str(req.body?.confirm) !== nb.id) { res.redirect(303, back(id, 'Confirm the delete from Edit → Delete….')); return; }
  if (pipelineRunning(ctx, nb.id)) { res.redirect(303, back(id, 'Its pipeline is running. Delete it once that finishes.')); return; }
  s.delete(nb.id);
  SurfaceStore.fromHandle(ctx.runStore.databaseHandle()).remove(`notebook:${nb.id}`);
  res.redirect(303, `/notebooks?flash=${encodeURIComponent(`Deleted “${nb.title}”.`)}`);
});

notebooksRouter.post('/notebooks/:id/criteria/:index', (req: Request, res: Response) => {
  const id = String(req.params.id);
  try {
    store(req).markCriterion(id, Number(req.params.index), req.body?.met === '1');
    res.redirect(303, `/notebooks/${encodeURIComponent(id)}`);
  } catch (err) {
    res.redirect(303, back(id, err instanceof Error ? err.message : String(err)));
  }
});

/** Edit this notebook: its whole setup, on its own page. */
notebooksRouter.get('/notebooks/:id/edit', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const nb = store(req).get(String(req.params.id));
  if (!nb) { res.status(404).redirect(303, `/notebooks?flash=${encodeURIComponent('No such notebook.')}`); return; }
  res.type('html').send(renderNotebookEdit({ nb, agents: searchAgents(ctx), flash: parseFlash(req), layoutUndos: store(req).layoutUndos(nb.id), pagePicking: !!ctx.notebookPages?.has(nb.id) }));
});

/** The notebook's page: back to a preset, or undo the last change (sua draws new ones in its conversation). */
notebooksRouter.post('/notebooks/:id/layout', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const edit = (msg: string, kind = 'ok') => `/notebooks/${encodeURIComponent(id)}/edit?${kind}=${encodeURIComponent(msg)}`;
  try {
    const s = store(req);
    if (req.body?.undo === '1') { res.redirect(303, edit(s.undoLayout(id) ? 'Put the page back how it was before the last change.' : 'There\'s no page change to undo.', 'info')); return; }
    // The notebook picks its page again, in the background (lib/notebook-page.ts).
    if (req.body?.decide === '1') {
      if (!s.get(id)) throw new Error('That notebook is gone.');
      void decideNotebookPage(getContext(req.app.locals), id, { again: true });
      res.redirect(303, edit('sua is picking a page for what this notebook is for. Open the notebook in a minute to see it; Undo puts the old one back.', 'info'));
      return;
    }
    const preset = layoutPreset(str(req.body?.preset));
    if (!preset) throw new Error('No such layout.');
    s.setLayout(id, preset.id === 'shortlist' ? null : preset.id, 'you');
    res.redirect(303, edit(preset.id === 'shortlist' ? `The page is the ${preset.label} again.` : `The page is now the ${preset.label}. Undo puts the last one back.`));
  } catch (err) {
    res.redirect(303, edit(err instanceof Error ? err.message : String(err), 'error'));
  }
});

/**
 * Save the Edit page. Lists come as one value per item (the setup editor's
 * chips and rows) or as one text, one per line. From the Edit page
 * (`setup=1`), the fields, checks and steps are saved too: a step you kept
 * keeps how far it got, and the one running can't be removed.
 */
notebooksRouter.post('/notebooks/:id/edit', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const cadence = str(req.body?.cadence).trim();
  const editPage = `/notebooks/${encodeURIComponent(id)}/edit`;
  try {
    if (cadence) validateScheduleInterval(cadence, {});
    const ctx = getContext(req.app.locals);
    let fixedSteps: string[] = [];
    const s = store(req);
    const nb = s.get(id);
    if (!nb) throw new Error('No such notebook.');
    const full = req.body?.setup === '1';
    let steps: unknown[] | undefined;
    if (full && nb.steps?.length) {
      const known = new Set(searchAgents(ctx).map((a) => a.id));
      const ids = many(req.body?.step_id);
      const posted = stepsFromForm(req.body ?? {});
      const running = nb.steps.find((x) => x.status === 'running');
      if (running && !ids.includes(running.id)) throw new Error(`"${running.title}" is running. Stop it before removing it.`);
      // A kept step starts from itself (its facts, how far it got); what you changed goes on top.
      steps = posted.map((x, i) => {
        const was = nb.steps!.find((w) => w.id === ids[i]);
        const agentId = x.agentId && (known.has(x.agentId) || x.agentId === was?.agentId) ? x.agentId : undefined;
        const target = x.target ? Number(x.target) : undefined;
        const { agentId: _a, target: _t, ...rest } = was ?? { id: '', kind: x.kind };
        return { ...rest, title: x.title, kind: x.kind, ...(agentId ? { agentId } : {}), ...(target !== undefined && Number.isFinite(target) ? { target } : {}) };
      });
    }
    s.update(id, {
      title: str(req.body?.title), statement: str(req.body?.statement),
      params: many(req.body?.params), pipeline: many(req.body?.pipeline), cadence,
    });
    s.setCriteria(id, many(req.body?.criteria));
    if (req.body?.stages !== undefined || full) s.setStages(id, many(req.body?.stages).flatMap((x) => x.split(/\s*(?:→|->|,)\s*/)).filter(Boolean));
    if (full) {
      s.setChecks(id, many(req.body?.checks));
      // The fields you kept, in their order (each as it was: only removing is done here).
      const kept = new Set(many(req.body?.field).map((f) => { try { return (JSON.parse(f) as { key?: unknown }).key; } catch { return undefined; } }));
      s.setFields(id, nb.fields.filter((f) => kept.has(f.key)));
      if (steps) {
        const fit = fitStepAgents(ctx, steps);
        s.setSteps(id, fit.steps);
        confirmDoneStepsAndSay(ctx, id);
        fixedSteps = fit.notes;
      }
    }
    res.redirect(303, back(id, `Saved.${fixedSteps.length ? ` ${fixedSteps.join(' ')}` : ''}`));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const say = cadence && /cron|schedule|frequen/i.test(msg) ? `"${cadence}" isn't a schedule sua understands. Use five fields, e.g. 0 7 * * *.` : msg;
    res.redirect(303, req.body?.setup === '1' ? `${editPage}?flash=${encodeURIComponent(say)}` : back(id, say));
  }
});

notebooksRouter.post('/notebooks/:id/decide', (req: Request, res: Response) => {
  const id = String(req.params.id);
  try {
    // The picks: one or several `chosen` option ids (none: the text says it).
    const raw: unknown = req.body?.chosen;
    const chosen = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]).map((x) => String(x)).filter(Boolean);
    // Save picks, keep it open: these are the picks now, and the notebook stays active.
    if (req.body?.keep === '1') {
      const s = store(req);
      const running = s.entries(id, 1000).filter((e) => e.kind === 'option' && !e.ruledOut);
      for (const o of running) if (!!o.chosenAt !== chosen.includes(o.id)) s.choose(id, o.id, chosen.includes(o.id));
      const n = running.filter((o) => chosen.includes(o.id)).length;
      res.redirect(303, back(id, n ? `Picked ${String(n)}. The notebook stays open.` : 'No picks now.'));
      return;
    }
    store(req).decide(id, str(req.body?.decision), 'you', chosen);
    reconcileStepCards(getContext(req.app.locals), id);
    res.redirect(303, back(id, 'Decided. The notebook is closed; reopen it any time.'));
  } catch (err) {
    res.redirect(303, back(id, err instanceof Error ? err.message : String(err)));
  }
});

/** Narrow: keep the picked options in the running, rule out the rest; the notebook stays open. */
notebooksRouter.post('/notebooks/:id/narrow', (req: Request, res: Response) => {
  const id = String(req.params.id);
  try {
    const raw: unknown = req.body?.chosen;
    const keep = [...new Set((Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]).map((x) => String(x)).filter(Boolean))];
    const before = store(req).entries(id, 1000).filter((e) => e.kind === 'option' && !e.ruledOut).length;
    const nb = store(req).narrow(id, keep, str(req.body?.decision), 'you');
    reconcileStepCards(getContext(req.app.locals), id);
    const next = nb.steps?.find((x) => x.status !== 'done');
    res.redirect(303, back(id, `Kept ${String(keep.length)}, ruled out ${String(before - keep.length)}.${next ? ` Next: ${next.title}.` : ''}`));
  } catch (err) {
    res.redirect(303, back(id, err instanceof Error ? err.message : String(err)));
  }
});

notebooksRouter.post('/notebooks/:id/status', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const status = str(req.body?.status);
  if (status !== 'active' && status !== 'stopped') { res.redirect(303, back(id, 'Unknown status.')); return; }
  try {
    store(req).setStatus(id, status);
    reconcileStepCards(getContext(req.app.locals), id);
    res.redirect(303, back(id, status === 'active' ? 'Reopened.' : 'Stopped. Its pipeline won’t run until you reopen it.'));
  } catch (err) {
    res.redirect(303, back(id, err instanceof Error ? err.message : String(err)));
  }
});

/** Run the pipeline now (G2): each agent in order, then the keeper adds what's new. */
/** Add to notebook: file a finished run of one of its agents that ran elsewhere. */
notebooksRouter.post('/notebooks/:id/runs/:runId/add', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const out = addRunToNotebook(getContext(req.app.locals), id, String(req.params.runId));
  res.redirect(303, back(id, out.started ? 'Adding that run\'s results. They show up here in a minute or so.' : out.reason ?? 'It could not be added.'));
});

// Skip: a run of one of its agents that doesn't belong here stops being offered.
notebooksRouter.post('/notebooks/:id/runs/skip-all', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const nb = store(req).get(id);
  if (!nb) { res.redirect(303, '/notebooks'); return; }
  const n = skipUnfiledRuns(getContext(req.app.locals), nb, 'all');
  res.redirect(303, back(id, n ? `Skipped ${String(n)} run${n === 1 ? '' : 's'}. They won't be offered here again.` : 'Nothing to skip.'));
});

notebooksRouter.post('/notebooks/:id/runs/:runId/skip', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const nb = store(req).get(id);
  if (!nb) { res.redirect(303, '/notebooks'); return; }
  const n = skipUnfiledRuns(getContext(req.app.locals), nb, [String(req.params.runId)]);
  res.redirect(303, back(id, n ? 'Skipped. It won\'t be offered here again.' : 'That run isn\'t offered here.'));
});

/** A step's outcome, as the header flashes it (the conversation has the same words). */
const flashWords = (s: string) => s.replace(/\*\*/g, '');

notebooksRouter.post('/notebooks/:id/run', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const ctx = getContext(req.app.locals);
  // With steps still to do, Run works on the current one (Continue, Try again)
  // through the conversation's card for it; else the pipeline, as before.
  const nb = store(req).get(id);
  if (nb && hasOpenSteps(nb)) {
    const out = await actOnStep(ctx, id, 'start');
    res.redirect(303, back(id, flashWords(out.message)));
    return;
  }
  const out = startNotebookPipeline(ctx, id);
  res.redirect(303, back(id, out.started ? 'Running the pipeline. New entries show up here as each agent finishes.' : out.reason ?? 'It could not start.'));
});

/** Stop the step that's running (the header's Stop): it keeps what it found and offers Move on or Try again. */
notebooksRouter.post('/notebooks/:id/steps/stop', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const out = stopNotebookStep(getContext(req.app.locals), id);
  res.redirect(303, back(id, out.stopped ? 'Stopping the step. It keeps what it found; then you can move on or try again.' : out.reason ?? 'It could not stop.'));
});

/**
 * Move on from the current step short of its goal: it keeps what it found,
 * is marked done, and the next step starts (the header's Move on).
 */
notebooksRouter.post('/notebooks/:id/steps/move-on', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const out = await actOnStep(getContext(req.app.locals), id, 'move', { stepId: str(req.body?.step) || undefined });
  res.redirect(303, back(id, flashWords(out.message)));
});

/** Check (or source) the top N: a step you moved on from short works again on just the best options. */
notebooksRouter.post('/notebooks/:id/steps/:step/top', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const top = Number(req.body?.top);
  const ctx = getContext(req.app.locals);
  const out = focusStepOnTop(ctx, id, String(req.params.step), top);
  reconcileStepCards(ctx, id);
  res.redirect(303, back(id, out.started ? `Working on ${out.step!.title}, for the top ${String(Math.round(top))}.` : out.reason ?? 'It could not start.'));
});

/** Search again: a find step that's done runs once more for new options (sua says how many are new). */
notebooksRouter.post('/notebooks/:id/steps/:step/again', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const out = await actOnStep(getContext(req.app.locals), id, 'again', { stepId: String(req.params.step) });
  res.redirect(303, back(id, flashWords(out.message)));
});

/**
 * Talk to sua about this notebook: starts its conversation (or continues it)
 * with what you said; sua files it into the notebook as you go.
 */
notebooksRouter.post('/notebooks/:id/ask', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const s = store(req);
  const nb = s.get(String(req.params.id));
  const text = str(req.body?.text).trim().slice(0, 4000);
  if (!nb || !ctx.inboxStore || !text) {
    if (isAjax(req)) { res.status(nb ? 400 : 404).json({ error: nb ? 'Say something first.' : 'No such notebook.' }); return; }
    res.redirect(303, nb ? back(nb.id, 'Say something first.') : '/notebooks');
    return;
  }
  // "Next" from an option's page: go to the next one (the page sends where, after your grid filters).
  const fromOption = str(req.body?.option);
  const step = fromOption ? optionNavIntent(text) : undefined;
  if (step) {
    const entries = s.entries(nb.id, 1000);
    const sent = str(req.body?.[step]);
    const order = navOrder(nb, notebookWidgetData(nb, entries, widgetHistory(ctx, s)).notebook.options, fromOption);
    const to = sent && order.some((o) => o.id === sent && !o.out) ? sent : optionNeighbours(order, fromOption)[step]?.id;
    if (to) {
      const page = optionPage(nb.id, to);
      if (isAjax(req)) { res.setHeader('X-Navigate', page); res.status(204).end(); return; }
      res.redirect(303, page);
      return;
    }
  }
  const threadId = notebookThread(ctx, nb)!;
  const cur = ctx.inboxStore.get(threadId);
  if (cur && (cur.status === 'resolved' || cur.status === 'dismissed')) ctx.inboxStore.updateStatus(threadId, 'open');
  // Asked from an option's page: the message names it, and sua gets that option in focus.
  const optionId = str(req.body?.option);
  const option = optionId ? s.entries(nb.id, 1000).find((e) => e.id === optionId && e.kind === 'option') : undefined;
  setThreadOptionFocus(ctx, threadId, option?.id);
  // From its template page: sua drafts the template (notebook-template).
  const said = ctx.inboxStore.addResponse(threadId, 'user', option ? `About “${shortName(option.title)}”: ${text}` : str(req.body?.template) === '1' ? `About this notebook's template: ${text}` : text);
  publishInboxEvent(ctx, threadId, 'message:created', { responseId: said.id, role: 'user', body: said.body, createdAt: said.createdAt });
  void runTriageAgent(ctx, threadId).catch(() => { /* logged in helper */ });
  publishInboxChanged(ctx, threadId, 'open');
  if (isAjax(req)) { res.setHeader('X-Inbox-Id', threadId); res.status(204).end(); return; }
  res.redirect(303, `/inbox/${encodeURIComponent(threadId)}`);
});

/** The notebook's sections alone, so its page can update as sua files things. */
// The data a notebook's widgets bind to (`/notebook/...`), the same shape for every notebook.
notebooksRouter.get('/notebooks/:id/data.json', (req: Request, res: Response) => {
  const s = store(req);
  const nb = s.get(String(req.params.id));
  if (!nb) { res.status(404).json({ error: 'No such notebook.' }); return; }
  res.json(notebookViewData(nb, s.entries(nb.id, 500), s));
});

// The shortlist as a spreadsheet; ?all=1 adds ruled-out options with why.
/** A notebook as a brief to share: one self-contained page (?download=1 saves it). */
notebooksRouter.get('/notebooks/:id/brief.html', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const s = store(req);
  const nb = s.get(String(req.params.id));
  if (!nb) { res.status(404).type('text/plain').send('No such notebook.'); return; }
  // ?full=1: the extended brief, each option in full after the summary.
  const full = req.query.full === '1';
  const entries = s.entries(nb.id, 1000);
  // Opened here, pictures load from the dashboard; a saved file carries its own.
  const download = req.query.download === '1';
  // ?latest=1: only the options the last run found for the first time.
  const latest = req.query.latest === '1';
  const page = renderNotebookBrief({ nb, entries, history: widgetHistory(ctx, s), ...(full ? { full: true } : {}), ...(latest ? { latest: true } : {}), ...(req.query.print === '1' && !download ? { print: true } : {}), ...(download ? { pictures: embeddedPictures(s, nb, entries) } : {}) });
  const name = `${nb.id.replace(/[^a-z0-9-]/gi, '').slice(0, 80) || 'notebook'}-brief${latest ? '-new' : ''}${full ? '-extended' : ''}.html`;
  res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', ...(req.query.download === '1' ? { 'Content-Disposition': `attachment; filename="${name}"` } : {}) }).send(page);
});

notebooksRouter.get('/notebooks/:id/shortlist.csv', (req: Request, res: Response) => {
  const s = store(req);
  const nb = s.get(String(req.params.id));
  if (!nb) { res.status(404).type('text/plain').send('No such notebook.'); return; }
  const options = notebookViewData(nb, s.entries(nb.id, 1000), s).notebook.options;
  // Which rows: ?rows=chosen|running|all (all=1 is the older spelling); else
  // the final set once you've decided, the ones in the running before.
  // ?ids=a,b,c keeps just those: the shortlist as you filtered it.
  // ?rows=new: the ones in the running the last run found for the first time.
  const asked = String(req.query.rows ?? (req.query.all === '1' ? 'all' : ''));
  const fresh = asked === 'new';
  const decidedSet = nb.status === 'decided' && options.some((o) => o.chosen && !o.ruledOut);
  const rows = asked === 'chosen' || asked === 'running' || asked === 'all' ? asked : fresh ? 'running' : decidedSet ? 'chosen' : 'running';
  const ids = fresh ? options.filter((o) => o.added === 'new').map((o) => o.id)
    : typeof req.query.ids === 'string' && req.query.ids ? req.query.ids.split(',').slice(0, 500) : undefined;
  const csv = notebookCsv(nb, options, { rows, ...(ids ? { ids } : {}) });
  const name = `${nb.id.replace(/[^a-z0-9-]/gi, '').slice(0, 80) || 'notebook'}-${fresh ? 'new' : ids ? 'selection' : rows === 'all' ? 'all' : rows === 'chosen' ? 'chosen' : 'shortlist'}.csv`;
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'private, no-store' }).send(csv);
});

notebooksRouter.get('/notebooks/:id/main', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const s = store(req);
  const nb = s.get(String(req.params.id));
  if (!nb) { res.status(404).end(); return; }
  const entries = s.entries(nb.id);
  const surface = SurfaceStore.fromHandle(ctx.runStore.databaseHandle()).current(`notebook:${nb.id}`);
  res.setHeader('X-Notebook-Entries', String(entries.length));
  // Changes that don't add an entry (a move, a ruling) still redraw the page.
  // Setup finishing also redraws (the note goes away).
  const settingUp = setupRunning(ctx, nb.id);
  res.setHeader('X-Notebook-Changed', `${(s.get(nb.id) ?? nb).updatedAt}${settingUp ? '+setup' : ''}`);
  // The talk box follows the notebook: its next-step hint and ghost text.
  const step = nextStep(s.get(nb.id) ?? nb, entries);
  res.setHeader('X-Notebook-Hint', encodeURIComponent(step.hint));
  res.setHeader('X-Notebook-Placeholder', encodeURIComponent(step.placeholder));
  // The header's steps (what runs, what waits on you): the page reloads when they change.
  res.setHeader('X-Notebook-Steps', stepsKey(ctx, s.get(nb.id) ?? nb));
  // What's live (waiting on you, sua replying, a step running): the page redraws its bar and Talk card when it changes.
  const running = pipelineRunning(ctx, nb.id);
  const live = notebookLive(ctx, s.get(nb.id) ?? nb, running ? { step: running.step, of: running.of } : undefined, []);
  res.setHeader('X-Notebook-Live', encodeURIComponent(notebookLiveKey(live)));
  res.setHeader('X-Notebook-Waiting', live.talk?.state === 'waiting' ? encodeURIComponent(live.talk.kind === 'step' ? `Your step: ${live.talk.text}` : live.talk.text) : '');
  res.type('html').send(renderNotebookMain(nb, compileSurface(surface.doc, notebookEntryItems(nb, entries)), entries, widgetHistory(ctx, s), settingUp));
});
