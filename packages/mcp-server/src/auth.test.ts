import { describe, it, expect } from 'vitest';
import {
  checkAuthorization,
  checkHost,
  checkOrigin,
  buildLoopbackAllowlist,
} from './auth.js';

const TOKEN = 'a'.repeat(64);

describe('checkAuthorization', () => {
  it('rejects missing header', () => {
    const r = checkAuthorization(undefined, TOKEN);
    expect(r).toEqual({ ok: false, status: 401, error: expect.stringMatching(/Missing/) });
  });

  it('rejects malformed header', () => {
    const r = checkAuthorization('NotBearer xyz', TOKEN);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
  });

  it('rejects wrong token', () => {
    const r = checkAuthorization(`Bearer ${'b'.repeat(64)}`, TOKEN);
    expect(r).toEqual({ ok: false, status: 401, error: 'Invalid bearer token' });
  });

  it('accepts correct bearer token', () => {
    const r = checkAuthorization(`Bearer ${TOKEN}`, TOKEN);
    expect(r).toEqual({ ok: true });
  });

  it('is case-insensitive on the "Bearer" prefix', () => {
    const r = checkAuthorization(`bearer ${TOKEN}`, TOKEN);
    expect(r).toEqual({ ok: true });
  });

  it('rejects tokens of differing length without timing leak', () => {
    const r = checkAuthorization('Bearer short', TOKEN);
    expect(r).toEqual({ ok: false, status: 401, error: 'Invalid bearer token' });
  });
});

describe('checkHost', () => {
  const allow = buildLoopbackAllowlist(3003);

  it('rejects missing host', () => {
    const r = checkHost(undefined, allow);
    expect(r).toEqual({ ok: false, status: 400, error: expect.stringMatching(/Missing/) });
  });

  it.each([
    'localhost:3003',
    '127.0.0.1:3003',
    '[::1]:3003',
    'localhost',
    '127.0.0.1',
  ])('accepts loopback host %s', (host) => {
    expect(checkHost(host, allow)).toEqual({ ok: true });
  });

  it.each([
    'evil.com:3003',
    '192.168.1.5:3003',
    '10.0.0.1',
    'mcp.example.org',
  ])('rejects non-loopback host %s', (host) => {
    const r = checkHost(host, allow);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });
});

describe('checkOrigin', () => {
  const allow = buildLoopbackAllowlist(3003);

  it('accepts missing Origin (non-browser client)', () => {
    expect(checkOrigin(undefined, allow)).toEqual({ ok: true });
  });

  it.each([
    'http://localhost:3003',
    'http://127.0.0.1:3003',
    'http://[::1]:3003',
  ])('accepts loopback origin %s', (origin) => {
    expect(checkOrigin(origin, allow)).toEqual({ ok: true });
  });

  it.each([
    'http://evil.com',
    'https://attacker.example.org',
    'http://192.168.1.5:3003',
  ])('rejects non-loopback origin %s', (origin) => {
    const r = checkOrigin(origin, allow);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });

  it('rejects malformed Origin', () => {
    const r = checkOrigin('not a url', allow);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });
});
