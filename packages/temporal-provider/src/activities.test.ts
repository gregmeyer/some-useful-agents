import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { EncryptedFileStore } from '@some-useful-agents/core';
import type { AgentDefinition } from '@some-useful-agents/core';
import { runAgentActivity } from './activities.js';

const TEST_DIR = join(import.meta.dirname, '__test-activities__');
const SECRETS_PATH = join(TEST_DIR, 'secrets.enc');

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function shellAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    name: 'test-agent',
    type: 'shell',
    command: 'echo hello-from-activity',
    source: 'local',
    ...overrides,
  };
}

describe('runAgentActivity', () => {
  it('runs a shell agent end-to-end', async () => {
    const result = await runAgentActivity({
      agent: shellAgent(),
      secretsPath: SECRETS_PATH,
    });

    expect(result.exitCode).toBe(0);
    expect(result.result).toContain('hello-from-activity');
    expect(result.error).toBeUndefined();
  });

  it('captures non-zero exit codes', async () => {
    const result = await runAgentActivity({
      agent: shellAgent({ command: 'exit 42' }),
      secretsPath: SECRETS_PATH,
    });

    expect(result.exitCode).toBe(42);
    expect(result.error).toBeTruthy();
  });

  it('injects secrets from store', async () => {
    const store = new EncryptedFileStore(SECRETS_PATH);
    await store.set('MY_SECRET_VAR', 'injected-value');

    const result = await runAgentActivity({
      agent: shellAgent({
        command: 'echo "got=$MY_SECRET_VAR"',
        secrets: ['MY_SECRET_VAR'],
      }),
      secretsPath: SECRETS_PATH,
    });

    expect(result.exitCode).toBe(0);
    expect(result.result).toContain('got=injected-value');
  });

  it('fails with clear error when secret is missing', async () => {
    const result = await runAgentActivity({
      agent: shellAgent({ secrets: ['DOES_NOT_EXIST'] }),
      secretsPath: SECRETS_PATH,
    });

    expect(result.exitCode).toBe(1);
    expect(result.error).toContain('Missing secrets');
    expect(result.error).toContain('DOES_NOT_EXIST');
  });

  it('community agents do NOT inherit dangerous process.env vars', async () => {
    // Set a fake AWS-looking var in this test's env
    process.env.TEST_FAKE_AWS_SECRET = 'should-not-leak-to-community-agent';

    try {
      const result = await runAgentActivity({
        agent: shellAgent({
          source: 'community',
          command: 'echo "leak=$TEST_FAKE_AWS_SECRET"',
        }),
        secretsPath: SECRETS_PATH,
      });

      expect(result.exitCode).toBe(0);
      // The var should NOT be present in the agent's env
      expect(result.result).toContain('leak=');
      expect(result.result).not.toContain('should-not-leak-to-community-agent');
    } finally {
      delete process.env.TEST_FAKE_AWS_SECRET;
    }
  });
});
