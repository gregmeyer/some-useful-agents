/** `sua agent webhook` end to end against the built CLI. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AgentStore, WebhookStore, parseAgent } from '@some-useful-agents/core';

const CLI = resolve(__dirname, '../../dist/index.js');
function runCli(cwd: string, args: string[]): { out: string; status: number } {
  try {
    const out = execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } });
    return { out, status: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { out: `${e.stdout ?? ''}${e.stderr ?? ''}`, status: e.status ?? 1 };
  }
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sua-webhook-cli-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  writeFileSync(join(dir, 'sua.config.json'), JSON.stringify({ dataDir: './data', provider: 'local' }));
  const db = new DatabaseSync(join(dir, 'data', 'runs.db'));
  const store = AgentStore.fromHandle(db);
  store.upsertAgent(parseAgent('id: hooked\nname: Hooked\nnodes:\n  - id: s\n    type: shell\n    command: echo hi\n'), 'import', 'seed');
  store.close();
  db.close();
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('sua agent webhook', () => {
  it('shows off, turns on with a URL and secret, rotates, and turns off', () => {
    expect(runCli(dir, ['agent', 'webhook', 'hooked']).out).toContain('off');
    const on = runCli(dir, ['agent', 'webhook', 'hooked', '--on']);
    expect(on.out).toMatch(/URL {5}POST http:\/\/.+\/hooks\/hooked/);
    const token = /Secret {2}(whk_[0-9a-f]+)/.exec(on.out)?.[1];
    expect(token).toBeTruthy();
    const rotated = runCli(dir, ['agent', 'webhook', 'hooked', '--rotate']).out;
    expect(rotated).not.toContain(token!);
    runCli(dir, ['agent', 'webhook', 'hooked', '--off']);
    const store = new WebhookStore(join(dir, 'data', 'runs.db'));
    expect(store.get('hooked')!.enabled).toBe(false);
    store.close();
    expect(runCli(dir, ['agent', 'webhook', 'nobody']).status).toBe(1);
  });
});
