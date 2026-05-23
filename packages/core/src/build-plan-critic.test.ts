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

describe('critiquePlan ai-template path checks', () => {
  const yamlWithTemplate = (template: string) =>
    `id: pitching\nname: Pitching\nnodes:\n  - id: n1\n    type: shell\n    command: echo hi\noutputWidget:\n  type: ai-template\n  template: |\n    ${template.replace(/\n/g, '\n    ')}\n`;

  it('flags outer nested outputs.X.Y paths', () => {
    const result = critiquePlan(
      planFor({
        newAgents: [{ id: 'pitching', purpose: 'p', yaml: yamlWithTemplate('<h2>{{outputs.featured_duel.title}}</h2>') }],
      }),
      { existingAgentIds: new Set() },
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.message.includes('outputs.featured_duel.title'))).toBe(true);
  });

  it('flags nested item.X.Y paths inside #each', () => {
    const result = critiquePlan(
      planFor({
        newAgents: [{ id: 'pitching', purpose: 'p', yaml: yamlWithTemplate(
          '{{#each outputs.games as item}}<td>{{item.away_pitcher.name}}</td>{{/each}}',
        ) }],
      }),
      { existingAgentIds: new Set() },
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.message.includes('item.away_pitcher.name'))).toBe(true);
  });

  it('passes single-level outputs and item paths', () => {
    const result = critiquePlan(
      planFor({
        newAgents: [{ id: 'pitching', purpose: 'p', yaml: yamlWithTemplate(
          '<h2>{{outputs.title}}</h2>{{#each outputs.games as item}}<td>{{item.away_pitcher_name}}</td>{{/each}}',
        ) }],
      }),
      { existingAgentIds: new Set() },
    );
    expect(result.ok).toBe(true);
  });
});

describe('critiquePlan CSP img-src checks', () => {
  const yamlWithImgTemplate = (template: string, declaredHosts: string[] = []) => {
    // Wildcard hosts begin with `*.` which YAML reads as an alias unless
    // single-quoted. Always quote to keep the test fixture predictable.
    const permissions = declaredHosts.length === 0
      ? ''
      : `permissions:\n  imgSrc:\n${declaredHosts.map((h) => `    - '${h}'`).join('\n')}\n`;
    return `id: drinks\nname: Drinks\nnodes:\n  - id: n1\n    type: shell\n    command: echo hi\n${permissions}outputWidget:\n  type: ai-template\n  template: |\n    ${template.replace(/\n/g, '\n    ')}\n`;
  };

  it('flags an <img> host not declared in permissions.imgSrc', () => {
    const result = critiquePlan(
      planFor({
        newAgents: [{
          id: 'drinks',
          purpose: 'p',
          yaml: yamlWithImgTemplate('<img src="https://www.thecocktaildb.com/images/drink.jpg">'),
        }],
      }),
      { existingAgentIds: new Set() },
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.message.includes('www.thecocktaildb.com') && e.path.endsWith('permissions.imgSrc'))).toBe(true);
  });

  it('accepts an <img> host that IS declared in permissions.imgSrc', () => {
    const result = critiquePlan(
      planFor({
        newAgents: [{
          id: 'drinks',
          purpose: 'p',
          yaml: yamlWithImgTemplate(
            '<img src="https://www.thecocktaildb.com/images/drink.jpg">',
            ['www.thecocktaildb.com'],
          ),
        }],
      }),
      { existingAgentIds: new Set() },
    );
    expect(result.ok).toBe(true);
  });

  it('accepts a host matched by a wildcard subdomain declaration', () => {
    const result = critiquePlan(
      planFor({
        newAgents: [{
          id: 'drinks',
          purpose: 'p',
          yaml: yamlWithImgTemplate(
            '<img src="https://www.thecocktaildb.com/img.jpg">',
            ['*.thecocktaildb.com'],
          ),
        }],
      }),
      { existingAgentIds: new Set() },
    );
    expect(result.ok).toBe(true);
  });

  it('does not flag data: image URIs (already allowed by baseline CSP)', () => {
    const result = critiquePlan(
      planFor({
        newAgents: [{
          id: 'drinks',
          purpose: 'p',
          yaml: yamlWithImgTemplate('<img src="data:image/png;base64,iVBORw0KGgo=">'),
        }],
      }),
      { existingAgentIds: new Set() },
    );
    expect(result.ok).toBe(true);
  });
});

describe('critiquePlan signal.template vs outputWidget', () => {
  const yamlWidgetSignal = (signalTemplate: string) =>
    `id: drinks\nname: Drinks\nnodes:\n  - id: n1\n    type: shell\n    command: echo hi\nsignal:\n  title: Drinks\n  template: ${signalTemplate}\noutputWidget:\n  type: ai-template\n  template: |\n    <h2>{{outputs.name}}</h2>\n`;

  it('flags an outputWidget agent whose signal.template is not "widget"', () => {
    const result = critiquePlan(
      planFor({ newAgents: [{ id: 'drinks', purpose: 'p', yaml: yamlWidgetSignal('text-image') }] }),
      { existingAgentIds: new Set() },
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path.endsWith('signal.template') && e.message.includes('widget'))).toBe(true);
  });

  it('accepts an outputWidget agent with signal.template: widget', () => {
    const result = critiquePlan(
      planFor({ newAgents: [{ id: 'drinks', purpose: 'p', yaml: yamlWidgetSignal('widget') }] }),
      { existingAgentIds: new Set() },
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
