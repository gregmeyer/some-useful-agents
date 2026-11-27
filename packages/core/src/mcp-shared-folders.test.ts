import { describe, it, expect } from 'vitest';
import { homedir } from 'node:os';
import { dockerShares, hostPathFor, mcpSharedFolders } from './mcp-shared-folders.js';
import type { McpServerConfig } from './mcp-server-types.js';

// The setup docs/mcp.md gives for modern-graphics.
const graphics: McpServerConfig = {
  id: 'modern-graphics', name: 'modern-graphics', transport: 'stdio', enabled: true, command: 'docker',
  args: ['run', '--rm', '-i', '--ipc=host', '-v', '/Users/me/graphics/output:/app/output', '-w', '/app', '--entrypoint', 'python', 'modern-graphics', '-m', 'modern_graphics.mcp_server'],
};

describe('folders a Docker-run tool server shares', () => {
  it('reads -v and -w from its start command', () => {
    expect(dockerShares(graphics)).toEqual({ workdir: '/app', image: 'modern-graphics', folders: [{ server: 'modern-graphics', host: '/Users/me/graphics/output', inside: '/app/output' }] });
  });

  it('reads --mount binds, --volume=, ~ and --workdir=; skips named volumes and what follows the image', () => {
    const s: McpServerConfig = { ...graphics, args: ['run', '-i', '--volume=~/pics:/data:ro', '--mount', 'type=bind,source=/srv/out,target=/out', '-v', 'cache:/cache', '--workdir=/data', 'img', '-v', '/etc:/etc'] };
    expect(dockerShares(s)).toEqual({ workdir: '/data', image: 'img', folders: [
      { server: 'modern-graphics', host: `${homedir()}/pics`, inside: '/data' },
      { server: 'modern-graphics', host: '/srv/out', inside: '/out' },
    ] });
  });

  it('a server that isn’t docker run, or is off, shares nothing', () => {
    expect(dockerShares({ ...graphics, command: 'npx', args: ['-y', 'x', '-v', '/a:/b'] })).toEqual({ folders: [] });
    expect(mcpSharedFolders([{ ...graphics, enabled: false }])).toEqual([]);
  });
});

describe('where a path a server gave is on this computer', () => {
  it('maps an absolute path in a shared folder, and a relative one against its working folder', () => {
    expect(hostPathFor('/app/output/pbj.png', [graphics])).toBe('/Users/me/graphics/output/pbj.png');
    expect(hostPathFor('output/charts/a.png', [graphics])).toBe('/Users/me/graphics/output/charts/a.png');
  });

  it('a path outside every shared folder stayed in the container', () => {
    expect(hostPathFor('.sua/graphics-output/pbj.png', [graphics])).toBeUndefined();
    expect(hostPathFor('/app/output/../../etc/passwd', [graphics])).toBeUndefined();
    expect(hostPathFor('output/../secrets.txt', [graphics])).toBeUndefined();
    expect(hostPathFor('/app/output/pbj.png', [{ ...graphics, enabled: false }])).toBeUndefined();
  });
});
