import { describe, it, expect } from 'vitest';
import { redactKnownSecrets } from './secret-redactor.js';

describe('redactKnownSecrets', () => {
  it('redacts AWS access key IDs', () => {
    const input = 'key=AKIAIOSFODNN7EXAMPLE found';
    expect(redactKnownSecrets(input)).toBe('key=[REDACTED:AWS_ACCESS_KEY_ID] found');
  });

  it('redacts GitHub personal access tokens', () => {
    const pat = 'ghp_' + 'a'.repeat(36);
    expect(redactKnownSecrets(`auth: ${pat}`)).toBe('auth: [REDACTED:GITHUB_PAT]');
  });

  it('redacts LLM API keys (sk-, sk-ant-, sk-proj-)', () => {
    expect(redactKnownSecrets('sk-abc123def456ghi789jk0')).toBe('[REDACTED:LLM_API_KEY]');
    expect(redactKnownSecrets('sk-ant-api03-abcdef0123456789XYZ')).toBe(
      '[REDACTED:LLM_API_KEY]',
    );
    expect(redactKnownSecrets('sk-proj-abcdef0123456789_ABC-DEF')).toBe(
      '[REDACTED:LLM_API_KEY]',
    );
  });

  it('redacts Slack tokens (bot, user, app)', () => {
    const bot = 'xoxb-1234567890-abcdefgh';
    const user = 'xoxp-1234567890-abcdefgh';
    const app = 'xapp-1-A01ABC-1234567890';
    const line = `${bot} ${user} ${app}`;
    const out = redactKnownSecrets(line);
    expect(out).toBe('[REDACTED:SLACK_BOT_TOKEN] [REDACTED:SLACK_USER_TOKEN] [REDACTED:SLACK_APP_TOKEN]');
  });

  it('redacts multiple tokens in one string', () => {
    const line = 'AKIAIOSFODNN7EXAMPLE and sk-abcdefghij0123456789x';
    const out = redactKnownSecrets(line);
    expect(out).toContain('[REDACTED:AWS_ACCESS_KEY_ID]');
    expect(out).toContain('[REDACTED:LLM_API_KEY]');
    expect(out).not.toContain('AKIA');
    expect(out).not.toMatch(/\bsk-/);
  });

  it('leaves non-matching text alone', () => {
    const input = 'this is a boring log line with no secrets';
    expect(redactKnownSecrets(input)).toBe(input);
  });

  it('is idempotent', () => {
    const once = redactKnownSecrets('AKIAIOSFODNN7EXAMPLE');
    const twice = redactKnownSecrets(once);
    expect(twice).toBe(once);
  });

  it('does not redact look-alikes that fail length/charset checks', () => {
    // sk- followed by too-short body
    expect(redactKnownSecrets('sk-short')).toBe('sk-short');
    // AKIA followed by lowercase (doesn't match [0-9A-Z]{16})
    expect(redactKnownSecrets('AKIAlowercasekeyxx')).toBe('AKIAlowercasekeyxx');
    // ghp_ followed by non-alphanumeric
    expect(redactKnownSecrets('ghp_has a space here')).toBe('ghp_has a space here');
  });

  it('handles empty string', () => {
    expect(redactKnownSecrets('')).toBe('');
  });
});
