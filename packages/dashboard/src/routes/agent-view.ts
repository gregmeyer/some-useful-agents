import { Router, type Request, type Response } from 'express';
import type { Agent } from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { render } from '../views/html.js';
import { renderViewEditorPage } from '../views/agent-view-editor.js';
import {
  bindablePaths,
  editorStarterView,
  parseViewText,
  renderViewPreview,
  viewSample,
  viewToYaml,
} from '../lib/view-editor.js';
import { discardViewProposal, readViewProposal, startViewProposal, type ViewProposal } from '../lib/view-designer.js';

/**
 * The View editor (docs/a2ui-views.md): GET the page, POST `/preview` as you
 * type (checks the YAML and draws it with the last run), POST to save it as
 * a new version, POST `/remove` to go back to the output widget or text.
 * Redesign: POST `/redesign` asks sua's view designer for a proposal, which
 * the page shows beside the current view (`/proposal.json` while it works),
 * then `/proposal/use` saves it or `/proposal/discard` drops it.
 */
export const agentViewRouter: Router = Router();

const param = (req: Request) => String(Array.isArray(req.params.name) ? req.params.name[0] : req.params.name);
const back = (agent: Agent, msg: string, kind: 'flash' | 'error' = 'flash') =>
  `/agents/${encodeURIComponent(agent.id)}/view?${kind}=${encodeURIComponent(msg)}`;
const staleMessage = (agent: Agent) =>
  `This agent changed since you opened the editor (it's on v${String(agent.version)} now). Reload to see it, then make your change again.`;

/** The agent's proposal; a "working" one whose run died with a restart reads as failed. */
function currentProposal(ctx: ReturnType<typeof getContext>, agent: Agent): ViewProposal | undefined {
  const p = readViewProposal(ctx.dataDir, agent.id);
  if (p?.status === 'working' && !ctx.viewDesignerRunning?.has(agent.id)) {
    return { status: 'failed', request: p.request, at: p.at, baseVersion: p.baseVersion, error: 'The redesign stopped (the dashboard restarted). Try again.' };
  }
  return p;
}

agentViewRouter.get('/agents/:name/view', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const agent = ctx.agentStore.getAgent(param(req));
  if (!agent) { res.redirect(303, '/agents'); return; }
  const sample = viewSample(agent, ctx.runStore);
  const starter = editorStarterView(agent, sample);
  const current = agent.view && 'components' in agent.view ? agent.view.components : starter;
  const flash = typeof req.query.flash === 'string' ? { kind: 'ok' as const, message: req.query.flash }
    : typeof req.query.error === 'string' ? { kind: 'error' as const, message: req.query.error } : undefined;
  const proposal = currentProposal(ctx, agent);
  res.type('html').send(renderViewEditorPage({
    agent,
    ...(proposal ? { proposal: {
      ...proposal,
      ...(proposal.status === 'ready' ? {
        text: viewToYaml(proposal.components),
        preview: renderViewPreview(agent, proposal.components, sample, 'view-proposed'),
        currentPreview: renderViewPreview(agent, current, sample, 'view-now'),
      } : {}),
    } } : {}),
    redesignFocus: req.query.redesign === '1',
    text: viewToYaml(current),
    starterText: viewToYaml(starter),
    preview: renderViewPreview(agent, current, sample),
    errors: [],
    paths: bindablePaths(sample),
    ...(sample?.run.completedAt ? { sampleAt: sample.run.completedAt } : {}),
    ...(flash ? { flash } : {}),
  }));
});

agentViewRouter.post('/agents/:name/view/preview', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const agent = ctx.agentStore.getAgent(param(req));
  if (!agent) { res.status(404).json({ errors: ['No such agent.'] }); return; }
  const text = typeof req.body?.text === 'string' ? req.body.text : '';
  const parsed = parseViewText(text, agent.permissions?.imgSrc ?? []);
  if ('errors' in parsed) { res.json({ ok: false, errors: parsed.errors }); return; }
  res.json({ ok: true, errors: [], html: render(renderViewPreview(agent, parsed.components, viewSample(agent, ctx.runStore))) });
});

agentViewRouter.post('/agents/:name/view', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const agent = ctx.agentStore.getAgent(param(req));
  if (!agent) { res.redirect(303, '/agents'); return; }
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (Number(body.baseVersion) !== agent.version) { res.redirect(303, back(agent, staleMessage(agent), 'error')); return; }
  const parsed = parseViewText(typeof body.text === 'string' ? body.text : '', agent.permissions?.imgSrc ?? []);
  if ('errors' in parsed) { res.redirect(303, back(agent, `Not saved. ${parsed.errors.slice(0, 3).join(' ')}`, 'error')); return; }
  try {
    const saved = ctx.agentStore.createNewVersion(agent.id, { ...agent, view: { components: parsed.components } }, 'dashboard', 'Edited the view');
    res.redirect(303, back(agent, `Saved as v${String(saved.version)}. Runs show with this view now.`));
  } catch (err) {
    res.redirect(303, back(agent, `Save failed: ${err instanceof Error ? err.message : String(err)}`, 'error'));
  }
});

agentViewRouter.post('/agents/:name/view/remove', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const agent = ctx.agentStore.getAgent(param(req));
  if (!agent) { res.redirect(303, '/agents'); return; }
  if (Number((req.body ?? {}).baseVersion) !== agent.version) { res.redirect(303, back(agent, staleMessage(agent), 'error')); return; }
  if (!agent.view) { res.redirect(303, back(agent, 'It has no view to remove.')); return; }
  try {
    const saved = ctx.agentStore.createNewVersion(agent.id, { ...agent, view: undefined }, 'dashboard', 'Removed the view');
    res.redirect(303, back(agent, `Removed the view (v${String(saved.version)}). Runs show with ${agent.outputWidget ? 'its output widget' : 'plain text'} again.`));
  } catch (err) {
    res.redirect(303, back(agent, `Remove failed: ${err instanceof Error ? err.message : String(err)}`, 'error'));
  }
});

agentViewRouter.post('/agents/:name/view/redesign', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const agent = ctx.agentStore.getAgent(param(req));
  if (!agent) { res.redirect(303, '/agents'); return; }
  const request = typeof req.body?.request === 'string' ? req.body.request : '';
  const started = startViewProposal(ctx, agent, request);
  res.redirect(303, `${back(agent, started ? 'sua is redesigning the view. This takes a minute or two; you can leave and come back.' : 'sua is already redesigning this view, or the view designer isn\'t available.', started ? 'flash' : 'error')}#redesign`);
});

agentViewRouter.get('/agents/:name/view/proposal.json', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const agent = ctx.agentStore.getAgent(param(req));
  if (!agent) { res.status(404).json({ error: 'No such agent.' }); return; }
  const p = currentProposal(ctx, agent);
  res.json(p ? { status: p.status } : { status: 'none' });
});

agentViewRouter.post('/agents/:name/view/proposal/use', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const agent = ctx.agentStore.getAgent(param(req));
  if (!agent) { res.redirect(303, '/agents'); return; }
  const p = readViewProposal(ctx.dataDir, agent.id);
  if (!p || p.status !== 'ready') { res.redirect(303, back(agent, 'There\'s no proposal to use.', 'error')); return; }
  if (Number((req.body ?? {}).baseVersion) !== agent.version) { res.redirect(303, back(agent, staleMessage(agent), 'error')); return; }
  try {
    const saved = ctx.agentStore.createNewVersion(agent.id, { ...agent, view: { components: p.components } }, 'dashboard', `Used sua's redesigned view${p.request ? `: ${p.request}` : ''}`.slice(0, 200));
    discardViewProposal(ctx.dataDir, agent.id);
    res.redirect(303, back(agent, `Saved sua's view as v${String(saved.version)}. Roll back from Versions to undo.`));
  } catch (err) {
    res.redirect(303, back(agent, `Save failed: ${err instanceof Error ? err.message : String(err)}`, 'error'));
  }
});

agentViewRouter.post('/agents/:name/view/proposal/discard', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const agent = ctx.agentStore.getAgent(param(req));
  if (!agent) { res.redirect(303, '/agents'); return; }
  if (!ctx.viewDesignerRunning?.has(agent.id)) discardViewProposal(ctx.dataDir, agent.id);
  res.redirect(303, back(agent, 'Discarded sua\'s proposal.'));
});
