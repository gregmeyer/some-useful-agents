import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withShellHelpers } from './node-spawner.js';

// The Python helpers every shell step can import (agents/examples/lib/sua_helpers.py).

const py = (code: string, env: Record<string, string> = {}) => execFileSync('python3', ['-c', code], {
  env: withShellHelpers({ PATH: process.env.PATH ?? '', ...env }),
  encoding: 'utf8',
}).trim();

describe('sua_helpers', () => {
  it('is on PYTHONPATH for shell steps', () => {
    expect(withShellHelpers({}).PYTHONPATH).toMatch(/examples\/lib$/);
    expect(py('import sua_helpers; print(sua_helpers.__name__)')).toBe('sua_helpers');
  });

  it('upstream reads the env value, or the whole of it from its file past 32KB', () => {
    expect(py('from sua_helpers import upstream; print(upstream("gather-1"))', { UPSTREAM_GATHER_1_RESULT: 'short' })).toBe('short');
    const file = join(mkdtempSync(join(tmpdir(), 'sua-helpers-')), 'plan.txt');
    writeFileSync(file, 'the whole thing');
    expect(py('from sua_helpers import upstream; print(upstream("plan"))', { UPSTREAM_PLAN_RESULT: 'the wh...(truncated)', UPSTREAM_PLAN_RESULT_FILE: file })).toBe('the whole thing');
    expect(py('from sua_helpers import upstream; print(repr(upstream("none")))')).toBe("''");
  });

  it('last_json takes the last top-level object, never one nested in it, and can require a key', () => {
    const reply = 'I looked.\n{"draft": 1}\nThen: {"subject": "Ramp", "found": {"hq": {"value": "NYC"}}} done';
    const code = (args: string) => `import json; from sua_helpers import last_json; print(json.dumps(last_json(${JSON.stringify(reply)}${args})))`;
    expect(JSON.parse(py(code('')))).toEqual({ subject: 'Ramp', found: { hq: { value: 'NYC' } } });
    expect(JSON.parse(py(code(', "draft"')))).toEqual({ draft: 1 });
    expect(py(code(', "missing"'))).toBe('null');
  });

  it('upstream_json reads whole JSON, else the last object, else the default', () => {
    const code = 'import json; from sua_helpers import upstream_json; print(json.dumps(upstream_json("x", {"none": True})))';
    expect(JSON.parse(py(code, { UPSTREAM_X_RESULT: '[1, 2]' }))).toEqual([1, 2]);
    expect(JSON.parse(py(code, { UPSTREAM_X_RESULT: 'ran\n{"ok": true}' }))).toEqual({ ok: true });
    expect(JSON.parse(py(code, { UPSTREAM_X_RESULT: 'nothing' }))).toEqual({ none: true });
  });
});

describe('shipped agents use the shared helpers', () => {
  // Agents that still keep their own copy, moved one at a time as they're
  // changed anyway. Only ever shrinks: a new copy fails here.
  const STILL_OWN_COPY = new Set(['account-research', 'firmographic-research', 'lever-job-agent', 'notebook-checker', 'notebook-finder', 'starter-research']);

  it('no new agent defines its own upstream() or last_json()', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const dir = join(__dirname, '../../../agents/examples');
    const own = readdirSync(dir).filter((f) => f.endsWith('.yaml'))
      .filter((f) => /def (upstream|last_json)\(/.test(readFileSync(join(dir, f), 'utf8')))
      .map((f) => f.replace(/\.yaml$/, ''));
    expect(own.filter((id) => !STILL_OWN_COPY.has(id))).toEqual([]);
    // Moved off the list: take it out, so it can't drift back.
    expect([...STILL_OWN_COPY].filter((id) => !own.includes(id))).toEqual([]);
  });
});
