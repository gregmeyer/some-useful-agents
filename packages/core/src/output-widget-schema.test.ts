import { describe, it, expect } from 'vitest';
import { outputWidgetSchema } from './output-widget-schema.js';
import { agentV2Schema } from './agent-v2-schema.js';
import { parseAgent } from './agent-yaml.js';
import { stringify as stringifyYaml } from 'yaml';

const baseDashboard = {
  type: 'dashboard' as const,
  fields: [
    { name: 'temp_c', type: 'metric' as const },
    { name: 'temp_f', type: 'metric' as const },
    { name: 'wind', type: 'stat' as const },
    { name: 'uv', type: 'text' as const },
  ],
};

describe('outputWidgetSchema controls', () => {
  it('accepts a replay control', () => {
    const r = outputWidgetSchema.safeParse({
      ...baseDashboard,
      controls: [{ type: 'replay', label: 'Refresh', inputs: ['CITY'] }],
    });
    expect(r.success).toBe(true);
  });

  it('accepts a field-toggle control referencing declared fields', () => {
    const r = outputWidgetSchema.safeParse({
      ...baseDashboard,
      controls: [{ type: 'field-toggle', label: 'Show', fields: ['uv'], default: 'hidden' }],
    });
    expect(r.success).toBe(true);
  });

  it('accepts a view-switch control', () => {
    const r = outputWidgetSchema.safeParse({
      ...baseDashboard,
      controls: [{
        type: 'view-switch', label: 'Units', default: 'metric',
        views: [
          { id: 'metric', fields: ['temp_c', 'wind'] },
          { id: 'imperial', fields: ['temp_f', 'wind'] },
        ],
      }],
    });
    expect(r.success).toBe(true);
  });

  it('accepts mixed control types in one widget', () => {
    const r = outputWidgetSchema.safeParse({
      ...baseDashboard,
      controls: [
        { type: 'replay' },
        { type: 'view-switch', label: 'Units', default: 'metric',
          views: [{ id: 'metric', fields: ['temp_c'] }, { id: 'imperial', fields: ['temp_f'] }] },
        { type: 'field-toggle', label: 'Optional', fields: ['uv'], default: 'hidden' },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('rejects field-toggle.fields[] that reference an undeclared widget field', () => {
    const r = outputWidgetSchema.safeParse({
      ...baseDashboard,
      controls: [{ type: 'field-toggle', label: 'Show', fields: ['nonexistent'], default: 'hidden' }],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message.includes('nonexistent'))).toBe(true);
    }
  });

  it('rejects view-switch.default not in views[].id', () => {
    const r = outputWidgetSchema.safeParse({
      ...baseDashboard,
      controls: [{
        type: 'view-switch', label: 'Units', default: 'kelvin',
        views: [{ id: 'metric', fields: ['temp_c'] }],
      }],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message.includes('kelvin'))).toBe(true);
    }
  });

  it('rejects empty views[] array', () => {
    const r = outputWidgetSchema.safeParse({
      ...baseDashboard,
      controls: [{ type: 'view-switch', label: 'Units', default: 'metric', views: [] }],
    });
    expect(r.success).toBe(false);
  });

  it('rejects view-switch.views[].fields[] referencing undeclared widget field', () => {
    const r = outputWidgetSchema.safeParse({
      ...baseDashboard,
      controls: [{
        type: 'view-switch', label: 'Units', default: 'metric',
        views: [{ id: 'metric', fields: ['ghost'] }],
      }],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message.includes('ghost'))).toBe(true);
    }
  });

  it('rejects field-toggle on ai-template widgets', () => {
    const r = outputWidgetSchema.safeParse({
      type: 'ai-template',
      template: '<div>{{outputs.x}}</div>',
      controls: [{ type: 'field-toggle', label: 'Show', fields: ['x'], default: 'hidden' }],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message.includes('ai-template'))).toBe(true);
    }
  });

  it('allows replay on ai-template widgets', () => {
    const r = outputWidgetSchema.safeParse({
      type: 'ai-template',
      template: '<div>{{outputs.x}}</div>',
      controls: [{ type: 'replay' }],
    });
    expect(r.success).toBe(true);
  });
});

describe('agentV2Schema cross-validation for replay.inputs', () => {
  const baseAgent = {
    id: 'weather',
    name: 'weather',
    status: 'active' as const,
    source: 'local' as const,
    version: 1,
    inputs: { CITY: { type: 'string', default: 'sf' } },
    nodes: [{ id: 'fetch', type: 'shell' as const, command: 'echo hi' }],
    outputWidget: {
      type: 'dashboard' as const,
      fields: [{ name: 'temp', type: 'metric' as const }],
    },
  };

  it('accepts replay.inputs naming a declared agent input', () => {
    const r = agentV2Schema.safeParse({
      ...baseAgent,
      outputWidget: { ...baseAgent.outputWidget, controls: [{ type: 'replay', inputs: ['CITY'] }] },
    });
    expect(r.success).toBe(true);
  });

  it('rejects replay.inputs naming an undeclared agent input', () => {
    const r = agentV2Schema.safeParse({
      ...baseAgent,
      outputWidget: { ...baseAgent.outputWidget, controls: [{ type: 'replay', inputs: ['NONEXISTENT'] }] },
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message.includes('NONEXISTENT'))).toBe(true);
    }
  });
});

describe('agent YAML round-trip preserves controls', () => {
  it('keeps controls intact through parse → stringify → parse', () => {
    const yaml = stringifyYaml({
      id: 'weather',
      name: 'weather',
      status: 'active',
      source: 'local',
      version: 1,
      inputs: { CITY: { type: 'string', default: 'sf' } },
      nodes: [{ id: 'fetch', type: 'shell', command: 'echo {"temp_c":20,"temp_f":68}' }],
      outputWidget: {
        type: 'dashboard',
        fields: [
          { name: 'temp_c', type: 'metric' },
          { name: 'temp_f', type: 'metric' },
        ],
        controls: [
          { type: 'replay', inputs: ['CITY'] },
          { type: 'view-switch', label: 'Units', default: 'metric',
            views: [
              { id: 'metric', fields: ['temp_c'] },
              { id: 'imperial', fields: ['temp_f'] },
            ] },
        ],
      },
    });
    const agent = parseAgent(yaml);
    expect(agent.outputWidget?.controls).toBeDefined();
    expect(agent.outputWidget?.controls).toHaveLength(2);
    expect(agent.outputWidget?.controls?.[0]).toMatchObject({ type: 'replay', inputs: ['CITY'] });
    expect(agent.outputWidget?.controls?.[1]).toMatchObject({ type: 'view-switch', default: 'metric' });
  });
});
