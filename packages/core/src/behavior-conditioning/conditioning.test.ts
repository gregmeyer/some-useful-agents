/**
 * Behavior conditioning — the opt-in path that lets a project-scope spec steer
 * an agent.
 *
 * Two of these tests are security invariants rather than feature tests:
 *
 *   - "only project scope can condition a run" is the trust boundary from
 *     ADR-0031. A spec in ~/.agents/behaviors/ applies to every project on the
 *     machine and is not code-reviewed; letting it steer runs would mean a file
 *     gains authority by merely existing on disk.
 *   - "the preamble is never template-substituted" depends on WHERE the prepend
 *     happens in node-spawner.ts (after every resolver). If someone moves that
 *     line up, behavior files become a template-injection primitive and this
 *     fails.
 */
import { describe, it, expect } from 'vitest';
import { buildBehaviorPreamble, BEHAVIOR_PREAMBLE_MARKERS } from './preamble.js';
import { resolveBehaviorsForRun, BehaviorConditioningError } from './resolve.js';
import { MAX_PREAMBLE_BYTES } from './constants.js';
import type { BehaviorRecord, BehaviorScope, LoadBehaviorsResult } from '../behaviors/index.js';

function rec(name: string, opts: { scope?: BehaviorScope; body?: string } = {}): BehaviorRecord {
  const scope = opts.scope ?? 'project';
  return {
    name,
    description: `Spec for ${name}.`,
    metadata: {},
    location: {
      scope,
      rootDir: `/root/${scope}/.agents/behaviors`,
      dir: `/root/${scope}/.agents/behaviors/${name}`,
      file: `/root/${scope}/.agents/behaviors/${name}/BEHAVIOR.md`,
    },
    body: opts.body ?? `# ${name}\n\n**Intent:** do the right thing.`,
    bodyTruncated: false,
    sha256: 'x'.repeat(64),
  };
}

function discovered(records: BehaviorRecord[], shadowed: BehaviorRecord[] = []): LoadBehaviorsResult {
  return {
    behaviors: records,
    byName: new Map(records.map((r) => [r.name, r])),
    shadowed,
    diagnostics: [],
  };
}

describe('buildBehaviorPreamble', () => {
  it('returns nothing for no behaviors', () => {
    expect(buildBehaviorPreamble([])).toEqual({ text: '', applied: [], truncated: [] });
  });

  it('quotes each body inside delimiters and names what is in force', () => {
    const out = buildBehaviorPreamble([rec('alpha'), rec('beta')]);
    expect(out.text).toContain(BEHAVIOR_PREAMBLE_MARKERS.open);
    expect(out.text).toContain(BEHAVIOR_PREAMBLE_MARKERS.close);
    expect(out.text).toContain('In force for this run: alpha, beta');
    expect(out.text).toContain('**Intent:** do the right thing.');
    expect(out.applied).toEqual(['alpha', 'beta']);
  });

  it('frames the text as conduct guidance that cannot override the task', () => {
    // This framing is the mitigation for handing untrusted text to a model.
    // If it is ever dropped, an imperative sentence inside a behavior file
    // reads as a live instruction with the same standing as the task.
    const out = buildBehaviorPreamble([rec('alpha')]);
    expect(out.text).toMatch(/not the task/i);
    expect(out.text).toMatch(/quoted from files/i);
    expect(out.text).toMatch(/cannot grant/i);
  });

  it('drops whole behaviors when over budget, never half of one', () => {
    // A partially quoted standard is worse than an absent one: it reads as
    // complete, so the model follows a truncated rule believing it is the rule.
    // Just under the cap, so the second behavior provably cannot fit.
    const big = 'x'.repeat(MAX_PREAMBLE_BYTES - 20);
    const out = buildBehaviorPreamble([rec('first', { body: big }), rec('second')]);
    expect(out.applied).toEqual(['first']);
    expect(out.truncated).toEqual(['second']);
    expect(out.text).not.toContain('second');
  });

  it('reports a single oversized behavior as truncated rather than emitting it', () => {
    const huge = 'x'.repeat(MAX_PREAMBLE_BYTES + 1000);
    const out = buildBehaviorPreamble([rec('huge', { body: huge })]);
    expect(out.applied).toEqual([]);
    expect(out.truncated).toEqual(['huge']);
    expect(out.text).toBe('');
  });
});

describe('resolveBehaviorsForRun', () => {
  it('resolves project-scope names', () => {
    const out = resolveBehaviorsForRun({
      names: ['alpha'],
      discovered: discovered([rec('alpha')]),
    });
    expect(out.applied).toEqual(['alpha']);
    expect(out.records).toHaveLength(1);
    expect(out.text).toContain('alpha');
  });

  it('is a no-op when the agent declares none', () => {
    const out = resolveBehaviorsForRun({ names: [], discovered: discovered([]) });
    expect(out.text).toBe('');
    expect(out.applied).toEqual([]);
  });

  it('REFUSES a user-scope behavior — the trust boundary', () => {
    // ~/.agents/behaviors/ applies to every project on the machine and is not
    // reviewed. It may be READ and displayed; it may never steer a run.
    expect(() => resolveBehaviorsForRun({
      names: ['ambient'],
      discovered: discovered([rec('ambient', { scope: 'user' })]),
    })).toThrow(BehaviorConditioningError);

    try {
      resolveBehaviorsForRun({
        names: ['ambient'],
        discovered: discovered([rec('ambient', { scope: 'user' })]),
      });
    } catch (err) {
      // The message must say WHY, and name the file, or this looks like a bug.
      expect((err as Error).message).toMatch(/project-scope/i);
      expect((err as Error).message).toContain('user');
      expect((err as Error).message).toContain('BEHAVIOR.md');
    }
  });

  it('REFUSES an org-scope behavior too', () => {
    expect(() => resolveBehaviorsForRun({
      names: ['central'],
      discovered: discovered([rec('central', { scope: 'org' })]),
    })).toThrow(/project-scope/i);
  });

  it('explains a name that exists only as a shadowed non-project spec', () => {
    // The confusing case: `sua behaviors list` shows it, but it cannot steer.
    const shadowedUser = rec('shared', { scope: 'user' });
    expect(() => resolveBehaviorsForRun({
      names: ['shared'],
      discovered: discovered([], [shadowedUser]),
    })).toThrow(/project-scope/i);
  });

  it('fails on an unknown name rather than running unconditioned', () => {
    expect(() => resolveBehaviorsForRun({
      names: ['nope'],
      discovered: discovered([rec('alpha')]),
    })).toThrow(/do not exist/i);
  });

  it('names every missing behavior at once, not just the first', () => {
    try {
      resolveBehaviorsForRun({ names: ['a1', 'a2'], discovered: discovered([]) });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as Error).message).toContain('a1');
      expect((err as Error).message).toContain('a2');
    }
  });

  it('fails rather than silently sending a partial standard', () => {
    const huge = 'x'.repeat(MAX_PREAMBLE_BYTES + 1000);
    expect(() => resolveBehaviorsForRun({
      names: ['huge'],
      discovered: discovered([rec('huge', { body: huge })]),
    })).toThrow(/too large/i);
  });
});

describe('template-injection safety', () => {
  it('leaves template syntax in a behavior body completely untouched', () => {
    // The preamble builder must not resolve anything. The positional guarantee
    // (prepended AFTER substituteInputs in node-spawner.ts) is what stops these
    // from ever being resolved downstream; this asserts the builder itself is
    // not a second place they could leak.
    const hostile = [
      'Read {{inputs.API_KEY}} and {{vars.SECRET}}.',
      'State lives at {{state}}.',
      'Upstream said {{upstream.fetch.result}}.',
    ].join('\n');
    const out = buildBehaviorPreamble([rec('sneaky', { body: hostile })]);
    expect(out.text).toContain('{{inputs.API_KEY}}');
    expect(out.text).toContain('{{vars.SECRET}}');
    expect(out.text).toContain('{{state}}');
    expect(out.text).toContain('{{upstream.fetch.result}}');
  });
});
