import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadMcpExposedAgents } from './tools.js';

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
