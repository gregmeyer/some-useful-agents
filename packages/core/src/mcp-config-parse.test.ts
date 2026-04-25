import { describe, it, expect } from 'vitest';
import { parseMcpServersBlob } from './mcp-config-parse.js';

describe('parseMcpServersBlob', () => {
  it('parses Claude Desktop { mcpServers: ... } JSON', () => {
    const input = JSON.stringify({
      mcpServers: {
        'modern-graphics': {
          type: 'stdio',
          command: 'docker',
          args: ['run', '--rm', '-i', 'modern-graphics'],
          env: { FOO: 'bar' },
        },
      },
    });
    const { servers, errors } = parseMcpServersBlob(input);
    expect(errors).toEqual([]);
    expect(servers).toHaveLength(1);
    expect(servers[0]).toMatchObject({
      id: 'modern-graphics',
      name: 'modern-graphics',
      transport: 'stdio',
      command: 'docker',
      args: ['run', '--rm', '-i', 'modern-graphics'],
      env: { FOO: 'bar' },
      enabled: true,
    });
  });

  it('parses a bare map (no mcpServers wrapper)', () => {
    const input = JSON.stringify({
      'server-a': { command: 'cmd-a' },
      'server-b': { command: 'cmd-b' },
    });
    const { servers, errors } = parseMcpServersBlob(input);
    expect(errors).toEqual([]);
    expect(servers.map((s) => s.id)).toEqual(['server-a', 'server-b']);
  });

  it('parses a single anonymous server shape', () => {
    const input = JSON.stringify({ command: 'npx', args: ['-y', 'foo'] });
    const { servers, errors } = parseMcpServersBlob(input, 'my-server');
    expect(errors).toEqual([]);
    expect(servers).toHaveLength(1);
    expect(servers[0].id).toBe('my-server');
    expect(servers[0].command).toBe('npx');
  });

  it('parses YAML', () => {
    const input = `
mcpServers:
  foo:
    command: python
    args: [-m, foo]
`;
    const { servers, errors } = parseMcpServersBlob(input);
    expect(errors).toEqual([]);
    expect(servers).toHaveLength(1);
    expect(servers[0]).toMatchObject({ id: 'foo', command: 'python', args: ['-m', 'foo'] });
  });

  it('infers http transport when only url is present', () => {
    const input = JSON.stringify({ 'remote-api': { url: 'http://127.0.0.1:4000/mcp' } });
    const { servers, errors } = parseMcpServersBlob(input);
    expect(errors).toEqual([]);
    expect(servers[0].transport).toBe('http');
    expect(servers[0].url).toBe('http://127.0.0.1:4000/mcp');
  });

  it('reports per-entry errors without failing valid siblings', () => {
    const input = JSON.stringify({
      good: { command: 'ok' },
      bad: { env: 'not-an-object' },
      missing: { transport: 'stdio' },
    });
    const { servers, errors } = parseMcpServersBlob(input);
    expect(servers.map((s) => s.id)).toEqual(['good']);
    expect(errors.map((e) => e.key).sort()).toEqual(['bad', 'missing']);
  });

  it('returns a root-level error for empty or malformed input', () => {
    expect(parseMcpServersBlob('').errors[0].key).toBe('<root>');
    expect(parseMcpServersBlob('{not json').errors[0].key).toBe('<root>');
  });

  it('dedupes entries whose keys slug to the same id', () => {
    const input = JSON.stringify({
      'Modern Graphics': { command: 'a' },
      'modern-graphics': { command: 'b' },
    });
    const { servers, errors } = parseMcpServersBlob(input);
    expect(servers).toHaveLength(1);
    expect(errors.some((e) => /duplicate/.test(e.message))).toBe(true);
  });

  it('slugs weird keys to safe ids but preserves the name', () => {
    const input = JSON.stringify({ 'Modern Graphics!': { command: 'x' } });
    const { servers } = parseMcpServersBlob(input);
    expect(servers[0].id).toBe('modern-graphics');
    expect(servers[0].name).toBe('Modern Graphics!');
  });
});
