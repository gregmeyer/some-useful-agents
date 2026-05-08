import { describe, it, expect } from 'vitest';
import { critiquePlan, formatCriticFeedback } from './build-plan-critic.js';
import { buildPlanSchema, type BuildPlanInput } from './build-plan-schema.js';

const validYaml = (id: string) => `id: ${id}\nname: ${id} agent\nnodes:\n  - id: n1\n    type: shell\n    command: echo hi\n`;

function planFor(overrides: Partial<BuildPlanInput> = {}): ReturnType<typeof buildPlanSchema.parse> {
  return buildPlanSchema.parse({
    intent: 'agent',
    summary: 'A test plan',
    survey: { matchedAgents: [], missingFor: [], existingDashboards: [] },
    newAgents: [{ id: 'one', purpose: 'p', yaml: validYaml('one') }],
    dashboard: null,
    questions: [],
    ...overrides,
  });
}

describe('critiquePlan', () => {
  it('passes a clean single-agent plan', () => {
    const result = critiquePlan(planFor(), { existingAgentIds: new Set() });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('flags YAML that fails parseAgent', () => {
    const result = critiquePlan(
      planFor({ newAgents: [{ id: 'broken', purpose: 'p', yaml: 'id: broken\n' /* missing name */ }] }),
      { existingAgentIds: new Set() },
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0].path).toBe('newAgents[0].yaml');
    expect(result.errors[0].message).toMatch(/failed to parse/i);
  });

  it('flags YAML id mismatch with plan ref id', () => {
    const result = critiquePlan(
      planFor({ newAgents: [{ id: 'planref', purpose: 'p', yaml: validYaml('different') }] }),
      { existingAgentIds: new Set() },
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /id field is "different"/.test(e.message))).toBe(true);
  });

  it('flags duplicate newAgents.id', () => {
    const result = critiquePlan(
      buildPlanSchema.parse({
        intent: 'dashboard-new',
        summary: 'dup',
        newAgents: [
          { id: 'dup', purpose: 'p', yaml: validYaml('dup') },
          { id: 'dup', purpose: 'p', yaml: validYaml('dup') },
        ],
        dashboard: { id: 'user:d', name: 'D', sections: [{ title: 'T', agentIds: ['dup'] }] },
      }),
      { existingAgentIds: new Set() },
    );
    expect(result.errors.some((e) => /Duplicate newAgents.id/.test(e.message))).toBe(true);
  });

  it('flags survey.matchedAgents that are not actually installed', () => {
    const result = critiquePlan(
      buildPlanSchema.parse({
        intent: 'dashboard-mixed',
        summary: 's',
        survey: { matchedAgents: [{ id: 'phantom', matchedFor: 'x' }], missingFor: [], existingDashboards: [] },
        newAgents: [{ id: 'real', purpose: 'p', yaml: validYaml('real') }],
        dashboard: { id: 'user:d', name: 'D', sections: [{ title: 'T', agentIds: ['phantom', 'real'] }] },
      }),
      { existingAgentIds: new Set(['something-else']) },
    );
    expect(result.errors.some((e) => /not installed/.test(e.message))).toBe(true);
  });

  it('flags dashboard agentIds that resolve to neither newAgents nor catalog', () => {
    // Schema would normally reject this, but here we force it via a matched
    // agent that the schema thinks is real (matched can be hallucinated).
    const result = critiquePlan(
      buildPlanSchema.parse({
        intent: 'dashboard-existing',
        summary: 's',
        survey: { matchedAgents: [{ id: 'ghost', matchedFor: 'x' }], missingFor: [], existingDashboards: [] },
        newAgents: [],
        dashboard: { id: 'user:d', name: 'D', sections: [{ title: 'T', agentIds: ['ghost'] }] },
      }),
      { existingAgentIds: new Set() },
    );
    expect(result.errors.some((e) => /no installed agent or newAgent/.test(e.message))).toBe(true);
  });

  it('flags loopConfig.agentId that does not resolve', () => {
    const yaml = `id: orchestrator\nname: orch\nnodes:\n  - id: loop1\n    type: loop\n    loopConfig:\n      over: \"items\"\n      agentId: missing-target\n`;
    const result = critiquePlan(
      planFor({ newAgents: [{ id: 'orchestrator', purpose: 'p', yaml }] }),
      { existingAgentIds: new Set() },
    );
    expect(result.errors.some((e) => /loopConfig.agentId/.test(e.path) && /missing-target/.test(e.message))).toBe(true);
  });

  it('accepts loopConfig.agentId that points at another newAgent in the same plan', () => {
    const orchestratorYaml = `id: orchestrator\nname: orch\nnodes:\n  - id: loop1\n    type: loop\n    loopConfig:\n      over: \"items\"\n      agentId: worker\n`;
    const result = critiquePlan(
      buildPlanSchema.parse({
        intent: 'dashboard-new',
        summary: 's',
        newAgents: [
          { id: 'orchestrator', purpose: 'p', yaml: orchestratorYaml },
          { id: 'worker', purpose: 'p', yaml: validYaml('worker') },
        ],
        dashboard: { id: 'user:d', name: 'D', sections: [{ title: 'T', agentIds: ['orchestrator'] }] },
      }),
      { existingAgentIds: new Set() },
    );
    expect(result.ok).toBe(true);
  });

  it('accepts agentInvokeConfig.agentId that points at an installed catalog agent', () => {
    const yaml = `id: caller\nname: caller\nnodes:\n  - id: invoke1\n    type: agent-invoke\n    agentInvokeConfig:\n      agentId: catalog-agent\n`;
    const result = critiquePlan(
      planFor({ newAgents: [{ id: 'caller', purpose: 'p', yaml }] }),
      { existingAgentIds: new Set(['catalog-agent']) },
    );
    expect(result.ok).toBe(true);
  });
});

describe('formatCriticFeedback', () => {
  it('returns empty string when no errors', () => {
    expect(formatCriticFeedback([])).toBe('');
  });

  it('renders each error as a bullet line under a header', () => {
    const out = formatCriticFeedback([
      { path: 'a.b', message: 'thing one' },
      { path: 'c[0]', message: 'thing two' },
    ]);
    expect(out).toMatch(/Critic feedback/);
    expect(out).toMatch(/- a\.b: thing one/);
    expect(out).toMatch(/- c\[0\]: thing two/);
  });
});
