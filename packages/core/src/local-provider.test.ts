import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalProvider, UntrustedCommunityShellError, MemorySecretsStore } from './index.js';
import type { AgentDefinition, SecretsStore } from './index.js';

/**
 * SecretsStore that explodes on any read. Lets tests assert that the
 * provider never touches the store for agents that don't declare any
 * `secrets:` — the regression introduced when v2 passphrase-protection
 * landed in v0.10.0.
 */
class ExplodingSecretsStore implements SecretsStore {
  async get(): Promise<string | undefined> { throw new Error('store opened unexpectedly'); }
  async set(): Promise<void> { throw new Error('store opened unexpectedly'); }
  async delete(): Promise<void> { throw new Error('store opened unexpectedly'); }
  async list(): Promise<string[]> { throw new Error('store opened unexpectedly'); }
  async has(): Promise<boolean> { throw new Error('store opened unexpectedly'); }
  async getAll(): Promise<Record<string, string>> { throw new Error('store opened unexpectedly'); }
}

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

describe('LocalProvider typed inputs', () => {
  it('substitutes {{inputs.X}} in claude-code prompts and merges into env', async () => {
    const provider = new LocalProvider(dbPath, new MemorySecretsStore());
    await provider.initialize();

    // Using a shell agent instead of claude-code for end-to-end checking,
    // since shell is easier to observe. The substitution path for claude-code
    // prompts is unit-tested in input-resolver.test.ts; this test exercises
    // the end-to-end env-merge for declared inputs in a real subprocess.
    const run = await provider.submitRun({
      agent: shellAgent({
        name: 'weather',
        command: 'echo "zip=$ZIP style=$STYLE"',
        inputs: {
          ZIP: { type: 'number', required: true },
          STYLE: { type: 'enum', values: ['haiku', 'verse'], default: 'haiku' },
        },
      }),
      triggeredBy: 'cli',
      inputs: { ZIP: '94110' },
    });
    const final = await waitFor(provider, run.id);

    expect(final!.status).toBe('completed');
    expect(final!.result).toContain('zip=94110');
    expect(final!.result).toContain('style=haiku');
    await provider.shutdown();
  });

  it('records a failed run + rethrows on missing required input', async () => {
    const provider = new LocalProvider(dbPath, new MemorySecretsStore());
    await provider.initialize();

    await expect(
      provider.submitRun({
        agent: shellAgent({
          name: 'needs-zip',
          command: 'echo "$ZIP"',
          inputs: { ZIP: { type: 'number', required: true } },
        }),
        triggeredBy: 'cli',
        inputs: {},
      }),
    ).rejects.toThrow(/Missing required input: ZIP/);

    const runs = await provider.listRuns({ agentName: 'needs-zip' });
    expect(runs.length).toBe(1);
    expect(runs[0].status).toBe('failed');

    await provider.shutdown();
  });

  it('tolerates caller-supplied inputs the agent did not declare (chain/scheduler fan-out)', async () => {
    // The provider is called from per-agent CLI (strict, validates at CLI
    // layer), chain execution (shared inputs for a fleet), and the
    // scheduler daemon (daemon-wide overrides). (2) and (3) need the
    // provider to tolerate extras — otherwise a single `--input ZIP=...`
    // breaks every scheduled agent that doesn't declare ZIP.
    const provider = new LocalProvider(dbPath, new MemorySecretsStore());
    await provider.initialize();

    const run = await provider.submitRun({
      agent: shellAgent({
        name: 'no-inputs-declared',
        command: 'echo tolerated',
        // no inputs field
      }),
      triggeredBy: 'schedule',
      inputs: { ZIP: '94110', EXTRA: 'ignored' },
    });
    const final = await waitFor(provider, run.id);

    expect(final!.status).toBe('completed');
    expect(final!.result).toContain('tolerated');
    await provider.shutdown();
  });

  it('still rejects invalid-type values for DECLARED inputs', async () => {
    const provider = new LocalProvider(dbPath, new MemorySecretsStore());
    await provider.initialize();

    await expect(
      provider.submitRun({
        agent: shellAgent({
          name: 'typed-zip',
          command: 'echo "$ZIP"',
          inputs: { ZIP: { type: 'number', required: true } },
        }),
        triggeredBy: 'cli',
        inputs: { ZIP: 'not-a-number' },
      }),
    ).rejects.toThrow(/Invalid value for input "ZIP"/);

    await provider.shutdown();
  });

  it('declared input overrides an ambient env var of the same name', async () => {
    const provider = new LocalProvider(dbPath, new MemorySecretsStore(), {
      // Widen the env allowlist so the ambient ZIP reaches the shell at all,
      // otherwise the filter would have dropped it already.
    });
    await provider.initialize();

    // Set an ambient value that the agent's env-builder would pass through.
    process.env.ZIP = '00000';
    try {
      const run = await provider.submitRun({
        agent: shellAgent({
          name: 'override',
          command: 'echo "zip=$ZIP"',
          envAllowlist: ['ZIP'],
          inputs: { ZIP: { type: 'number', required: true } },
        }),
        triggeredBy: 'cli',
        inputs: { ZIP: '94110' },
      });
      const final = await waitFor(provider, run.id);
      expect(final!.result).toContain('zip=94110');
    } finally {
      delete process.env.ZIP;
      await provider.shutdown();
    }
  });
});

describe('LocalProvider lazy secrets fetch (v0.10.x fix)', () => {
  it('never opens the secrets store for agents with no declared secrets', async () => {
    const provider = new LocalProvider(dbPath, new ExplodingSecretsStore());
    await provider.initialize();

    // Agent declares no `secrets:` — the store should never be read.
    const run = await provider.submitRun({
      agent: shellAgent({ name: 'no-secrets', command: 'echo ok' }),
      triggeredBy: 'cli',
    });
    const final = await waitFor(provider, run.id);

    expect(final!.status).toBe('completed');
    expect(final!.result).toContain('ok');
    await provider.shutdown();
  });

  it('still opens the store and reports missing secrets for agents that declare them', async () => {
    const provider = new LocalProvider(dbPath, new MemorySecretsStore());
    await provider.initialize();

    const run = await provider.submitRun({
      agent: shellAgent({
        name: 'needs-secret',
        command: 'echo $API_KEY',
        secrets: ['API_KEY'],
      }),
      triggeredBy: 'cli',
    });
    const final = await waitFor(provider, run.id);

    expect(final!.status).toBe('failed');
    expect(final!.error).toContain('Missing secrets');
    expect(final!.error).toContain('API_KEY');
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
