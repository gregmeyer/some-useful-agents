import type { ToolDefinition } from '@some-useful-agents/core';
import { html, render, unsafeHtml, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader } from './page-header.js';

export function renderToolDetail(args: {
  tool: ToolDefinition;
  /** When set, link the tool to its source MCP server for navigation. */
  mcpServerId?: string;
}): string {
  const { tool, mcpServerId } = args;

  const sourceBadge = tool.source === 'builtin'
    ? html`<span class="badge badge--muted">builtin</span>`
    : html`<span class="badge badge--ok">${tool.source}</span>`;

  const implBadge = tool.implementation.type === 'shell'
    ? html`<span class="badge badge--ok">shell</span>`
    : tool.implementation.type === 'claude-code'
      ? html`<span class="badge badge--info">claude-code</span>`
      : tool.implementation.type === 'mcp'
        ? html`<span class="badge badge--info">mcp</span>`
        : html`<span class="badge badge--muted">${tool.implementation.type}</span>`;

  const inputRows = Object.entries(tool.inputs).map(([name, spec]) => html`
    <tr>
      <td class="mono">${name}</td>
      <td>${spec.type}</td>
      <td>${spec.required ? html`<span class="badge badge--warn">required</span>` : html`<span class="dim">optional</span>`}</td>
      <td class="mono">${spec.default !== undefined ? String(spec.default) : html`<span class="dim">\u2014</span>`}</td>
      <td class="dim">${spec.description ?? ''}</td>
    </tr>
  `);

  const outputRows = Object.entries(tool.outputs).map(([name, spec]) => html`
    <tr>
      <td class="mono">${name}</td>
      <td>${spec.type}</td>
      <td class="dim">${spec.description ?? ''}</td>
    </tr>
  `);

  const body = html`
    ${pageHeader({
      title: tool.id,
      meta: [sourceBadge, implBadge],
      description: tool.description ?? undefined,
      back: { href: '/tools', label: 'Back to tools' },
    })}

    ${Object.keys(tool.inputs).length > 0 ? html`
      <section>
        <h2>Inputs</h2>
        <table class="table">
          <thead><tr><th>Name</th><th>Type</th><th>Required</th><th>Default</th><th>Description</th></tr></thead>
          <tbody>${inputRows as unknown as SafeHtml[]}</tbody>
        </table>
      </section>
    ` : html`<p class="dim">No inputs declared.</p>`}

    ${Object.keys(tool.outputs).length > 0 ? html`
      <section class="mt-6">
        <h2>Outputs</h2>
        <table class="table">
          <thead><tr><th>Name</th><th>Type</th><th>Description</th></tr></thead>
          <tbody>${outputRows as unknown as SafeHtml[]}</tbody>
        </table>
      </section>
    ` : html`<p class="dim">No outputs declared.</p>`}

    <section class="mt-6">
      <h2>Implementation</h2>
      <div class="card">
        <dl class="kv">
          <dt>Type</dt><dd>${tool.implementation.type}</dd>
          ${tool.implementation.command
            ? html`<dt>Command</dt><dd class="mono" style="white-space: pre-wrap;">${tool.implementation.command}</dd>`
            : unsafeHtml('')}
          ${tool.implementation.prompt
            ? html`<dt>Prompt</dt><dd style="white-space: pre-wrap;">${tool.implementation.prompt}</dd>`
            : unsafeHtml('')}
          ${tool.implementation.builtinName
            ? html`<dt>Builtin</dt><dd class="mono">${tool.implementation.builtinName}</dd>`
            : unsafeHtml('')}
          ${mcpServerId
            ? html`<dt>Server</dt><dd class="mono"><a href="/settings/mcp-servers">${mcpServerId}</a></dd>`
            : unsafeHtml('')}
          ${tool.implementation.type === 'mcp' ? html`
            <dt>Transport</dt><dd class="mono">${tool.implementation.mcpTransport ?? 'stdio'}</dd>
            ${tool.implementation.mcpToolName
              ? html`<dt>Remote tool</dt><dd class="mono">${tool.implementation.mcpToolName}</dd>`
              : unsafeHtml('')}
            ${tool.implementation.mcpUrl
              ? html`<dt>URL</dt><dd class="mono">${tool.implementation.mcpUrl}</dd>`
              : unsafeHtml('')}
            ${tool.implementation.mcpCommand
              ? html`<dt>Command</dt><dd class="mono">${tool.implementation.mcpCommand} ${(tool.implementation.mcpArgs ?? []).join(' ')}</dd>`
              : unsafeHtml('')}
            ${tool.implementation.mcpEnv && Object.keys(tool.implementation.mcpEnv).length > 0
              ? html`<dt>Env</dt><dd class="mono">${Object.keys(tool.implementation.mcpEnv).join(', ')}</dd>`
              : unsafeHtml('')}
          ` : unsafeHtml('')}
        </dl>
      </div>
    </section>
  `;

  return render(layout({ title: `Tool: ${tool.id}`, activeNav: 'tools' }, body));
}
