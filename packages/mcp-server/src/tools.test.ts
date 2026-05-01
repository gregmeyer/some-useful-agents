import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkInputCaps, describeInputSpec, loadMcpExposedAgents } from './tools.js';

describe('loadMcpExposedAgents', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sua-mcp-filter-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeAgent(name: string, body: string): void {
    writeFileSync(join(dir, `${name}.yaml`), body);
  }

  it('returns only agents with mcp: true', () => {
    writeAgent(
      'exposed',
      `name: exposed\ntype: shell\ncommand: echo ok\nmcp: true\n`,
    );
    writeAgent(
      'hidden',
      `name: hidden\ntype: shell\ncommand: echo hi\n`,
    );
    writeAgent(
      'explicit-false',
      `name: explicit-false\ntype: shell\ncommand: echo no\nmcp: false\n`,
    );

    const exposed = loadMcpExposedAgents([dir]);

    expect(Array.from(exposed.keys()).sort()).toEqual(['exposed']);
  });

  it('returns empty map when no agents opt in', () => {
    writeAgent('a', `name: a\ntype: shell\ncommand: echo a\n`);
    writeAgent('b', `name: b\ntype: shell\ncommand: echo b\nmcp: false\n`);

    const exposed = loadMcpExposedAgents([dir]);

    expect(exposed.size).toBe(0);
  });

  it('exposes input declarations on agents that have them', () => {
    writeAgent(
      'with-inputs',
      [
        'name: with-inputs',
        'type: shell',
        'command: echo "$TOPIC"',
        'mcp: true',
        'inputs:',
        '  TOPIC:',
        '    type: string',
        '    required: true',
        '    description: What to echo',
        '  STYLE:',
        '    type: enum',
        '    default: short',
        '    values:',
        '      - short',
        '      - long',
        '',
      ].join('\n'),
    );

    const exposed = loadMcpExposedAgents([dir]);
    const agent = exposed.get('with-inputs');
    expect(agent?.inputs?.TOPIC?.required).toBe(true);
    expect(agent?.inputs?.STYLE?.values).toEqual(['short', 'long']);
  });

  it('handles claude-code agents with mcp: true', () => {
    writeAgent(
      'claude-exposed',
      `name: claude-exposed\ntype: claude-code\nprompt: "say hi"\nmcp: true\n`,
    );

    const exposed = loadMcpExposedAgents([dir]);

    expect(exposed.has('claude-exposed')).toBe(true);
    expect(exposed.get('claude-exposed')?.type).toBe('claude-code');
  });
});

describe('checkInputCaps', () => {
  it('passes payloads within caps', () => {
    expect(checkInputCaps({ TOPIC: 'hello', STYLE: 'short' })).toBeNull();
    expect(checkInputCaps({})).toBeNull();
  });

  it('rejects per-value oversize payloads', () => {
    const big = 'x'.repeat(8 * 1024 + 1);
    const err = checkInputCaps({ TOPIC: big });
    expect(err).toContain('TOPIC');
    expect(err).toMatch(/per-value cap/);
  });

  it('rejects total oversize payloads even when each value is fine', () => {
    // 9 values × 7800 bytes = 70200 bytes total, > 64 KB cap, each < 8 KB.
    const inputs: Record<string, string> = {};
    for (let i = 0; i < 9; i++) inputs[`K${i}`] = 'y'.repeat(7800);
    const err = checkInputCaps(inputs);
    expect(err).toMatch(/Total inputs payload/);
  });

  it('counts byte length, not character length', () => {
    // Multi-byte UTF-8: '€' = 3 bytes, so 3000 chars = 9000 bytes > 8 KB cap.
    const big = '€'.repeat(3000);
    const err = checkInputCaps({ TOPIC: big });
    expect(err).toMatch(/per-value cap/);
  });
});

describe('describeInputSpec', () => {
  it('omits optional fields when absent', () => {
    expect(describeInputSpec({ type: 'string' })).toEqual({ type: 'string' });
  });

  it('includes required, default, description, and enum values when present', () => {
    expect(
      describeInputSpec({
        type: 'enum',
        required: true,
        default: 'hero',
        description: 'Layout preset',
        values: ['hero', 'card'],
      }),
    ).toEqual({
      type: 'enum',
      required: true,
      default: 'hero',
      description: 'Layout preset',
      values: ['hero', 'card'],
    });
  });
});
