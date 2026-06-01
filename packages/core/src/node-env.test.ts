import { describe, it, expect } from 'vitest';
import { stripSensitiveEnv } from './node-env.js';
import type { AgentNode } from './agent-v2-types.js';

const node = (secrets?: string[]): AgentNode => ({
  id: 'n1',
  type: 'shell',
  command: 'echo hi',
  ...(secrets ? { secrets } : {}),
});

describe('stripSensitiveEnv', () => {
  it('keeps benign keys and strips declared secrets', () => {
    const { safe, strippedKeys } = stripSensitiveEnv(
      { PATH: '/usr/bin', GREETING: 'hi', MY_SECRET: 'shh' },
      node(['MY_SECRET']),
    );
    expect(safe).toEqual({ PATH: '/usr/bin', GREETING: 'hi' });
    expect(strippedKeys).toContain('MY_SECRET');
    expect(safe.MY_SECRET).toBeUndefined();
  });

  it('strips sensitive-looking key names even when not declared', () => {
    const { safe, strippedKeys } = stripSensitiveEnv(
      { API_TOKEN: 'abc', NORMAL: 'ok' },
      node(),
    );
    expect(safe.NORMAL).toBe('ok');
    expect(safe.API_TOKEN).toBeUndefined();
    expect(strippedKeys).toContain('API_TOKEN');
  });

  it('strips values matching sensitive patterns (e.g. an sk- key)', () => {
    const { safe, strippedKeys } = stripSensitiveEnv(
      { SOMEVAR: 'sk-abcdefghijklmnopqrstuvwx', PLAIN: 'fine' },
      node(),
    );
    expect(safe.PLAIN).toBe('fine');
    expect(safe.SOMEVAR).toBeUndefined();
    expect(strippedKeys).toContain('SOMEVAR');
  });
});
