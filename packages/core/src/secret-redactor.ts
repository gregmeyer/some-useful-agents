/**
 * Known-prefix secret redactor. Intentionally narrow to avoid the false
 * positives that kill generic "value > 20 chars looks like a secret"
 * scrubbers (env dumps, JSON blobs, URLs).
 *
 * We redact:
 *   - AWS access key IDs (AKIA + 16 upper/digit)
 *   - GitHub personal access tokens (ghp_ + 36 chars)
 *   - OpenAI / Anthropic API keys (sk- + 20+ chars, incl. sk-ant- and sk-proj-)
 *   - Slack bot tokens (xoxb- + 10+ chars)
 *   - Slack user tokens (xoxp- + 10+ chars)
 *   - Slack app tokens (xapp- + 10+ chars)
 *
 * Matches are replaced with a redaction marker that keeps the prefix so
 * post-mortem debugging can at least see which provider the leak was for
 * without exposing the secret value.
 */

interface RedactionRule {
  readonly pattern: RegExp;
  readonly label: string;
}

const RULES: readonly RedactionRule[] = [
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, label: 'AWS_ACCESS_KEY_ID' },
  { pattern: /\bghp_[A-Za-z0-9]{36}\b/g, label: 'GITHUB_PAT' },
  { pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g, label: 'LLM_API_KEY' },
  { pattern: /\bxoxb-[A-Za-z0-9-]{10,}\b/g, label: 'SLACK_BOT_TOKEN' },
  { pattern: /\bxoxp-[A-Za-z0-9-]{10,}\b/g, label: 'SLACK_USER_TOKEN' },
  { pattern: /\bxapp-[A-Za-z0-9-]{10,}\b/g, label: 'SLACK_APP_TOKEN' },
];

/**
 * Scrub known-prefix secrets from a string, replacing each match with a
 * marker. Idempotent: re-running on already-scrubbed text is a no-op.
 */
export function redactKnownSecrets(text: string): string {
  if (!text) return text;
  let out = text;
  for (const rule of RULES) {
    out = out.replace(rule.pattern, `[REDACTED:${rule.label}]`);
  }
  return out;
}

/** Expose the rules for diagnostics / testing. Read-only. */
export function getRedactionRules(): readonly RedactionRule[] {
  return RULES;
}
