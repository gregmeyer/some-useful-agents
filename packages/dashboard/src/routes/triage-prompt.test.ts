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
import { replyWidgetComponents } from '@some-useful-agents/core';
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

  it('teaches the ladder: run, call, build a helper, then edit', () => {
    const kernel = loadTriageKernel();
    const ladder = kernel.slice(kernel.indexOf("WHEN AN AGENT CAN'T DO PART OF THE JOB"));
    const rungs = ['1. RUN.', '2. CALL IT.', '3. BUILD A HELPER.', '4. EDIT.'].map((r) => ladder.indexOf(r));
    expect(rungs.every((i) => i > 0)).toBe(true);
    expect([...rungs].sort((a, b) => a - b)).toEqual(rungs);
    expect(ladder).toContain('`FOR_AGENT`');
    // The old "only path" rule is gone, and stuck notebook steps point at the ladder.
    expect(kernel).not.toContain('Your only\n  job for fix-applying flows');
    expect(kernel).toMatch(/When a step is stuck[\s\S]{0,200}WHEN AN AGENT CAN'T DO PART OF THE/);
  });

  it("gets the chat agents' widget components, Buttons included (one list for every conversation)", () => {
    const kernel = loadTriageKernel();
    expect(kernel).not.toContain('@@REPLY_WIDGET_COMPONENTS@@');
    expect(kernel).toContain(replyWidgetComponents());
    expect(kernel).toContain("A Button's click is sent as the person's next message");
    expect(kernel).not.toContain('No buttons');
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
