import { describe, it, expect } from 'vitest';
import { deriveCapabilities } from './agent-capabilities.js';
import type { Agent } from './agent-v2-types.js';

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'a',
    name: 'A',
    status: 'active',
    source: 'local',
    mcp: false,
    version: 1,
    nodes: [{ id: 'main', type: 'shell', command: 'echo hi' }],
    ...overrides,
  };
}

describe('deriveCapabilities — tools_used', () => {
  it('lists shell-exec for plain shell nodes', () => {
    const c = deriveCapabilities(makeAgent());
    expect(c.tools_used).toEqual(['shell-exec']);
  });

  it('lists claude-code for plain claude-code nodes', () => {
    const c = deriveCapabilities(makeAgent({
      nodes: [{ id: 'main', type: 'claude-code', prompt: 'say hi' }],
    }));
    expect(c.tools_used).toEqual(['claude-code']);
  });

  it('captures explicit tool: names', () => {
    const c = deriveCapabilities(makeAgent({
      nodes: [
        { id: 'fetch', type: 'shell', tool: 'http-get', toolInputs: { url: 'https://example.com' } },
        { id: 'save', type: 'shell', tool: 'file-write', toolInputs: { path: '/tmp/x' } },
      ],
    }));
    expect(c.tools_used).toEqual(['file-write', 'http-get']);
  });

  it('includes allowedTools entries from claude-code nodes', () => {
    const c = deriveCapabilities(makeAgent({
      nodes: [{
        id: 'main', type: 'claude-code', prompt: 'do thing',
        allowedTools: ['file-read', 'file-write', 'web-search'],
      }],
    }));
    expect(c.tools_used).toEqual(['claude-code', 'file-read', 'file-write', 'web-search']);
  });

  it('dedupes tool names across nodes', () => {
    const c = deriveCapabilities(makeAgent({
      nodes: [
        { id: 'a', type: 'shell', command: 'echo 1' },
        { id: 'b', type: 'shell', command: 'echo 2' },
      ],
    }));
    expect(c.tools_used).toEqual(['shell-exec']);
  });

  it('detects file-write node type as the file-write tool', () => {
    const c = deriveCapabilities(makeAgent({
      nodes: [{ id: 'save', type: 'file-write', path: 'out.md', content: 'x' }],
    }));
    expect(c.tools_used).toContain('file-write');
    expect(c.side_effects).toContain('writes_files');
  });

  it('returns empty for flow-control-only DAGs', () => {
    const c = deriveCapabilities(makeAgent({
      nodes: [{ id: 'end', type: 'end', endMessage: 'done' }],
    }));
    expect(c.tools_used).toEqual([]);
  });
});

describe('deriveCapabilities — mcp_servers_used', () => {
  it('extracts server name from mcp__server__tool naming', () => {
    const c = deriveCapabilities(makeAgent({
      nodes: [{
        id: 'main', type: 'claude-code', prompt: 'x',
        allowedTools: ['mcp__github__list_prs', 'mcp__notion__search'],
      }],
    }));
    expect(c.mcp_servers_used).toEqual(['github', 'notion']);
  });

  it('also detects MCP tool when used as the primary tool: field', () => {
    const c = deriveCapabilities(makeAgent({
      nodes: [{ id: 'main', type: 'shell', tool: 'mcp__linear__create_issue' }],
    }));
    expect(c.mcp_servers_used).toEqual(['linear']);
  });

  it('returns empty when no MCP-prefixed tools are used', () => {
    const c = deriveCapabilities(makeAgent({
      nodes: [{ id: 'main', type: 'shell', tool: 'http-get' }],
    }));
    expect(c.mcp_servers_used).toEqual([]);
  });
});

describe('deriveCapabilities — side_effects', () => {
  it('detects sends_notifications when notify is set', () => {
    const c = deriveCapabilities(makeAgent({
      notify: {
        on: ['failure'],
        secrets: ['SLACK_WEBHOOK'],
        handlers: [{ type: 'slack', webhook_secret: 'SLACK_WEBHOOK' }],
      },
    }));
    expect(c.side_effects).toContain('sends_notifications');
  });

  it('detects posts_http for webhook notify handlers', () => {
    const c = deriveCapabilities(makeAgent({
      notify: {
        on: ['always'],
        handlers: [{ type: 'webhook', url: 'https://example.com/hook' }],
      },
    }));
    expect(c.side_effects).toContain('posts_http');
    expect(c.side_effects).toContain('sends_notifications');
  });

  it('detects writes_files for file-write tool', () => {
    const c = deriveCapabilities(makeAgent({
      nodes: [{ id: 'save', type: 'shell', tool: 'file-write', toolInputs: { path: '/tmp/x' } }],
    }));
    expect(c.side_effects).toContain('writes_files');
  });

  it('detects writes_files for claude-code Edit/Write in allowedTools', () => {
    const c = deriveCapabilities(makeAgent({
      nodes: [{
        id: 'main', type: 'claude-code', prompt: 'x',
        allowedTools: ['Edit', 'Write'],
      }],
    }));
    expect(c.side_effects).toContain('writes_files');
  });

  it('detects writes_files for shell redirects (>, >>, tee, mkdir, mv, cp, rm)', () => {
    for (const cmd of [
      'echo hi > out.txt',
      'echo hi >> out.txt',
      'echo hi | tee out.txt',
      'mkdir -p /tmp/x',
      'mv a b',
      'cp a b',
      'rm -f x',
    ]) {
      const c = deriveCapabilities(makeAgent({
        nodes: [{ id: 'main', type: 'shell', command: cmd }],
      }));
      expect(c.side_effects).toContain('writes_files');
    }
  });

  it('detects posts_http for http-post tool', () => {
    const c = deriveCapabilities(makeAgent({
      nodes: [{ id: 'main', type: 'shell', tool: 'http-post', toolInputs: { url: 'https://x.com' } }],
    }));
    expect(c.side_effects).toContain('posts_http');
  });

  it('returns empty side_effects for read-only agents', () => {
    const c = deriveCapabilities(makeAgent({
      nodes: [{ id: 'fetch', type: 'shell', tool: 'http-get', toolInputs: { url: 'https://x.com' } }],
    }));
    expect(c.side_effects).toEqual([]);
  });
});

describe('deriveCapabilities — reads_external', () => {
  it('captures URLs from toolInputs.url', () => {
    const c = deriveCapabilities(makeAgent({
      nodes: [{ id: 'fetch', type: 'shell', tool: 'http-get', toolInputs: { url: 'https://api.example.com/v1/things' } }],
    }));
    expect(c.reads_external).toEqual(['https://api.example.com/v1/things']);
  });

  it('captures URLs from toolInputs.endpoint', () => {
    const c = deriveCapabilities(makeAgent({
      nodes: [{ id: 'a', type: 'shell', tool: 'http-post', toolInputs: { endpoint: 'https://hooks.example.com/x' } }],
    }));
    expect(c.reads_external).toContain('https://hooks.example.com/x');
  });

  it('captures URLs embedded in shell commands', () => {
    const c = deriveCapabilities(makeAgent({
      nodes: [{ id: 'main', type: 'shell', command: 'curl -sf "https://news.ycombinator.com/" | grep title' }],
    }));
    expect(c.reads_external).toEqual(['https://news.ycombinator.com/']);
  });

  it('captures URLs embedded in claude-code prompts', () => {
    const c = deriveCapabilities(makeAgent({
      nodes: [{ id: 'main', type: 'claude-code', prompt: 'Look at https://example.com/docs and summarize.' }],
    }));
    expect(c.reads_external).toEqual(['https://example.com/docs']);
  });

  it('strips trailing punctuation from URLs in prose', () => {
    const c = deriveCapabilities(makeAgent({
      nodes: [{ id: 'main', type: 'claude-code', prompt: 'Check https://example.com/path. It might be down.' }],
    }));
    expect(c.reads_external).toEqual(['https://example.com/path']);
  });

  it('dedupes URLs across nodes', () => {
    const c = deriveCapabilities(makeAgent({
      nodes: [
        { id: 'a', type: 'shell', command: 'curl https://api.example.com/x' },
        { id: 'b', type: 'shell', command: 'curl https://api.example.com/x', dependsOn: ['a'] },
      ],
    }));
    expect(c.reads_external).toEqual(['https://api.example.com/x']);
  });

  it('returns sorted output across all four arrays', () => {
    const c = deriveCapabilities(makeAgent({
      nodes: [
        { id: 'a', type: 'shell', command: 'curl https://b.com && curl https://a.com' },
        { id: 'b', type: 'claude-code', prompt: 'x', allowedTools: ['file-write', 'Edit'] },
      ],
    }));
    expect(c.reads_external).toEqual(['https://a.com', 'https://b.com']);
    expect(c.tools_used).toEqual(['Edit', 'claude-code', 'file-write', 'shell-exec']);
  });
});
