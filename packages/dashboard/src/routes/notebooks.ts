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
import { notebookOptionData, optionNeighbours, optionPage } from '../lib/notebook-option.js';
import { notebookWidgetData } from '../lib/notebook-widgets.js';
import { render } from '../views/html.js';
import { renderNotebookNew, renderDraftReview, renderSuggestionPills } from '../views/notebook-new.js';
import { notebookSuggestions } from '../lib/notebook-suggestions.js';
import { startNotebookDraft, readDraft, searchAgents } from '../lib/notebook-draft.js';
import {
  NotebookStore, SurfaceStore, notebookLineage, notebookCsv, shortName, compileSurface, notebookEntryItems, notebookViewData, notebookPhotoPath, validateScheduleInterval, markdownToText, rankOptions,
  type Notebook,
  type NotebookEntryKind,
} from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { parseFlash } from './inbox-shared.js';
import { renderNotebookPage, renderNotebooksList, formatFieldValue, type PipelineStage } from '../views/notebooks.js';
import { notebookCard } from '../lib/notebook-card.js';
import { startNotebookPipeline, pipelineRunning, startNotebookSetup, setupRunning, unfiledRuns, addingRun, addRunToNotebook } from '../lib/notebook-pipeline.js';
import { keepPhotos, startListingPhotos } from '../lib/notebook-photos.js';
import { optionIllustration, illustrationKind } from '../lib/notebook-illustrations.js';
import { notebookThread, greetNotebook, setThreadOptionFocus, optionNavIntent } from '../lib/notebook-chat.js';
import { startNotebookPictures } from '../lib/notebook-pictures.js';
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
  const sug = notebookSuggestions(getContext(req.app.locals));
  res.type('html').send(renderNotebookNew({ text: str(req.query.text).slice(0, 1000), suggestions: sug.items, refreshing: sug.refreshing, flash: parseFlash(req) }));
});

/** The pills, redrawn when a refresh finishes (notebook-new.js.ts). */
notebooksRouter.get('/notebooks/suggestions', (req: Request, res: Response) => {
  const sug = notebookSuggestions(getContext(req.app.locals));
  res.json({ refreshing: sug.refreshing, html: render(renderSuggestionPills(sug.items, sug.refreshing)) });
});

notebooksRouter.post('/notebooks/draft', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const from = str(req.body?.from) ? readDraft(ctx, str(req.body?.from)) : undefined;
  const out = startNotebookDraft(ctx, str(req.body?.text), from?.status === 'ready' ? { draft: from.draft, change: str(req.body?.change) } : undefined);
  if (typeof out !== 'string') { res.status(400).json({ error: out.error }); return; }
  res.status(202).json({ id: out });
});

notebooksRouter.get('/notebooks/draft/:id', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const d = readDraft(ctx, String(req.params.id));
  if (!d) { res.status(404).json({ status: 'gone', error: 'That draft has expired. Draft it again.' }); return; }
  if (d.status === 'working') { res.json({ status: 'working' }); return; }
  if (d.status === 'failed') { res.json({ status: 'failed', error: d.error }); return; }
  res.json({ status: 'ready', html: render(renderDraftReview(String(req.params.id), d.draft, searchAgents(ctx))) });
});

notebooksRouter.post('/notebooks', (req: Request, res: Response) => {
  try {
    const statement = str(req.body?.statement);
    const ctx0 = getContext(req.app.locals);
    const known = new Set(searchAgents(ctx0).map((a) => a.id));
    let cadence = str(req.body?.cadence).trim();
    if (cadence) { try { validateScheduleInterval(cadence, {}); } catch { cadence = ''; } }
    const nb = store(req).create({
      title: str(req.body?.title).trim() || titleFrom(statement),
      statement,
      params: many(req.body?.params),
      criteria: many(req.body?.criteria),
      pipeline: many(req.body?.pipeline).filter((id) => known.has(id)),
      cadence,
    });
    // From a draft: what to note, the stages and the checks are set already, so setup is skipped.
    const fields = many(req.body?.field).map((f) => { try { return JSON.parse(f) as unknown; } catch { return undefined; } }).filter(Boolean);
    if (fields.length) {
      const s0 = store(req);
      s0.setFields(nb.id, fields);
      const stages = many(req.body?.stages).flatMap((x) => x.split(/\s*(?:→|->|,)\s*/)).filter(Boolean);
      if (stages.length) s0.setStages(nb.id, stages);
      const checks = many(req.body?.checks);
      if (checks.length) s0.setChecks(nb.id, checks);
      s0.markSetup(nb.id);
    }
    // sua sets up what options record and the stages they go through, from the
    // goal, then says hello in the notebook's conversation with what it set up.
    const ctx = getContext(req.app.locals);
    const greet = () => {
      const now = store(req).get(nb.id);
      if (!now) return;
      const threadId = greetNotebook(ctx, nb.id);
      if (threadId) { publishInboxChanged(ctx, threadId, 'awaiting_user'); store(req).touch(nb.id); }
    };
    if (!startNotebookSetup(ctx, nb.id, { onDone: greet })) greet();
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
  const nb = s.get(String(req.params.id));
  if (!nb) { res.status(404).redirect(303, `/notebooks?flash=${encodeURIComponent('No such notebook.')}`); return; }
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
  const coverPhoto = s.coverPhoto(nb.id);
  res.type('html').send(renderNotebookPage({ nb, unfiled: unfiledRuns(ctx, nb).map((r) => ({ ...r, adding: addingRun(ctx, r.id) })), ...(coverPhoto ? { cover: { src: notebookPhotoPath(nb.id, coverPhoto.entryId), kind: coverPhoto.kind } } : {}), entries, compiled, history: widgetHistory(ctx, s), settingUp: setupRunning(ctx, nb.id), stages, running: running ? { step: running.step, of: running.of } : undefined, ...(lastWord ? { lastWord } : {}), flash: parseFlash(req) }));
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
notebooksRouter.get('/notebooks/:id/entries/:entry/photo', (req: Request, res: Response) => {
  const s = store(req);
  const photo = s.photo(String(req.params.entry));
  if (!photo) { res.status(404).end(); return; }
  // An illustration is drawn here, each time (so earlier drawings improve too).
  if (photo.kind === 'illustration') {
    const nb = s.get(String(req.params.id));
    const entry = nb ? s.entries(nb.id, 1000).find((e) => e.id === String(req.params.entry)) : undefined;
    if (nb && entry) {
      const name = shortName(entry.title);
      // A company's tile shows its own name's initials (the org field), not the option's title.
      const orgKey = nb.fields.find((f) => f.role === 'org')?.key;
      const org = orgKey && typeof entry.data?.[orgKey] === 'string' ? (entry.data[orgKey] as string) : undefined;
      const kind = illustrationKind(nb, name);
      const svg = optionIllustration({ kind, name: kind === 'job' && org ? org : name, seed: entry.id });
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
      // Drawn on every request (cheap), so the browser always asks: a better drawing shows at once.
      res.setHeader('Cache-Control', 'private, no-cache');
      res.end(svg);
      return;
    }
  }
  res.setHeader('Content-Type', photo.contentType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cache-Control', 'private, max-age=86400');
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
  res.type('html').send(renderNotebookOptionPage({ nb, entry, data, flash: parseFlash(req) }));
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

// Tick (or untick) one of the notebook's checks for an option.
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

notebooksRouter.post('/notebooks/:id/edit', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const cadence = str(req.body?.cadence).trim();
  try {
    if (cadence) validateScheduleInterval(cadence, {});
    const s = store(req);
    s.update(id, {
      title: str(req.body?.title), statement: str(req.body?.statement),
      params: lines(req.body?.params), pipeline: lines(req.body?.pipeline), cadence,
    });
    s.setCriteria(id, lines(req.body?.criteria));
    if (typeof req.body?.stages === 'string') s.setStages(id, lines(req.body.stages));
    res.redirect(303, back(id, 'Saved.'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.redirect(303, back(id, cadence && /cron|schedule|frequen/i.test(msg) ? `"${cadence}" isn't a schedule sua understands. Use five fields, e.g. 0 7 * * *.` : msg));
  }
});

notebooksRouter.post('/notebooks/:id/decide', (req: Request, res: Response) => {
  const id = String(req.params.id);
  try {
    store(req).decide(id, str(req.body?.decision));
    res.redirect(303, back(id, 'Decided. The notebook is closed; reopen it any time.'));
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

notebooksRouter.post('/notebooks/:id/run', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const out = startNotebookPipeline(getContext(req.app.locals), id);
  res.redirect(303, back(id, out.started ? 'Running the pipeline. New entries show up here as each agent finishes.' : out.reason ?? 'It could not start.'));
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
    const order = rankOptions(nb, notebookWidgetData(nb, entries, widgetHistory(ctx, s)).notebook.options);
    const to = sent && order.some((o) => o.id === sent) ? sent : optionNeighbours(order, fromOption)[step]?.id;
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
  const said = ctx.inboxStore.addResponse(threadId, 'user', option ? `About “${shortName(option.title)}”: ${text}` : text);
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
notebooksRouter.get('/notebooks/:id/shortlist.csv', (req: Request, res: Response) => {
  const s = store(req);
  const nb = s.get(String(req.params.id));
  if (!nb) { res.status(404).type('text/plain').send('No such notebook.'); return; }
  const all = req.query.all === '1';
  const csv = notebookCsv(nb, notebookViewData(nb, s.entries(nb.id, 1000), s).notebook.options, { ruledOut: all });
  const name = `${nb.id.replace(/[^a-z0-9-]/gi, '').slice(0, 80) || 'notebook'}-${all ? 'all' : 'shortlist'}.csv`;
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
  res.type('html').send(renderNotebookMain(nb, compileSurface(surface.doc, notebookEntryItems(nb, entries)), entries, widgetHistory(ctx, s), settingUp));
});
