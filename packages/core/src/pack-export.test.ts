import { describe, it, expect } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { dashboardToPackManifest } from './pack-export.js';
import { packManifestSchema } from './pack-schema.js';
import type { Agent } from './agent-v2-types.js';
import type { Dashboard } from './dashboards-store.js';

function sampleAgent(id: string, overrides: Partial<Agent> = {}): Agent {
  return {
    id,
    name: id,
    status: 'active',
    source: 'local',
    mcp: false,
    nodes: [{ id: 'n', type: 'shell', command: 'echo hi', dependsOn: [] }],
    signal: { title: id, template: 'text-headline', mapping: { headline: 'h' } },
    version: 1,
    ...overrides,
  } as Agent;
}

function sampleDashboard(overrides: Partial<Dashboard> = {}): Dashboard {
  return {
    id: 'user:morning-briefing',
    packId: null,
    name: 'Morning Briefing',
    layout: { sections: [
      { title: 'News', agentIds: ['hn-top-stories'] },
      { title: 'Weather', agentIds: ['weather-forecast'] },
    ]},
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('dashboardToPackManifest', () => {
  it('produces a manifest with both agents inlined', () => {
    const dashboard = sampleDashboard();
    const agents = [sampleAgent('hn-top-stories'), sampleAgent('weather-forecast')];
    const result = dashboardToPackManifest({ dashboard, agents });
    expect(result.manifest.id).toBe('morning-briefing');
    expect(result.manifest.agents).toHaveLength(2);
    expect(result.manifest.agents?.[0].yaml).toContain('id: hn-top-stories');
    expect(result.manifest.dashboards?.[0].id).toBe('morning-briefing');
    expect(result.manifest.dashboards?.[0].sections).toHaveLength(2);
  });

  it('strips the namespace prefix from the inner dashboard id', () => {
    const result = dashboardToPackManifest({
      dashboard: sampleDashboard({ id: 'starter:media' }),
      agents: [],
    });
    expect(result.manifest.id).toBe('media');
    expect(result.manifest.dashboards?.[0].id).toBe('media');
  });

  it('reports missingAgentIds when an agent is referenced but not supplied', () => {
    const dashboard = sampleDashboard();
    const agents = [sampleAgent('hn-top-stories')]; // missing weather-forecast
    const result = dashboardToPackManifest({ dashboard, agents });
    expect(result.missingAgentIds).toEqual(['weather-forecast']);
    expect(result.manifest.agents).toHaveLength(1);
  });

  it('round-trips through packManifestSchema', () => {
    const dashboard = sampleDashboard();
    const agents = [sampleAgent('hn-top-stories'), sampleAgent('weather-forecast')];
    const result = dashboardToPackManifest({ dashboard, agents });
    // The YAML body should re-parse cleanly via the loader's schema.
    const parsedAgain = parseYaml(result.yaml) as unknown;
    const validation = packManifestSchema.safeParse(parsedAgain);
    expect(validation.success).toBe(true);
  });

  it('honours packId / packName / version overrides', () => {
    const result = dashboardToPackManifest({
      dashboard: sampleDashboard(),
      agents: [],
      packId: 'morning-pack',
      packName: 'My Morning Pack',
      version: '0.5.0',
      author: 'tester',
    });
    expect(result.manifest.id).toBe('morning-pack');
    expect(result.manifest.name).toBe('My Morning Pack');
    expect(result.manifest.version).toBe('0.5.0');
    expect(result.manifest.author).toBe('tester');
  });

  it('deduplicates agent ids when one appears in multiple sections', () => {
    const dashboard = sampleDashboard({
      layout: { sections: [
        { title: 'A', agentIds: ['shared'] },
        { title: 'B', agentIds: ['shared'] },
      ]},
    });
    const result = dashboardToPackManifest({ dashboard, agents: [sampleAgent('shared')] });
    expect(result.manifest.agents).toHaveLength(1);
  });
});
