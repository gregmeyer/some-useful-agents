/**
 * Inbound webhooks: something outside (GitHub, Stripe, Zapier, a script)
 * POSTs to `/hooks/<agent>` and the agent runs with inputs taken from the
 * request. See docs/webhooks.md and ADR-0043.
 *
 * Off by default. Turning a webhook on creates a per-agent secret; a request
 * must carry it (bearer token, `X-Sua-Token`, or `?token=`), or — with
 * `webhook.signature: github` — be signed with it (`X-Hub-Signature-256`).
 * The agent's optional `webhook:` block maps request fields to inputs and
 * filters which deliveries start a run.
 */
import { DatabaseSync } from 'node:sqlite';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { openStoreDb } from './sqlite-open.js';
import type { Agent } from './agent-v2-types.js';

export interface WebhookConfig {
  /** Input name → where to read it: `$.a.b[0]` (JSON body), `$` (whole body as JSON), `header:Name`, `query:name`. */
  inputs?: Record<string, string>;
  /** Only run when every path equals its value (e.g. `{ "$.action": "opened" }`); other deliveries are acknowledged and ignored. */
  when?: Record<string, string>;
  /** `github`: verify `X-Hub-Signature-256` (HMAC-SHA256 of the body with the webhook secret) instead of a token. */
  signature?: 'github';
}

export interface Webhook {
  agentId: string;
  token: string;
  enabled: boolean;
  createdAt: string;
  lastDeliveryAt?: string;
  lastStatus?: string;
  lastRunId?: string;
  deliveries: number;
}

/** Largest request body sua accepts on a webhook. */
export const WEBHOOK_MAX_BODY_BYTES = 1024 * 1024;
/** Largest single input value a webhook may set. */
export const WEBHOOK_MAX_INPUT_BYTES = 32 * 1024;
/** Deliveries per agent per minute before sua answers 429. */
export const WEBHOOK_RATE_PER_MINUTE = 30;

export class WebhookStore {
  private db: DatabaseSync;
  private readonly ownsConnection: boolean;

  constructor(dbPath: string) {
    this.db = openStoreDb(dbPath);
    this.ownsConnection = true;
    this.ensureSchema();
  }

  static fromHandle(db: DatabaseSync): WebhookStore {
    const store = Object.create(WebhookStore.prototype) as WebhookStore;
    (store as unknown as { db: DatabaseSync }).db = db;
    (store as unknown as { ownsConnection: boolean }).ownsConnection = false;
    store.ensureSchema();
    return store;
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS webhooks (
        agent_id TEXT PRIMARY KEY,
        token TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        last_delivery_at TEXT,
        last_status TEXT,
        last_run_id TEXT,
        deliveries INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  get(agentId: string): Webhook | undefined {
    const row = this.db.prepare('SELECT * FROM webhooks WHERE agent_id = ?').get(agentId) as Record<string, unknown> | undefined;
    return row ? toWebhook(row) : undefined;
  }

  /** Turn the webhook on, creating its secret the first time. */
  enable(agentId: string): Webhook {
    const existing = this.get(agentId);
    if (existing) {
      this.db.prepare('UPDATE webhooks SET enabled = 1 WHERE agent_id = ?').run(agentId);
    } else {
      this.db.prepare('INSERT INTO webhooks (agent_id, token, enabled, created_at) VALUES (?, ?, 1, ?)')
        .run(agentId, newWebhookToken(), new Date().toISOString());
    }
    return this.get(agentId)!;
  }

  disable(agentId: string): void {
    this.db.prepare('UPDATE webhooks SET enabled = 0 WHERE agent_id = ?').run(agentId);
  }

  /** A new secret; the old one stops working at once. */
  rotate(agentId: string): Webhook | undefined {
    if (!this.get(agentId)) return undefined;
    this.db.prepare('UPDATE webhooks SET token = ? WHERE agent_id = ?').run(newWebhookToken(), agentId);
    return this.get(agentId);
  }

  remove(agentId: string): void {
    this.db.prepare('DELETE FROM webhooks WHERE agent_id = ?').run(agentId);
  }

  recordDelivery(agentId: string, status: string, runId?: string): void {
    this.db.prepare(`
      UPDATE webhooks SET last_delivery_at = ?, last_status = ?, last_run_id = COALESCE(?, last_run_id), deliveries = deliveries + 1
      WHERE agent_id = ?
    `).run(new Date().toISOString(), status, runId ?? null, agentId);
  }

  close(): void {
    if (this.ownsConnection) this.db.close();
  }
}

function toWebhook(r: Record<string, unknown>): Webhook {
  return {
    agentId: String(r.agent_id),
    token: String(r.token),
    enabled: Number(r.enabled) === 1,
    createdAt: String(r.created_at),
    lastDeliveryAt: (r.last_delivery_at as string | null) ?? undefined,
    lastStatus: (r.last_status as string | null) ?? undefined,
    lastRunId: (r.last_run_id as string | null) ?? undefined,
    deliveries: Number(r.deliveries ?? 0),
  };
}

export function newWebhookToken(): string {
  return `whk_${randomBytes(24).toString('hex')}`;
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Is this request allowed to trigger the agent? With `signature: github`,
 * only a valid `X-Hub-Signature-256` over the raw body counts; otherwise the
 * secret must be presented as a bearer token, `X-Sua-Token`, or `?token=`.
 */
export function verifyWebhookRequest(args: {
  token: string;
  config?: WebhookConfig;
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
}): { ok: true } | { ok: false; reason: string } {
  const header = (name: string): string | undefined => {
    const v = args.headers[name.toLowerCase()];
    return Array.isArray(v) ? v[0] : v;
  };
  if (args.config?.signature === 'github') {
    const sig = header('x-hub-signature-256');
    if (!sig) return { ok: false, reason: 'Missing X-Hub-Signature-256 (this webhook expects GitHub-signed deliveries).' };
    const expected = `sha256=${createHmac('sha256', args.token).update(args.rawBody).digest('hex')}`;
    return safeEqual(sig, expected) ? { ok: true } : { ok: false, reason: 'Bad signature.' };
  }
  const auth = header('authorization');
  const presented = (auth?.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : undefined)
    ?? header('x-sua-token')
    ?? (typeof args.query.token === 'string' ? args.query.token : undefined);
  if (!presented) return { ok: false, reason: 'Missing token (send it as Authorization: Bearer, X-Sua-Token, or ?token=).' };
  return safeEqual(presented, args.token) ? { ok: true } : { ok: false, reason: 'Bad token.' };
}

/** `$.a.b[0].c` → the value, or undefined. `$` is the whole value. */
export function readJsonPath(root: unknown, path: string): unknown {
  if (path === '$') return root;
  if (!path.startsWith('$.') && !path.startsWith('$[')) return undefined;
  const parts = path.slice(1).match(/\.[^.[\]]+|\[\d+\]|\["[^"]+"\]/g) ?? [];
  let cur: unknown = root;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (part.startsWith('[')) {
      const key = part.startsWith('["') ? part.slice(2, -2) : Number(part.slice(1, -1));
      cur = (cur as Record<string | number, unknown>)[key];
    } else {
      cur = (cur as Record<string, unknown>)[part.slice(1)];
    }
  }
  return cur;
}

function asInputString(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  return typeof v === 'string' ? v : JSON.stringify(v);
}

export interface WebhookRequestData {
  /** Parsed JSON body (object/array), a form body as an object, or undefined. */
  body: unknown;
  /** The raw body as text, for `$` when the body isn't JSON. */
  text: string;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
}

function readSource(req: WebhookRequestData, source: string): unknown {
  if (source.startsWith('header:')) {
    const v = req.headers[source.slice(7).trim().toLowerCase()];
    return Array.isArray(v) ? v[0] : v;
  }
  if (source.startsWith('query:')) return req.query[source.slice(6).trim()];
  if (source === '$') return req.body !== undefined ? req.body : req.text;
  return readJsonPath(req.body, source);
}

/** Does the delivery pass the agent's `webhook.when` filter? */
export function webhookFilterMatches(config: WebhookConfig | undefined, req: WebhookRequestData): { matches: true } | { matches: false; reason: string } {
  for (const [source, expected] of Object.entries(config?.when ?? {})) {
    const actual = asInputString(readSource(req, source));
    if (actual !== expected) return { matches: false, reason: `${source} is ${actual === undefined ? 'missing' : JSON.stringify(actual)}, not ${JSON.stringify(expected)}` };
  }
  return { matches: true };
}

export class WebhookInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookInputError';
  }
}

/**
 * The run's inputs from a delivery: `webhook.inputs` mappings first; then,
 * for declared inputs without a mapping, a top-level body field of the same
 * name (so `{"TOPIC": "owls"}` just works). Only declared inputs are set.
 */
export function mapWebhookInputs(agent: Pick<Agent, 'inputs'> & { webhook?: WebhookConfig }, req: WebhookRequestData): Record<string, string> {
  const declared = agent.inputs ?? {};
  const out: Record<string, string> = {};
  for (const [name, source] of Object.entries(agent.webhook?.inputs ?? {})) {
    if (!(name in declared)) throw new WebhookInputError(`webhook.inputs maps "${name}", which the agent doesn't declare as an input.`);
    const value = asInputString(readSource(req, source));
    if (value !== undefined) out[name] = value;
  }
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    for (const name of Object.keys(declared)) {
      if (name in out) continue;
      const value = asInputString((req.body as Record<string, unknown>)[name]);
      if (value !== undefined) out[name] = value;
    }
  }
  for (const [name, value] of Object.entries(out)) {
    if (Buffer.byteLength(value) > WEBHOOK_MAX_INPUT_BYTES) {
      throw new WebhookInputError(`Input "${name}" is ${Buffer.byteLength(value)} bytes; a webhook input can be at most ${WEBHOOK_MAX_INPUT_BYTES / 1024} KB. Map a smaller part of the body.`);
    }
  }
  return out;
}

/** In-memory per-agent rate limiter (a sliding minute). */
export class WebhookRateLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly perMinute = WEBHOOK_RATE_PER_MINUTE) {}
  allow(agentId: string, now = Date.now()): boolean {
    const recent = (this.hits.get(agentId) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= this.perMinute) {
      this.hits.set(agentId, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(agentId, recent);
    return true;
  }
}
