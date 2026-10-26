import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AgentStore } from '@some-useful-agents/core';
import { reimportOne, collectYamlFiles } from './reimport.js';

const baseYaml = (id: string, extra = '') => `id: ${id}
name: ${id}
status: active
source: local
version: 1
${extra}
nodes:
  - id: n1
    type: shell
    command: echo hi
`;

// The verb's own per-file logic (reimport.ts), run against files on disk.
describe('sua agent reimport', () => {
  let dir: string;
  let db: DatabaseSync;
  let store: AgentStore;
  const file = (name: string, yaml: string) => { const p = join(dir, name); writeFileSync(p, yaml); return p; };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sua-reimport-'));
    db = new DatabaseSync(join(dir, 'runs.db'));
    store = AgentStore.fromHandle(db);
  });

  afterEach(() => {
    try { db.close(); } catch { /* ignore */ }
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates an agent, then reports it unchanged when the YAML matches', () => {
    const p = file('alpha.yaml', baseYaml('alpha'));
    expect(reimportOne(store, p)).toMatchObject({ status: 'created', message: 'alpha v1' });
    expect(reimportOne(store, p)).toMatchObject({ status: 'unchanged' });
  });

  it('updates and bumps the version when the agent changes (an output widget added)', () => {
    reimportOne(store, file('gamma.yaml', baseYaml('gamma')));
    const v1 = store.getAgent('gamma')!.version;
    const result = reimportOne(store, file('gamma.yaml', baseYaml('gamma', `outputWidget:\n  type: raw\n  fields:\n    - name: result\n      type: text`)));
    expect(result.status).toBe('updated');
    expect(store.getAgent('gamma')!.version).toBeGreaterThan(v1);
    expect(store.getAgent('gamma')!.outputWidget?.type).toBe('raw');
  });

  it('handles flipping interactive: true on a re-import (the motivating case)', () => {
    reimportOne(store, file('delta.yaml', baseYaml('delta', `outputWidget:\n  type: ai-template\n  template: |\n    <div>x</div>\n`)));
    expect(store.getAgent('delta')!.outputWidget?.interactive).toBeFalsy();
    const result = reimportOne(store, file('delta.yaml', baseYaml('delta', `outputWidget:\n  type: ai-template\n  interactive: true\n  template: |\n    <div>x</div>\n`)));
    expect(result.status).toBe('updated');
    expect(store.getAgent('delta')!.outputWidget?.interactive).toBe(true);
  });

  it('reports a file it can\'t read or parse as failed, without touching the store', () => {
    expect(reimportOne(store, join(dir, 'missing.yaml'))).toMatchObject({ status: 'failed' });
    expect(reimportOne(store, file('bad.yaml', 'name: no id or nodes\n'))).toMatchObject({ status: 'failed' });
    expect(store.listAgents()).toHaveLength(0);
  });

  it('takes a file, or the YAML files in a folder', () => {
    const root = join(dir, 'agents');
    mkdirSync(root);
    writeFileSync(join(root, 'a.yaml'), baseYaml('walked-a'));
    writeFileSync(join(root, 'b.yml'), baseYaml('walked-b'));
    writeFileSync(join(root, 'README.md'), '# not yaml');
    const files = collectYamlFiles(root).sort();
    expect(files.map((f) => f.slice(root.length + 1))).toEqual(['a.yaml', 'b.yml']);
    expect(collectYamlFiles(files[0])).toEqual([files[0]]);
    for (const f of files) reimportOne(store, f);
    expect(store.getAgent('walked-a')).not.toBeNull();
    expect(store.getAgent('walked-b')).not.toBeNull();
  });
});
