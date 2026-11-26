/**
 * `/skills`: read, write and change skills (docs/skills.md). Saved skills
 * live in the run database with versions (SkillStore); a shipped skill
 * changed here is saved as your copy, which agents use instead. Nothing is
 * saved that would leave an agent unable to run: every agent that lists a
 * skill keeps its skills under 16 KB together, and a skill an agent lists
 * can't be deleted.
 */
import { Router, type Request, type Response } from 'express';
import { buildSkillsPreamble, MAX_SKILLS_PREAMBLE_BYTES } from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { allSkills, agentSkillsBytes, overAgentLimit, safeAgents, skillFromForm, skillStore } from '../lib/skill-edit.js';
import { renderSkillDetail, renderSkillForm, renderSkillsList } from '../views/skills.js';

export const skillsRouter: Router = Router();

const param = (req: Request, k: string) => { const v = req.params[k]; return Array.isArray(v) ? v[0] : String(v ?? ''); };
const flashOf = (req: Request) => (typeof req.query.error === 'string' ? { kind: 'error' as const, message: req.query.error }
  : typeof req.query.flash === 'string' ? { kind: 'ok' as const, message: req.query.flash } : undefined);
const back = (res: Response, name: string, msg: string, kind: 'flash' | 'error' = 'flash') =>
  res.redirect(303, `/skills/${encodeURIComponent(name)}?${kind}=${encodeURIComponent(msg)}`);

skillsRouter.get('/skills', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const { rows, loaded } = allSkills(ctx);
  const flash = flashOf(req);
  res.type('html').send(renderSkillsList({ rows, problems: loaded.problems, ...(flash ? { flash } : {}) }));
});

skillsRouter.get('/skills/new', (_req: Request, res: Response) => {
  res.type('html').send(renderSkillForm({ mode: 'new', values: { name: '', description: '', body: '' } }));
});

skillsRouter.post('/skills/new', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const { values, problem } = skillFromForm(req.body as Record<string, unknown>);
  const { loaded } = allSkills(ctx);
  const store = skillStore(ctx);
  const error = problem
    ?? (loaded.byName.has(values.name) ? `There's already a skill called ${values.name}. Edit it instead, or pick another name.` : undefined)
    ?? (!store ? "Skills can't be saved here: the run database isn't open." : undefined);
  if (error) { res.status(400).type('html').send(renderSkillForm({ mode: 'new', values, error })); return; }
  store!.save(values, 'dashboard', 'Written in the dashboard');
  res.redirect(303, `/skills/${encodeURIComponent(values.name)}?flash=${encodeURIComponent(`Saved ${values.name}.`)}`);
});

skillsRouter.get('/skills/:name/edit', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const row = allSkills(ctx).rows.find((r) => r.skill.name === param(req, 'name'));
  if (!row) { res.redirect(303, '/skills'); return; }
  res.type('html').send(renderSkillForm({ mode: 'edit', values: row.skill, origin: row.origin }));
});

skillsRouter.post('/skills/:name/edit', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = param(req, 'name');
  const { rows, loaded } = allSkills(ctx);
  const row = rows.find((r) => r.skill.name === name);
  if (!row) { res.redirect(303, '/skills'); return; }
  const { values, problem } = skillFromForm(req.body as Record<string, unknown>, name);
  const store = skillStore(ctx);
  const error = problem ?? overAgentLimit(ctx, loaded, values) ?? (!store ? "Skills can't be saved here: the run database isn't open." : undefined);
  if (error) { res.status(400).type('html').send(renderSkillForm({ mode: 'edit', values, origin: row.origin, error: error.endsWith('.') ? error : `${error}.` })); return; }
  const message = typeof (req.body as { message?: unknown }).message === 'string' ? ((req.body as { message: string }).message).trim().slice(0, 120) : '';
  const was = row.skill.version;
  const version = store!.save(values, 'dashboard', message || (row.origin === 'shipped' ? "Your copy of sua's" : 'Edited in the dashboard'));
  back(res, name, version === was ? 'Nothing changed.' : row.origin === 'shipped' ? `Saved your copy of ${name}. Agents use it now.` : `Saved ${name} v${String(version)}.`);
});

skillsRouter.post('/skills/:name/restore', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = param(req, 'name');
  const store = skillStore(ctx);
  const version = Number((req.body as { version?: unknown }).version);
  const old = store?.listVersions(name).find((v) => v.version === version);
  if (!store || !old) { back(res, name, `There's no version ${String(version)} to restore.`, 'error'); return; }
  const over = overAgentLimit(ctx, allSkills(ctx).loaded, old);
  if (over) { back(res, name, `${over}.`, 'error'); return; }
  const now = store.rollback(name, version);
  back(res, name, `Restored v${String(version)} as v${String(now)}.`);
});

skillsRouter.post('/skills/:name/reset', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = param(req, 'name');
  const { rows, shipped } = allSkills(ctx);
  const row = rows.find((r) => r.skill.name === name);
  const store = skillStore(ctx);
  if (!row || row.origin !== 'your-copy' || !store) { back(res, name, 'Only your copy of a shipped skill can go back to sua\'s.', 'error'); return; }
  const over = overAgentLimit(ctx, shipped, shipped.byName.get(name)!);
  if (over) { back(res, name, `${over}.`, 'error'); return; }
  store.remove(name);
  back(res, name, `Agents use sua's ${name} again.`);
});

skillsRouter.post('/skills/:name/delete', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = param(req, 'name');
  const row = allSkills(ctx).rows.find((r) => r.skill.name === name);
  const store = skillStore(ctx);
  if (!row || row.origin !== 'yours' || !store) { back(res, name, "Only a skill you wrote can be deleted; a shipped one can't.", 'error'); return; }
  if (row.usedBy.length) { back(res, name, `Take it off ${row.usedBy.map((a) => a.id).join(', ')} first; they'd stop running without it.`, 'error'); return; }
  store.remove(name);
  res.redirect(303, `/skills?flash=${encodeURIComponent(`Deleted ${name}.`)}`);
});

skillsRouter.post('/skills/:name/agents', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = param(req, 'name');
  const agentId = String((req.body as { agentId?: unknown }).agentId ?? '');
  const { loaded } = allSkills(ctx);
  const agent = ctx.agentStore.getAgent(agentId);
  if (!loaded.byName.has(name) || !agent) { back(res, name, "That agent or skill isn't there.", 'error'); return; }
  if (agent.skills?.includes(name)) { back(res, name, `${agentId} already uses it.`); return; }
  const skills = [...(agent.skills ?? []), name];
  try { buildSkillsPreamble(skills, loaded); } catch {
    back(res, name, `${agentId}'s skills would be over ${String(MAX_SKILLS_PREAMBLE_BYTES / 1024)} KB together. Take one off it first, or make this one shorter.`, 'error');
    return;
  }
  ctx.agentStore.createNewVersion(agent.id, { ...agent, skills }, 'dashboard', `Uses the skill ${name}`);
  back(res, name, `${agentId} uses ${name} now (a new version of it).`);
});

skillsRouter.post('/skills/:name/agents/:agentId/remove', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = param(req, 'name');
  const agentId = param(req, 'agentId');
  const agent = ctx.agentStore.getAgent(agentId);
  if (!agent?.skills?.includes(name)) { back(res, name, `${agentId} doesn't use it.`); return; }
  const skills = agent.skills.filter((s) => s !== name);
  ctx.agentStore.createNewVersion(agent.id, { ...agent, skills: skills.length ? skills : undefined }, 'dashboard', `No longer uses the skill ${name}`);
  back(res, name, `Took ${name} off ${agentId} (a new version of it).`);
});

skillsRouter.get('/skills/:name', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = param(req, 'name');
  const { rows, loaded } = allSkills(ctx);
  const row = rows.find((r) => r.skill.name === name);
  if (!row) { res.redirect(303, '/skills'); return; }
  const versions = row.origin === 'shipped' ? [] : (skillStore(ctx)?.listVersions(name) ?? []);
  const others = safeAgents(ctx).filter((a) => !a.skills?.includes(name)).sort((x, y) => x.id.localeCompare(y.id))
    .map((a) => ({ id: a.id, name: a.name, bytes: agentSkillsBytes(loaded, a.skills ?? []) }));
  const flash = flashOf(req);
  res.type('html').send(renderSkillDetail({ row, versions, others, ...(flash ? { flash } : {}) }));
});
