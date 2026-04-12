import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadAgents } from './agent-loader.js';

const TEST_DIR = join(import.meta.dirname, '__test-agents__');

function writeAgent(dir: string, filename: string, content: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), content);
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('loadAgents', () => {
  it('loads valid agents from directory', () => {
    writeAgent(TEST_DIR, 'test.yaml', 'name: test\ntype: shell\ncommand: "echo hi"\n');
    const { agents, warnings } = loadAgents({ directories: [TEST_DIR] });
    expect(agents.size).toBe(1);
    expect(agents.get('test')?.command).toBe('echo hi');
    expect(warnings.length).toBe(0);
  });

  it('warns when directory does not exist', () => {
    const { agents, warnings } = loadAgents({ directories: ['/nonexistent'] });
    expect(agents.size).toBe(0);
    expect(warnings.length).toBe(1);
    expect(warnings[0].message).toContain('does not exist');
  });

  it('handles empty directory', () => {
    const { agents, warnings } = loadAgents({ directories: [TEST_DIR] });
    expect(agents.size).toBe(0);
    expect(warnings.length).toBe(0);
  });

  it('skips invalid YAML and loads valid ones', () => {
    writeAgent(TEST_DIR, 'good.yaml', 'name: good\ntype: shell\ncommand: "echo"\n');
    writeAgent(TEST_DIR, 'bad.yaml', 'name: bad\ntype: shell\n'); // missing command
    const { agents, warnings } = loadAgents({ directories: [TEST_DIR] });
    expect(agents.size).toBe(1);
    expect(agents.has('good')).toBe(true);
    expect(warnings.length).toBe(1);
  });

  it('warns on duplicate agent names', () => {
    const dir2 = join(TEST_DIR, 'dir2');
    writeAgent(TEST_DIR, 'a.yaml', 'name: dup\ntype: shell\ncommand: "echo 1"\n');
    writeAgent(dir2, 'b.yaml', 'name: dup\ntype: shell\ncommand: "echo 2"\n');
    const { agents, warnings } = loadAgents({ directories: [TEST_DIR, dir2] });
    expect(agents.size).toBe(1);
    expect(warnings.some(w => w.message.includes('Duplicate'))).toBe(true);
  });

  it('skips non-YAML files', () => {
    writeAgent(TEST_DIR, 'README.md', '# Not an agent');
    writeAgent(TEST_DIR, '.gitkeep', '');
    writeAgent(TEST_DIR, 'test.yaml', 'name: test\ntype: shell\ncommand: "echo"\n');
    const { agents } = loadAgents({ directories: [TEST_DIR] });
    expect(agents.size).toBe(1);
  });

  it('warns on empty YAML files', () => {
    writeAgent(TEST_DIR, 'empty.yaml', '');
    const { warnings } = loadAgents({ directories: [TEST_DIR] });
    expect(warnings.length).toBe(1);
    expect(warnings[0].message).toContain('Empty');
  });

  it('warns on malformed YAML', () => {
    writeAgent(TEST_DIR, 'bad.yaml', '{{{{not yaml');
    const { warnings } = loadAgents({ directories: [TEST_DIR] });
    expect(warnings.length).toBe(1);
    expect(warnings[0].message).toContain('Invalid YAML');
  });

  it('loads .yml files too', () => {
    writeAgent(TEST_DIR, 'test.yml', 'name: test\ntype: shell\ncommand: "echo"\n');
    const { agents } = loadAgents({ directories: [TEST_DIR] });
    expect(agents.size).toBe(1);
  });

  it('calls onWarning callback', () => {
    writeAgent(TEST_DIR, 'bad.yaml', 'name: bad\ntype: shell\n');
    const warned: string[] = [];
    loadAgents({ directories: [TEST_DIR], onWarning: (f, m) => warned.push(m) });
    expect(warned.length).toBe(1);
  });
});
