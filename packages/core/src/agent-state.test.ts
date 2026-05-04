import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stateDirFor, ensureStateDir, removeStateDir } from './agent-state.js';

describe('agent-state', () => {
  let dataRoot: string;
  beforeEach(() => { dataRoot = mkdtempSync(join(tmpdir(), 'sua-state-')); });
  afterEach(() => { rmSync(dataRoot, { recursive: true, force: true }); });

  describe('stateDirFor', () => {
    it('returns <dataRoot>/agent-state/<id>', () => {
      const dir = stateDirFor('hn-digest', dataRoot);
      expect(dir).toBe(join(dataRoot, 'agent-state', 'hn-digest'));
    });

    it('rejects unsafe agent ids (path traversal defense)', () => {
      expect(() => stateDirFor('../escape', dataRoot)).toThrow(/unsafe agent id/);
      expect(() => stateDirFor('a/b', dataRoot)).toThrow(/unsafe agent id/);
      expect(() => stateDirFor('UPPER', dataRoot)).toThrow(/unsafe agent id/);
      expect(() => stateDirFor('', dataRoot)).toThrow(/unsafe agent id/);
    });

    it('does not create the directory', () => {
      const dir = stateDirFor('never-touched', dataRoot);
      expect(existsSync(dir)).toBe(false);
    });
  });

  describe('ensureStateDir', () => {
    it('creates the directory and chmod 0o700', () => {
      const dir = ensureStateDir('my-agent', dataRoot);
      expect(existsSync(dir)).toBe(true);
      // Permission check is best-effort across platforms; only assert when supported.
      if (process.platform !== 'win32') {
        const mode = statSync(dir).mode & 0o777;
        expect(mode).toBe(0o700);
      }
    });

    it('is idempotent — second call doesn\'t throw or wipe contents', () => {
      const dir = ensureStateDir('persist-test', dataRoot);
      writeFileSync(join(dir, 'state.json'), '{"count":1}');
      ensureStateDir('persist-test', dataRoot); // second call
      expect(readFileSync(join(dir, 'state.json'), 'utf-8')).toBe('{"count":1}');
    });

    it('creates parent agent-state/ dir lazily', () => {
      ensureStateDir('first', dataRoot);
      expect(existsSync(join(dataRoot, 'agent-state'))).toBe(true);
      ensureStateDir('second', dataRoot);
      expect(existsSync(join(dataRoot, 'agent-state', 'first'))).toBe(true);
      expect(existsSync(join(dataRoot, 'agent-state', 'second'))).toBe(true);
    });
  });

  describe('removeStateDir', () => {
    it('removes the directory and all contents', () => {
      const dir = ensureStateDir('to-delete', dataRoot);
      writeFileSync(join(dir, 'state.json'), '{}');
      removeStateDir('to-delete', dataRoot);
      expect(existsSync(dir)).toBe(false);
    });

    it('is idempotent — silently no-ops when the dir doesn\'t exist', () => {
      expect(() => removeStateDir('never-created', dataRoot)).not.toThrow();
    });

    it('rejects unsafe ids before touching the filesystem', () => {
      expect(() => removeStateDir('../etc', dataRoot)).toThrow(/unsafe agent id/);
    });
  });

  it('persists state across simulated runs', () => {
    // Run 1: write state
    const dir1 = ensureStateDir('cross-run', dataRoot);
    writeFileSync(join(dir1, 'last-fired.txt'), '2026-01-01');

    // Run 2: read state (same agent, same dataRoot)
    const dir2 = ensureStateDir('cross-run', dataRoot);
    expect(dir1).toBe(dir2);
    expect(readFileSync(join(dir2, 'last-fired.txt'), 'utf-8')).toBe('2026-01-01');
  });
});

describe('STATE_DIR env-var integration via buildNodeEnv', () => {
  let dataRoot: string;
  beforeEach(() => { dataRoot = mkdtempSync(join(tmpdir(), 'sua-state-env-')); });
  afterEach(() => { rmSync(dataRoot, { recursive: true, force: true }); });

  it('sets STATE_DIR in env when deps.dataRoot is configured', async () => {
    const { buildNodeEnv } = await import('./node-env.js');
    const agent = {
      id: 'env-test',
      name: 'env-test',
      status: 'active' as const,
      source: 'local' as const,
      mcp: false,
      version: 1,
      nodes: [{ id: 'main', type: 'shell' as const, command: 'echo hi' }],
    };
    const env = await buildNodeEnv(
      agent,
      agent.nodes[0],
      {},
      {},
      { runStore: { } as never, dataRoot },
    );
    expect(env.STATE_DIR).toBe(stateDirFor('env-test', dataRoot));
    expect(existsSync(env.STATE_DIR)).toBe(true);
  });

  it('omits STATE_DIR when deps.dataRoot is absent', async () => {
    const { buildNodeEnv } = await import('./node-env.js');
    const agent = {
      id: 'no-state',
      name: 'no-state',
      status: 'active' as const,
      source: 'local' as const,
      mcp: false,
      version: 1,
      nodes: [{ id: 'main', type: 'shell' as const, command: 'echo hi' }],
    };
    const env = await buildNodeEnv(
      agent,
      agent.nodes[0],
      {},
      {},
      { runStore: { } as never },
    );
    expect(env.STATE_DIR).toBeUndefined();
  });
});

describe('resolveStateTemplate', () => {
  // co-located test for the template helper since it's tightly coupled
  // to the agent-state primitive
  it('replaces {{state}} with the dir path', async () => {
    const { resolveStateTemplate } = await import('./node-templates.js');
    expect(resolveStateTemplate('cat {{state}}/log.txt', '/data/agent-state/x'))
      .toBe('cat /data/agent-state/x/log.txt');
  });

  it('replaces with empty string when stateDir is undefined', async () => {
    const { resolveStateTemplate } = await import('./node-templates.js');
    expect(resolveStateTemplate('cat {{state}}/log.txt', undefined))
      .toBe('cat /log.txt');
  });

  it('handles multiple references in one string', async () => {
    const { resolveStateTemplate } = await import('./node-templates.js');
    expect(resolveStateTemplate('{{state}}/a {{state}}/b', '/x'))
      .toBe('/x/a /x/b');
  });

  it('leaves text without {{state}} untouched', async () => {
    const { resolveStateTemplate } = await import('./node-templates.js');
    expect(resolveStateTemplate('no template here', '/x')).toBe('no template here');
  });
});
