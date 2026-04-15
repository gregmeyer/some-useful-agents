import { Router, type Request, type Response } from 'express';
import { html } from '../views/html.js';
import { renderSettingsShell } from '../views/settings-shell.js';

/**
 * Settings routes. This PR ships the shell + placeholder tab content;
 * /settings/secrets CRUD, passphrase modal, MCP token rotation, and
 * retention display arrive in PR 4 of v0.15.
 */
export const settingsRouter: Router = Router();

settingsRouter.get('/settings', (_req: Request, res: Response) => {
  res.redirect(303, '/settings/secrets');
});

settingsRouter.get('/settings/secrets', (_req: Request, res: Response) => {
  const body = html`
    <div class="card">
      <p class="card__title">Secrets</p>
      <p>Manage encrypted secrets referenced by agent nodes. Values are
        never rendered here.</p>
      <p class="dim">Coming in the next v0.15 PR: list declared secrets,
        set/delete from the UI, passphrase-gated flows for protected stores.</p>
    </div>
  `;
  res.type('html').send(renderSettingsShell({ active: 'secrets', body }));
});

settingsRouter.get('/settings/integrations', (_req: Request, res: Response) => {
  const body = html`
    <div class="settings-empty">
      <h3 style="margin-top: 0;">Integrations</h3>
      <p>Integrations are coming in v0.16.</p>
      <p class="dim">Today, external services are wired up through
        secrets (e.g. <code>SLACK_WEBHOOK</code>) referenced from agent nodes.
        Integrations will add a metadata layer on top so agents can
        reference named services instead of raw secret names.</p>
    </div>
  `;
  res.type('html').send(renderSettingsShell({ active: 'integrations', body }));
});

settingsRouter.get('/settings/general', (_req: Request, res: Response) => {
  const body = html`
    <div class="card">
      <p class="card__title">General</p>
      <p>Dashboard-wide settings.</p>
      <p class="dim">Coming in the next v0.15 PR: rotate the MCP bearer
        token, view retention policy, show the paths sua is reading
        config and data from.</p>
    </div>
  `;
  res.type('html').send(renderSettingsShell({ active: 'general', body }));
});
