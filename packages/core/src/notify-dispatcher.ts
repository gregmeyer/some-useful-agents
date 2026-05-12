/**
 * Notify dispatcher — fires user-declared handlers (slack / file / webhook)
 * after a DAG run commits its final state. Called from `dag-executor.ts`
 * with the finalised Run row in hand.
 *
 * Trigger conditions:
 *   - `on: ['failure']` — run.status === 'failed'
 *   - `on: ['success']` — run.status === 'completed'
 *   - `on: ['always']`  — any terminal status (also 'cancelled')
 *
 * Reliability:
 *   - Handlers run in parallel.
 *   - Handler exceptions are caught + logged; they NEVER bubble into the
 *     run path. A broken Slack webhook should not turn a successful run
 *     into a failed one.
 *
 * Secrets:
 *   - Secrets are env-var-only at the node level (see `node-env.ts`). Notify
 *     config doesn't see node env, so we resolve declared `notify.secrets:`
 *     against `secretsStore.getAll()` here, the same shape `node-env.ts`
 *     uses.
 *
 * Templating:
 *   - String fields (channel, path, url, mention) accept `{{vars.X}}`
 *     substitution via the global variables store. `{{upstream.X.result}}`
 *     is NOT supported — the dispatcher fires once per run, not per node,
 *     and binding it to a single upstream's output is ambiguous.
 */

import { resolve } from 'node:path';
import { appendFileSync, writeFileSync } from 'node:fs';
import type { Agent } from './agent-v2-types.js';
import type { Run } from './types.js';
import type { SecretsStore } from './secrets-store.js';
import type { VariablesStore } from './variables-store.js';
import type { IntegrationsStore, Integration } from './integrations-store.js';
import { assertSafeUrl } from './builtin-tools.js';
import { resolveVarsTemplate } from './node-templates.js';
import { refreshGoogleToken, sendGmail } from './oauth/google.js';

export type NotifyTrigger = 'failure' | 'success' | 'always';

/**
 * Each handler may set `integration: <id>` to reference a named
 * Slack/file/webhook entry from Settings → Integrations. When set, the
 * dispatcher resolves the integration row at fire time and merges its
 * config into the handler — inline fields on the handler still override
 * the integration's values, so users can customise per-agent without
 * editing the shared integration. The kind-specific required fields
 * (webhook_secret, path, url) become optional when `integration` is
 * present; if both are absent the schema rejects the YAML.
 */
export interface SlackHandlerConfig {
  type: 'slack';
  /** Reference to a saved slack integration (resolved at fire time). */
  integration?: string;
  /** Name of the secret holding the Slack incoming webhook URL. */
  webhook_secret?: string;
  channel?: string;
  mention?: string;
}

export interface FileHandlerConfig {
  type: 'file';
  /** Reference to a saved file integration. */
  integration?: string;
  /** Path relative to the working directory; absolute paths are allowed
   *  only if they resolve inside cwd. Path traversal is rejected. */
  path?: string;
  /** When true (default), append. When false, overwrite each notify. */
  append?: boolean;
}

export interface WebhookHandlerConfig {
  type: 'webhook';
  /** Reference to a saved webhook integration. */
  integration?: string;
  url?: string;
  method?: 'POST' | 'PUT';
  /** Name of the secret holding a Bearer token; injected as
   *  `Authorization: Bearer <secret>` if present. */
  headers_secret?: string;
}

/**
 * Gmail notify handler. Always uses a connected `gmail` integration —
 * OAuth credentials don't fit cleanly inline in YAML. The handler
 * carries the per-message fields (to / subject / body); the integration
 * provides the connected account + the refresh-token secret name.
 */
export interface GmailHandlerConfig {
  type: 'gmail';
  /** Required — id of a connected `gmail` integration. */
  integration: string;
  to: string;
  subject: string;
  body?: string;
}

export type NotifyHandlerConfig =
  | SlackHandlerConfig
  | FileHandlerConfig
  | WebhookHandlerConfig
  | GmailHandlerConfig;

export interface NotifyConfig {
  on: NotifyTrigger[];
  secrets?: string[];
  handlers: NotifyHandlerConfig[];
}

export interface NotifyLogger {
  warn(message: string): void;
}

const defaultLogger: NotifyLogger = {
  warn(msg) {
    // eslint-disable-next-line no-console
    console.warn(`[notify] ${msg}`);
  },
};

export interface DispatchNotifyOptions {
  agent: Agent;
  run: Run;
  secretsStore?: SecretsStore;
  variablesStore?: VariablesStore;
  /** Resolves named integrations referenced by `handlers[i].integration`. */
  integrationsStore?: IntegrationsStore;
  /** Project-cwd for the file handler's path-traversal guard. Defaults to process.cwd(). */
  cwd?: string;
  /** Optional URL prefix for dashboard run links inside Slack messages. */
  dashboardBaseUrl?: string;
  /** Injection point for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injection point for tests; defaults to console.warn. */
  logger?: NotifyLogger;
}

/**
 * Fire all handlers in `notify` whose trigger condition matches the run's
 * final status. Returns the count of handlers that ran successfully — useful
 * for tests; the dag-executor ignores it.
 *
 * Never throws; handler errors are caught and logged.
 */
export async function dispatchNotify(
  notify: NotifyConfig,
  opts: DispatchNotifyOptions,
): Promise<{ fired: number; succeeded: number }> {
  const logger = opts.logger ?? defaultLogger;
  if (!shouldFire(notify.on, opts.run.status)) {
    return { fired: 0, succeeded: 0 };
  }

  // Resolve handlers that reference a saved integration. Pulls config +
  // secret refs from the integration row; inline fields on the handler
  // override (so users can customise per-agent without editing the
  // shared integration). A missing or wrong-kind integration logs and
  // skips the handler — the contract says we never break the run.
  const resolvedHandlers: NotifyHandlerConfig[] = [];
  const integrationSecretNames = new Set<string>();
  for (const handler of notify.handlers) {
    if (!handler.integration) {
      resolvedHandlers.push(handler);
      continue;
    }
    if (!opts.integrationsStore) {
      logger.warn(`handler references integration "${handler.integration}" but no integrations store is wired; skipping.`);
      continue;
    }
    const row = opts.integrationsStore.getIntegration(handler.integration);
    if (!row) {
      logger.warn(`integration "${handler.integration}" not found; skipping handler.`);
      continue;
    }
    if (row.kind !== handler.type) {
      logger.warn(`integration "${handler.integration}" is kind="${row.kind}" but handler is type="${handler.type}"; skipping.`);
      continue;
    }
    resolvedHandlers.push(mergeIntegrationIntoHandler(handler, row));
    for (const s of row.secretRefs) integrationSecretNames.add(s);
  }

  // Resolve declared secrets up-front. Union: agent-declared
  // `notify.secrets` + every secret referenced by a resolved integration.
  // If the store is locked / a secret is missing, we still fire handlers
  // that don't need it; broken handlers log and continue.
  const secrets: Record<string, string> = {};
  const needed = new Set<string>([...(notify.secrets ?? []), ...integrationSecretNames]);
  if (needed.size > 0 && opts.secretsStore) {
    try {
      const all = await opts.secretsStore.getAll();
      for (const name of needed) {
        if (name in all) secrets[name] = all[name];
      }
    } catch (err) {
      logger.warn(`failed to read secrets: ${(err as Error).message}`);
    }
  }

  const vars = opts.variablesStore?.getAll() ?? {};

  const results = await Promise.all(
    resolvedHandlers.map(async (handler) => {
      try {
        await runHandler(handler, { ...opts, secrets, vars, logger });
        return true;
      } catch (err) {
        logger.warn(`handler ${handler.type} failed: ${(err as Error).message}`);
        return false;
      }
    }),
  );

  return {
    fired: results.length,
    succeeded: results.filter(Boolean).length,
  };
}

/**
 * Merge an integration row into a handler that referenced it. Inline
 * handler fields win — the integration provides defaults the user can
 * override. Returns a handler that no longer carries `integration` (it's
 * already resolved) so the downstream runHandler switch sees a normal
 * inline shape.
 */
function mergeIntegrationIntoHandler(
  handler: NotifyHandlerConfig,
  row: Integration,
): NotifyHandlerConfig {
  const c = row.config;
  // Gmail keeps the `integration` ref on the handler — the runner uses
  // it to look up the integration row again at send time (refresh
  // token secret name lives on the row, not on the handler).
  if (handler.type === 'gmail') {
    return handler;
  }
  if (handler.type === 'slack') {
    return {
      type: 'slack',
      webhook_secret: handler.webhook_secret ?? (typeof c.webhook_secret === 'string' ? c.webhook_secret : ''),
      ...((handler.channel ?? (typeof c.channel === 'string' ? c.channel : '')) ? { channel: handler.channel ?? (c.channel as string) } : {}),
      ...((handler.mention ?? (typeof c.mention === 'string' ? c.mention : '')) ? { mention: handler.mention ?? (c.mention as string) } : {}),
    };
  }
  if (handler.type === 'webhook') {
    return {
      type: 'webhook',
      url: handler.url ?? (typeof c.url === 'string' ? c.url : ''),
      method: handler.method ?? (c.method === 'PUT' ? 'PUT' : c.method === 'POST' ? 'POST' : undefined),
      ...((handler.headers_secret ?? (typeof c.headers_secret === 'string' ? c.headers_secret : '')) ? {
        headers_secret: handler.headers_secret ?? (c.headers_secret as string),
      } : {}),
    };
  }
  if (handler.type === 'file') {
    return {
      type: 'file',
      path: handler.path ?? (typeof c.path === 'string' ? c.path : ''),
      append: handler.append ?? (c.append !== false),
    };
  }
  return handler;
}

function shouldFire(triggers: NotifyTrigger[], status: Run['status']): boolean {
  if (triggers.includes('always')) return status !== 'pending' && status !== 'running';
  if (triggers.includes('failure') && status === 'failed') return true;
  if (triggers.includes('success') && status === 'completed') return true;
  return false;
}

interface HandlerContext extends DispatchNotifyOptions {
  secrets: Record<string, string>;
  vars: Record<string, string>;
  logger: NotifyLogger;
}

async function runHandler(handler: NotifyHandlerConfig, ctx: HandlerContext): Promise<void> {
  switch (handler.type) {
    case 'slack':
      return slackHandler(handler, ctx);
    case 'file':
      return fileHandler(handler, ctx);
    case 'webhook':
      return webhookHandler(handler, ctx);
    case 'gmail':
      return gmailHandler(handler, ctx);
    default: {
      const exhaustive: never = handler;
      throw new Error(`Unknown notify handler type: ${JSON.stringify(exhaustive)}`);
    }
  }
}

// ── Slack ──────────────────────────────────────────────────────────────

export function buildSlackBlocks(
  agent: Agent,
  run: Run,
  opts: { mention?: string; channel?: string; dashboardBaseUrl?: string },
): { text: string; blocks: unknown[]; channel?: string } {
  const statusEmoji =
    run.status === 'failed' ? ':x:' :
    run.status === 'completed' ? ':white_check_mark:' :
    run.status === 'cancelled' ? ':no_entry_sign:' :
    ':information_source:';
  const headline = `${statusEmoji} *${agent.name ?? agent.id}* — ${run.status}`;
  const errTail = run.error ? run.error.slice(-200) : '';
  const lines: string[] = [
    headline,
    `agent: \`${agent.id}\`  run: \`${run.id}\``,
  ];
  if (run.startedAt) lines.push(`started: ${run.startedAt}`);
  if (run.completedAt) lines.push(`completed: ${run.completedAt}`);
  if (errTail) lines.push(`error: \`${errTail}\``);
  if (opts.dashboardBaseUrl) {
    const base = opts.dashboardBaseUrl.replace(/\/$/, '');
    lines.push(`<${base}/runs/${encodeURIComponent(run.id)}|Open run in dashboard>`);
  }
  const text = (opts.mention ? `${opts.mention}\n` : '') + lines.join('\n');

  const blocks: unknown[] = [
    { type: 'section', text: { type: 'mrkdwn', text } },
  ];

  return {
    text: stripMarkdown(text),
    blocks,
    ...(opts.channel ? { channel: opts.channel } : {}),
  };
}

function stripMarkdown(text: string): string {
  return text.replace(/[*_`<>]/g, '');
}

async function slackHandler(handler: SlackHandlerConfig, ctx: HandlerContext): Promise<void> {
  // Post-resolution invariant: integration refs have been merged in by
  // dispatchNotify, so webhook_secret is always set here. If it isn't,
  // the YAML was wrong (schema should have caught it) or the integration
  // row was missing fields.
  if (!handler.webhook_secret) {
    throw new Error('slack handler missing webhook_secret (integration may be misconfigured).');
  }
  const url = ctx.secrets[handler.webhook_secret];
  if (!url) {
    throw new Error(`secret "${handler.webhook_secret}" not declared in notify.secrets or not present in store`);
  }
  await assertSafeUrl(url);

  const channel = handler.channel ? resolveVarsTemplate(handler.channel, ctx.vars) : undefined;
  const mention = handler.mention ? resolveVarsTemplate(handler.mention, ctx.vars) : undefined;

  const payload = buildSlackBlocks(ctx.agent, ctx.run, {
    channel,
    mention,
    dashboardBaseUrl: ctx.dashboardBaseUrl,
  });

  const fetchFn = ctx.fetchImpl ?? fetch;
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`slack webhook returned ${res.status}`);
  }
}

// ── File ───────────────────────────────────────────────────────────────

async function fileHandler(handler: FileHandlerConfig, ctx: HandlerContext): Promise<void> {
  if (!handler.path) {
    throw new Error('file handler missing path (integration may be misconfigured).');
  }
  const cwd = resolve(ctx.cwd ?? process.cwd());
  const rawPath = resolveVarsTemplate(handler.path, ctx.vars);
  const filePath = resolve(cwd, rawPath);
  if (!filePath.startsWith(cwd + '/') && filePath !== cwd) {
    throw new Error(`Path "${rawPath}" escapes the working directory.`);
  }
  const append = handler.append !== false;
  const line = JSON.stringify(notifyPayload(ctx.agent, ctx.run)) + '\n';
  if (append) {
    appendFileSync(filePath, line, 'utf-8');
  } else {
    writeFileSync(filePath, line, 'utf-8');
  }
}

// ── Webhook ────────────────────────────────────────────────────────────

// ── Gmail ──────────────────────────────────────────────────────────────

async function gmailHandler(handler: GmailHandlerConfig, ctx: HandlerContext): Promise<void> {
  if (!ctx.integrationsStore) {
    throw new Error('gmail handler needs an integrationsStore (none provided).');
  }
  const row = ctx.integrationsStore.getIntegration(handler.integration);
  if (!row) {
    throw new Error(`gmail integration "${handler.integration}" not found.`);
  }
  if (row.kind !== 'gmail') {
    throw new Error(`integration "${handler.integration}" is kind="${row.kind}" but handler is gmail.`);
  }
  const clientIdSecret = (row.config.client_id_secret as string | undefined) ?? 'GMAIL_CLIENT_ID';
  const clientSecretSecret = (row.config.client_secret_secret as string | undefined) ?? 'GMAIL_CLIENT_SECRET';
  const refreshTokenSecret = row.config.refresh_token_secret as string | undefined;
  if (!refreshTokenSecret) {
    throw new Error(`gmail integration "${handler.integration}" is not connected — visit Settings → Integrations and click Connect.`);
  }
  const clientId = ctx.secrets[clientIdSecret];
  const clientSecret = ctx.secrets[clientSecretSecret];
  const refreshToken = ctx.secrets[refreshTokenSecret];
  if (!clientId || !clientSecret || !refreshToken) {
    const missing = [
      !clientId && clientIdSecret,
      !clientSecret && clientSecretSecret,
      !refreshToken && refreshTokenSecret,
    ].filter(Boolean).join(', ');
    throw new Error(`gmail integration missing secrets in store: ${missing}`);
  }

  const fetchFn = ctx.fetchImpl ?? fetch;
  const tokens = await refreshGoogleToken({
    clientId,
    clientSecret,
    refreshToken,
    fetchImpl: fetchFn,
  });
  const to = resolveVarsTemplate(handler.to, ctx.vars);
  const subject = resolveVarsTemplate(handler.subject, ctx.vars);
  const body = handler.body ? resolveVarsTemplate(handler.body, ctx.vars) : defaultGmailBody(ctx.agent, ctx.run);
  await sendGmail({
    accessToken: tokens.access_token,
    to,
    subject,
    body,
    from: typeof row.config.connected_account === 'string' ? row.config.connected_account as string : undefined,
    fetchImpl: fetchFn,
  });
}

function defaultGmailBody(agent: Agent, run: Run): string {
  const lines = [
    `Agent: ${agent.id} (${agent.name})`,
    `Run: ${run.id}`,
    `Status: ${run.status}`,
    run.startedAt ? `Started: ${run.startedAt}` : '',
    run.completedAt ? `Completed: ${run.completedAt}` : '',
    run.error ? `\nError:\n${run.error.slice(0, 2000)}` : '',
  ].filter(Boolean);
  return lines.join('\n');
}

async function webhookHandler(handler: WebhookHandlerConfig, ctx: HandlerContext): Promise<void> {
  if (!handler.url) {
    throw new Error('webhook handler missing url (integration may be misconfigured).');
  }
  const url = resolveVarsTemplate(handler.url, ctx.vars);
  await assertSafeUrl(url);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (handler.headers_secret) {
    const token = ctx.secrets[handler.headers_secret];
    if (!token) {
      throw new Error(`secret "${handler.headers_secret}" not declared in notify.secrets or not present in store`);
    }
    headers['Authorization'] = `Bearer ${token}`;
  }
  const fetchFn = ctx.fetchImpl ?? fetch;
  const res = await fetchFn(url, {
    method: handler.method ?? 'POST',
    headers,
    body: JSON.stringify(notifyPayload(ctx.agent, ctx.run)),
  });
  if (!res.ok) {
    throw new Error(`webhook returned ${res.status}`);
  }
}

// ── Payload shape ──────────────────────────────────────────────────────

function notifyPayload(agent: Agent, run: Run): Record<string, unknown> {
  return {
    agent: agent.id,
    run_id: run.id,
    status: run.status,
    started_at: run.startedAt,
    completed_at: run.completedAt,
    ...(run.error ? { error: run.error } : {}),
    ...(run.result !== undefined ? { output: run.result } : {}),
  };
}
