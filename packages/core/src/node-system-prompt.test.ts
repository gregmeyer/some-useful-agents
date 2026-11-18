import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnNodeReal, llmChildEnv } from './node-spawner.js';

// A node's fixed instructions (systemPrompt) go to claude as a system-prompt file,
// which its prompt cache keeps between calls; other providers get them at the head of the prompt.

let binDir: string;
const kept = (name: string) => readFileSync(join(binDir, name), 'utf8');

beforeAll(() => {
  binDir = mkdtempSync(join(tmpdir(), 'sua-system-prompt-'));
  // claude: keep its args, its stdin, and the system file it was handed (while it exists).
  writeFileSync(join(binDir, 'claude'), [
    '#!/bin/sh',
    `cat > "${join(binDir, 'claude.stdin')}"`,
    `printf '%s\\n' "$@" > "${join(binDir, 'claude.args')}"`,
    'prev=""; for a in "$@"; do if [ "$prev" = "--append-system-prompt-file" ]; then cp "$a" "' + join(binDir, 'claude.system') + '"; fi; prev="$a"; done',
    'echo \'{"type":"result","subtype":"success","result":"ok"}\'',
  ].join('\n'));
  writeFileSync(join(binDir, 'codex'), [
    '#!/bin/sh',
    '[ "$1" = "mcp" ] && { echo "[]"; exit 0; }',
    `cat > "${join(binDir, 'codex.stdin')}"`,
    `printf '%s\\n' '${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'ok' } })}'`,
    `printf '%s\\n' '${JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } })}'`,
  ].join('\n'));
  chmodSync(join(binDir, 'claude'), 0o755);
  chmodSync(join(binDir, 'codex'), 0o755);
});
afterAll(() => rmSync(binDir, { recursive: true, force: true }));

const node = { id: 'triage', type: 'llm-prompt' as const, systemPrompt: 'RULES\n{{inputs.KERNEL}}', prompt: 'THREAD: {{inputs.ASK}}' };
const env = (extra: Record<string, string> = {}) => ({ PATH: `${binDir}:${process.env.PATH ?? ''}`, KERNEL: 'the kernel', ASK: 'lead with a hot dog', ...extra });

describe('a node with a systemPrompt', () => {
  it('claude gets it as an appended system-prompt file, templated, and the prompt without it; the file is gone after', async () => {
    const res = await spawnNodeReal(node, env(), { agentId: 'a', agentSource: 'local', llmSettings: { providers: ['claude'] } });
    expect(res.exitCode).toBe(0);
    const args = kept('claude.args').split('\n');
    const at = args.indexOf('--append-system-prompt-file');
    expect(at).toBeGreaterThan(-1);
    expect(kept('claude.system')).toBe('RULES\nthe kernel');
    expect(kept('claude.stdin')).toBe('THREAD: lead with a hot dog');
    expect(existsSync(args[at + 1])).toBe(false);
  });

  it('codex gets it at the head of the prompt, as before', async () => {
    const res = await spawnNodeReal(node, env(), { agentId: 'a', agentSource: 'local', llmSettings: { providers: ['codex'] } });
    expect(res.exitCode).toBe(0);
    expect(kept('codex.stdin')).toBe('RULES\nthe kernel\n\nTHREAD: lead with a hot dog');
  });

  it("a big input the system prompt carries is left out of the child's env too", () => {
    const big = 'x'.repeat(200_000);
    const out = llmChildEnv({ KERNEL: big, OTHER: 'y' }, `${node.prompt}\n${node.systemPrompt}`);
    expect(out.KERNEL).toBeUndefined();
    expect(out.OTHER).toBe('y');
  });
});

describe('systemPrompt in agent YAML', () => {
  it('survives import and export (a field left out of parsedToAgent is silently stripped)', async () => {
    const { parseAgent, exportAgent } = await import('./agent-yaml.js');
    const yaml = [
      'id: t', 'name: T', 'status: active', 'source: local', 'mcp: false',
      'inputs:', '  X:', '    type: string',
      'nodes:', '  - id: n', '    type: llm-prompt', '    systemPrompt: "Fixed rules."', '    prompt: "Ask {{inputs.X}}"',
    ].join('\n');
    const agent = parseAgent(yaml);
    expect(agent.nodes[0].systemPrompt).toBe('Fixed rules.');
    const again = parseAgent(exportAgent(agent));
    expect(again.nodes[0].systemPrompt).toBe('Fixed rules.');
    // Its templates are checked like the prompt's.
    expect(() => parseAgent(yaml.replace('Fixed rules.', 'Rules {{inputs.NOPE}}'))).toThrow(/systemPrompt: Template references \{\{inputs\.NOPE\}\}/);
    // The triage agent sends its kernel this way.
    const { readFileSync } = await import('node:fs');
    const triage = parseAgent(readFileSync(new URL('../../../agents/examples/inbox-triage.yaml', import.meta.url), 'utf8'));
    expect(triage.nodes[0].systemPrompt).toContain('{{inputs.TRIAGE_KERNEL}}');
    expect(triage.nodes[0].prompt).not.toContain('{{inputs.TRIAGE_KERNEL}}');
  });
});
