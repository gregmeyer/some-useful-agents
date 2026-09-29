import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  WebhookStore,
  WebhookRateLimiter,
  WebhookInputError,
  WEBHOOK_MAX_INPUT_BYTES,
  verifyWebhookRequest,
  readJsonPath,
  webhookFilterMatches,
  mapWebhookInputs,
  type WebhookRequestData,
} from './webhooks.js';
import { parseAgent, exportAgent, AgentYamlParseError } from './agent-yaml.js';

let dir: string;
let store: WebhookStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sua-hooks-'));
  store = new WebhookStore(join(dir, 'runs.db'));
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const req = (body: unknown, headers: Record<string, string> = {}, query: Record<string, string> = {}): WebhookRequestData =>
  ({ body, text: JSON.stringify(body), headers, query });

describe('WebhookStore', () => {
  it('turns on with a secret, keeps it across off/on, rotates, records deliveries', () => {
    expect(store.get('a')).toBeUndefined();
    const on = store.enable('a');
    expect(on.token).toMatch(/^whk_[0-9a-f]{48}$/);
    store.disable('a');
    expect(store.get('a')!.enabled).toBe(false);
    expect(store.enable('a').token).toBe(on.token);
    const rotated = store.rotate('a')!;
    expect(rotated.token).not.toBe(on.token);
    expect(store.rotate('nobody')).toBeUndefined();
    store.recordDelivery('a', 'started', 'run-1');
    store.recordDelivery('a', 'ignored: x');
    expect(store.get('a')).toMatchObject({ deliveries: 2, lastStatus: 'ignored: x', lastRunId: 'run-1' });
  });
});

describe('verifyWebhookRequest', () => {
  const token = 'whk_secret';
  const raw = Buffer.from('{"a":1}');
  it('accepts the token as bearer, X-Sua-Token or ?token=, and rejects anything else', () => {
    expect(verifyWebhookRequest({ token, rawBody: raw, headers: { authorization: `Bearer ${token}` }, query: {} }).ok).toBe(true);
    expect(verifyWebhookRequest({ token, rawBody: raw, headers: { 'x-sua-token': token }, query: {} }).ok).toBe(true);
    expect(verifyWebhookRequest({ token, rawBody: raw, headers: {}, query: { token } }).ok).toBe(true);
    expect(verifyWebhookRequest({ token, rawBody: raw, headers: { authorization: 'Bearer nope' }, query: {} })).toEqual({ ok: false, reason: 'Bad token.' });
    expect(verifyWebhookRequest({ token, rawBody: raw, headers: {}, query: {} }).ok).toBe(false);
  });

  it('with signature: github, only a valid X-Hub-Signature-256 over the raw body counts', () => {
    const sig = `sha256=${createHmac('sha256', token).update(raw).digest('hex')}`;
    const config = { signature: 'github' as const };
    expect(verifyWebhookRequest({ token, config, rawBody: raw, headers: { 'x-hub-signature-256': sig }, query: {} }).ok).toBe(true);
    expect(verifyWebhookRequest({ token, config, rawBody: Buffer.from('{"a":2}'), headers: { 'x-hub-signature-256': sig }, query: {} }).ok).toBe(false);
    // A token alone isn't enough for a signed webhook.
    expect(verifyWebhookRequest({ token, config, rawBody: raw, headers: { authorization: `Bearer ${token}` }, query: {} }).ok).toBe(false);
  });
});

describe('mapping and filtering', () => {
  const body = { action: 'opened', issue: { title: 'Crash on save', labels: [{ name: 'bug' }], number: 42 } };
  it('reads JSON paths', () => {
    expect(readJsonPath(body, '$.issue.title')).toBe('Crash on save');
    expect(readJsonPath(body, '$.issue.labels[0].name')).toBe('bug');
    expect(readJsonPath(body, '$.nope.deeper')).toBeUndefined();
    expect(readJsonPath(body, '$')).toBe(body);
  });

  it('filters on when:', () => {
    expect(webhookFilterMatches({ when: { '$.action': 'opened' } }, req(body)).matches).toBe(true);
    const miss = webhookFilterMatches({ when: { '$.action': 'closed', 'header:x-github-event': 'issues' } }, req(body));
    expect(miss).toEqual({ matches: false, reason: '$.action is "opened", not "closed"' });
    expect(webhookFilterMatches(undefined, req(body)).matches).toBe(true);
  });

  it('maps inputs from paths, headers, query and same-name fields; only declared inputs', () => {
    const agent = {
      inputs: { TITLE: { type: 'string' as const }, NUMBER: { type: 'string' as const }, EVENT: { type: 'string' as const }, TOPIC: { type: 'string' as const }, WHOLE: { type: 'string' as const } },
      webhook: { inputs: { TITLE: '$.issue.title', NUMBER: '$.issue.number', EVENT: 'header:X-GitHub-Event', WHOLE: '$' } },
    };
    const out = mapWebhookInputs(agent, req({ ...body, TOPIC: 'owls', EXTRA: 'ignored' }, { 'x-github-event': 'issues' }));
    expect(out).toMatchObject({ TITLE: 'Crash on save', NUMBER: '42', EVENT: 'issues', TOPIC: 'owls' });
    expect(JSON.parse(out.WHOLE).issue.number).toBe(42);
    expect(out).not.toHaveProperty('EXTRA');
    expect(() => mapWebhookInputs({ inputs: {}, webhook: { inputs: { NOPE: '$.a' } } }, req({}))).toThrow(/doesn't declare/);
    expect(() => mapWebhookInputs({ inputs: { BIG: { type: 'string' } } }, req({ BIG: 'x'.repeat(WEBHOOK_MAX_INPUT_BYTES + 1) }))).toThrow(WebhookInputError);
  });

  it('rate-limits per agent per minute', () => {
    const limiter = new WebhookRateLimiter(2);
    expect([limiter.allow('a', 0), limiter.allow('a', 1), limiter.allow('a', 2), limiter.allow('b', 2), limiter.allow('a', 61_000)]).toEqual([true, true, false, true, true]);
  });

  it('parses and exports the webhook: block, and validates sources', () => {
    const yaml = `id: a\nname: A\ninputs:\n  TITLE: { type: string }\nwebhook:\n  inputs:\n    TITLE: $.issue.title\n  when:\n    $.action: opened\n  signature: github\nnodes:\n  - id: s\n    type: shell\n    command: echo hi\n`;
    const agent = parseAgent(yaml);
    expect(agent.webhook).toEqual({ inputs: { TITLE: '$.issue.title' }, when: { '$.action': 'opened' }, signature: 'github' });
    expect(parseAgent(exportAgent(agent)).webhook).toEqual(agent.webhook);
    expect(() => parseAgent(yaml.replace('$.issue.title', 'issue.title'))).toThrow(AgentYamlParseError);
  });
});
