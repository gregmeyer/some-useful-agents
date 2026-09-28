import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunStore } from './run-store.js';
import {
  SessionStore,
  resolveChatInput,
  formatConversationBlock,
  prepareAgentTurn,
  runAgentTurn,
  reconcileSession,
  NotConversationalError,
  SessionNotFoundError,
  ChatMessageError,
  CONVERSATION_BLOCK_MAX_BYTES,
  CONVERSATION_TURN_MAX_CHARS,
  type SessionTurn,
} from './sessions.js';
import type { Agent, AgentNode } from './agent-v2-types.js';
import type { DagExecutorDeps } from './dag-executor.js';

let dir: string;
let runStore: RunStore;
let sessions: SessionStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sua-sessions-'));
  runStore = new RunStore(join(dir, 'runs.db'));
  sessions = SessionStore.fromHandle(runStore.databaseHandle());
});
afterEach(() => {
  runStore.close();
  rmSync(dir, { recursive: true, force: true });
});

const chatAgent = (overrides: Partial<Agent> = {}): Agent => ({
  id: 'helper',
  name: 'Helper',
  status: 'active',
  source: 'local',
  mcp: false,
  version: 1,
  inputs: { QUESTION: { type: 'string', required: true } },
  nodes: [{ id: 'answer', type: 'llm-prompt', prompt: 'Answer: {{inputs.QUESTION}}' }],
  ...overrides,
});

describe('resolveChatInput', () => {
  it('uses chat.input when declared', () => {
    expect(resolveChatInput(chatAgent({
      inputs: { A: { type: 'string', required: true }, B: { type: 'string', required: true } },
      chat: { input: 'B' },
    }))).toBe('B');
  });

  it('falls back to the only required string input, then the only string input', () => {
    expect(resolveChatInput(chatAgent())).toBe('QUESTION');
    expect(resolveChatInput(chatAgent({
      inputs: { Q: { type: 'string', required: true }, TONE: { type: 'string', default: 'dry' }, N: { type: 'number' } },
    }))).toBe('Q');
    expect(resolveChatInput(chatAgent({ inputs: { TOPIC: { type: 'string', default: 'x' } } }))).toBe('TOPIC');
  });

  it('explains what to fix when it can\'t pick', () => {
    expect(() => resolveChatInput(chatAgent({ inputs: {} }))).toThrow(/no string input/);
    expect(() => resolveChatInput(chatAgent({
      inputs: { A: { type: 'string', required: true }, B: { type: 'string', required: true } },
    }))).toThrow(/Set chat: \{ input: A \}/);
    expect(() => resolveChatInput(chatAgent({ chat: { input: 'NOPE' } }))).toThrow(NotConversationalError);
    expect(() => resolveChatInput(chatAgent({ inputs: { N: { type: 'number' } }, chat: { input: 'N' } }))).toThrow(/must be a string input/);
  });
});

describe('SessionStore', () => {
  it('creates sessions, appends numbered turns, lists newest first, deletes', () => {
    const a = sessions.create('helper', '  What   is\nup?  ');
    expect(a.title).toBe('What is up?');
    sessions.appendTurn({ sessionId: a.id, role: 'user', text: 'hi', runId: 'r1' });
    const t2 = sessions.appendTurn({ sessionId: a.id, role: 'agent', text: 'hello', runId: 'r1' });
    expect(t2.seq).toBe(2);
    const b = sessions.create('helper', 'second');
    sessions.appendTurn({ sessionId: b.id, role: 'user', text: 'later' });
    expect(sessions.list('helper').map((s) => s.id)).toEqual([b.id, a.id]);
    expect(sessions.list('other')).toEqual([]);
    expect(sessions.turns(a.id).map((t) => t.text)).toEqual(['hi', 'hello']);
    expect(sessions.delete(a.id)).toBe(true);
    expect(sessions.turns(a.id)).toEqual([]);
  });
});

describe('formatConversationBlock', () => {
  const turn = (seq: number, role: 'user' | 'agent', text: string, failed = false): SessionTurn =>
    ({ sessionId: 's', seq, role, text, failed, createdAt: '' });

  it('is empty on a first turn', () => {
    expect(formatConversationBlock([])).toBe('');
  });

  it('lists turns oldest first, and says when a run failed', () => {
    const block = formatConversationBlock([turn(1, 'user', 'Which is cheaper?'), turn(2, 'agent', 'boom', true), turn(3, 'user', 'try again')]);
    expect(block).toMatch(/^CONVERSATION SO FAR/);
    expect(block.indexOf('User: Which is cheaper?')).toBeLessThan(block.indexOf('User: try again'));
    expect(block).toContain('You: (no reply: that run failed — boom)');
    expect(block.trimEnd().endsWith('END OF CONVERSATION SO FAR')).toBe(true);
  });

  it('keeps the most recent turns within budget and cuts long ones', () => {
    const turns = Array.from({ length: 40 }, (_, i) => turn(i + 1, i % 2 ? 'agent' : 'user', `t${i} ${'x'.repeat(600)}`));
    const block = formatConversationBlock(turns);
    expect(Buffer.byteLength(block)).toBeLessThanOrEqual(CONVERSATION_BLOCK_MAX_BYTES + 100);
    expect(block).toContain('t39 ');
    expect(block).not.toContain('t0 ');
    expect(block).toMatch(/earlier turns left out for length/);

    const long = formatConversationBlock([turn(1, 'agent', 'y'.repeat(CONVERSATION_TURN_MAX_CHARS + 500))]);
    expect(long).toContain('…(cut)');
  });
});

describe('prepareAgentTurn', () => {
  it('starts a session, records the message against a run id, and maps it to the chat input', () => {
    const p = prepareAgentTurn({ agent: chatAgent(), sessions, message: ' Hi there ', inputs: { OTHER: 'x' } });
    expect(p.conversationPreamble).toBe('');
    expect(p.inputs).toEqual({ OTHER: 'x', QUESTION: 'Hi there' });
    expect(sessions.turns(p.session.id)).toEqual([expect.objectContaining({ role: 'user', text: 'Hi there', runId: p.runId })]);
  });

  it('refuses empty messages and another agent\'s session', () => {
    expect(() => prepareAgentTurn({ agent: chatAgent(), sessions, message: '  ' })).toThrow(ChatMessageError);
    const other = sessions.create('someone-else', 'x');
    expect(() => prepareAgentTurn({ agent: chatAgent(), sessions, message: 'hi', sessionId: other.id })).toThrow(SessionNotFoundError);
    expect(() => prepareAgentTurn({ agent: chatAgent(), sessions, message: 'hi', sessionId: 'nope' })).toThrow(SessionNotFoundError);
  });
});

describe('runAgentTurn', () => {
  type Seen = { node: AgentNode; preamble?: string; env: Record<string, string> };
  const spawner = (seen: Seen[], reply: (n: number) => { result: string; exitCode: number; error?: string }): DagExecutorDeps['spawnNode'] =>
    async (node, env, opts) => {
      seen.push({ node, preamble: (opts as { behaviorPreamble?: string } | undefined)?.behaviorPreamble, env });
      return reply(seen.length);
    };

  it('gives the second turn the first exchange, and records each reply with its run', async () => {
    const seen: Seen[] = [];
    const deps: DagExecutorDeps = { runStore, spawnNode: spawner(seen, (n) => ({ result: n === 1 ? 'Rail is 40 EUR, bus is 25 EUR.' : 'The bus.', exitCode: 0 })) };
    const first = await runAgentTurn({ agent: chatAgent(), sessions, message: 'Rail or bus to Porto?', triggeredBy: 'cli', deps });
    expect(first.run.status).toBe('completed');
    expect(first.reply).toMatchObject({ role: 'agent', text: 'Rail is 40 EUR, bus is 25 EUR.', runId: first.run.id, failed: false });
    expect(seen[0].preamble).toBeUndefined();

    const second = await runAgentTurn({ agent: chatAgent(), sessions, message: 'Which is cheaper?', sessionId: first.sessionId, triggeredBy: 'cli', deps });
    expect(second.sessionId).toBe(first.sessionId);
    expect(seen[1].preamble).toContain('User: Rail or bus to Porto?');
    expect(seen[1].preamble).toContain('You: Rail is 40 EUR, bus is 25 EUR.');
    expect(seen[1].preamble).not.toContain('Which is cheaper?');
    expect(sessions.turns(first.sessionId).map((t) => `${t.role}:${t.text}`)).toEqual([
      'user:Rail or bus to Porto?', 'agent:Rail is 40 EUR, bus is 25 EUR.', 'user:Which is cheaper?', 'agent:The bus.',
    ]);
  });

  it('records a failed run as a failed reply', async () => {
    const deps: DagExecutorDeps = { runStore, spawnNode: spawner([], () => ({ result: '', exitCode: 1, error: 'provider down' })) };
    const turn = await runAgentTurn({ agent: chatAgent(), sessions, message: 'hi', triggeredBy: 'cli', deps });
    expect(turn.run.status).toBe('failed');
    expect(turn.reply.failed).toBe(true);
  });
});

describe('reconcileSession', () => {
  it('fills in the reply for a run that finished while nobody waited', async () => {
    const p = prepareAgentTurn({ agent: chatAgent(), sessions, message: 'hi' });
    expect(reconcileSession(sessions, runStore, p.session.id)).toHaveLength(1);
    runStore.createRun({ id: p.runId, agentName: 'helper', status: 'completed', startedAt: new Date().toISOString(), triggeredBy: 'dashboard', result: 'hello!' });
    const turns = reconcileSession(sessions, runStore, p.session.id);
    expect(turns.map((t) => `${t.role}:${t.text}`)).toEqual(['user:hi', 'agent:hello!']);
    expect(reconcileSession(sessions, runStore, p.session.id)).toHaveLength(2);
  });
});
