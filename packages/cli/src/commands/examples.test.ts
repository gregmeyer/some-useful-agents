/**
 * `EMBEDDED_YAMLS` in examples.ts is a hand-maintained duplicate of a few
 * `agents/examples/*.yaml` files, used when sua is installed from npm
 * without the repo. Nothing kept the two in sync, so a change to a shipped
 * example silently shipped a different agent to npm users — which is how
 * `two-step-digest` briefly lost its `outcome:` block.
 *
 * These tests don't demand byte parity (the embedded copies are abridged —
 * they drop `signal.template`/`mapping` and other display-only fields).
 * They assert the parts that change behaviour.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAgent } from '@some-useful-agents/core';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const EXAMPLES_DIR = join(REPO_ROOT, 'agents', 'examples');
const SOURCE = join(HERE, 'examples.ts');

/** Pull the embedded YAML literals straight out of the source. */
function embeddedYamls(): Record<string, string> {
  const src = readFileSync(SOURCE, 'utf-8');
  const start = src.indexOf('const EMBEDDED_YAMLS');
  expect(start).toBeGreaterThan(-1);
  const body = src.slice(start);
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/^ {2}'([a-z0-9-]+)': `([\s\S]*?)`,$/gm)) {
    // The literals are template strings: unescape what TS would.
    out[m[1]] = m[2].replace(/\\`/g, '`').replace(/\\\$/g, '$').replace(/\\\\/g, '\\');
  }
  return out;
}

describe('embedded example YAMLs', () => {
  const embedded = embeddedYamls();

  it('finds the embedded set', () => {
    expect(Object.keys(embedded).length).toBeGreaterThan(0);
  });

  it.each(Object.keys(embeddedYamls()))('%s parses as a valid agent', (id) => {
    const agent = parseAgent(embedded[id]);
    expect(agent.id).toBe(id);
  });

  it.each(Object.keys(embeddedYamls()))(
    '%s matches the on-disk example in node topology and outcome block',
    (id) => {
      const onDiskPath = join(EXAMPLES_DIR, `${id}.yaml`);
      if (!existsSync(onDiskPath)) return; // embedded-only agent; nothing to compare
      const onDisk = parseAgent(readFileSync(onDiskPath, 'utf-8'));
      const emb = parseAgent(embedded[id]);

      // Topology: the thing that actually executes.
      expect(emb.nodes.map((n) => n.id)).toEqual(onDisk.nodes.map((n) => n.id));
      expect(emb.nodes.map((n) => n.type)).toEqual(onDisk.nodes.map((n) => n.type));
      expect(emb.nodes.map((n) => n.command ?? null)).toEqual(onDisk.nodes.map((n) => n.command ?? null));
      expect(emb.nodes.map((n) => n.tool ?? null)).toEqual(onDisk.nodes.map((n) => n.tool ?? null));

      // Behavioural agent-level blocks.
      expect(emb.outcome).toEqual(onDisk.outcome);
      expect(emb.successCriteria).toEqual(onDisk.successCriteria);
      expect(emb.inputs).toEqual(onDisk.inputs);
    },
  );
});
