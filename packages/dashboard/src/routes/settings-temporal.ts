import { Router, type Request, type Response } from 'express';
import { spawnService, stopService, getServiceStatus } from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { renderSettingsShell } from '../views/settings-shell.js';
import { renderSettingsTemporal } from '../views/settings-temporal.js';

/**
 * Routes for /settings/temporal: the run provider, Temporal connection, and the
 * worker (a daemon-managed host service that executes v2 DAG nodes). Worker
 * start/stop mirrors /settings/mcp — the dashboard is a local host process, so
 * it manages sibling daemon services the same way the CLI does.
 */
export const settingsTemporalRouter: Router = Router();

const DEFAULT_TEMPORAL = { address: 'localhost:7233', namespace: 'default', taskQueue: 'sua-agents' };
const TEMPORAL_UI_URL = 'http://localhost:8233';

settingsTemporalRouter.get('/settings/temporal', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const workerStatus = getServiceStatus(ctx.dataDir, 'worker');

  const errorParam = typeof req.query.error === 'string' ? req.query.error : undefined;
  const flashParam = typeof req.query.flash === 'string' ? req.query.flash : undefined;
  const flash = errorParam
    ? { kind: 'error' as const, message: errorParam }
    : flashParam
    ? { kind: 'ok' as const, message: flashParam }
    : undefined;

  const body = renderSettingsTemporal({
    providerName: ctx.provider.name,
    workerStatus,
    temporal: ctx.temporal ?? DEFAULT_TEMPORAL,
    temporalUiUrl: TEMPORAL_UI_URL,
  });
  res.type('html').send(renderSettingsShell({ active: 'temporal', body, flash }));
});

settingsTemporalRouter.post('/settings/temporal/worker/start', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const suaBin = process.argv[1];
  if (!suaBin) {
    res.redirect(303, `/settings/temporal?error=${encodeURIComponent('Cannot determine the sua binary path. Run `sua worker start` from the CLI.')}`);
    return;
  }
  try {
    const result = spawnService(ctx.dataDir, 'worker', {
      suaBin,
      cwd: process.cwd(),
      env: process.env,
    });
    res.redirect(303, `/settings/temporal?flash=${encodeURIComponent(`Worker started (PID ${result.pid}).`)}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.redirect(303, `/settings/temporal?error=${encodeURIComponent(`Start failed: ${msg}`)}`);
  }
});

settingsTemporalRouter.post('/settings/temporal/worker/stop', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  try {
    const result = stopService(ctx.dataDir, 'worker');
    if (!result.signalled && result.pid === undefined) {
      res.redirect(303, `/settings/temporal?flash=${encodeURIComponent('Worker was not running.')}`);
      return;
    }
    res.redirect(303, `/settings/temporal?flash=${encodeURIComponent(`Stopped worker (PID ${result.pid}).`)}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.redirect(303, `/settings/temporal?error=${encodeURIComponent(`Stop failed: ${msg}`)}`);
  }
});
