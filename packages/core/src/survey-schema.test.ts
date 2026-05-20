import { describe, it, expect } from 'vitest';
import { surveySchema, draftSchema, dashboardDesignSchema } from './survey-schema.js';

const validMixedSurvey = {
  intent: 'dashboard-mixed' as const,
  summary: 'Morning briefing dashboard',
  matchedAgents: [{ id: 'weather-forecast', matchedFor: "today's weather" }],
  fragments: [{ purpose: 'List the latest 10 markdown titles from a notes folder.', suggestedName: 'notes-list' }],
  existingDashboards: [],
  packSuggestions: [],
  questions: [],
};

describe('surveySchema', () => {
  it('accepts a minimal well-formed dashboard-mixed survey', () => {
    const r = surveySchema.safeParse(validMixedSurvey);
    expect(r.success).toBe(true);
  });

  it('defaults optional arrays when omitted', () => {
    const r = surveySchema.safeParse({
      intent: 'agent',
      summary: 'just one agent',
      fragments: [{ purpose: 'do the thing' }],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.matchedAgents).toEqual([]);
      expect(r.data.existingDashboards).toEqual([]);
      expect(r.data.packSuggestions).toEqual([]);
      expect(r.data.questions).toEqual([]);
    }
  });

  it('coerces existingDashboards string entries into objects', () => {
    const r = surveySchema.safeParse({
      ...validMixedSurvey,
      existingDashboards: ['user:morning'],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.existingDashboards[0]).toEqual({ id: 'user:morning', name: '', reason: '' });
    }
  });

  it('rejects intent="agent" with multiple fragments', () => {
    const r = surveySchema.safeParse({
      intent: 'agent',
      summary: 's',
      fragments: [{ purpose: 'a' }, { purpose: 'b' }],
    });
    expect(r.success).toBe(false);
  });

  it('rejects intent="dashboard-existing" with non-empty fragments', () => {
    const r = surveySchema.safeParse({
      intent: 'dashboard-existing',
      summary: 's',
      fragments: [{ purpose: 'a' }],
      matchedAgents: [{ id: 'a-b', matchedFor: 'x' }],
    });
    expect(r.success).toBe(false);
  });

  it('rejects intent="dashboard-new" with non-empty matchedAgents', () => {
    const r = surveySchema.safeParse({
      intent: 'dashboard-new',
      summary: 's',
      fragments: [{ purpose: 'a' }],
      matchedAgents: [{ id: 'a-b', matchedFor: 'x' }],
    });
    expect(r.success).toBe(false);
  });

  it('rejects intent="dashboard-mixed" with empty fragments', () => {
    const r = surveySchema.safeParse({
      intent: 'dashboard-mixed',
      summary: 's',
      matchedAgents: [{ id: 'a-b', matchedFor: 'x' }],
      fragments: [],
    });
    expect(r.success).toBe(false);
  });

  it('rejects malformed matchedAgents.id', () => {
    const r = surveySchema.safeParse({
      ...validMixedSurvey,
      matchedAgents: [{ id: 'Weather Forecast', matchedFor: 'x' }],
    });
    expect(r.success).toBe(false);
  });

  it('rejects malformed fragments.suggestedName', () => {
    const r = surveySchema.safeParse({
      ...validMixedSurvey,
      fragments: [{ purpose: 'p', suggestedName: 'Notes List' }],
    });
    expect(r.success).toBe(false);
  });
});

describe('draftSchema', () => {
  it('accepts a complete draft', () => {
    const r = draftSchema.safeParse({
      id: 'stock-ticker',
      purpose: 'show stock prices',
      yaml: 'id: stock-ticker\nname: Stock\n...',
    });
    expect(r.success).toBe(true);
  });

  it('rejects malformed id', () => {
    const r = draftSchema.safeParse({
      id: 'Stock Ticker',
      purpose: 'show stock prices',
      yaml: 'id: stock-ticker\n',
    });
    expect(r.success).toBe(false);
  });

  it('rejects empty yaml', () => {
    const r = draftSchema.safeParse({ id: 'x', purpose: 'p', yaml: '' });
    expect(r.success).toBe(false);
  });
});

describe('dashboardDesignSchema', () => {
  it('accepts a valid design', () => {
    const r = dashboardDesignSchema.safeParse({
      id: 'user:morning',
      name: 'Morning Briefing',
      sections: [{ title: 'News', agentIds: ['hn-top-stories'] }],
    });
    expect(r.success).toBe(true);
  });

  it('rejects dashboard.id without user: prefix', () => {
    const r = dashboardDesignSchema.safeParse({
      id: 'morning',
      name: 'Morning',
      sections: [{ title: 'X', agentIds: ['a'] }],
    });
    expect(r.success).toBe(false);
  });

  it('rejects empty sections', () => {
    const r = dashboardDesignSchema.safeParse({
      id: 'user:a',
      name: 'A',
      sections: [],
    });
    expect(r.success).toBe(false);
  });

  it('rejects section with empty agentIds', () => {
    const r = dashboardDesignSchema.safeParse({
      id: 'user:a',
      name: 'A',
      sections: [{ title: 'X', agentIds: [] }],
    });
    expect(r.success).toBe(false);
  });
});
