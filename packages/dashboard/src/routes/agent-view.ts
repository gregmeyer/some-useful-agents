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

/**
 * The View editor (docs/a2ui-views.md): GET the page, POST `/preview` as you
 * type (checks the YAML and draws it with the last run), POST to save it as
 * a new version, POST `/remove` to go back to the output widget or text.
 */
export const agentViewRouter: Router = Router();

const param = (req: Request) => String(Array.isArray(req.params.name) ? req.params.name[0] : req.params.name);
const back = (agent: Agent, msg: string, kind: 'flash' | 'error' = 'flash') =>
  `/agents/${encodeURIComponent(agent.id)}/view?${kind}=${encodeURIComponent(msg)}`;
const staleMessage = (agent: Agent) =>
  `This agent changed since you opened the editor (it's on v${String(agent.version)} now). Reload to see it, then make your change again.`;

agentViewRouter.get('/agents/:name/view', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const agent = ctx.agentStore.getAgent(param(req));
  if (!agent) { res.redirect(303, '/agents'); return; }
  const sample = viewSample(agent, ctx.runStore);
  const starter = editorStarterView(agent, sample);
  const current = agent.view && 'components' in agent.view ? agent.view.components : starter;
  const flash = typeof req.query.flash === 'string' ? { kind: 'ok' as const, message: req.query.flash }
    : typeof req.query.error === 'string' ? { kind: 'error' as const, message: req.query.error } : undefined;
  res.type('html').send(renderViewEditorPage({
    agent,
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
