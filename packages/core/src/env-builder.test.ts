import { describe, it, expect } from 'vitest';
import { buildAgentEnv } from './env-builder.js';
import type { AgentDefinition } from './types.js';

const FAKE_PROCESS_ENV: Record<string, string> = {
  PATH: '/usr/bin',
  HOME: '/home/user',
  USER: 'testuser',
  SHELL: '/bin/bash',
  LANG: 'en_US.UTF-8',
  LC_ALL: 'en_US.UTF-8',
  TERM: 'xterm',
  TMPDIR: '/tmp',
  NODE_ENV: 'development',
  TZ: 'America/Los_Angeles',
  // Dangerous vars that should NOT leak to community agents
  AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  GITHUB_TOKEN: 'ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  ANTHROPIC_API_KEY: 'sk-ant-api03-xxxxxxxxxxxx',
  OPENAI_API_KEY: 'sk-xxxxxxxxxxxxxxxxxxxx',
  DATABASE_URL: 'postgres://user:pass@localhost/db',
  CUSTOM_VAR: 'custom-value',
};

function makeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    name: 'test-agent',
    type: 'shell',
    command: 'echo test',
    ...overrides,
  };
}

describe('buildAgentEnv — community trust', () => {
  it('does NOT leak AWS_SECRET_ACCESS_KEY', () => {
    const { env } = buildAgentEnv({
      agent: makeAgent({ source: 'community' }),
      trustLevel: 'community',
      processEnv: FAKE_PROCESS_ENV,
    });
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  });

  it('does NOT leak GITHUB_TOKEN', () => {
    const { env } = buildAgentEnv({
      agent: makeAgent({ source: 'community' }),
      trustLevel: 'community',
      processEnv: FAKE_PROCESS_ENV,
    });
    expect(env.GITHUB_TOKEN).toBeUndefined();
  });

  it('does NOT leak ANTHROPIC_API_KEY', () => {
    const { env } = buildAgentEnv({
      agent: makeAgent({ source: 'community' }),
      trustLevel: 'community',
      processEnv: FAKE_PROCESS_ENV,
    });
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('does NOT leak DATABASE_URL', () => {
    const { env } = buildAgentEnv({
      agent: makeAgent({ source: 'community' }),
      trustLevel: 'community',
      processEnv: FAKE_PROCESS_ENV,
    });
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it('allows PATH and HOME', () => {
    const { env } = buildAgentEnv({
      agent: makeAgent({ source: 'community' }),
      trustLevel: 'community',
      processEnv: FAKE_PROCESS_ENV,
    });
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/user');
  });

  it('does NOT allow USER or SHELL for community', () => {
    const { env } = buildAgentEnv({
      agent: makeAgent({ source: 'community' }),
      trustLevel: 'community',
      processEnv: FAKE_PROCESS_ENV,
    });
    expect(env.USER).toBeUndefined();
    expect(env.SHELL).toBeUndefined();
  });

  it('allows explicitly allowlisted vars', () => {
    const { env } = buildAgentEnv({
      agent: makeAgent({ source: 'community', envAllowlist: ['CUSTOM_VAR'] }),
      trustLevel: 'community',
      processEnv: FAKE_PROCESS_ENV,
    });
    expect(env.CUSTOM_VAR).toBe('custom-value');
  });
});

describe('buildAgentEnv — local trust', () => {
  it('allows PATH, HOME, USER, SHELL', () => {
    const { env } = buildAgentEnv({
      agent: makeAgent({ source: 'local' }),
      trustLevel: 'local',
      processEnv: FAKE_PROCESS_ENV,
    });
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/user');
    expect(env.USER).toBe('testuser');
    expect(env.SHELL).toBe('/bin/bash');
  });

  it('allows LC_* pattern vars', () => {
    const { env } = buildAgentEnv({
      agent: makeAgent({ source: 'local' }),
      trustLevel: 'local',
      processEnv: FAKE_PROCESS_ENV,
    });
    expect(env.LC_ALL).toBe('en_US.UTF-8');
  });

  it('still does NOT leak AWS_SECRET_ACCESS_KEY for local agents', () => {
    const { env } = buildAgentEnv({
      agent: makeAgent({ source: 'local' }),
      trustLevel: 'local',
      processEnv: FAKE_PROCESS_ENV,
    });
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  });
});

describe('buildAgentEnv — secrets', () => {
  it('injects declared secrets', () => {
    const { env, missingSecrets } = buildAgentEnv({
      agent: makeAgent({ secrets: ['MY_API_KEY'] }),
      trustLevel: 'local',
      secrets: { MY_API_KEY: 'secret-value' },
      processEnv: FAKE_PROCESS_ENV,
    });
    expect(env.MY_API_KEY).toBe('secret-value');
    expect(missingSecrets).toEqual([]);
  });

  it('reports missing secrets', () => {
    const { missingSecrets } = buildAgentEnv({
      agent: makeAgent({ secrets: ['MISSING_KEY'] }),
      trustLevel: 'local',
      secrets: {},
      processEnv: FAKE_PROCESS_ENV,
    });
    expect(missingSecrets).toEqual(['MISSING_KEY']);
  });
});

describe('buildAgentEnv — agent env field', () => {
  it('applies agent env values', () => {
    const { env } = buildAgentEnv({
      agent: makeAgent({ env: { FOO: 'bar' } }),
      trustLevel: 'local',
      processEnv: FAKE_PROCESS_ENV,
    });
    expect(env.FOO).toBe('bar');
  });

  it('warns on hardcoded secret-looking values', () => {
    const { warnings } = buildAgentEnv({
      agent: makeAgent({ env: { API_KEY: 'sk-1234567890abcdefghij' } }),
      trustLevel: 'local',
      processEnv: FAKE_PROCESS_ENV,
    });
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('hardcoded secret');
  });

  it('does NOT warn on short values', () => {
    const { warnings } = buildAgentEnv({
      agent: makeAgent({ env: { API_KEY: 'short' } }),
      trustLevel: 'local',
      processEnv: FAKE_PROCESS_ENV,
    });
    expect(warnings.length).toBe(0);
  });
});
