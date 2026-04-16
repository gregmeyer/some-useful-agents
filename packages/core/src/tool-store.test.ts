import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolStore } from './tool-store.js';
import type { ToolDefinition } from './tool-types.js';

let dir: string;
let store: ToolStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sua-tool-store-'));
  store = new ToolStore(join(dir, 'runs.db'));
});

afterEach(() => {
  try { store.close(); } catch {}
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function sampleTool(id = 'http-get', overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    id,
    name: 'HTTP GET',
    description: 'Fetch a URL.',
    source: 'local',
    inputs: { url: { type: 'string', required: true } },
    outputs: { status: { type: 'number' }, body: { type: 'json' } },
    implementation: { type: 'shell', command: 'curl -s "$url"' },
    ...overrides,
  };
}

describe('ToolStore', () => {
  it('creates and retrieves a tool', () => {
    const tool = store.createTool(sampleTool());
    expect(tool.createdAt).toBeDefined();

    const loaded = store.getTool('http-get');
    expect(loaded).toBeDefined();
    expect(loaded!.id).toBe('http-get');
    expect(loaded!.name).toBe('HTTP GET');
    expect(loaded!.inputs.url.type).toBe('string');
    expect(loaded!.outputs.body.type).toBe('json');
    expect(loaded!.implementation.command).toBe('curl -s "$url"');
  });

  it('lists tools sorted by id', () => {
    store.createTool(sampleTool('b-tool'));
    store.createTool(sampleTool('a-tool'));
    const list = store.listTools();
    expect(list.map((t) => t.id)).toEqual(['a-tool', 'b-tool']);
  });

  it('updates an existing tool', () => {
    store.createTool(sampleTool());
    store.updateTool({ ...sampleTool(), name: 'HTTP GET v2' });
    const loaded = store.getTool('http-get');
    expect(loaded!.name).toBe('HTTP GET v2');
  });

  it('upserts: inserts if absent, updates if present', () => {
    store.upsertTool(sampleTool());
    expect(store.getTool('http-get')).toBeDefined();

    store.upsertTool({ ...sampleTool(), name: 'Updated' });
    expect(store.getTool('http-get')!.name).toBe('Updated');
  });

  it('deletes a tool', () => {
    store.createTool(sampleTool());
    expect(store.deleteTool('http-get')).toBe(true);
    expect(store.getTool('http-get')).toBeUndefined();
  });

  it('returns false when deleting a nonexistent tool', () => {
    expect(store.deleteTool('ghost')).toBe(false);
  });

  it('returns undefined for nonexistent tool', () => {
    expect(store.getTool('ghost')).toBeUndefined();
  });
});
