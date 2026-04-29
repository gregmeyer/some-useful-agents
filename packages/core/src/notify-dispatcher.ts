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
import { assertSafeUrl } from './builtin-tools.js';
import { resolveVarsTemplate } from './node-templates.js';

export type NotifyTrigger = 'failure' | 'success' | 'always';

export interface SlackHandlerConfig {
  type: 'slack';
  /** Name of the secret holding the Slack incoming webhook URL. */
  webhook_secret: string;
  channel?: string;
  mention?: string;
}

export interface FileHandlerConfig {
  type: 'file';
  /** Path relative to the working directory; absolute paths are allowed
   *  only if they resolve inside cwd. Path traversal is rejected. */
  path: string;
  /** When true (default), append. When false, overwrite each notify. */
  append?: boolean;
}

export interface WebhookHandlerConfig {
  type: 'webhook';
  url: string;
  method?: 'POST' | 'PUT';
  /** Name of the secret holding a Bearer token; injected as
   *  `Authorization: Bearer <secret>` if present. */
  headers_secret?: string;
}

export type NotifyHandlerConfig =
  | SlackHandlerConfig
  | FileHandlerConfig
  | WebhookHandlerConfig;

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

  // Resolve declared secrets up-front. If the store is locked / a secret
  // is missing, we still fire handlers that don't need it; broken handlers
  // log and continue. This matches the "never break the run" contract.
  const secrets: Record<string, string> = {};
  if (notify.secrets && notify.secrets.length > 0 && opts.secretsStore) {
    try {
      const all = await opts.secretsStore.getAll();
      for (const name of notify.secrets) {
        if (name in all) secrets[name] = all[name];
      }
    } catch (err) {
      logger.warn(`failed to read secrets: ${(err as Error).message}`);
    }
  }

  const vars = opts.variablesStore?.getAll() ?? {};

  const results = await Promise.all(
    notify.handlers.map(async (handler) => {
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

async function webhookHandler(handler: WebhookHandlerConfig, ctx: HandlerContext): Promise<void> {
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
