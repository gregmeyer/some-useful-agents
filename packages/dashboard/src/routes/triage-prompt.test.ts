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

describe('a notebook like the one asked for', () => {
  it('an ask to test what changes an agent\'s output is an experiment: offered as a link, its set never invented, its finding only repeated', () => {
    const kernel = loadTriageKernel();
    expect(kernel).toContain('EXPERIMENTS — "does the build matter more than what they ask for?"');
    // Not a notebook, not a new agent, and not answered from reasoning.
    expect(kernel).toMatch(/TEST, PROVE, MEASURE or COMPARE[\s\S]{0,500}Do NOT start a notebook for\s+it, do NOT build or run an agent for it, and do NOT answer the question\s+from reasoning/);
    // One link to the setup page, filled in with the fields that page reads.
    expect(kernel).toContain('[Set up the experiment](/experiments/new?question=');
    for (const field of ['cN_kind', 'cN_vM_name', 'cN_vM_text', 'cN_vM_provider', 'cN_vM_version', 'notebook=1', 'j1_rubric']) expect(kernel).toContain(field);
    expect(kernel).toContain('THE SET IS NEVER INVENTED.');
    expect(kernel).toContain('Never write example items.');
    // What one found comes from its runs, in those numbers.
    expect(kernel).toMatch(/answer from EXPERIMENTS ONLY:\s+its "found" and "restsOn"/);
    expect(kernel).toContain('never 1, which leaves nothing to conclude');
  });

  it('the kernel reads NOTEBOOK_CANDIDATES before offering a new notebook: run the same one again, or set a new one up like it', async () => {
    const kernel = loadTriageKernel();
    expect(kernel).toContain('A NOTEBOOK LIKE THIS EXISTS');
    expect(kernel).toContain('read NOTEBOOK_CANDIDATES before offering one');
    // The same topic: two answer buttons, then the rerun card (it archives, so it's a card).
    expect(kernel).toMatch(/`same-topic`[\s\S]{0,600}"Run it again"[\s\S]{0,300}"Start a new one"/);
    expect(kernel).toMatch(/propose the\s+`notebook-rerun` card/);
    // The same kind for someone else: a create card that names the notebook and who it's for.
    expect(kernel).toMatch(/`same-kind`[\s\S]{0,900}"LIKE": "<candidate id>", "SUBJECT"/);
    expect(kernel).toContain('SUBJECT is required with LIKE');
    // Only the name is swapped by itself; a size or budget the ask changes goes in the lists.
    expect(kernel).toMatch(/never the whole ask and never a size,\s+budget, place or date/);
    // They asked for a fresh one: no reuse talk.
    expect(kernel).toMatch(/"from scratch", "don't reuse"\):\s+skip this/);
    // New notebook opens with their words; the old address only redirects.
    expect(kernel).not.toContain('/notebooks?new=1');
    // The triage agent declares the input and shows it to the model.
    const { readFileSync } = await import('node:fs');
    const yaml = readFileSync('agents/examples/inbox-triage.yaml', 'utf8');
    expect(yaml).toMatch(/^ {2}NOTEBOOK_CANDIDATES:$/m);
    expect(yaml).toContain('{{inputs.NOTEBOOK_CANDIDATES}}');
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
