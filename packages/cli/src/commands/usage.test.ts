/** `sua usage` end to end against the built CLI and a seeded run database. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { RunStore } from '@some-useful-agents/core';

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

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sua-usage-cli-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  writeFileSync(join(dir, 'sua.config.json'), JSON.stringify({ dataDir: './data', provider: 'local' }));
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('sua usage', () => {
  it('prints spend by agent and by provider, and says when prices are missing', () => {
    const runs = new RunStore(join(dir, 'data', 'runs.db'));
    const now = new Date().toISOString();
    runs.createRun({ id: 'r1', agentName: 'digest', status: 'running', startedAt: now, triggeredBy: 'cli' });
    runs.createNodeExecution({ runId: 'r1', nodeId: 'n', workflowVersion: 1, status: 'running', startedAt: now });
    runs.updateNodeExecution('r1', 'n', {
      status: 'completed',
      usage: {
        total: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.42, costComplete: false },
        attempts: [
          { provider: 'claude', model: 'claude-opus-5-5', inputTokens: 500, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.42, costSource: 'reported' },
          { provider: 'codex', inputTokens: 500, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, costSource: 'unpriced' },
        ],
      },
    });
    runs.updateRun('r1', { status: 'completed', completedAt: now });
    runs.close();

    const res = runCli(dir, ['usage', '--days', '30']);
    expect(res.status).toBe(0);
    expect(res.out).toContain('≥ $0.42');
    expect(res.out).toContain('digest');
    expect(res.out).toContain('claude/claude-opus-5-5');
    expect(res.out).toContain('no price  codex');
    expect(res.out).toContain('Settings → LLM → Pricing');

    expect(runCli(dir, ['usage', '--agent', 'nobody']).out).toContain('No runs with recorded usage');
  });
});
