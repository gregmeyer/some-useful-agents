import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AgentStore } from '@some-useful-agents/core';

// Re-export the internal `reimportOne` shape via a thin re-export trick:
// the verb itself wires its own DB; we want to exercise the per-file
// logic in isolation. Since reimport.ts only exports the Command, we
// duplicate the helper's contract here using a freshly-opened store.
// If the helper grows, expose it directly and switch this to a real import.
import { parseAgent } from '@some-useful-agents/core';

function reimportOne(store: AgentStore, yaml: string, file: string): { status: string; version: number } {
  const agent = parseAgent(yaml);
  const before = store.getAgent(agent.id);
  const after = store.upsertAgent(agent, 'cli', `Reimport from ${file}`);
  if (!before) return { status: 'created', version: after.version };
  if (after.version === before.version) return { status: 'unchanged', version: after.version };
  return { status: 'updated', version: after.version };
}

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

describe('reimport core mechanics', () => {
  let dir: string;
  let db: DatabaseSync;
  let store: AgentStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sua-reimport-'));
    mkdirSync(join(dir, 'data'), { recursive: true });
    db = new DatabaseSync(join(dir, 'runs.db'));
    store = AgentStore.fromHandle(db);
  });

  afterEach(() => {
    try { db.close(); } catch { /* ignore */ }
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates a new agent on first import', () => {
    const result = reimportOne(store, baseYaml('alpha'), 'alpha.yaml');
    expect(result.status).toBe('created');
    expect(store.getAgent('alpha')!.id).toBe('alpha');
  });

  it('returns unchanged when the YAML matches the current DB version', () => {
    const yaml = baseYaml('beta');
    reimportOne(store, yaml, 'beta.yaml');
    const second = reimportOne(store, yaml, 'beta.yaml');
    expect(second.status).toBe('unchanged');
  });

  it('returns updated and bumps version when the DAG changes', () => {
    reimportOne(store, baseYaml('gamma'), 'gamma.yaml');
    const v1 = store.getAgent('gamma')!.version;
    // Different DAG: add an output widget block.
    const result = reimportOne(store, baseYaml('gamma', `outputWidget:\n  type: raw\n  fields:\n    - name: result\n      type: text`), 'gamma.yaml');
    expect(result.status).toBe('updated');
    expect(result.version).toBeGreaterThan(v1);
    expect(store.getAgent('gamma')!.outputWidget?.type).toBe('raw');
  });

  it('handles flipping interactive: true on a re-import (the motivating case)', () => {
    const before = baseYaml('delta', `outputWidget:\n  type: ai-template\n  template: |\n    <div>x</div>\n`);
    reimportOne(store, before, 'delta.yaml');
    expect(store.getAgent('delta')!.outputWidget?.interactive).toBeFalsy();

    const after = baseYaml('delta', `outputWidget:\n  type: ai-template\n  interactive: true\n  template: |\n    <div>x</div>\n`);
    const result = reimportOne(store, after, 'delta.yaml');
    expect(result.status).toBe('updated');
    expect(store.getAgent('delta')!.outputWidget?.interactive).toBe(true);
  });

  it('walks YAMLs in a directory (file collection contract)', () => {
    const root = join(dir, 'agents');
    mkdirSync(root);
    writeFileSync(join(root, 'a.yaml'), baseYaml('walked-a'));
    writeFileSync(join(root, 'b.yml'), baseYaml('walked-b'));
    writeFileSync(join(root, 'README.md'), '# not yaml');

    // Mirror collectYamlFiles inline so this test doesn't need to import
    // it (the function is private to reimport.ts).
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const files = fs.readdirSync(root)
      .filter((f) => /\.ya?ml$/i.test(f))
      .map((f) => path.join(root, f));

    expect(files).toHaveLength(2);
    for (const f of files) reimportOne(store, fs.readFileSync(f, 'utf-8'), f);
    expect(store.getAgent('walked-a')).not.toBeNull();
    expect(store.getAgent('walked-b')).not.toBeNull();
  });
});
