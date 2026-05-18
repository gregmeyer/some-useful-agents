import { describe, it, expect } from 'vitest';
import type { BuildPlan } from '../build-plan-schema.js';
import { smokeRunNewAgents, validateOnly, formatSmokeFeedback } from './eval-smoke-run.js';
import { parseAgent } from '../agent-yaml.js';

const TRIVIAL_YAML = `
id: trivial
name: trivial
nodes:
  - id: a
    type: shell
    command: echo hi
`;

function planWith(yamls: Array<{ id: string; yaml: string }>): BuildPlan {
  return {
    intent: 'agent',
    summary: 's',
    survey: { matchedAgents: [], missingFor: [], existingDashboards: [] },
    newAgents: yamls.map((y) => ({ id: y.id, purpose: 'p', yaml: y.yaml })),
    questions: [],
    dashboard: null,
  };
}

describe('smokeRunNewAgents', () => {
  it('passes when every newAgent parses + validates', () => {
    const r = smokeRunNewAgents(planWith([{ id: 'trivial', yaml: TRIVIAL_YAML }]));
    expect(r.ok).toBe(true);
    expect(r.perAgent).toEqual([]);
  });

  it('flags unparseable YAML as a per-agent error', () => {
    const r = smokeRunNewAgents(planWith([{ id: 'broken', yaml: '!!!not valid yaml' }]));
    expect(r.ok).toBe(false);
    expect(r.perAgent).toHaveLength(1);
    expect(r.perAgent[0].agentId).toBe('broken');
    expect(r.perAgent[0].errors[0].path).toBe('yaml');
  });

  it('aggregates errors across multiple newAgents', () => {
    const r = smokeRunNewAgents(planWith([
      { id: 'good', yaml: TRIVIAL_YAML },
      { id: 'bad1', yaml: '!!!nope' },
      { id: 'bad2', yaml: 'also bad' },
    ]));
    expect(r.ok).toBe(false);
    expect(r.perAgent.map((a) => a.agentId).sort()).toEqual(['bad1', 'bad2']);
  });
});

describe('validateOnly', () => {
  it('flags shell tool refs that aren\'t in the known-tools set', () => {
    const agent = parseAgent(`
id: tooluser
name: tooluser
nodes:
  - id: a
    type: shell
    tool: nonexistent-tool
`);
    const errs = validateOnly(agent, { knownToolIds: new Set(['file-read', 'http-get']) });
    expect(errs).toHaveLength(1);
    expect(errs[0].path).toBe('nodes.0.tool');
    expect(errs[0].message).toContain('nonexistent-tool');
  });

  it('skips tool-id checks when knownToolIds is empty (test-harness escape hatch)', () => {
    const agent = parseAgent(`
id: tooluser
name: tooluser
nodes:
  - id: a
    type: shell
    tool: anything-goes
`);
    expect(validateOnly(agent, { knownToolIds: new Set() })).toEqual([]);
    expect(validateOnly(agent, {})).toEqual([]);
  });

  it('flags signal.mapping fields that don\'t match a declared output key', () => {
    const agent = parseAgent(`
id: mapper
name: mapper
outputs:
  headline:
    type: string
nodes:
  - id: a
    type: shell
    command: echo hi
signal:
  title: T
  icon: x
  template: text-headline
  mapping:
    headline: headline      # ok — declared
    title: not_declared     # not ok — not in outputs
  refresh: 1h
  size: 1x1
`);
    const errs = validateOnly(agent);
    expect(errs).toHaveLength(1);
    expect(errs[0].path).toBe('signal.mapping.title');
    expect(errs[0].message).toContain('not_declared');
  });

  it('treats mapping values with spaces / punctuation as literal text (not output refs)', () => {
    const agent = parseAgent(`
id: literal
name: literal
outputs:
  headline:
    type: string
nodes:
  - id: a
    type: shell
    command: echo hi
signal:
  title: T
  icon: x
  template: text-headline
  mapping:
    headline: "Hello, world!"
  refresh: 1h
  size: 1x1
`);
    expect(validateOnly(agent)).toEqual([]);
  });

  it('flags typed-widget field names not in declared outputs', () => {
    const agent = parseAgent(`
id: widget
name: widget
outputs:
  count:
    type: number
nodes:
  - id: a
    type: shell
    command: echo hi
outputWidget:
  type: dashboard
  fields:
    - name: count
      type: metric
    - name: missing
      type: stat
`);
    const errs = validateOnly(agent);
    expect(errs).toHaveLength(1);
    expect(errs[0].path).toBe('outputWidget.fields.1.name');
    expect(errs[0].message).toContain('missing');
  });

  it('skips widget field checks for ai-template widgets', () => {
    const agent = parseAgent(`
id: tpl
name: tpl
outputs:
  headline:
    type: string
nodes:
  - id: a
    type: shell
    command: echo hi
outputWidget:
  type: ai-template
  template: "<h1>{{outputs.headline}}</h1>"
`);
    expect(validateOnly(agent)).toEqual([]);
  });
});

describe('formatSmokeFeedback', () => {
  it('returns empty string when smoke passed', () => {
    expect(formatSmokeFeedback({ ok: true, perAgent: [] })).toBe('');
  });

  it('renders per-agent errors as a bulleted block', () => {
    const out = formatSmokeFeedback({
      ok: false,
      perAgent: [{
        agentId: 'a1',
        errors: [{ path: 'nodes.0.tool', message: 'unknown' }],
      }],
    });
    expect(out).toContain('newAgent "a1"');
    expect(out).toContain('nodes.0.tool: unknown');
  });
});
