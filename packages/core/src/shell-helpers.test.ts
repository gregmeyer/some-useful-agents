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

  it('a reply that is one object is that object; with keys, a nested match when no top-level one has them', () => {
    const run = (text: string, args = '') => JSON.parse(py(`import json; from sua_helpers import last_json; print(json.dumps(last_json(${JSON.stringify(text)}${args})))`));
    expect(run('{"note": "nothing found"}', ', "candidates"')).toEqual({ note: 'nothing found' });
    expect(run('ran {"outputs": {"results": [1]}} ok', ', "results"')).toEqual({ results: [1] });
  });

  it('tagged_json reads the JSON inside a tag', () => {
    const code = (text: string) => py(`import json; from sua_helpers import tagged_json; print(json.dumps(tagged_json(${JSON.stringify(text)}, "verdicts")))`);
    expect(JSON.parse(code('Here: <verdicts>[{"ok": true}]</verdicts>'))).toEqual([{ ok: true }]);
    expect(code('<verdicts>not json</verdicts>')).toBe('null');
  });

  it('upstream_json reads whole JSON, else the last object, else the default', () => {
    const code = 'import json; from sua_helpers import upstream_json; print(json.dumps(upstream_json("x", {"none": True})))';
    expect(JSON.parse(py(code, { UPSTREAM_X_RESULT: '[1, 2]' }))).toEqual([1, 2]);
    expect(JSON.parse(py(code, { UPSTREAM_X_RESULT: 'ran\n{"ok": true}' }))).toEqual({ ok: true });
    expect(JSON.parse(py(code, { UPSTREAM_X_RESULT: 'nothing' }))).toEqual({ none: true });
  });
});

describe('shipped agents use the shared helpers', () => {
  it('no shipped agent defines its own upstream(), last_json() or JSON scanner', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const dir = join(__dirname, '../../../agents/examples');
    const own = readdirSync(dir).filter((f) => f.endsWith('.yaml'))
      .filter((f) => /def (upstream|last_json|last_obj|block)\(/.test(readFileSync(join(dir, f), 'utf8')))
      .map((f) => f.replace(/\.yaml$/, ''));
    expect(own).toEqual([]);
  });
});
