import { Router, type Request, type Response } from 'express';
import {
  looksLikeSensitive,
  inferCsvSnapshot,
  inferPostgresSnapshot,
  closePostgresPool,
  inferSqliteSnapshot,
  closeSqliteDatabase,
  isAppleIntegrationEnabled,
  ensureAppleRunner,
  runAppleSubcommand,
  type AppleSnapshot,
  LLM_PROVIDERS,
  isProvider,
  type LlmProvider,
  getServiceStatus,
  spawnService,
  stopService,
} from '@some-useful-agents/core';
import { spawn } from 'node:child_process';
import { formatAge } from '../views/components.js';
import { html, type SafeHtml } from '../views/html.js';
import { renderSettingsUsage } from '../views/settings-usage.js';
import {
  unenforceableProviders,
  evaluatePolicy,
  loadPolicyDocument,
  policyFilePath,
  PolicyLoadError,
  PolicyConflictError,
  policyFileVersion,
  readPolicyFileText,
  savePolicyDocument,
  savePolicyText,
  hasPolicyBackup,
  restorePolicyBackup,
  type PolicyDocument,
  type PolicyRule,
} from '@some-useful-agents/core';
import { existsSync } from 'node:fs';
import { renderSettingsPolicies, type PolicyCheck, type PolicySource } from '../views/settings-policies.js';
import { listPickableTools } from '../views/tools-multipicker.js';
import { a2uiWidgetsEnabled, boardPagesEnabled, setDashboardPrefs } from '../lib/dashboard-prefs.js';
import { renderSettingsShell } from '../views/settings-shell.js';
import { renderSettingsSecrets } from '../views/settings-secrets.js';
import { renderSettingsVariables } from '../views/settings-variables.js';
import { renderSettingsMcpServers } from '../views/settings-mcp-servers.js';
import { renderSettingsGeneral } from '../views/settings-general.js';
import { renderSettingsAppearance } from '../views/settings-appearance.js';
import { renderSettingsIntegrations } from '../views/settings-integrations.js';
import { renderSettingsLlm, type ModelServerView } from '../views/settings-llm.js';
import { getContext, type DashboardContext } from '../context.js';
import { SESSION_COOKIE } from '../auth-middleware.js';
import {
  probeProvider,
  probeCustomProvider,
  invalidateProviderReadiness,
} from '../lib/provider-readiness.js';

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

/**
 * The Servers panel, rendered into the Tools page (ADR-0034). It lives here
 * next to the POST handlers that mutate it — those keep their `/settings/...`
 * paths because they are form targets, not navigable URLs, and rewriting them
 * would churn a dozen redirect strings for no user-visible gain.
 */
export function buildMcpServersPanel(
  ctx: ReturnType<typeof getContext>,
  setError?: string,
): { body: SafeHtml; count: number } {
  if (!ctx.toolStore) {
    return {
      count: 0,
      body: html`
        <div class="settings-empty">
          <h3 style="margin-top: 0;">Tool store unavailable</h3>
          <p class="dim">Managing MCP servers requires a tool store.</p>
        </div>
      `,
    };
  }
  const servers = ctx.toolStore.listMcpServers();
  const rows = servers.map((server) => ({
    server,
    toolCount: ctx.toolStore!.listToolsByServer(server.id).length,
  }));
  return { body: renderSettingsMcpServers({ rows, setError }), count: rows.length };
}

// Moved into Tools (ADR-0034). Kept as a redirect so old links, bookmarks and
// the docs that name this URL still land somewhere correct.
settingsRouter.get('/settings/mcp-servers', (req: Request, res: Response) => {
  const params = new URLSearchParams({ tab: 'servers' });
  for (const [k, v] of Object.entries(req.query)) {
    if (typeof v === 'string' && k !== 'tab') params.set(k, v);
  }
  res.redirect(302, `/tools?${params.toString()}`);
});

settingsRouter.post('/settings/mcp-servers/toggle', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  const action = typeof body.action === 'string' ? body.action : '';
  if (!ctx.toolStore) {
    redirectWith(res, '/tools?tab=servers', 'setError', 'Tool store not configured.');
    return;
  }
  if (!id) {
    redirectWith(res, '/tools?tab=servers', 'setError', 'Missing server id.');
    return;
  }
  const enabled = action === 'enable';
  const ok = ctx.toolStore.setMcpServerEnabled(id, enabled);
  if (!ok) {
    redirectWith(res, '/tools?tab=servers', 'setError', `Server "${id}" not found.`);
    return;
  }
  redirectWith(res, '/tools?tab=servers', 'flash', `${enabled ? 'Enabled' : 'Disabled'} ${id}.`);
});

settingsRouter.post('/settings/mcp-servers/delete', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!ctx.toolStore) {
    redirectWith(res, '/tools?tab=servers', 'setError', 'Tool store not configured.');
    return;
  }
  if (!id) {
    redirectWith(res, '/tools?tab=servers', 'setError', 'Missing server id.');
    return;
  }
  const { serverDeleted, toolsDeleted } = ctx.toolStore.deleteMcpServer(id);
  if (!serverDeleted) {
    redirectWith(res, '/tools?tab=servers', 'setError', `Server "${id}" not found.`);
    return;
  }
  redirectWith(res, '/tools?tab=servers', 'flash', `Deleted ${id} and ${toolsDeleted} tool${toolsDeleted === 1 ? '' : 's'}.`);
});

// ── Integrations ─────────────────────────────────────────────────────────
// Slug used in IDs. The store gates the full ID format (with `user:` prefix);
// this is just the user-typed portion so the prefix stays implementation-detail.
const INTEGRATION_SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/;
const INTEGRATION_SECRET_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;

const INTEGRATION_TABS = new Set(['all', 'slack', 'webhook', 'file', 'mcp-tool', 'csv', 'postgres', 'sqlite', 'apple']);

/** The Integrations panel, rendered into the Tools page (ADR-0034). */
export function buildIntegrationsPanel(
  ctx: ReturnType<typeof getContext>,
  req: Request,
): { body: SafeHtml; count: number } {
  if (!ctx.integrationsStore) {
    return {
      count: 0,
      body: html`<p class="settings-empty">Integrations store unavailable on this dashboard.</p>`,
    };
  }

  // Inline error after a failed add is round-tripped via query string so the
  // user keeps their typed values without us needing a session/flash store.
  const errKind = typeof req.query.errKind === 'string' ? req.query.errKind : undefined;
  const errMsg = typeof req.query.errMsg === 'string' ? req.query.errMsg : undefined;
  const formValues = pickFormValuesFromQuery(req);
  const addError = errKind && errMsg ? { kind: errKind, message: errMsg, values: formValues } : undefined;

  // The kind tab is bookmarkable. On /tools, `?tab=` names the Tools tab, so
  // the integration kind travels as `?kind=` — `?tab=` is still read as a
  // fallback so old bookmarks and the pre-move redirect keep working.
  const rawKind = typeof req.query.kind === 'string' ? req.query.kind : undefined;
  const rawTab = rawKind ?? (typeof req.query.tab === 'string' && req.query.tab !== 'integrations'
    ? req.query.tab
    : undefined);
  const activeTab = (rawTab && INTEGRATION_TABS.has(rawTab) ? rawTab : errKind && INTEGRATION_TABS.has(errKind) ? errKind : 'all') as
    'all' | 'slack' | 'webhook' | 'file' | 'mcp-tool' | 'csv' | 'postgres' | 'sqlite' | 'apple';

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

  const appleRem = typeof req.query.appleRem === 'string' ? req.query.appleRem : undefined;
  const appleNotes = typeof req.query.appleNotes === 'string' ? req.query.appleNotes : undefined;
  const appleAccess = appleRem || appleNotes ? { reminders: appleRem, notes: appleNotes } : undefined;

  const body = renderSettingsIntegrations({
    integrations, activeTab, addError, mcpServers, mcpToolsByServer,
    appleEnabled: isAppleIntegrationEnabled(),
    appleAccess,
  });
  return { body, count: integrations.length };
}

// Moved into Tools (ADR-0034). Preserves ?tab= so a deep link to a specific
// integration kind, and the error round-trip the add form relies on, survive.
settingsRouter.get('/settings/integrations', (req: Request, res: Response) => {
  const params = new URLSearchParams({ tab: 'integrations' });
  for (const [k, v] of Object.entries(req.query)) {
    if (typeof v === 'string' && k !== 'tab') params.set(k, v);
  }
  const kind = typeof req.query.tab === 'string' ? req.query.tab : undefined;
  if (kind) params.set('kind', kind);
  res.redirect(302, `/tools?${params.toString()}`);
});

settingsRouter.post('/settings/integrations/add', async (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  if (!ctx.integrationsStore) {
    res.redirect(303, '/tools?tab=integrations&error=Integrations+store+unavailable.');
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
    res.redirect(303, `/tools?tab=integrations&${qs.toString()}`);
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
    case 'csv': {
      const path = typeof body.path === 'string' ? body.path.trim() : '';
      if (!path) return fail('Path is required.');
      const hasHeader = body.has_header !== 'false';
      const delimiter = typeof body.delimiter === 'string' && body.delimiter.length === 1 ? body.delimiter : ',';
      let snapshot;
      try {
        snapshot = inferCsvSnapshot(path, { hasHeader, delimiter });
      } catch (err) {
        return fail(`Could not read CSV: ${(err as Error).message}`);
      }
      if (snapshot.columns.length === 0) {
        return fail('CSV is empty or has no columns.');
      }
      config = {
        path,
        has_header: hasHeader,
        delimiter,
        schema: snapshot,
      };
      secretRefs = [];
      break;
    }
    case 'postgres': {
      const urlSecret = typeof body.url_secret === 'string' ? body.url_secret.trim() : '';
      if (!INTEGRATION_SECRET_NAME_RE.test(urlSecret)) {
        return fail('url_secret must be UPPERCASE_WITH_UNDERSCORES.');
      }
      const schemasRaw = typeof body.schemas === 'string' ? body.schemas.trim() : 'public';
      const schemas = schemasRaw.split(',').map((s) => s.trim()).filter(Boolean);
      if (schemas.length === 0) return fail('At least one schema is required (e.g. "public").');
      // Pull the DSN from the secrets store + introspect. We use a
      // throwaway integration id for the pool key so the cached pool
      // doesn't leak into the real integration's namespace before save.
      let dsn: string | undefined;
      try {
        const all = await ctx.secretsStore.getAll();
        dsn = all[urlSecret];
      } catch (err) {
        return fail(`Could not read secrets store: ${(err as Error).message}`);
      }
      if (!dsn) {
        return fail(`Secret "${urlSecret}" is not set — add it via Settings → Secrets first.`);
      }
      const probeId = `__probe__:${slug}:${Date.now()}`;
      let snapshot;
      try {
        snapshot = await inferPostgresSnapshot({ integrationId: probeId, connectionString: dsn, schemas });
      } catch (err) {
        return fail(`Could not introspect Postgres: ${(err as Error).message}`);
      } finally {
        await closePostgresPool(probeId);
      }
      if (Object.keys(snapshot.tables).length === 0) {
        return fail(`No tables found in schemas: ${schemas.join(', ')}.`);
      }
      config = {
        url_secret: urlSecret,
        schemas,
        schema: snapshot,
      };
      secretRefs = [urlSecret];
      break;
    }
    case 'sqlite': {
      const path = typeof body.path === 'string' ? body.path.trim() : '';
      if (!path) return fail('Path is required.');
      // Open + introspect through a throwaway integration id so the cached
      // handle doesn't collide with the real integration's lifecycle.
      const probeId = `__probe__:${slug}:${Date.now()}`;
      let snapshot;
      try {
        snapshot = inferSqliteSnapshot({ integrationId: probeId, path, readonly: true });
      } catch (err) {
        return fail(`Could not open SQLite file: ${(err as Error).message}`);
      } finally {
        closeSqliteDatabase(probeId);
      }
      if (Object.keys(snapshot.tables).length === 0) {
        return fail('No tables found in this SQLite file (or every table name is unsafe to splice into SQL).');
      }
      config = { path, schema: snapshot };
      secretRefs = [];
      break;
    }
    case 'apple': {
      if (!isAppleIntegrationEnabled()) {
        return fail('The Apple integration is experimental and disabled. Enable it with experimental.apple in sua.config.json (or SUA_EXPERIMENTAL_APPLE=1) and restart.');
      }
      const handle = ensureAppleRunner();
      if (handle.status !== 'ready') {
        return fail(`Apple runner unavailable: ${handle.message ?? handle.status}`);
      }
      let snapshot: AppleSnapshot;
      try {
        const res = await runAppleSubcommand(handle.binaryPath, 'lists', {}, { timeoutSec: 120 });
        if (res.status !== 'ok') {
          return fail(`Could not read Reminders/Notes: ${res.errorMessage ?? res.status}. Run \`sua apple authorize\` in a Terminal first.`);
        }
        const data = (res.data ?? {}) as { reminder_lists?: { id: string; title: string }[]; note_folders?: { id: string; name: string }[] };
        snapshot = {
          reminderLists: Array.isArray(data.reminder_lists) ? data.reminder_lists : [],
          noteFolders: Array.isArray(data.note_folders) ? data.note_folders : [],
          introspectedAt: new Date().toISOString(),
        };
      } catch (err) {
        return fail(`Could not reach the Apple runner: ${(err as Error).message}`);
      }
      config = { schema: snapshot };
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
  res.redirect(303, `/tools?tab=integrations&kind=${kind}&flash=${encodeURIComponent(`Added ${kind} integration "${id}".`)}`);
});

// Probe the two macOS TCC buckets (Reminders, Notes/Automation) via the runner
// with zero-content reads, and report per-bucket status back on the Apple tab.
settingsRouter.post('/settings/integrations/apple/check', async (req: Request, res: Response) => {
  if (!isAppleIntegrationEnabled()) {
    res.redirect(303, '/tools?tab=integrations&kind=apple');
    return;
  }
  const handle = ensureAppleRunner();
  if (handle.status !== 'ready') {
    res.redirect(303, '/tools?tab=integrations&kind=apple&appleRem=unsupported&appleNotes=unsupported');
    return;
  }
  const probe = async (sub: string): Promise<string> => {
    try {
      const r = await runAppleSubcommand(handle.binaryPath, sub, { limit: 0 }, { timeoutSec: 120 });
      return r.status;
    } catch {
      return 'error';
    }
  };
  const reminders = await probe('reminder-read');
  const notes = await probe('note-read');
  res.redirect(303, `/tools?tab=integrations&kind=apple&appleRem=${encodeURIComponent(reminders)}&appleNotes=${encodeURIComponent(notes)}`);
});

// Open a real Terminal window running `sua apple authorize` so the macOS
// permission prompts appear in a foreground GUI session (a background daemon's
// prompt is silently denied). macOS-only; needs the one-time Automation grant
// to control Terminal the first time.
settingsRouter.post('/settings/integrations/apple/open-terminal', (req: Request, res: Response) => {
  if (!isAppleIntegrationEnabled()) {
    res.redirect(303, '/tools?tab=integrations&kind=apple');
    return;
  }
  if (process.platform !== 'darwin') {
    res.redirect(303, `/tools?tab=integrations&kind=apple&errKind=apple&errMsg=${encodeURIComponent('Opening Terminal is macOS-only.')}`);
    return;
  }
  const repo = process.cwd().replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const script = `tell application "Terminal"\nactivate\ndo script "cd \\"${repo}\\" && sua apple authorize"\nend tell`;
  try {
    const child = spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore' });
    child.unref();
    res.redirect(303, `/tools?tab=integrations&kind=apple&flash=${encodeURIComponent('Opened a Terminal running `sua apple authorize` — approve the macOS prompts there, then click “Check access”.')}`);
  } catch (err) {
    res.redirect(303, `/tools?tab=integrations&kind=apple&errKind=apple&errMsg=${encodeURIComponent(`Could not open Terminal: ${(err as Error).message}`)}`);
  }
});

settingsRouter.post('/settings/integrations/delete', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  if (!ctx.integrationsStore) {
    res.redirect(303, '/tools?tab=integrations&error=Integrations+store+unavailable.');
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!id) {
    res.redirect(303, '/tools?tab=integrations&error=Missing+id.');
    return;
  }
  const existing = ctx.integrationsStore.getIntegration(id);
  if (existing?.packId) {
    res.redirect(303, '/tools?tab=integrations&error=Pack-owned+integrations+can%27t+be+deleted+directly.');
    return;
  }
  const removed = ctx.integrationsStore.deleteIntegration(id);
  res.redirect(303, removed
    ? `/tools?tab=integrations&flash=${encodeURIComponent(`Deleted integration "${id}".`)}`
    : '/tools?tab=integrations&error=No+such+integration.');
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
  const body = renderSettingsAppearance({ a2uiWidgets: a2uiWidgetsEnabled(), boardPages: boardPagesEnabled() });
  res.type('html').send(renderSettingsShell({ active: 'appearance', body, flash }));
});

/** Settings → Appearance: A2UI renderer for widgets (default on; off = the previous renderer, kept one release). */
settingsRouter.post('/settings/appearance/a2ui', (req: Request, res: Response) => {
  const enabled = req.body?.enabled === '1';
  try {
    setDashboardPrefs({ a2uiWidgets: enabled });
    redirectWith(res, '/settings/appearance#a2ui-widgets', 'flash', enabled
      ? 'Widgets draw with the A2UI renderer.'
      : 'Widgets draw with the previous renderer. It will be removed in a future release, so please report what looked wrong.');
  } catch (err) {
    redirectWith(res, '/settings/appearance#a2ui-widgets', 'error', (err as Error).message);
  }
});

/** Settings → Appearance: Pulse and dashboards as boards (default on; off = the previous layout, kept one release). */
settingsRouter.post('/settings/appearance/boards', (req: Request, res: Response) => {
  const enabled = req.body?.enabled === '1';
  try {
    setDashboardPrefs({ boardPages: enabled });
    redirectWith(res, '/settings/appearance#board-pages', 'flash', enabled
      ? 'Pulse and dashboards show as boards.'
      : 'Pulse and dashboards use the previous layout. It will be removed in a future release, so please tell us what you missed.');
  } catch (err) {
    redirectWith(res, '/settings/appearance#board-pages', 'error', (err as Error).message);
  }
});

settingsRouter.get('/settings/usage', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const { flash } = readQueryBanners(req);
  const requested = Number(req.query.days);
  const days = [1, 7, 30].includes(requested) ? requested : 7;
  const summary = ctx.runStore.usageSummary(new Date(Date.now() - days * 86_400_000).toISOString());
  const settings = ctx.llmSettingsStore?.get();
  const error = typeof req.query.error === 'string' ? req.query.error : undefined;
  res.type('html').send(renderSettingsShell({
    active: 'usage',
    body: renderSettingsUsage({
      summary,
      days,
      limits: settings ? (settings.spendLimits ?? {}) : undefined,
      unenforceable: settings ? unenforceableProviders(settings) : [],
    }),
    flash: error ? { kind: 'error', message: error } : flash,
  }));
});

/**
 * Settings → Policies: the tool policy in force and a "would this be
 * allowed?" checker (GET with ?tool=&resource=&source=). Read-only; the rules
 * are edited in the file. Mirrors `sua policy show` / `sua policy check`.
 */
settingsRouter.get('/settings/policies', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const { flash } = readQueryBanners(req);
  const path = policyFilePath(ctx.dataDir);
  const exists = existsSync(path);
  let doc: PolicyDocument | undefined;
  let error: string | undefined;
  try { doc = loadPolicyDocument(ctx.dataDir); } catch (err) {
    error = err instanceof PolicyLoadError ? err.message : (err as Error).message;
  }

  let check: PolicyCheck | undefined;
  const tool = typeof req.query.tool === 'string' ? req.query.tool.trim().slice(0, 200) : '';
  if (tool) {
    const resource = typeof req.query.resource === 'string' ? req.query.resource.trim().slice(0, 2000) : '';
    const source: PolicySource = req.query.source === 'examples' || req.query.source === 'community' ? req.query.source : 'local';
    // An invalid file fails closed at run time; the checker says the same.
    const enforced = error
      ? { version: 1 as const, defaultAction: 'deny' as const, rules: [], invalidReason: `${error} Every tool call is blocked until it's fixed.` }
      : doc!;
    check = { tool, resource, source, decision: evaluatePolicy(enforced, { toolId: tool, resource, agentSource: source, agentId: 'settings-check' }) };
  }

  let toolIds: string[] = [];
  try {
    toolIds = listPickableTools({ toolStore: ctx.toolStore, agents: ctx.agentStore.listAgents(), currentAgentId: '' }).map((t) => t.id);
  } catch { /* stores unavailable: free text still works */ }

  res.type('html').send(renderSettingsShell({
    active: 'policies',
    body: renderSettingsPolicies({
      path, exists, doc, error, toolIds, check,
      version: policyFileVersion(ctx.dataDir),
      rawText: readPolicyFileText(ctx.dataDir),
      canUndo: hasPolicyBackup(ctx.dataDir),
      editing: req.query.edit === 'new' ? 'new'
        : typeof req.query.edit === 'string' && /^\d+$/.test(req.query.edit) ? Number(req.query.edit) : undefined,
    }),
    flash,
  }));
});

// ── Policy editing ────────────────────────────────────────────────────
// Each POST carries the file `version` it was rendered from; a save over a
// file that changed in between is refused (PolicyConflictError) rather than
// silently overwriting it. Invalid documents are never written.

/** Run an edit against the current (valid) document and save it. */
function editPolicy(
  req: Request,
  res: Response,
  change: (doc: PolicyDocument) => { doc: PolicyDocument; message: string; anchor?: string } | string,
): void {
  const ctx = getContext(req.app.locals);
  const version = typeof req.body?.version === 'string' ? req.body.version : undefined;
  let doc: PolicyDocument;
  try { doc = loadPolicyDocument(ctx.dataDir); } catch {
    redirectWith(res, '/settings/policies#json', 'error', 'The policy file is invalid. Fix it under Edit as JSON (or undo the last change) before editing rules.');
    return;
  }
  const out = change(structuredClone(doc));
  if (typeof out === 'string') { redirectWith(res, '/settings/policies#rules', 'error', out); return; }
  try {
    savePolicyDocument(ctx.dataDir, out.doc, { expectedVersion: version });
    redirectWith(res, `/settings/policies#${out.anchor ?? 'rules'}`, 'flash', `${out.message} It applies to the next tool call.`);
  } catch (err) {
    redirectWith(res, '/settings/policies#rules', 'error', (err as Error).message);
  }
}

function ruleIndex(req: Request, doc: PolicyDocument): number | undefined {
  const raw = Array.isArray(req.params.i) ? req.params.i[0] : req.params.i;
  const i = Number(raw);
  return Number.isInteger(i) && i >= 0 && i < doc.rules.length ? i : undefined;
}

settingsRouter.post('/settings/policies/default', (req: Request, res: Response) => {
  editPolicy(req, res, (doc) => {
    const action = req.body?.defaultAction;
    if (action !== 'allow' && action !== 'deny') return 'Choose allow or deny.';
    return { doc: { ...doc, defaultAction: action }, message: `When no rule matches, tool calls are now ${action === 'deny' ? 'denied' : 'allowed'}.` };
  });
});

/** Add (index empty) or replace a rule from the rule form. */
settingsRouter.post('/settings/policies/rules', (req: Request, res: Response) => {
  editPolicy(req, res, (doc) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const tool = typeof body.tool === 'string' ? body.tool.trim() : '';
    if (!tool) return 'A rule needs a tool (or * for any tool).';
    const effect = body.effect === 'allow' ? 'allow' : body.effect === 'deny' ? 'deny' : undefined;
    if (!effect) return 'Choose deny or allow.';
    const resources = (typeof body.resources === 'string' ? body.resources : '')
      .split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const picked = ([] as unknown[]).concat(body.source ?? []).filter((s): s is 'local' | 'examples' | 'community' =>
      s === 'local' || s === 'examples' || s === 'community');
    const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 300) : undefined;
    const rule: PolicyRule = {
      tool, action: 'execute', resources, effect,
      ...(picked.length > 0 && picked.length < 3 ? { conditions: { source: picked } } : {}),
      ...(reason ? { reason } : {}),
    };
    const index = typeof body.index === 'string' && body.index !== '' ? Number(body.index) : undefined;
    if (index === undefined) {
      doc.rules.push(rule);
      return { doc, message: `Added rule #${doc.rules.length - 1}.`, anchor: `rule-${doc.rules.length - 1}` };
    }
    if (!Number.isInteger(index) || index < 0 || index >= doc.rules.length) return 'That rule no longer exists. Reload and try again.';
    doc.rules[index] = rule;
    return { doc, message: `Saved rule #${index}.`, anchor: `rule-${index}` };
  });
});

settingsRouter.post('/settings/policies/rules/:i/move', (req: Request, res: Response) => {
  editPolicy(req, res, (doc) => {
    const i = ruleIndex(req, doc);
    const j = i === undefined ? undefined : req.body?.dir === 'up' ? i - 1 : i + 1;
    if (i === undefined || j === undefined || j < 0 || j >= doc.rules.length) return 'That rule can\'t move that way.';
    [doc.rules[i], doc.rules[j]] = [doc.rules[j], doc.rules[i]];
    return { doc, message: `Moved rule #${i} to #${j}.`, anchor: `rule-${j}` };
  });
});

settingsRouter.post('/settings/policies/rules/:i/delete', (req: Request, res: Response) => {
  editPolicy(req, res, (doc) => {
    const i = ruleIndex(req, doc);
    if (i === undefined) return 'That rule no longer exists. Reload and try again.';
    const [removed] = doc.rules.splice(i, 1);
    return { doc, message: `Deleted rule #${i} (${removed.effect} ${removed.tool}). Undo puts it back.` };
  });
});

/** The JSON editor: saved as written, only when it parses and validates. */
settingsRouter.post('/settings/policies/raw', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const text = typeof req.body?.text === 'string' ? req.body.text : '';
  const version = typeof req.body?.version === 'string' ? req.body.version : undefined;
  try {
    savePolicyText(ctx.dataDir, text, { expectedVersion: version });
    redirectWith(res, '/settings/policies', 'flash', 'Saved the policy file. It applies to the next tool call.');
  } catch (err) {
    redirectWith(res, '/settings/policies#json', 'error', (err as Error).message);
  }
});

settingsRouter.post('/settings/policies/undo', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const version = typeof req.body?.version === 'string' ? req.body.version : undefined;
  try {
    restorePolicyBackup(ctx.dataDir, { expectedVersion: version });
    redirectWith(res, '/settings/policies', 'flash', 'Put back the previous version of the policy file. Undo again to redo.');
  } catch (err) {
    redirectWith(res, '/settings/policies', 'error', err instanceof PolicyConflictError || err instanceof PolicyLoadError ? err.message : String(err));
  }
});

/** Save the default spend limits (USD) for agents without their own. */
settingsRouter.post('/settings/usage/limits', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  if (!ctx.llmSettingsStore) {
    redirectWith(res, '/settings/usage', 'error', 'LLM settings store not configured.');
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const read = (v: unknown): number | undefined => {
    if (typeof v !== 'string' || v.trim() === '') return undefined;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Error('A limit must be a positive number of USD, or empty for no limit.');
    return n;
  };
  try {
    ctx.llmSettingsStore.setSpendLimits({ perRunUsd: read(body.perRunUsd), perDayUsd: read(body.perDayUsd) });
    redirectWith(res, '/settings/usage#limits', 'flash', 'Saved the spend limits. They apply to runs that start from now on.');
  } catch (err) {
    redirectWith(res, '/settings/usage#limits', 'error', (err as Error).message);
  }
});

settingsRouter.get('/settings/llm', async (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const { flash } = readQueryBanners(req);
  const settings = ctx.llmSettingsStore?.get();
  const error = typeof req.query.error === 'string' ? req.query.error : undefined;
  const body = renderSettingsLlm({
    settings,
    providers: LLM_PROVIDERS,
    error,
    formatAge: (v) => formatAge(typeof v === 'number' ? new Date(v).toISOString() : v),
    modelServer: await readModelServer(ctx),
  });
  res.type('html').send(renderSettingsShell({ active: 'llm', body, flash }));
});

/**
 * The local model server card: configured command, process state, and — when
 * running — whether it answers yet. llama-server's /health is 503 while it
 * loads (or downloads) the model, which can take minutes on a first start.
 */
async function readModelServer(ctx: DashboardContext): Promise<ModelServerView> {
  const svc = ctx.modelService;
  if (!svc?.command) return { configured: false };
  const status = getServiceStatus(ctx.dataDir, 'model');
  let health: ModelServerView['health'];
  if (status.state === 'running' && svc.healthUrl) {
    try {
      const r = await fetch(svc.healthUrl, { signal: AbortSignal.timeout(1000) });
      health = r.ok ? 'ready' : r.status === 503 ? 'loading' : 'not-answering';
    } catch {
      health = 'not-answering';
    }
  }
  return { configured: true, command: [svc.command, ...(svc.args ?? [])].join(' '), status, health };
}

settingsRouter.post('/settings/llm/model/start', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  if (!ctx.modelService?.command) {
    redirectWith(res, '/settings/llm', 'error', 'No local model server is set up yet.');
    return;
  }
  try {
    const result = spawnService(ctx.dataDir, 'model', {
      suaBin: process.argv[1] ?? '',
      cwd: process.cwd(),
      env: process.env,
      commands: { model: ctx.modelService },
    });
    redirectWith(res, '/settings/llm', 'flash', `Model server starting (PID ${result.pid}). It can take a minute or two to load.`);
  } catch (err) {
    redirectWith(res, '/settings/llm', 'error', `Start failed: ${(err as Error).message}`);
  }
});

settingsRouter.post('/settings/llm/model/stop', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const result = stopService(ctx.dataDir, 'model');
  if (!result.signalled) {
    redirectWith(res, '/settings/llm', 'flash', 'Model server was not running.');
    return;
  }
  redirectWith(res, '/settings/llm', 'flash', `Stopped the model server (PID ${result.pid}).`);
});

/**
 * Add a provider to the END of the waterfall chain. No-op if the
 * provider is already present.
 */
settingsRouter.post('/settings/llm/add', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  if (!ctx.llmSettingsStore) {
    redirectWith(res, '/settings/llm', 'error', 'LLM settings store not configured.');
    return;
  }
  const providerRaw = typeof req.body?.provider === 'string' ? req.body.provider : '';
  // A waterfall entry is a builtin id OR the name of a defined custom provider.
  if (!isProvider(providerRaw) && !ctx.llmSettingsStore.getCustomProvider(providerRaw)) {
    redirectWith(res, '/settings/llm', 'error', `Invalid provider "${providerRaw}".`);
    return;
  }
  const current = ctx.llmSettingsStore.get().providers;
  if (current.includes(providerRaw)) {
    redirectWith(res, '/settings/llm', 'flash', `${providerRaw} is already in the chain.`);
    return;
  }
  try {
    ctx.llmSettingsStore.setProviders([...current, providerRaw]);
  } catch (err) {
    redirectWith(res, '/settings/llm', 'error', (err as Error).message);
    return;
  }
  redirectWith(res, '/settings/llm', 'flash', `Added ${providerRaw} to the chain.`);
});

/**
 * Remove a provider from the chain. Refuses when the chain would
 * become empty — every llm-prompt node needs at least one provider
 * to dispatch to.
 */
settingsRouter.post('/settings/llm/remove', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  if (!ctx.llmSettingsStore) {
    redirectWith(res, '/settings/llm', 'error', 'LLM settings store not configured.');
    return;
  }
  const providerRaw = typeof req.body?.provider === 'string' ? req.body.provider : '';
  const current = ctx.llmSettingsStore.get().providers;
  if (!current.includes(providerRaw as LlmProvider)) {
    redirectWith(res, '/settings/llm', 'error', `${providerRaw} is not in the chain.`);
    return;
  }
  const next = current.filter((p) => p !== providerRaw);
  if (next.length === 0) {
    redirectWith(res, '/settings/llm', 'error', 'Cannot remove the last provider — pick a replacement first.');
    return;
  }
  try {
    ctx.llmSettingsStore.setProviders(next);
  } catch (err) {
    redirectWith(res, '/settings/llm', 'error', (err as Error).message);
    return;
  }
  redirectWith(res, '/settings/llm', 'flash', `Removed ${providerRaw} from the chain.`);
});

/**
 * Move a provider up or down by one slot in the chain. The TOP slot is
 * the primary, so promoting an entry to position 0 makes it the
 * default provider for new runs.
 */
settingsRouter.post('/settings/llm/move', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  if (!ctx.llmSettingsStore) {
    redirectWith(res, '/settings/llm', 'error', 'LLM settings store not configured.');
    return;
  }
  const providerRaw = typeof req.body?.provider === 'string' ? req.body.provider : '';
  const direction = typeof req.body?.direction === 'string' ? req.body.direction : '';
  const current = ctx.llmSettingsStore.get().providers;
  const idx = current.indexOf(providerRaw as LlmProvider);
  if (idx < 0) {
    redirectWith(res, '/settings/llm', 'error', `${providerRaw} is not in the chain.`);
    return;
  }
  const delta = direction === 'up' ? -1 : direction === 'down' ? 1 : 0;
  if (delta === 0) {
    redirectWith(res, '/settings/llm', 'error', `Invalid direction "${direction}".`);
    return;
  }
  const target = idx + delta;
  if (target < 0 || target >= current.length) {
    // Already at the edge — nothing to do.
    redirectWith(res, '/settings/llm', 'flash', `${providerRaw} is already at the ${target < 0 ? 'top' : 'bottom'}.`);
    return;
  }
  const next = [...current];
  [next[idx], next[target]] = [next[target], next[idx]];
  try {
    ctx.llmSettingsStore.setProviders(next);
  } catch (err) {
    redirectWith(res, '/settings/llm', 'error', (err as Error).message);
    return;
  }
  redirectWith(res, '/settings/llm', 'flash', `Moved ${providerRaw} ${direction}.`);
});

/**
 * Toggle a waterfall provider on/off without removing it. Disabled providers
 * keep their slot + config but are skipped at runtime — the "turn claude/codex
 * off and run local-only" switch.
 */
settingsRouter.post('/settings/llm/toggle', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  if (!ctx.llmSettingsStore) {
    redirectWith(res, '/settings/llm', 'error', 'LLM settings store not configured.');
    return;
  }
  const provider = typeof req.body?.provider === 'string' ? req.body.provider : '';
  const enabled = req.body?.enabled === '1' || req.body?.enabled === 'true';
  try {
    ctx.llmSettingsStore.setProviderEnabled(provider, enabled);
  } catch (err) {
    redirectWith(res, '/settings/llm', 'error', (err as Error).message);
    return;
  }
  redirectWith(res, '/settings/llm', 'flash', `${enabled ? 'Enabled' : 'Disabled'} ${provider}.`);
});

// NOTE: defining a custom OpenAI-compatible provider used to live here as
// `POST /settings/llm/custom/add`. It now has exactly one home —
// `POST /connect-model/connect` — which derives the slug from the model id,
// probes the endpoint before writing, and promotes the result to the front of
// the chain. The old route saved without probing and left the endpoint OUT of
// the waterfall, so "saved" and "usable" were two different things. This page
// keeps the manage half: reorder, disable, remove.

/** Delete a custom provider (also strips it from the waterfall). */
settingsRouter.post('/settings/llm/custom/remove', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  if (!ctx.llmSettingsStore) {
    redirectWith(res, '/settings/llm', 'error', 'LLM settings store not configured.');
    return;
  }
  const name = typeof req.body?.name === 'string' ? req.body.name : '';
  try {
    ctx.llmSettingsStore.removeCustomProvider(name);
  } catch (err) {
    redirectWith(res, '/settings/llm', 'error', (err as Error).message);
    return;
  }
  invalidateProviderReadiness();
  redirectWith(res, '/settings/llm', 'flash', `Removed custom provider "${name}".`);
});

/**
 * Save or clear a price (USD per million tokens) for a provider or
 * provider/model. Used to estimate the cost of token-only providers.
 */
settingsRouter.post('/settings/llm/price', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  if (!ctx.llmSettingsStore) {
    redirectWith(res, '/settings/llm', 'error', 'LLM settings store not configured.');
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const key = typeof body.key === 'string' ? body.key.trim() : '';
  const num = (v: unknown): number | undefined => {
    if (typeof v !== 'string' || v.trim() === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  };
  try {
    if (body.clear === '1') {
      ctx.llmSettingsStore.setPrice(key, null);
      redirectWith(res, '/settings/llm#pricing', 'flash', `Cleared the price for ${key}.`);
      return;
    }
    const input = num(body.input);
    const output = num(body.output);
    if (input === undefined || output === undefined) throw new Error('Input and output prices are both required.');
    const cacheRead = num(body.cacheRead);
    ctx.llmSettingsStore.setPrice(key, {
      inputPerMTok: input,
      outputPerMTok: output,
      ...(cacheRead !== undefined ? { cacheReadPerMTok: cacheRead } : {}),
    });
    redirectWith(res, '/settings/llm#pricing', 'flash', `Saved the price for ${key}. It applies to runs from now on.`);
  } catch (err) {
    redirectWith(res, '/settings/llm#pricing', 'error', (err as Error).message);
  }
});

settingsRouter.post('/settings/llm/probe', async (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const settings = ctx.llmSettingsStore?.get();
  if (!settings) {
    redirectWith(res, '/settings/llm', 'error', 'LLM settings store not configured.');
    return;
  }
  const probe: Record<string, { ok: boolean; message: string }> = {};
  for (const p of LLM_PROVIDERS) {
    probe[p] = await probeProvider(p);
  }
  for (const c of settings.customProviders ?? []) {
    probe[c.name] = await probeCustomProvider(c);
  }
  // Stash the result on a per-request basis by piggybacking the shell
  // render (the simplest way without adding session state).
  const error = typeof req.query.error === 'string' ? req.query.error : undefined;
  const body = renderSettingsLlm({
    settings,
    providers: LLM_PROVIDERS,
    error,
    probe,
    formatAge: (v) => formatAge(typeof v === 'number' ? new Date(v).toISOString() : v),
  });
  res.type('html').send(renderSettingsShell({ active: 'llm', body }));
});

settingsRouter.post('/settings/llm/clear-last-fallback', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  if (ctx.llmSettingsStore) ctx.llmSettingsStore.clearLastFallback();
  redirectWith(res, '/settings/llm', 'flash', 'Cleared.');
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
  kind: 'flash' | 'unlockError' | 'setError' | 'error',
  message: string,
  extra: Record<string, string> = {},
): void {
  const params = new URLSearchParams();
  params.set(kind, message);
  for (const [k, v] of Object.entries(extra)) params.set(k, v);
  // Targets may already carry a query (e.g. `/tools?tab=servers` since the
  // panels moved out of Settings), so join with the right separator.
  const [base, hash] = path.split('#');
  const sep = base.includes('?') ? '&' : '?';
  res.redirect(303, `${base}${sep}${params.toString()}${hash ? `#${hash}` : ''}`);
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
