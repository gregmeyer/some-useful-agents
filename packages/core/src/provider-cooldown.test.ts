import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnNodeReal } from './node-spawner.js';
import { retryAtFrom, noteProviderFailure, providerCooldown, withoutCoolingProviders, clearProviderCooldown, providerCooldowns } from './provider-cooldown.js';

const now = new Date(2026, 10, 18, 9, 0).getTime();

describe('when a failed provider can be tried again', () => {
  it('reads the reset time an error states', () => {
    expect(retryAtFrom('You’ve hit your usage limit. Upgrade to Pro … or try again at Nov 18th, 2026 12:28 PM.', now)).toBe(new Date(2026, 10, 18, 12, 28).getTime());
    expect(retryAtFrom('Rate limited, retry after 30 seconds', now)).toBe(now + 30_000);
    expect(retryAtFrom('try again in 20 minutes', now)).toBe(now + 20 * 60_000);
    // Past, too far off, or not said: nothing.
    expect(retryAtFrom('try again at Nov 17th, 2026 8:00 AM', now)).toBeUndefined();
    expect(retryAtFrom('try again in 900 hours', now)).toBeUndefined();
    expect(retryAtFrom('usage limit reached', now)).toBeUndefined();
  });

  it('a lasting failure cools the provider down (until the stated time, else the default); others do not', () => {
    expect(noteProviderFailure('codex', 'quota_exceeded', 'try again at Nov 18th, 2026 12:28 PM', now)?.until).toBe(new Date(2026, 10, 18, 12, 28).getTime());
    expect(noteProviderFailure('local-qwen-8b', 'binary_missing', 'Could not reach http://127.0.0.1:8181', now)?.until).toBe(now + 5 * 60_000);
    expect(noteProviderFailure('claude', 'invalid_output', '', now)).toBeUndefined();
    expect(noteProviderFailure('claude', 'timeout', '', now)).toBeUndefined();
    expect(providerCooldowns(now).map((c) => c.provider)).toEqual(['local-qwen-8b', 'codex']);
    // Over when it runs out, or when the provider works again.
    expect(providerCooldown('local-qwen-8b', now + 5 * 60_000)).toBeUndefined();
    clearProviderCooldown('codex');
    expect(providerCooldown('codex', now)).toBeUndefined();
  });

  it('the chain skips cooling providers, but never all of them', () => {
    noteProviderFailure('codex', 'quota_exceeded', '', now);
    noteProviderFailure('local-qwen-8b', 'binary_missing', '', now);
    const { chain, skipped } = withoutCoolingProviders(['codex', 'local-qwen-8b', 'claude'], now);
    expect(chain).toEqual(['claude']);
    expect(skipped.map((s) => s.provider)).toEqual(['codex', 'local-qwen-8b']);
    expect(withoutCoolingProviders(['codex', 'local-qwen-8b'], now)).toEqual({ chain: ['codex', 'local-qwen-8b'], skipped: [] });
  });
});

describe('through the waterfall: a provider out of quota is asked once, not on every node', () => {
  let binDir: string;
  const calls = () => (existsSync(join(binDir, 'codex-calls')) ? readFileSync(join(binDir, 'codex-calls'), 'utf8').split('\n').filter((l) => l.startsWith('exec')).length : 0);

  beforeAll(() => {
    binDir = mkdtempSync(join(tmpdir(), 'sua-fake-codex-quota-'));
    writeFileSync(join(binDir, 'codex'), [
      '#!/bin/sh',
      'cat >/dev/null',
      `echo "$1" >> "${join(binDir, 'codex-calls')}"`,
      `printf '%s\\n' '${JSON.stringify({ type: 'turn.failed', error: { message: 'You’ve hit your usage limit. Try again at Dec 1st, 2099 12:28 PM.' } })}'`,
      'exit 1',
    ].join('\n'));
    writeFileSync(join(binDir, 'claude'), ['#!/bin/sh', 'cat >/dev/null', 'echo \'{"type":"result","subtype":"success","result":"answered by claude"}\''].join('\n'));
    chmodSync(join(binDir, 'codex'), 0o755);
    chmodSync(join(binDir, 'claude'), 0o755);
  });
  afterAll(() => rmSync(binDir, { recursive: true, force: true }));

  const run = () => spawnNodeReal(
    { id: 'triage', type: 'llm-prompt', prompt: 'hi' },
    { PATH: `${binDir}:${process.env.PATH ?? ''}` },
    { agentId: 'a', agentSource: 'local', llmSettings: { providers: ['codex', 'claude'] } },
  );

  it('the second node goes straight to claude and says why codex was skipped', async () => {
    const first = await run();
    expect(first.result).toBe('answered by claude');
    expect(first.attemptedProviders).toEqual(['codex', 'claude']);
    expect(calls()).toBe(1);

    const second = await run();
    expect(second.result).toBe('answered by claude');
    expect(second.attemptedProviders).toEqual(['claude']);
    expect(calls()).toBe(1);
    expect(second.providerFailures).toEqual([expect.objectContaining({ provider: 'codex', category: 'quota_exceeded', error: expect.stringMatching(/^Skipped: it failed \(quota_exceeded\)/) })]);
  });
});
