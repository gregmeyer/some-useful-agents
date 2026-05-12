import { Router, type Request, type Response } from 'express';
import { looksLikeSensitive } from '@some-useful-agents/core';
import { html } from '../views/html.js';
import { renderSettingsShell } from '../views/settings-shell.js';
import { renderSettingsSecrets } from '../views/settings-secrets.js';
import { renderSettingsVariables } from '../views/settings-variables.js';
import { renderSettingsMcpServers } from '../views/settings-mcp-servers.js';
import { renderSettingsGeneral } from '../views/settings-general.js';
import { renderSettingsAppearance } from '../views/settings-appearance.js';
import { renderSettingsIntegrations } from '../views/settings-integrations.js';
import { getContext, type DashboardContext } from '../context.js';
import { SESSION_COOKIE } from '../auth-middleware.js';

export const settingsRouter: Router = Router();

const SECRET_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;
const VAR_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;

settingsRouter.get('/settings', (_req: Request, res: Response) => {
  res.redirect(303, '/settings/secrets');
});

settingsRouter.get('/settings/secrets', async (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const { flash, unlockError, setError } = readQueryBanners(req);

  const status = ctx.secretsSession.inspect();
  let isUnlocked = false;
  let names: string[] = [];
  let decryptError: string | undefined;
  try {
    isUnlocked = ctx.secretsSession.isUnlocked();
    names = isUnlocked ? await ctx.secretsSession.listNames() : [];
  } catch (err) {
    isUnlocked = false;
    decryptError = `Could not read secrets store: ${(err as Error).message}. Try unlocking with your passphrase, or run \`sua secrets migrate\` from the CLI.`;
  }
  const declared = collectDeclaredSecrets(ctx);
  const missing = [...declared].filter((n) => !names.includes(n)).sort();

  const body = renderSettingsSecrets({
    status,
    isUnlocked,
    names,
    missing,
    unlockError: unlockError || decryptError,
    setError,
    setNameValue: typeof req.query.name === 'string' ? req.query.name : undefined,
  });
  res.type('html').send(renderSettingsShell({ active: 'secrets', body, flash }));
});

settingsRouter.post('/settings/secrets/unlock', async (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const passphrase = typeof body.passphrase === 'string' ? body.passphrase : '';

  if (passphrase.length === 0) {
    redirectWith(res, '/settings/secrets', 'unlockError', 'Passphrase is required.');
    return;
  }

  const ok = await ctx.secretsSession.unlock(passphrase);
  if (!ok) {
    redirectWith(res, '/settings/secrets', 'unlockError', 'Wrong passphrase.');
    return;
  }
  redirectWith(res, '/settings/secrets', 'flash', 'Unlocked for this session.');
});

settingsRouter.post('/settings/secrets/lock', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  ctx.secretsSession.lock();
  redirectWith(res, '/settings/secrets', 'flash', 'Locked.');
});

settingsRouter.post('/settings/secrets/set', async (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const value = typeof body.value === 'string' ? body.value : '';

  if (!SECRET_NAME_RE.test(name)) {
    redirectWith(
      res,
      '/settings/secrets',
      'setError',
      `Invalid name "${name}". Must be uppercase letters, digits, or underscores (e.g. MY_API_KEY).`,
      { name },
    );
    return;
  }
  if (value.length === 0) {
    redirectWith(res, '/settings/secrets', 'setError', 'Value is required.', { name });
    return;
  }
  if (!ctx.secretsSession.isUnlocked()) {
    redirectWith(res, '/settings/secrets', 'setError', 'Store is locked. Unlock before writing.', { name });
    return;
  }

  try {
    await ctx.secretsSession.setSecret(name, value);
    redirectWith(res, '/settings/secrets', 'flash', `Saved ${name}.`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    redirectWith(res, '/settings/secrets', 'setError', `Save failed: ${msg}`, { name });
  }
});

settingsRouter.post('/settings/secrets/delete', async (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!SECRET_NAME_RE.test(name)) {
    redirectWith(res, '/settings/secrets', 'setError', `Invalid name "${name}".`);
    return;
  }
  if (!ctx.secretsSession.isUnlocked()) {
    redirectWith(res, '/settings/secrets', 'setError', 'Store is locked. Unlock before deleting.');
    return;
  }

  try {
    await ctx.secretsSession.deleteSecret(name);
    redirectWith(res, '/settings/secrets', 'flash', `Deleted ${name}.`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    redirectWith(res, '/settings/secrets', 'setError', `Delete failed: ${msg}`);
  }
});

// ── Variables ─────────────────────────────────────────────────────────────

settingsRouter.get('/settings/variables', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const { flash, setError } = readQueryBanners(req);

  if (!ctx.variablesStore) {
    const body = html`
      <div class="settings-empty">
        <h3 style="margin-top: 0;">Variables</h3>
        <p>No variables store configured.</p>
        <p class="dim">Start the dashboard with a <code>variablesPath</code> to enable global variables.</p>
      </div>
    `;
    res.type('html').send(renderSettingsShell({ active: 'variables', body, flash }));
    return;
  }

  const all = ctx.variablesStore.list();
  const variables = Object.entries(all).sort(([a], [b]) => a.localeCompare(b));

  const body = renderSettingsVariables({
    variables,
    setError,
    setNameValue: typeof req.query.name === 'string' ? req.query.name : undefined,
    setValueValue: typeof req.query.value === 'string' ? req.query.value : undefined,
    setDescriptionValue: typeof req.query.description === 'string' ? req.query.description : undefined,
  });
  res.type('html').send(renderSettingsShell({ active: 'variables', body, flash }));
});

settingsRouter.post('/settings/variables/set', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const value = typeof body.value === 'string' ? body.value : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';

  if (!ctx.variablesStore) {
    redirectWith(res, '/settings/variables', 'setError', 'Variables store not configured.');
    return;
  }

  if (!VAR_NAME_RE.test(name)) {
    redirectWith(
      res,
      '/settings/variables',
      'setError',
      `Invalid name "${name}". Must be uppercase letters, digits, or underscores (e.g. API_BASE_URL).`,
      { name, value, description },
    );
    return;
  }
  if (value.length === 0) {
    redirectWith(res, '/settings/variables', 'setError', 'Value is required.', { name, description });
    return;
  }

  // Warn (but don't refuse) if the name looks like it should be a secret.
  let flashMsg = `Saved ${name}.`;
  if (looksLikeSensitive(name)) {
    flashMsg += ` Note: "${name}" looks like it might be sensitive. Consider using Secrets instead.`;
  }

  try {
    ctx.variablesStore.set(name, value, description || undefined);
    redirectWith(res, '/settings/variables', 'flash', flashMsg);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    redirectWith(res, '/settings/variables', 'setError', `Save failed: ${msg}`, { name, value, description });
  }
});

settingsRouter.post('/settings/variables/delete', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const name = typeof body.name === 'string' ? body.name.trim() : '';

  if (!ctx.variablesStore) {
    redirectWith(res, '/settings/variables', 'setError', 'Variables store not configured.');
    return;
  }

  if (!VAR_NAME_RE.test(name)) {
    redirectWith(res, '/settings/variables', 'setError', `Invalid name "${name}".`);
    return;
  }

  try {
    const deleted = ctx.variablesStore.delete(name);
    if (deleted) {
      redirectWith(res, '/settings/variables', 'flash', `Deleted ${name}.`);
    } else {
      redirectWith(res, '/settings/variables', 'setError', `Variable "${name}" not found.`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    redirectWith(res, '/settings/variables', 'setError', `Delete failed: ${msg}`);
  }
});

settingsRouter.get('/settings/mcp-servers', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const { flash, setError } = readQueryBanners(req);
  if (!ctx.toolStore) {
    const body = html`
      <div class="settings-empty">
        <h3 style="margin-top: 0;">Tool store unavailable</h3>
        <p class="dim">MCP server management requires a tool store.</p>
      </div>
    `;
    res.type('html').send(renderSettingsShell({ active: 'mcp-servers', body, flash }));
    return;
  }
  const servers = ctx.toolStore.listMcpServers();
  const rows = servers.map((server) => ({
    server,
    toolCount: ctx.toolStore!.listToolsByServer(server.id).length,
  }));
  const body = renderSettingsMcpServers({ rows, setError });
  res.type('html').send(renderSettingsShell({ active: 'mcp-servers', body, flash }));
});

settingsRouter.post('/settings/mcp-servers/toggle', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  const action = typeof body.action === 'string' ? body.action : '';
  if (!ctx.toolStore) {
    redirectWith(res, '/settings/mcp-servers', 'setError', 'Tool store not configured.');
    return;
  }
  if (!id) {
    redirectWith(res, '/settings/mcp-servers', 'setError', 'Missing server id.');
    return;
  }
  const enabled = action === 'enable';
  const ok = ctx.toolStore.setMcpServerEnabled(id, enabled);
  if (!ok) {
    redirectWith(res, '/settings/mcp-servers', 'setError', `Server "${id}" not found.`);
    return;
  }
  redirectWith(res, '/settings/mcp-servers', 'flash', `${enabled ? 'Enabled' : 'Disabled'} ${id}.`);
});

settingsRouter.post('/settings/mcp-servers/delete', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!ctx.toolStore) {
    redirectWith(res, '/settings/mcp-servers', 'setError', 'Tool store not configured.');
    return;
  }
  if (!id) {
    redirectWith(res, '/settings/mcp-servers', 'setError', 'Missing server id.');
    return;
  }
  const { serverDeleted, toolsDeleted } = ctx.toolStore.deleteMcpServer(id);
  if (!serverDeleted) {
    redirectWith(res, '/settings/mcp-servers', 'setError', `Server "${id}" not found.`);
    return;
  }
  redirectWith(res, '/settings/mcp-servers', 'flash', `Deleted ${id} and ${toolsDeleted} tool${toolsDeleted === 1 ? '' : 's'}.`);
});

// ── Integrations ─────────────────────────────────────────────────────────
// Slug used in IDs. The store gates the full ID format (with `user:` prefix);
// this is just the user-typed portion so the prefix stays implementation-detail.
const INTEGRATION_SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/;
const INTEGRATION_SECRET_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;

const INTEGRATION_TABS = new Set(['all', 'slack', 'webhook', 'file', 'mcp-tool']);

settingsRouter.get('/settings/integrations', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const { flash } = readQueryBanners(req);
  if (!ctx.integrationsStore) {
    const body = html`<p class="settings-empty">Integrations store unavailable on this dashboard.</p>`;
    res.type('html').send(renderSettingsShell({ active: 'integrations', body, flash }));
    return;
  }

  // Inline error after a failed add is round-tripped via query string so the
  // user keeps their typed values without us needing a session/flash store.
  const errKind = typeof req.query.errKind === 'string' ? req.query.errKind : undefined;
  const errMsg = typeof req.query.errMsg === 'string' ? req.query.errMsg : undefined;
  const formValues = pickFormValuesFromQuery(req);
  const addError = errKind && errMsg ? { kind: errKind, message: errMsg, values: formValues } : undefined;

  // Tab is bookmarkable. Default to the kind that just errored (so the
  // user sees their preserved values on the right form) or to "all".
  const rawTab = typeof req.query.tab === 'string' ? req.query.tab : undefined;
  const activeTab = (rawTab && INTEGRATION_TABS.has(rawTab) ? rawTab : errKind && INTEGRATION_TABS.has(errKind) ? errKind : 'all') as
    'all' | 'slack' | 'webhook' | 'file' | 'mcp-tool';

  const integrations = ctx.integrationsStore.listIntegrations();

  // Pull MCP servers + their cached tools so the mcp-tool form can
  // populate the server/tool dropdowns without a live list call.
  // Cheap — both reads are direct SQLite scans we already do elsewhere.
  let mcpServers: Array<{ id: string; name: string }> = [];
  const mcpToolsByServer: Record<string, Array<{ name: string; description?: string }>> = {};
  if (ctx.toolStore) {
    try {
      mcpServers = ctx.toolStore.listMcpServers()
        .filter((s) => s.enabled)
        .map((s) => ({ id: s.id, name: s.name }));
      for (const s of mcpServers) {
        const tools = ctx.toolStore.listToolsByServer(s.id);
        mcpToolsByServer[s.id] = tools.map((t) => ({
          name: t.implementation.mcpToolName ?? t.id,
          description: t.description,
        }));
      }
    } catch { /* tools surface stays empty — form shows the empty hint */ }
  }

  const body = renderSettingsIntegrations({
    integrations, activeTab, addError, mcpServers, mcpToolsByServer,
  });
  res.type('html').send(renderSettingsShell({ active: 'integrations', body, flash }));
});

settingsRouter.post('/settings/integrations/add', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  if (!ctx.integrationsStore) {
    res.redirect(303, '/settings/integrations?error=Integrations+store+unavailable.');
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const kind = typeof body.kind === 'string' ? body.kind.trim() : '';
  const slug = typeof body.id === 'string' ? body.id.trim() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';

  const fail = (message: string): void => {
    const qs = new URLSearchParams({ errKind: kind, errMsg: message });
    for (const [k, v] of Object.entries(body)) {
      if (typeof v === 'string' && k !== 'errKind' && k !== 'errMsg') qs.append(`f_${k}`, v);
    }
    res.redirect(303, `/settings/integrations?${qs.toString()}`);
  };

  if (!INTEGRATION_SLUG_RE.test(slug)) return fail('ID must be lowercase letters/digits/dashes/underscores, starting with a letter or digit.');
  if (!name) return fail('Name is required.');

  let config: Record<string, unknown>;
  let secretRefs: string[];
  switch (kind) {
    case 'slack': {
      const webhookSecret = typeof body.webhook_secret === 'string' ? body.webhook_secret.trim() : '';
      if (!INTEGRATION_SECRET_NAME_RE.test(webhookSecret)) return fail('Webhook secret name must be UPPERCASE_WITH_UNDERSCORES.');
      const channel = typeof body.channel === 'string' ? body.channel.trim() : '';
      const mention = typeof body.mention === 'string' ? body.mention.trim() : '';
      config = {
        webhook_secret: webhookSecret,
        ...(channel ? { channel } : {}),
        ...(mention ? { mention } : {}),
      };
      secretRefs = [webhookSecret];
      break;
    }
    case 'webhook': {
      const url = typeof body.url === 'string' ? body.url.trim() : '';
      if (!/^https?:\/\//i.test(url)) return fail('URL must start with http:// or https://.');
      const method = body.method === 'PUT' ? 'PUT' : 'POST';
      const headersSecret = typeof body.headers_secret === 'string' ? body.headers_secret.trim() : '';
      if (headersSecret && !INTEGRATION_SECRET_NAME_RE.test(headersSecret)) return fail('Headers secret name must be UPPERCASE_WITH_UNDERSCORES.');
      config = {
        url,
        method,
        ...(headersSecret ? { headers_secret: headersSecret } : {}),
      };
      secretRefs = headersSecret ? [headersSecret] : [];
      break;
    }
    case 'file': {
      const path = typeof body.path === 'string' ? body.path.trim() : '';
      if (!path) return fail('Path is required.');
      const mode = body.mode === 'overwrite' ? 'overwrite' : 'append';
      config = { path, append: mode === 'append' };
      secretRefs = [];
      break;
    }
    case 'mcp-tool': {
      const serverId = typeof body.server_id === 'string' ? body.server_id.trim() : '';
      const toolName = typeof body.tool_name === 'string' ? body.tool_name.trim() : '';
      if (!serverId) return fail('Pick an MCP server (none selected).');
      if (!toolName) return fail('Pick a tool from the selected server.');
      // Validate the server exists + is enabled, and the tool name is one
      // we've cached for it. Catches typos + stale dropdown state.
      if (!ctx.toolStore) return fail('Tool store unavailable — can\'t validate the MCP target.');
      const server = ctx.toolStore.getMcpServer(serverId);
      if (!server || !server.enabled) return fail(`MCP server "${serverId}" is not enabled.`);
      const known = ctx.toolStore.listToolsByServer(serverId).some((t) =>
        (t.implementation.mcpToolName ?? t.id) === toolName,
      );
      if (!known) return fail(`Tool "${toolName}" is not imported under server "${serverId}". Import it via Settings → MCP Servers first.`);

      let defaultInputs: Record<string, unknown> = {};
      const rawInputs = typeof body.default_inputs === 'string' ? body.default_inputs.trim() : '';
      if (rawInputs) {
        try {
          const parsed = JSON.parse(rawInputs);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            defaultInputs = parsed as Record<string, unknown>;
          } else {
            return fail('default_inputs must be a JSON object (or omitted).');
          }
        } catch (err) {
          return fail(`default_inputs is not valid JSON: ${(err as Error).message}`);
        }
      }

      config = {
        server_id: serverId,
        tool_name: toolName,
        ...(Object.keys(defaultInputs).length > 0 ? { default_inputs: defaultInputs } : {}),
      };
      secretRefs = [];
      break;
    }
    default:
      return fail(`Unknown kind "${kind}".`);
  }

  const id = `user:${slug}`;
  if (ctx.integrationsStore.getIntegration(id)) return fail(`An integration with id "${id}" already exists.`);

  try {
    ctx.integrationsStore.upsertIntegration({ id, packId: null, kind, name, config, secretRefs });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
  res.redirect(303, `/settings/integrations?tab=${kind}&flash=${encodeURIComponent(`Added ${kind} integration "${id}".`)}`);
});

settingsRouter.post('/settings/integrations/delete', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  if (!ctx.integrationsStore) {
    res.redirect(303, '/settings/integrations?error=Integrations+store+unavailable.');
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!id) {
    res.redirect(303, '/settings/integrations?error=Missing+id.');
    return;
  }
  const existing = ctx.integrationsStore.getIntegration(id);
  if (existing?.packId) {
    res.redirect(303, '/settings/integrations?error=Pack-owned+integrations+can%27t+be+deleted+directly.');
    return;
  }
  const removed = ctx.integrationsStore.deleteIntegration(id);
  res.redirect(303, removed
    ? `/settings/integrations?flash=${encodeURIComponent(`Deleted integration "${id}".`)}`
    : '/settings/integrations?error=No+such+integration.');
});

function pickFormValuesFromQuery(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.query)) {
    if (typeof v === 'string' && k.startsWith('f_')) out[k.slice(2)] = v;
  }
  return out;
}

settingsRouter.get('/settings/appearance', (req: Request, res: Response) => {
  const { flash } = readQueryBanners(req);
  const body = renderSettingsAppearance();
  res.type('html').send(renderSettingsShell({ active: 'appearance', body, flash }));
});

settingsRouter.get('/settings/general', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const { flash } = readQueryBanners(req);
  const rotatedToken = typeof req.query.rotated === 'string' ? req.query.rotated : undefined;
  const body = renderSettingsGeneral({
    tokenFingerprint: ctx.token.slice(0, 8),
    tokenPath: ctx.tokenPath,
    secretsPath: ctx.secretsPath,
    dbPath: ctx.dbPath,
    retentionDays: ctx.retentionDays,
    rotatedToken,
  });
  res.type('html').send(renderSettingsShell({ active: 'general', body, flash }));
});

settingsRouter.post('/settings/general/rotate-mcp-token', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  // Rotating the file in-place invalidates every existing MCP client
  // cookie including the one we're serving the response with. Re-cookie
  // this browser at the same time so the operator doesn't get bounced
  // to /auth on their next click. The freshly rotated value is rendered
  // once on /settings/general — we never re-display it after that.
  let newToken: string;
  try {
    newToken = ctx.rotateToken();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    redirectWith(res, '/settings/general', 'flash', `Rotation failed: ${msg}`);
    return;
  }

  updateToken(ctx, newToken);
  res.cookie(SESSION_COOKIE, newToken, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
  });
  res.redirect(303, `/settings/general?rotated=${encodeURIComponent(newToken)}&flash=${encodeURIComponent('Rotated bearer token. Update any MCP clients to use the new value.')}`);
});

/**
 * Parse `?flash=` (success) and `?error=` / `?unlockError=` / `?setError=`
 * (failure) query params into render-ready structures.
 */
function readQueryBanners(req: Request): {
  flash?: { kind: 'error' | 'ok' | 'info'; message: string };
  unlockError?: string;
  setError?: string;
} {
  const flashVal = typeof req.query.flash === 'string' ? req.query.flash : undefined;
  const errorVal = typeof req.query.error === 'string' ? req.query.error : undefined;
  const unlockError = typeof req.query.unlockError === 'string' ? req.query.unlockError : undefined;
  const setError = typeof req.query.setError === 'string' ? req.query.setError : undefined;
  const flash = errorVal
    ? { kind: 'error' as const, message: errorVal }
    : flashVal
      ? { kind: 'ok' as const, message: flashVal }
      : undefined;
  return { flash, unlockError, setError };
}

/**
 * 303-redirect back to a settings page with a query-encoded banner. The
 * `extra` map lets callers preserve form field values (e.g. name= on a
 * failed /set) so the user doesn't retype them.
 */
function redirectWith(
  res: Response,
  path: string,
  kind: 'flash' | 'unlockError' | 'setError',
  message: string,
  extra: Record<string, string> = {},
): void {
  const params = new URLSearchParams();
  params.set(kind, message);
  for (const [k, v] of Object.entries(extra)) params.set(k, v);
  res.redirect(303, `${path}?${params.toString()}`);
}

function collectDeclaredSecrets(ctx: DashboardContext): Set<string> {
  const declared = new Set<string>();
  try {
    const { agents } = ctx.loadAgents();
    for (const [, a] of agents) {
      for (const s of a.secrets ?? []) declared.add(s);
    }
  } catch {
    // Broken YAML on disk shouldn't prevent the Settings page from rendering.
  }
  try {
    for (const agent of ctx.agentStore.listAgents()) {
      for (const node of agent.nodes) {
        for (const s of node.secrets ?? []) declared.add(s);
      }
    }
  } catch {
    // Same — tolerate a failing store read so Settings still renders.
  }
  return declared;
}

/** Mutate the live auth-check token in app.locals. Keeps the middleware
 *  in lockstep with the on-disk file after a rotation. */
function updateToken(ctx: DashboardContext, newToken: string): void {
  ctx.token = newToken;
}
