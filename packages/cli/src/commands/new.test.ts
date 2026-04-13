import { describe, it, expect } from 'vitest';
import { parse as yamlParse } from 'yaml';
import { agentDefinitionSchema } from '@some-useful-agents/core';
import { buildAgentYaml, type AgentAnswers } from './new.js';

function shell(overrides: Partial<AgentAnswers> = {}): AgentAnswers {
  return {
    name: 'my-agent',
    type: 'shell',
    command: 'echo hi',
    ...overrides,
  };
}

function claude(overrides: Partial<AgentAnswers> = {}): AgentAnswers {
  return {
    name: 'my-claude-agent',
    type: 'claude-code',
    prompt: 'Say hi.',
    ...overrides,
  };
}

describe('buildAgentYaml', () => {
  it('emits a minimum-viable shell agent', () => {
    const yaml = buildAgentYaml(shell());
    const parsed = yamlParse(yaml);
    expect(parsed).toEqual({ name: 'my-agent', type: 'shell', command: 'echo hi' });
  });

  it('emits a minimum-viable claude-code agent', () => {
    const yaml = buildAgentYaml(claude());
    const parsed = yamlParse(yaml);
    expect(parsed).toEqual({ name: 'my-claude-agent', type: 'claude-code', prompt: 'Say hi.' });
  });

  it('orders keys: identity → type → execution → schedule → capabilities', () => {
    const yaml = buildAgentYaml(
      shell({
        description: 'does a thing',
        timeout: 60,
        schedule: '0 9 * * *',
        secrets: ['MY_KEY'],
        mcp: true,
        redactSecrets: true,
      }),
    );
    const lines = yaml
      .split('\n')
      .filter(l => l && !l.startsWith(' ') && !l.startsWith('-'))
      .map(l => l.split(':')[0]);
    expect(lines).toEqual([
      'name',
      'description',
      'type',
      'command',
      'timeout',
      'schedule',
      'secrets',
      'mcp',
      'redactSecrets',
    ]);
  });

  it('skips optional fields when not set', () => {
    const yaml = buildAgentYaml(shell({ description: undefined }));
    expect(yaml).not.toContain('description');
    expect(yaml).not.toContain('schedule');
    expect(yaml).not.toContain('secrets');
    expect(yaml).not.toContain('mcp:');
    expect(yaml).not.toContain('redactSecrets');
  });

  it('drops mcp and redactSecrets when false', () => {
    const yaml = buildAgentYaml(shell({ mcp: false, redactSecrets: false }));
    expect(yaml).not.toContain('mcp:');
    expect(yaml).not.toContain('redactSecrets');
  });

  it('includes model only for claude-code agents that specify one', () => {
    const withModel = buildAgentYaml(claude({ model: 'claude-sonnet-4-20250514' }));
    expect(withModel).toContain('model: claude-sonnet-4-20250514');
    const withoutModel = buildAgentYaml(claude({ model: undefined }));
    expect(withoutModel).not.toContain('model:');
  });

  it('does not leak shell fields into a claude-code agent', () => {
    const yaml = buildAgentYaml(claude({ command: 'oops', prompt: 'do X' }));
    const parsed = yamlParse(yaml);
    expect(parsed.command).toBeUndefined();
    expect(parsed.prompt).toBe('do X');
  });

  it('does not leak claude-code fields into a shell agent', () => {
    const yaml = buildAgentYaml(shell({ prompt: 'oops', model: 'oops', command: 'echo hi' }));
    const parsed = yamlParse(yaml);
    expect(parsed.prompt).toBeUndefined();
    expect(parsed.model).toBeUndefined();
    expect(parsed.command).toBe('echo hi');
  });

  it('serializes secrets as a YAML list', () => {
    const yaml = buildAgentYaml(shell({ secrets: ['A', 'B'] }));
    // yaml package may emit either block or flow style; assert round-trip
    const parsed = yamlParse(yaml);
    expect(parsed.secrets).toEqual(['A', 'B']);
  });
});

describe('buildAgentYaml → agentDefinitionSchema round-trip', () => {
  // The creator's promise is "we won't write a YAML the loader would reject."
  // Every emitted YAML must parse AND validate.

  it.each<[string, AgentAnswers]>([
    ['minimum shell', shell()],
    ['minimum claude-code', claude()],
    ['shell with everything', shell({
      description: 'kitchen sink',
      timeout: 45,
      schedule: '*/30 * * * *',
      secrets: ['TOKEN_A', 'TOKEN_B'],
      mcp: true,
      redactSecrets: true,
    })],
    ['claude-code with model + schedule', claude({
      model: 'claude-sonnet-4-20250514',
      timeout: 120,
      schedule: '0 8 * * 1-5',
      mcp: true,
    })],
  ])('%s parses and validates', (_label, answers) => {
    const yaml = buildAgentYaml(answers);
    const parsed = yamlParse(yaml);
    const result = agentDefinitionSchema.safeParse({
      ...parsed,
      timeout: parsed.timeout ?? 300,
    });
    expect(result.success).toBe(true);
  });

  it('emits a schedule that passes the v0.4.0 frequency cap', () => {
    const yaml = buildAgentYaml(shell({ schedule: '* * * * *' }));
    const parsed = yamlParse(yaml);
    const result = agentDefinitionSchema.safeParse({ ...parsed, timeout: 300 });
    expect(result.success).toBe(true);
  });
});
