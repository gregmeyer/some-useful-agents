import { describe, it, expect } from 'vitest';
import type { McpServerConfig } from '@some-useful-agents/core';
import { cleanUpServerContainers, serverContainers, type RunCommand } from './mcp-containers.js';

const graphics: McpServerConfig = {
  id: 'modern-graphics', name: 'modern-graphics', transport: 'stdio', enabled: true, command: 'docker',
  args: ['run', '--rm', '-i', '-v', '/out:/app/output', '-w', '/app', '--entrypoint', 'python', 'modern-graphics', '-m', 'modern_graphics.mcp_server'],
};

function fakeDocker(ps: string) {
  const calls: string[][] = [];
  const run: RunCommand = async (command, args) => { calls.push([command, ...args]); return args[0] === 'ps' ? ps : ''; };
  return { calls, run };
}

describe("a Docker-run server's left-over containers", () => {
  it('counts running ones and lists stopped and never-started ones, for its image only', async () => {
    const { calls, run } = fakeDocker('aaa111\trunning\nbbb222\tcreated\nccc333\texited\nddd444\tdead\n\n');
    expect(await serverContainers(graphics, run)).toEqual({ running: 1, leftover: ['bbb222', 'ccc333', 'ddd444'] });
    expect(calls[0]).toEqual(['docker', 'ps', '-a', '--filter', 'ancestor=modern-graphics', '--format', '{{.ID}}\t{{.State}}']);
  });

  it('clean up removes the left-over ones and leaves the running ones', async () => {
    const { calls, run } = fakeDocker('aaa111\trunning\nbbb222\tcreated\nccc333\texited\n');
    expect(await cleanUpServerContainers(graphics, run)).toEqual({ removed: 2, running: 1 });
    expect(calls[1]).toEqual(['docker', 'rm', 'bbb222', 'ccc333']);
    const none = fakeDocker('aaa111\trunning\n');
    expect(await cleanUpServerContainers(graphics, none.run)).toEqual({ removed: 0, running: 1 });
    expect(none.calls).toHaveLength(1);
  });

  it("a server that isn't docker run has none, and clean up says so", async () => {
    const npx: McpServerConfig = { ...graphics, command: 'npx', args: ['-y', 'some-server'] };
    expect(await serverContainers(npx, fakeDocker('').run)).toBeUndefined();
    await expect(cleanUpServerContainers(npx, fakeDocker('').run)).rejects.toThrow("doesn't run in Docker");
  });
});
