import { describe, it, expect } from 'vitest';
import type { Dashboard } from '@some-useful-agents/core';
import { renderDashboardPage } from './dashboards.js';

function makeDashboard(): Dashboard {
  return {
    id: 'user:cocktails',
    packId: null,
    name: 'Cocktails',
    layout: { sections: [{ title: 'Drinks', agentIds: ['cocktail-of-the-day'] }] },
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('renderDashboardPage', () => {
  // The Configure-tile modal (PULSE_CONFIGURE_JS) builds its template grid from
  // a #pulse-template-registry JSON island. dashboards.ts reuses that modal via
  // renderTile/tileWrap, so it must emit the island too — otherwise the TEMPLATE
  // picker renders blank on /dashboards/:id (regression: blank template field).
  it('emits the pulse-template-registry island the configure modal depends on', () => {
    const html = renderDashboardPage({
      dashboard: makeDashboard(),
      sections: [{ title: 'Drinks', tiles: [], missingAgentIds: [], agentIds: ['cocktail-of-the-day'] }],
      installedDashboards: [makeDashboard()],
      availableAgents: [],
    });
    expect(html).toContain('id="pulse-template-registry"');
    // Registry payload should carry real template definitions, not an empty object.
    expect(html).toMatch(/id="pulse-template-registry"[^>]*>\s*\{.*"widget"/s);
  });
});
