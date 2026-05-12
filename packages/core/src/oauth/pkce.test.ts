import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { generatePkcePair, generateOauthState } from './pkce.js';

describe('generatePkcePair', () => {
  it('returns a base64url verifier between 43 and 128 chars (RFC 7636)', () => {
    const { codeVerifier } = generatePkcePair();
    expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(codeVerifier.length).toBeLessThanOrEqual(128);
    expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('challenge is base64url(SHA-256(verifier))', () => {
    const { codeVerifier, codeChallenge, codeChallengeMethod } = generatePkcePair();
    expect(codeChallengeMethod).toBe('S256');
    const expected = createHash('sha256').update(codeVerifier).digest('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(codeChallenge).toBe(expected);
  });

  it('produces unique pairs each call', () => {
    const a = generatePkcePair();
    const b = generatePkcePair();
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
    expect(a.codeChallenge).not.toBe(b.codeChallenge);
  });
});

describe('generateOauthState', () => {
  it('is base64url, at least 30 chars (24 random bytes -> 32 chars)', () => {
    const s = generateOauthState();
    expect(s.length).toBeGreaterThanOrEqual(30);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(generateOauthState()).not.toBe(s);
  });
});
