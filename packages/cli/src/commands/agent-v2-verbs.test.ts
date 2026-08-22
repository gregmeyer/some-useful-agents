/**
 * `sua agent run` / `sua agent list` must reach v2 (DAG) agents.
 *
 * These drive the BUILT CLI as a subprocess against a throwaway
 * cwd + data dir. That is deliberate: the bug being pinned here was a
 * routing bug — `agent run` looked only at `loadAgents`, the V1 loader,
 * which silently skips every v2 file — and a unit test that called the
 * v2 helper directly would have passed happily while the verb stayed
 * broken. The only honest assertion is "type the command, see it work".
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AgentStore, parseAgent } from '@some-useful-agents/core';

const CLI = resolve(__dirname, '../../dist/index.js');

/** A v2 agent whose single shell node needs no network and no secrets. */
const V2_YAML = `id: v2-echo
name: V2 Echo
description: Echo a value back. Exists only for the CLI routing tests.
status: active
source: local
version: 1
inputs:
  MESSAGE:
    type: string
    required: false
    default: hello-from-v2
nodes:
  - id: say
    type: shell
    command: echo "$MESSAGE"
`;

/** A v1 agent, so the merged list is provably showing both models. */
const V1_YAML = `name: v1-echo
type: shell
description: A v1 agent used to prove the merged list still shows v1.
command: echo hi
`;

function runCli(cwd: string, args: string[]): { stdout: string; status: number } {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    });
    return { stdout, status: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { stdout: `${e.stdout ?? ''}${e.stderr ?? ''}`, status: e.status ?? 1 };
  }
}

describe('sua agent verbs reach v2 agents', () => {
  let dir: string;

  beforeAll(() => {
    if (!existsSync(CLI)) {
      throw new Error(
        `Built CLI not found at ${CLI}. These tests drive the real binary; run \`npm run build\` first.`,
      );
    }
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sua-agent-v2-'));
    mkdirSync(join(dir, 'data'), { recursive: true });
    mkdirSync(join(dir, 'agents', 'local'), { recursive: true });

    // `local` provider: the v1 path must not try to reach Temporal.
    writeFileSync(
      join(dir, 'sua.config.json'),
      JSON.stringify({ dataDir: './data', provider: 'local' }),
    );
    writeFileSync(join(dir, 'agents', 'local', 'v1-echo.yaml'), V1_YAML);

    const db = new DatabaseSync(join(dir, 'data', 'runs.db'));
    const store = AgentStore.fromHandle(db);
    // createdBy is CHECK-constrained to cli | dashboard | import.
    store.upsertAgent(parseAgent(V2_YAML), 'import', 'seed for CLI routing test');
    store.close();
    db.close();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('runs a v2 agent through `sua agent run`', () => {
    const { stdout, status } = runCli(dir, ['agent', 'run', 'v2-echo']);
    expect(status).toBe(0);
    // The node's actual output, not just a success banner — proves the DAG
    // executor ran rather than the verb short-circuiting somewhere. (The
    // ora "completed" line is a spinner frame and is suppressed off-TTY,
    // so asserting on it here would pass locally and fail in CI.)
    expect(stdout).toContain('hello-from-v2');
    expect(stdout).toContain('Run ID:');
  });

  it('passes --input through to a v2 agent', () => {
    const { stdout } = runCli(dir, ['agent', 'run', 'v2-echo', '--input', 'MESSAGE=routed-ok']);
    expect(stdout).toContain('routed-ok');
  });

  it('rejects an --input key the v2 agent does not declare', () => {
    const { stdout, status } = runCli(dir, ['agent', 'run', 'v2-echo', '--input', 'NOPE=1']);
    expect(status).not.toBe(0);
    expect(stdout).toContain('not declared by agent "v2-echo"');
    // The typo must be fatal BEFORE execution, not silently dropped. No
    // "Run ID:" means no run record was ever created.
    expect(stdout).not.toContain('Run ID:');
  });

  it('refuses --provider temporal for a v2 agent instead of silently running local', () => {
    const { stdout, status } = runCli(dir, ['agent', 'run', 'v2-echo', '--provider', 'temporal']);
    expect(status).not.toBe(0);
    expect(stdout).toContain('v2 DAG agent');
    expect(stdout).not.toContain('Run ID:');
  });

  it('lists v1 and v2 agents together', () => {
    const { stdout } = runCli(dir, ['agent', 'list']);
    expect(stdout).toContain('v2-echo');
    expect(stdout).toContain('v1-echo');
    expect(stdout).toContain('2 agent(s)');
  });

  it('still reports genuinely unknown names as not found', () => {
    const { stdout, status } = runCli(dir, ['agent', 'run', 'definitely-not-an-agent']);
    expect(status).not.toBe(0);
    expect(stdout).toContain('not found');
  });

  it('keeps `sua workflow run` working on the same shared path', () => {
    const { stdout, status } = runCli(dir, ['workflow', 'run', 'v2-echo']);
    expect(status).toBe(0);
    expect(stdout).toContain('hello-from-v2');
  });
});
