import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolStore } from './tool-store.js';
import type { ToolDefinition } from './tool-types.js';
import type { McpServerConfig } from './mcp-server-types.js';

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

function sampleServer(id = 'modern-graphics', overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id,
    name: id,
    transport: 'stdio',
    command: 'docker',
    args: ['run', '--rm', '-i', id],
    env: { FOO: 'bar' },
    enabled: true,
    ...overrides,
  };
}

describe('ToolStore — MCP servers', () => {
  it('round-trips a server config', () => {
    const created = store.createMcpServer(sampleServer());
    expect(created.createdAt).toBeDefined();
    const loaded = store.getMcpServer('modern-graphics');
    expect(loaded).toMatchObject({
      id: 'modern-graphics',
      transport: 'stdio',
      command: 'docker',
      args: ['run', '--rm', '-i', 'modern-graphics'],
      env: { FOO: 'bar' },
      enabled: true,
    });
  });

  it('lists servers sorted by id', () => {
    store.createMcpServer(sampleServer('b'));
    store.createMcpServer(sampleServer('a'));
    expect(store.listMcpServers().map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('toggles enabled flag idempotently', () => {
    store.createMcpServer(sampleServer());
    expect(store.setMcpServerEnabled('modern-graphics', false)).toBe(true);
    expect(store.getMcpServer('modern-graphics')!.enabled).toBe(false);
    expect(store.setMcpServerEnabled('modern-graphics', false)).toBe(true);
    expect(store.getMcpServer('modern-graphics')!.enabled).toBe(false);
    expect(store.setMcpServerEnabled('ghost', true)).toBe(false);
  });

  it('links tools to a server and lists by server', () => {
    store.createMcpServer(sampleServer());
    store.createTool(sampleTool('modern-graphics-hero'), undefined, 'modern-graphics');
    store.createTool(sampleTool('modern-graphics-composite'), undefined, 'modern-graphics');
    store.createTool(sampleTool('unrelated'));
    const byServer = store.listToolsByServer('modern-graphics');
    expect(byServer.map((t) => t.id).sort()).toEqual(['modern-graphics-composite', 'modern-graphics-hero']);
    expect(store.getToolServerId('modern-graphics-hero')).toBe('modern-graphics');
    expect(store.getToolServerId('unrelated')).toBeUndefined();
  });

  it('cascades tool deletion when the server is deleted', () => {
    store.createMcpServer(sampleServer());
    store.createTool(sampleTool('modern-graphics-hero'), undefined, 'modern-graphics');
    store.createTool(sampleTool('modern-graphics-composite'), undefined, 'modern-graphics');
    store.createTool(sampleTool('unrelated'));
    const { serverDeleted, toolsDeleted } = store.deleteMcpServer('modern-graphics');
    expect(serverDeleted).toBe(true);
    expect(toolsDeleted).toBe(2);
    expect(store.getMcpServer('modern-graphics')).toBeUndefined();
    expect(store.getTool('modern-graphics-hero')).toBeUndefined();
    expect(store.getTool('unrelated')).toBeDefined();
  });

  it('upserts servers (create then update)', () => {
    store.upsertMcpServer(sampleServer());
    store.upsertMcpServer({ ...sampleServer(), name: 'Modern Graphics v2' });
    expect(store.getMcpServer('modern-graphics')!.name).toBe('Modern Graphics v2');
  });
});
