/**
 * Tests for the triage prompt composition (kernel + per-source playbook).
 *
 * These exercise the real fragment files on disk (the loaders resolve from
 * cwd = repo root, same as the agent YAML auto-refresh), so they also guard
 * against the fragments going missing or being mis-split. The load-bearing
 * guarantee is MUTUAL EXCLUSIVITY: a thread only ever gets ITS source's
 * playbook, never the others — that's the whole point of the de-monolith.
 */
import { describe, it, expect } from 'vitest';
import { loadTriageKernel, loadTriagePlaybook } from './triage-prompt.js';

describe('loadTriageKernel', () => {
  it('carries the shared mechanics + the exact <plan> output schema', () => {
    const kernel = loadTriageKernel();
    expect(kernel.length).toBeGreaterThan(1000);
    expect(kernel).toContain('PROPOSING ACTIONS');
    expect(kernel).toContain('OUTPUT FORMAT');
    expect(kernel).toContain('VOICE');
    expect(kernel).toContain('COMMITMENT RULE');
    expect(kernel).toContain('<plan>');
  });

  it('does NOT carry source-specific guidance (that lives in playbooks)', () => {
    const kernel = loadTriageKernel();
    expect(kernel).not.toContain('source=run-failure');
    expect(kernel).not.toContain('source=permission-request');
  });

  it('strips the leading editor comment so it never reaches the model', () => {
    expect(loadTriageKernel()).not.toContain('<!--');
  });
});

describe('loadTriagePlaybook', () => {
  const ALL = ['run-failure', 'permission-request', 'cadence', 'manual'] as const;

  it('returns only the matching source playbook, never the others', () => {
    for (const src of ALL) {
      const body = loadTriagePlaybook(src);
      expect(body).toContain(`source=${src}`);
      for (const other of ALL.filter((s) => s !== src)) {
        expect(body).not.toContain(`source=${other}`);
      }
    }
  });

  it('permission-request keeps the surgical CSP-host → analyzer dispatch', () => {
    expect(loadTriagePlaybook('permission-request')).toContain('permissions.imgSrc');
  });

  it('falls back to the manual playbook for unknown or empty sources', () => {
    const manual = loadTriagePlaybook('manual');
    expect(loadTriagePlaybook('something-else')).toBe(manual);
    expect(loadTriagePlaybook(undefined)).toBe(manual);
    expect(loadTriagePlaybook('')).toBe(manual);
  });
});
