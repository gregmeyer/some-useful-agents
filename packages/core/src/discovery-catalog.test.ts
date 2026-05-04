import { describe, it, expect } from 'vitest';
import { buildDiscoveryCatalog, type TemplateDef } from './discovery-catalog.js';
import type { Agent } from './agent-v2-types.js';

const MOCK_REGISTRY: Record<string, TemplateDef> = {
  metric: {
    name: 'metric',
    displayName: 'Metric',
    slots: [
      { name: 'value', required: true, type: 'number' },
      { name: 'label', required: false, type: 'string' },
    ],
    defaultSize: '1x1',
  },
  status: {
    name: 'status',
    displayName: 'Status',
    slots: [
      { name: 'status', required: true, type: 'string' },
    ],
    defaultSize: '1x1',
  },
  widget: {
    name: 'widget',
    displayName: 'Output Widget',
    slots: [],
    defaultSize: '2x1',
  },
};

const MOCK_AGENTS: Agent[] = [
  {
    id: 'api-monitor',
    name: 'API Monitor',
    description: 'Monitor API endpoints',
    status: 'active',
    version: 1,
    nodes: [],
    inputs: { TARGET_URL: { type: 'string', required: true }, TIMEOUT: { type: 'number' } },
  } as unknown as Agent,
  {
    id: 'agent-builder',
    name: 'Agent Builder',
    description: 'Builds agents',
    status: 'active',
    source: 'examples',
    version: 1,
    nodes: [],
  } as unknown as Agent,
];

describe('buildDiscoveryCatalog', () => {
  it('includes all sections', () => {
    const catalog = buildDiscoveryCatalog({
      agents: MOCK_AGENTS,
      tools: [],
      templateRegistry: MOCK_REGISTRY,
    });

    expect(catalog).toContain('## NODE TYPES');
    expect(catalog).toContain('## SIGNAL TEMPLATES');
    expect(catalog).toContain('## OUTPUT WIDGET TYPES');
    expect(catalog).toContain('## AVAILABLE AGENTS');
    expect(catalog).toContain('## ARCHITECTURE PATTERNS');
    expect(catalog).toContain('## WIDGET & SIGNAL DESIGN');
  });

  it('lists node types', () => {
    const catalog = buildDiscoveryCatalog({ agents: [], tools: [], templateRegistry: {} });
    expect(catalog).toContain('- shell:');
    expect(catalog).toContain('- claude-code:');
    expect(catalog).toContain('- conditional:');
    expect(catalog).toContain('- loop:');
    expect(catalog).toContain('- agent-invoke:');
    expect(catalog).toContain('- branch:');
    expect(catalog).toContain('- end:');
    expect(catalog).toContain('- break:');
  });

  it('builds signal templates from registry', () => {
    const catalog = buildDiscoveryCatalog({
      agents: [],
      tools: [],
      templateRegistry: MOCK_REGISTRY,
    });

    expect(catalog).toContain('- metric (1x1): Metric. Required: value(number).');
    expect(catalog).toContain('- status (1x1): Status. Required: status(string).');
    // widget meta-template should be filtered out
    expect(catalog).not.toContain('Output Widget');
  });

  it('lists available agents excluding builder/analyzer', () => {
    const catalog = buildDiscoveryCatalog({
      agents: MOCK_AGENTS,
      tools: [],
      templateRegistry: {},
    });

    expect(catalog).toContain('- api-monitor:');
    expect(catalog).toContain('inputs: TARGET_URL, TIMEOUT');
    expect(catalog).not.toContain('agent-builder');
  });

  it('includes per-agent outputs when declared', () => {
    const catalog = buildDiscoveryCatalog({
      agents: [{
        id: 'hn-digest',
        name: 'HN Digest',
        description: 'Fetches HN top stories',
        status: 'active',
        version: 1,
        nodes: [],
        outputs: { articles: { type: 'array' }, count: { type: 'number' } },
      } as unknown as Agent],
      tools: [],
      templateRegistry: {},
    });
    expect(catalog).toContain('outputs: articles, count');
  });

  it('includes per-agent capabilities when present', () => {
    const catalog = buildDiscoveryCatalog({
      agents: [{
        id: 'notifier',
        name: 'Notifier',
        description: 'Sends alerts',
        status: 'active',
        version: 1,
        nodes: [],
        capabilities: {
          tools_used: ['shell-exec', 'http-post'],
          mcp_servers_used: [],
          side_effects: ['posts_http', 'sends_notifications'],
          reads_external: [],
        },
      } as unknown as Agent],
      tools: [],
      templateRegistry: {},
    });
    expect(catalog).toContain('tools: shell-exec, http-post');
    expect(catalog).toContain('side effects: posts_http, sends_notifications');
  });

  it('includes the new design-discipline section', () => {
    const catalog = buildDiscoveryCatalog({ agents: [], tools: [], templateRegistry: {} });
    expect(catalog).toContain('## DESIGN DISCIPLINE');
    expect(catalog).toContain('DECOMPOSE');
    expect(catalog).toContain('DECLARE OUTPUTS');
    expect(catalog).toContain('TEMPLATE SYNTAX');
    expect(catalog).toContain('FAIL FAST');
  });

  it('warns about widget field name semantics in OUTPUT WIDGET TYPES', () => {
    const catalog = buildDiscoveryCatalog({ agents: [], tools: [], templateRegistry: {} });
    expect(catalog).toContain('CRITICAL — OUTPUT WIDGET FIELD SCHEMA');
    expect(catalog).toContain('THE JSON KEY TO LOOK UP');
    // Names of common LLM mistakes that should be called out as wrong:
    expect(catalog).toContain('source:');
    expect(catalog).toContain('path:');
    expect(catalog).toContain('from:');
  });

  it('stays under 8000 chars with typical data (was 4000 before adding manifest detail)', () => {
    const catalog = buildDiscoveryCatalog({
      agents: MOCK_AGENTS,
      tools: [],
      templateRegistry: MOCK_REGISTRY,
    });
    expect(catalog.length).toBeLessThan(8000);
  });

  it('handles empty agents gracefully', () => {
    const catalog = buildDiscoveryCatalog({
      agents: [],
      tools: [],
      templateRegistry: MOCK_REGISTRY,
    });

    expect(catalog).toContain('No agents available yet.');
  });
});
