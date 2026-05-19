import { describe, it, expect } from 'vitest';
import { layoutPlanSchema } from './layout-plan-schema.js';

const validPlan = {
  summary: 'Group monitoring and pin reliable agents.',
  topAgents: [
    { id: 'api-monitor', rationale: 'runs every 5 minutes, 100% success', suggestedSize: '2x1' as const },
    { id: 'weather-forecast', rationale: 'user mentioned weather', suggestedSize: '1x1' as const },
  ],
  containers: [
    { label: 'Monitoring', tiles: ['api-monitor'] },
    { label: 'Personal', tiles: ['weather-forecast'] },
  ],
  questions: [],
};

describe('layoutPlanSchema', () => {
  it('accepts a minimal well-formed plan', () => {
    const r = layoutPlanSchema.safeParse(validPlan);
    if (!r.success) console.log(r.error.issues);
    expect(r.success).toBe(true);
  });

  it('defaults questions to an empty array when omitted', () => {
    const { questions, ...rest } = validPlan;
    void questions;
    const r = layoutPlanSchema.safeParse(rest);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.questions).toEqual([]);
  });

  it('accepts questions with options for select-style rendering', () => {
    const r = layoutPlanSchema.safeParse({
      ...validPlan,
      questions: [
        { text: 'Rank by?', suggestedAnswer: 'recency', options: ['recency', 'reliability', 'frequency'] },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('rejects empty topAgents', () => {
    const r = layoutPlanSchema.safeParse({ ...validPlan, topAgents: [] });
    expect(r.success).toBe(false);
  });

  it('rejects empty containers', () => {
    const r = layoutPlanSchema.safeParse({ ...validPlan, containers: [] });
    expect(r.success).toBe(false);
  });

  it('rejects a container with no tiles', () => {
    const r = layoutPlanSchema.safeParse({
      ...validPlan,
      containers: [{ label: 'Empty', tiles: [] }],
    });
    expect(r.success).toBe(false);
  });

  it('rejects when the same tile appears in two containers', () => {
    const r = layoutPlanSchema.safeParse({
      ...validPlan,
      containers: [
        { label: 'A', tiles: ['api-monitor'] },
        { label: 'B', tiles: ['api-monitor'] }, // duplicate
      ],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message.includes('appears in containers'))).toBe(true);
    }
  });

  it('rejects duplicate container labels (case-insensitive)', () => {
    const r = layoutPlanSchema.safeParse({
      ...validPlan,
      containers: [
        { label: 'Monitoring', tiles: ['api-monitor'] },
        { label: 'monitoring', tiles: ['weather-forecast'] }, // collides
      ],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message.includes('duplicates'))).toBe(true);
    }
  });

  it('rejects duplicate topAgents ids', () => {
    const r = layoutPlanSchema.safeParse({
      ...validPlan,
      topAgents: [
        { id: 'api-monitor', rationale: 'a' },
        { id: 'api-monitor', rationale: 'b' },
      ],
    });
    expect(r.success).toBe(false);
  });

  it('rejects invalid suggestedSize values', () => {
    const r = layoutPlanSchema.safeParse({
      ...validPlan,
      topAgents: [{ id: 'api-monitor', rationale: 'a', suggestedSize: '5x5' }],
    });
    expect(r.success).toBe(false);
  });

  it('accepts a plan where topAgents and container tiles are disjoint', () => {
    // The full agent metadata reaches the planner; lower-ranked agents
    // may appear in containers without being promoted to topAgents.
    const r = layoutPlanSchema.safeParse({
      ...validPlan,
      topAgents: [{ id: 'api-monitor', rationale: 'critical' }],
      containers: [
        { label: 'Monitoring', tiles: ['api-monitor'] },
        { label: 'Side', tiles: ['some-other-agent'] }, // not in topAgents
      ],
    });
    expect(r.success).toBe(true);
  });

  it('rejects malformed agent ids', () => {
    const r = layoutPlanSchema.safeParse({
      ...validPlan,
      topAgents: [{ id: 'Api Monitor!', rationale: 'a' }],
    });
    expect(r.success).toBe(false);
  });

  it('accepts system-tile ids (leading underscore) in container.tiles', () => {
    const r = layoutPlanSchema.safeParse({
      ...validPlan,
      containers: [
        { label: 'Health', tiles: ['_system-runs-today', '_system-failure-rate'] },
        { label: 'Agents', tiles: ['api-monitor', 'weather-forecast'] },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('still rejects malformed tile ids that are neither agents nor system tiles', () => {
    const r = layoutPlanSchema.safeParse({
      ...validPlan,
      containers: [{ label: 'Bad', tiles: ['Has Spaces'] }],
    });
    expect(r.success).toBe(false);
  });

  it('rejects leading underscore in topAgents.id (real agents only)', () => {
    const r = layoutPlanSchema.safeParse({
      ...validPlan,
      topAgents: [{ id: '_system-runs-today', rationale: 'a' }],
    });
    expect(r.success).toBe(false);
  });

  it('requires a non-empty summary', () => {
    const r = layoutPlanSchema.safeParse({ ...validPlan, summary: '' });
    expect(r.success).toBe(false);
  });

  it('defaults toAdd to an empty array when omitted', () => {
    const r = layoutPlanSchema.safeParse(validPlan);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.toAdd).toEqual([]);
  });

  it('accepts toAdd when every id is placed in a container', () => {
    const r = layoutPlanSchema.safeParse({
      ...validPlan,
      containers: [
        { label: 'Monitoring', tiles: ['api-monitor'] },
        { label: 'Personal', tiles: ['weather-forecast', 'stock-ticker'] },
      ],
      toAdd: ['stock-ticker'],
    });
    expect(r.success).toBe(true);
  });

  it('rejects toAdd ids that are not placed in any container', () => {
    const r = layoutPlanSchema.safeParse({
      ...validPlan,
      toAdd: ['phantom-agent'],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message.includes('not placed in any container'))).toBe(true);
    }
  });

  it('rejects duplicate toAdd ids', () => {
    const r = layoutPlanSchema.safeParse({
      ...validPlan,
      containers: [
        { label: 'Monitoring', tiles: ['api-monitor', 'stock-ticker'] },
        { label: 'Personal', tiles: ['weather-forecast'] },
      ],
      toAdd: ['stock-ticker', 'stock-ticker'],
    });
    expect(r.success).toBe(false);
  });
});
