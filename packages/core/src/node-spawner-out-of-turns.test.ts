import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeOutOfTurns, claudeSpawner, spawnNodeReal, turnBudgetLine, wastedBuiltins, WRAP_UP_PROMPT } from './node-spawner.js';
import type { AgentNode } from './agent-v2-types.js';

// Regression: starter-research's two gather nodes searched for ten turns each
// on a job hunt, hit claude's error_max_turns, and everything they'd read was
// thrown away; the brief said "no results". Now the node is resumed once,
// without tools, to answer from what it read.

const SESSION = '778be279-0348-4273-a08b-e9d0db32661c';
const OUT_OF_TURNS = [
  JSON.stringify({ type: 'system', subtype: 'init', session_id: SESSION }),
  JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true, session_id: SESSION, errors: ['Reached maximum number of turns (3)'], usage: { input_tokens: 100, output_tokens: 10 } }),
].join('\n');
const ANSWER = 'Two roles found: Acme (Controller, remote, $190k) and Hooli (Director of Accounting, Austin). Lever not covered.';
const WRAPPED = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: SESSION, result: ANSWER, usage: { input_tokens: 40, output_tokens: 20 } });

describe('claudeOutOfTurns', () => {
  it('names the session of a run that ran out of turns, and nothing else', () => {
    expect(claudeOutOfTurns(OUT_OF_TURNS)).toBe(SESSION);
    expect(claudeOutOfTurns(WRAPPED)).toBeUndefined();
    expect(claudeOutOfTurns(JSON.stringify({ type: 'result', subtype: 'error_max_budget_usd', is_error: true, session_id: SESSION }))).toBeUndefined();
    expect(claudeOutOfTurns('not json')).toBeUndefined();
  });

  it('resumes without any tools', () => {
    const args = claudeSpawner.buildArgs({ prompt: WRAP_UP_PROMPT, maxTurns: 2, resume: SESSION, noTools: true, allowedTools: ['WebFetch'], mcpConfigPath: '/x.json' });
    expect(args).toContain('--resume');
    expect(args[args.indexOf('--resume') + 1]).toBe(SESSION);
    expect(args[args.indexOf('--tools') + 1]).toBe('');
    expect(args).toContain('--strict-mcp-config');
    expect(args).not.toContain('--allowedTools');
    expect(args).not.toContain('--mcp-config');
  });
});

describe('a node that runs out of turns', () => {
  let binDir: string;
  // A fake claude: the first call runs out of turns; a --resume call answers
  // (or, in the "can't" variant, fails too). Each call's args and stdin are logged.
  const fake = (name: string, wrapOk: boolean) => {
    const dir = join(binDir, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'first.jsonl'), `${OUT_OF_TURNS}\n`);
    writeFileSync(join(dir, 'wrap.jsonl'), `${wrapOk ? WRAPPED : OUT_OF_TURNS}\n`);
    writeFileSync(join(dir, 'claude'), [
      '#!/bin/sh',
      `echo "$*" >> "${join(dir, 'args.log')}"`,
      `cat >> "${join(dir, 'stdin.log')}"`,
      `echo "----" >> "${join(dir, 'stdin.log')}"`,
      'case "$*" in',
      `  *--resume*) cat "${join(dir, 'wrap.jsonl')}"; ${wrapOk ? 'exit 0' : 'exit 1'} ;;`,
      `  *) cat "${join(dir, 'first.jsonl')}"; exit 1 ;;`,
      'esac',
    ].join('\n'));
    chmodSync(join(dir, 'claude'), 0o755);
    return dir;
  };
  const node = (over: Partial<AgentNode> = {}): AgentNode => ({ id: 'gather-main', type: 'llm-prompt', prompt: 'Find jobs.', maxTurns: 3, tools: ['web-search'], ...over });
  const run = (dir: string, n: AgentNode) => spawnNodeReal(
    n,
    { PATH: `${dir}:${process.env.PATH ?? ''}` },
    { agentId: 'starter-research', agentSource: 'examples', llmSettings: { providers: ['claude'] } },
  );

  beforeAll(() => { binDir = mkdtempSync(join(tmpdir(), 'sua-fake-claude-turns-')); });
  afterAll(() => rmSync(binDir, { recursive: true, force: true }));

  it('answers from what it read, with a warning, and is told its budget up front', async () => {
    const dir = fake('answers', true);
    const res = await run(dir, node());
    expect(res.exitCode).toBe(0);
    expect(res.result).toBe(ANSWER);
    expect(res.error).toBe('Ran out of turns (3), so claude answered from what it had already read; it may not have covered everything.');
    const calls = readFileSync(join(dir, 'args.log'), 'utf8').trim().split('\n');
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('--disallowedTools Agent,Task,Bash');
    expect(calls[1]).toContain(`--resume ${SESSION}`);
    expect(calls[1]).toContain('--max-turns 2');
    const [first, second] = readFileSync(join(dir, 'stdin.log'), 'utf8').split('----\n');
    expect(first).toContain(`Find jobs.\n\n${turnBudgetLine(3)}`);
    expect(second.trim()).toBe(WRAP_UP_PROMPT);
    // Both calls' tokens count.
    expect(res.usage?.total.inputTokens).toBe(140);
  });

  it("still fails when it can't answer either, and says so", async () => {
    const res = await run(fake('cant', false), node());
    expect(res.exitCode).not.toBe(0);
    expect(res.error).toContain('error_max_turns');
    expect(res.error).toContain("Asked to answer from what it had read, it couldn't");
  });

  it('onMaxTurns: fail keeps the old behaviour', async () => {
    const dir = fake('fails', true);
    const res = await run(dir, node({ onMaxTurns: 'fail' }));
    expect(res.exitCode).not.toBe(0);
    expect(readFileSync(join(dir, 'args.log'), 'utf8').trim().split('\n')).toHaveLength(1);
  });

  it("a node without tools isn't told a turn budget", async () => {
    const dir = fake('plain', true);
    await run(dir, node({ tools: undefined }));
    expect(existsSync(join(dir, 'stdin.log'))).toBe(true);
    expect(readFileSync(join(dir, 'stdin.log'), 'utf8')).not.toContain('turns in all');
  });
});

// The live run that ran out spent its turns on claude's own WebFetch (refused
// six times), a Bash curl (refused) and, in another run, a subagent that sat
// outside the node's turn limit.
describe('wastedBuiltins', () => {
  it("takes away subagents, claude's WebFetch when sua's is there, and Bash", () => {
    expect(wastedBuiltins({}, ['web-fetch', 'web-scrape'])).toEqual(['Agent', 'Task', 'WebFetch', 'Bash']);
    expect(wastedBuiltins({}, [])).toEqual(['Agent', 'Task', 'Bash']);
  });

  it('leaves the ones a node asks for', () => {
    expect(wastedBuiltins({ allowedTools: ['Bash(curl:*)', 'WebFetch', 'Task'] }, ['web-fetch'])).toEqual(['Agent']);
  });

  it('reaches claude as --disallowedTools, and a node run passes it', async () => {
    const args = claudeSpawner.buildArgs({ prompt: 'x', disallowedTools: ['Agent', 'Task', 'WebFetch', 'Bash'] });
    expect(args[args.indexOf('--disallowedTools') + 1]).toBe('Agent,Task,WebFetch,Bash');
  });
});
