import { describe, it, expect } from 'vitest';
import { agentDefinitionSchema } from './schema.js';

describe('agentDefinitionSchema', () => {
  it('validates a valid shell agent', () => {
    const result = agentDefinitionSchema.safeParse({
      name: 'hello-shell',
      type: 'shell',
      command: 'echo hello',
    });
    expect(result.success).toBe(true);
  });

  it('validates a valid claude-code agent', () => {
    const result = agentDefinitionSchema.safeParse({
      name: 'hello-claude',
      type: 'claude-code',
      prompt: 'Say hello',
      model: 'claude-sonnet-4-20250514',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing name', () => {
    const result = agentDefinitionSchema.safeParse({
      type: 'shell',
      command: 'echo hello',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing type', () => {
    const result = agentDefinitionSchema.safeParse({
      name: 'test',
      command: 'echo hello',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid type value', () => {
    const result = agentDefinitionSchema.safeParse({
      name: 'test',
      type: 'python',
      command: 'echo hello',
    });
    expect(result.success).toBe(false);
  });

  it('rejects shell agent without command', () => {
    const result = agentDefinitionSchema.safeParse({
      name: 'test',
      type: 'shell',
    });
    expect(result.success).toBe(false);
  });

  it('rejects claude-code agent without prompt', () => {
    const result = agentDefinitionSchema.safeParse({
      name: 'test',
      type: 'claude-code',
    });
    expect(result.success).toBe(false);
  });

  it('rejects name with uppercase letters', () => {
    const result = agentDefinitionSchema.safeParse({
      name: 'Hello-Shell',
      type: 'shell',
      command: 'echo hello',
    });
    expect(result.success).toBe(false);
  });

  it('rejects name with spaces', () => {
    const result = agentDefinitionSchema.safeParse({
      name: 'hello shell',
      type: 'shell',
      command: 'echo hello',
    });
    expect(result.success).toBe(false);
  });

  it('passes through extra fields (zod strips them)', () => {
    const result = agentDefinitionSchema.safeParse({
      name: 'test',
      type: 'shell',
      command: 'echo hello',
      unknownField: 'value',
    });
    expect(result.success).toBe(true);
  });

  it('applies default timeout of 300', () => {
    const result = agentDefinitionSchema.parse({
      name: 'test',
      type: 'shell',
      command: 'echo hello',
    });
    expect(result.timeout).toBe(300);
  });

  it('mcp defaults to false when omitted', () => {
    const result = agentDefinitionSchema.parse({
      name: 'plain',
      type: 'shell',
      command: 'echo hi',
    });
    expect(result.mcp).toBe(false);
  });

  it('accepts explicit mcp: true', () => {
    const result = agentDefinitionSchema.parse({
      name: 'exposed',
      type: 'shell',
      command: 'echo hi',
      mcp: true,
    });
    expect(result.mcp).toBe(true);
  });

  it('rejects 6-field cron schedules without allowHighFrequency', () => {
    const result = agentDefinitionSchema.safeParse({
      name: 'fast',
      type: 'shell',
      command: 'echo hi',
      schedule: '* * * * * *',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(i => i.path[0] === 'schedule');
      expect(issue?.message).toMatch(/fires more often than the minimum/);
    }
  });

  it('accepts 6-field cron when allowHighFrequency is true', () => {
    const result = agentDefinitionSchema.safeParse({
      name: 'fast',
      type: 'shell',
      command: 'echo hi',
      schedule: '* * * * * *',
      allowHighFrequency: true,
    });
    expect(result.success).toBe(true);
  });

  it('rejects garbage cron schedules with a clear error', () => {
    const result = agentDefinitionSchema.safeParse({
      name: 'broken',
      type: 'shell',
      command: 'echo hi',
      schedule: 'not-a-cron',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(i => i.path[0] === 'schedule');
      expect(issue?.message).toMatch(/Invalid cron expression/);
    }
  });

  it('validates all optional metadata fields', () => {
    const result = agentDefinitionSchema.safeParse({
      name: 'test',
      type: 'shell',
      command: 'echo hello',
      author: 'gregmeyer',
      version: '1.0.0',
      tags: ['test', 'example'],
      description: 'A test agent',
      env: { FOO: 'bar' },
      schedule: '0 9 * * *',
      workingDirectory: '/tmp',
      dependsOn: ['other-agent'],
      input: '{{outputs.other-agent.result}}',
    });
    expect(result.success).toBe(true);
  });
});
