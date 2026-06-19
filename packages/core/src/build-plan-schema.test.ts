import { describe, it, expect } from 'vitest';
import { buildPlanSchema, extractPlanJson, extractTaggedJson, type BuildPlanInput } from './build-plan-schema.js';

function basePlan(overrides: Partial<BuildPlanInput> = {}): BuildPlanInput {
  return {
    intent: 'agent',
    summary: 'A single XKCD-fetcher agent',
    survey: { matchedAgents: [], missingFor: [], existingDashboards: [] },
    newAgents: [{ id: 'xkcd', purpose: 'fetch latest', yaml: 'id: xkcd\nname: x\n' }],
    dashboard: null,
    questions: [],
    ...overrides,
  };
}

describe('buildPlanSchema', () => {
  it('accepts a minimal agent-only plan', () => {
    const plan = buildPlanSchema.parse(basePlan());
    expect(plan.intent).toBe('agent');
    expect(plan.newAgents).toHaveLength(1);
    expect(plan.dashboard).toBeNull();
  });

  it('fills in defaults for omitted survey + arrays', () => {
    const plan = buildPlanSchema.parse({
      intent: 'agent',
      summary: 'X',
      newAgents: [{ id: 'x', purpose: 'p', yaml: 'id: x\n' }],
    });
    expect(plan.survey.matchedAgents).toEqual([]);
    expect(plan.questions).toEqual([]);
    expect(plan.dashboard).toBeNull();
  });

  it('rejects intent="agent" with a dashboard', () => {
    expect(() => buildPlanSchema.parse(basePlan({
      dashboard: { id: 'user:x', name: 'X', sections: [{ title: 'T', agentIds: ['xkcd'] }] },
    }))).toThrow(/dashboard=null/);
  });

  it('rejects intent="agent" with multiple new agents', () => {
    expect(() => buildPlanSchema.parse(basePlan({
      newAgents: [
        { id: 'a', purpose: 'p', yaml: 'id: a\n' },
        { id: 'b', purpose: 'p', yaml: 'id: b\n' },
      ],
    }))).toThrow(/exactly one/);
  });

  it('rejects dashboard intents without a dashboard', () => {
    expect(() => buildPlanSchema.parse(basePlan({
      intent: 'dashboard-mixed',
      newAgents: [{ id: 'a', purpose: 'p', yaml: 'id: a\n' }],
      dashboard: null,
    }))).toThrow(/requires a dashboard/);
  });

  it('rejects dashboard-existing with new agents', () => {
    expect(() => buildPlanSchema.parse(basePlan({
      intent: 'dashboard-existing',
      newAgents: [{ id: 'a', purpose: 'p', yaml: 'id: a\n' }],
      dashboard: { id: 'user:x', name: 'X', sections: [{ title: 'T', agentIds: ['weather-forecast'] }] },
      survey: { matchedAgents: [{ id: 'weather-forecast', matchedFor: 'weather' }], missingFor: [], existingDashboards: [] },
    }))).toThrow(/must not include new agents/);
  });

  it('rejects dashboards referencing unknown agent ids', () => {
    expect(() => buildPlanSchema.parse(basePlan({
      intent: 'dashboard-mixed',
      newAgents: [{ id: 'notes', purpose: 'p', yaml: 'id: notes\n' }],
      dashboard: { id: 'user:x', name: 'X', sections: [{ title: 'T', agentIds: ['ghost'] }] },
    }))).toThrow(/hallucinated/);
  });

  it('accepts dashboard-mixed with existing + new agent ids', () => {
    const plan = buildPlanSchema.parse(basePlan({
      intent: 'dashboard-mixed',
      newAgents: [{ id: 'notes-list', purpose: 'p', yaml: 'id: notes-list\n' }],
      dashboard: {
        id: 'user:morning',
        name: 'Morning',
        sections: [
          { title: 'News', agentIds: ['hn-top-stories'] },
          { title: 'Notes', agentIds: ['notes-list'] },
        ],
      },
      survey: {
        matchedAgents: [{ id: 'hn-top-stories', matchedFor: 'top stories on HN' }],
        missingFor: ['notes list'],
        existingDashboards: [],
      },
    }));
    expect(plan.dashboard?.sections).toHaveLength(2);
  });

  it('coerces existingDashboards string entries into objects', () => {
    // Surfaced by the smoke runner: real planner output emits
    // `existingDashboards: ["dash-1", "dash-2"]` instead of the
    // canonical {id, name?, reason?} shape. We coerce strings into
    // objects so the rest of the plan still validates.
    const plan = buildPlanSchema.parse({
      intent: 'dashboard-mixed',
      summary: 's',
      survey: { matchedAgents: [], missingFor: [], existingDashboards: ['user:home', 'user:work'] },
      newAgents: [{ id: 'a', purpose: 'p', yaml: 'id: a\nname: A\n' }],
      dashboard: { id: 'user:d', name: 'D', sections: [{ title: 'T', agentIds: ['a'] }] },
    });
    expect(plan.survey.existingDashboards).toEqual([
      { id: 'user:home', name: '', reason: '' },
      { id: 'user:work', name: '', reason: '' },
    ]);
  });

  it('still accepts the canonical {id,name,reason} object shape', () => {
    const plan = buildPlanSchema.parse({
      intent: 'dashboard-mixed',
      summary: 's',
      survey: {
        matchedAgents: [],
        missingFor: [],
        existingDashboards: [{ id: 'user:x', name: 'X', reason: 'because' }],
      },
      newAgents: [{ id: 'a', purpose: 'p', yaml: 'id: a\nname: A\n' }],
      dashboard: { id: 'user:d', name: 'D', sections: [{ title: 'T', agentIds: ['a'] }] },
    });
    expect(plan.survey.existingDashboards[0]).toEqual({ id: 'user:x', name: 'X', reason: 'because' });
  });

  it('rejects user dashboard ids without the user: prefix', () => {
    expect(() => buildPlanSchema.parse(basePlan({
      intent: 'dashboard-new',
      newAgents: [{ id: 'a', purpose: 'p', yaml: 'id: a\n' }],
      dashboard: { id: 'morning', name: 'M', sections: [{ title: 'T', agentIds: ['a'] }] },
    }))).toThrow(/user:/);
  });
});

describe('extractPlanJson', () => {
  it('extracts from <plan>…</plan> wrapper', () => {
    const out = extractPlanJson('Here is the plan:\n<plan>{"intent":"agent"}</plan>\nDone.');
    expect(out).toBe('{"intent":"agent"}');
  });

  it('extracts from ```json fence', () => {
    const out = extractPlanJson('```json\n{"intent":"agent"}\n```');
    expect(out).toBe('{"intent":"agent"}');
  });

  it('extracts from bare ``` fence', () => {
    const out = extractPlanJson('```\n{"intent":"agent"}\n```');
    expect(out).toBe('{"intent":"agent"}');
  });

  it('returns the input as-is when it looks like bare JSON', () => {
    const out = extractPlanJson('  {"intent":"agent"}  ');
    expect(out).toBe('{"intent":"agent"}');
  });

  it('returns null when no plan block is found', () => {
    expect(extractPlanJson('Sorry, I can\'t do that.')).toBeNull();
  });
});

describe('extractTaggedJson', () => {
  it('extracts from a custom <learning>…</learning> wrapper', () => {
    const out = extractTaggedJson('Result:\n<learning>{"lesson":"do X"}</learning>\nok', 'learning');
    expect(out).toBe('{"lesson":"do X"}');
  });

  it('is case-insensitive on the tag', () => {
    expect(extractTaggedJson('<LEARNING>{"lesson":null}</LEARNING>', 'learning')).toBe('{"lesson":null}');
  });

  it('falls back to a ```json fence, then bare JSON', () => {
    expect(extractTaggedJson('```json\n{"lesson":"y"}\n```', 'learning')).toBe('{"lesson":"y"}');
    expect(extractTaggedJson('  {"lesson":"z"}  ', 'learning')).toBe('{"lesson":"z"}');
  });

  it('returns null when nothing matches', () => {
    expect(extractTaggedJson('no json here', 'learning')).toBeNull();
  });
});
