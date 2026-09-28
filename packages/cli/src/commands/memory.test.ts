/**
 * `sua memory` end to end: runs the built CLI in a temp project and checks it
 * against the memory store in that project's data dir.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { MemoryStore } from '@some-useful-agents/core';

const CLI = resolve(__dirname, '../../dist/index.js');

function runCli(cwd: string, args: string[]): { out: string; status: number } {
  try {
    const out = execFileSync(process.execPath, [CLI, ...args], {
      cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    });
    return { out, status: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { out: `${e.stdout ?? ''}${e.stderr ?? ''}`, status: e.status ?? 1 };
  }
}

let cwd: string;
let store: MemoryStore;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'sua-memory-cli-'));
  mkdirSync(join(cwd, 'data'), { recursive: true });
  store = new MemoryStore(join(cwd, 'data', 'runs.db'));
});
afterEach(() => {
  store.close();
  rmSync(cwd, { recursive: true, force: true });
});

describe('sua memory', () => {
  it('lists, searches, pins and forgets one agent\'s memories', () => {
    const a = store.save({ agentId: 'scout', text: 'Lisbon museum tickets cost 12 euros' });
    store.save({ agentId: 'scout', text: 'The user prefers short answers' });
    store.save({ agentId: 'other', text: 'Belongs to another agent' });

    const list = runCli(cwd, ['memory', 'list', 'scout']);
    expect(list.status).toBe(0);
    expect(list.out).toContain('Lisbon museum tickets');
    expect(list.out).not.toContain('another agent');

    const found = runCli(cwd, ['memory', 'search', 'scout', 'museum', 'tickets']);
    expect(found.out).toContain(a.id);
    expect(found.out).not.toContain('short answers');

    expect(runCli(cwd, ['memory', 'pin', 'scout', a.id]).status).toBe(0);
    expect(store.get('scout', a.id)!.pinned).toBe(true);

    expect(runCli(cwd, ['memory', 'forget', 'scout', a.id]).status).toBe(0);
    expect(store.get('scout', a.id)).toBeUndefined();
    expect(runCli(cwd, ['memory', 'forget', 'scout', a.id]).status).toBe(1);

    expect(runCli(cwd, ['memory', 'forget', 'scout', '--all']).out).toContain('Forgot 1 memories');
    expect(store.list('other')).toHaveLength(1);
  });

  it('needs an id or --all to forget', () => {
    expect(runCli(cwd, ['memory', 'forget', 'scout']).status).toBe(2);
  });
});
