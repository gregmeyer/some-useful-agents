import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalProvider, UntrustedCommunityShellError, MemorySecretsStore } from './index.js';
import type { AgentDefinition } from './index.js';

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sua-local-provider-'));
  dbPath = join(dir, 'runs.db');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function shellAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    name: 'a',
    type: 'shell',
    command: 'echo hello',
    source: 'local',
    ...overrides,
  };
}

async function waitFor(
  provider: LocalProvider,
  runId: string,
  timeoutMs = 3000,
): Promise<Awaited<ReturnType<LocalProvider['getRun']>>> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const run = await provider.getRun(runId);
    if (run && run.status !== 'running' && run.status !== 'pending') return run;
    await new Promise(r => setTimeout(r, 20));
  }
  throw new Error('timed out waiting for run');
}

describe('LocalProvider shell gate', () => {
  it('refuses community shell without allow-list and records the failed run', async () => {
    const provider = new LocalProvider(dbPath, new MemorySecretsStore());
    await provider.initialize();
    const agent = shellAgent({ source: 'community', name: 'hostile' });

    await expect(provider.submitRun({ agent, triggeredBy: 'cli' })).rejects.toBeInstanceOf(
      UntrustedCommunityShellError,
    );

    const runs = await provider.listRuns({ agentName: 'hostile' });
    expect(runs.length).toBe(1);
    expect(runs[0].status).toBe('failed');
    expect(runs[0].error).toMatch(/community shell agent/);

    await provider.shutdown();
  });

  it('runs community shell when its name is allow-listed', async () => {
    const provider = new LocalProvider(dbPath, new MemorySecretsStore(), {
      allowUntrustedShell: new Set(['permitted']),
    });
    await provider.initialize();

    const run = await provider.submitRun({
      agent: shellAgent({ source: 'community', name: 'permitted', command: 'echo ok' }),
      triggeredBy: 'cli',
    });
    const final = await waitFor(provider, run.id);

    expect(final!.status).toBe('completed');
    expect(final!.result).toContain('ok');
    await provider.shutdown();
  });

  it('does not gate local shell agents', async () => {
    const provider = new LocalProvider(dbPath, new MemorySecretsStore());
    await provider.initialize();

    const run = await provider.submitRun({
      agent: shellAgent({ source: 'local', name: 'trusted', command: 'echo fine' }),
      triggeredBy: 'cli',
    });
    const final = await waitFor(provider, run.id);

    expect(final!.status).toBe('completed');
    await provider.shutdown();
  });
});

describe('LocalProvider redactSecrets', () => {
  it('scrubs known-prefix secrets from result when redactSecrets is true', async () => {
    const provider = new LocalProvider(dbPath, new MemorySecretsStore());
    await provider.initialize();

    const run = await provider.submitRun({
      agent: shellAgent({
        name: 'leaky',
        redactSecrets: true,
        command: `echo "token=ghp_${'a'.repeat(36)}"`,
      }),
      triggeredBy: 'cli',
    });
    const final = await waitFor(provider, run.id);

    expect(final!.status).toBe('completed');
    expect(final!.result).toContain('[REDACTED:GITHUB_PAT]');
    expect(final!.result).not.toMatch(/\bghp_/);
    await provider.shutdown();
  });

  it('leaves output alone when redactSecrets is false (default)', async () => {
    const provider = new LocalProvider(dbPath, new MemorySecretsStore());
    await provider.initialize();

    // Not a real secret — just a pattern that would match if redaction were on.
    const marker = 'AKIAIOSFODNN7EXAMPLE';
    const run = await provider.submitRun({
      agent: shellAgent({ name: 'plain', command: `echo ${marker}` }),
      triggeredBy: 'cli',
    });
    const final = await waitFor(provider, run.id);

    expect(final!.status).toBe('completed');
    expect(final!.result).toContain(marker);
    expect(final!.result).not.toContain('[REDACTED');
    await provider.shutdown();
  });
});
