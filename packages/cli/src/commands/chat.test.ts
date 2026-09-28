/**
 * `sua agent chat` end to end against the built CLI. The agent is a shell
 * echo, so no model is involved: this pins the session mechanics (message →
 * chat input, turns recorded, --session continues, --list / --show), not the
 * conversation block, which only llm / goal nodes see (core sessions.test.ts).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AgentStore, SessionStore, parseAgent } from '@some-useful-agents/core';

const CLI = resolve(__dirname, '../../dist/index.js');

const ECHO_YAML = `id: echo-chat
name: Echo chat
status: active
source: local
version: 1
inputs:
  MESSAGE: { type: string, required: true }
nodes:
  - id: say
    type: shell
    command: echo "you said $MESSAGE"
`;

const NO_INPUT_YAML = `id: no-input
name: No input
status: active
source: local
version: 1
nodes:
  - id: say
    type: shell
    command: echo hi
`;

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

let dir: string;
const dbPath = () => join(dir, 'data', 'runs.db');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sua-chat-cli-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  writeFileSync(join(dir, 'sua.config.json'), JSON.stringify({ dataDir: './data', provider: 'local' }));
  const db = new DatabaseSync(dbPath());
  const store = AgentStore.fromHandle(db);
  store.upsertAgent(parseAgent(ECHO_YAML), 'import', 'seed');
  store.upsertAgent(parseAgent(NO_INPUT_YAML), 'import', 'seed');
  store.close();
  db.close();
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('sua agent chat', () => {
  it('sends a message, then continues the same conversation with --session', () => {
    const first = runCli(dir, ['agent', 'chat', 'echo-chat', '-m', 'hello there']);
    expect(first.status).toBe(0);
    expect(first.out).toContain('you said hello there');
    const sessionId = /session (\w+) —/.exec(first.out)?.[1];
    expect(sessionId).toBeTruthy();

    const second = runCli(dir, ['agent', 'chat', 'echo-chat', '--session', sessionId!, '-m', 'and again']);
    expect(second.out).toContain('you said and again');

    const sessions = new SessionStore(dbPath());
    expect(sessions.turns(sessionId!).map((t) => `${t.role}:${t.text}`)).toEqual([
      'user:hello there', 'agent:you said hello there', 'user:and again', 'agent:you said and again',
    ]);
    sessions.close();

    const list = runCli(dir, ['agent', 'chat', 'echo-chat', '--list']);
    expect(list.out).toContain(sessionId!);
    expect(list.out).toContain('4 turns');

    const show = runCli(dir, ['agent', 'chat', 'echo-chat', '--session', sessionId!, '--show']);
    expect(show.out).toContain('and again');
  });

  it('says why an agent can\'t take a message', () => {
    const res = runCli(dir, ['agent', 'chat', 'no-input', '-m', 'hi']);
    expect(res.status).toBe(1);
    expect(res.out).toContain('has no string input for the message');
  });

  it('refuses a session that belongs to another agent', () => {
    const sessions = new SessionStore(dbPath());
    const other = sessions.create('no-input', 'x');
    sessions.close();
    const res = runCli(dir, ['agent', 'chat', 'echo-chat', '--session', other.id, '-m', 'hi']);
    expect(res.status).toBe(1);
    expect(res.out).toContain(`No conversation ${other.id}`);
  });
});
