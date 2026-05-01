import { html, render, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader } from './page-header.js';

export type SettingsTab = 'secrets' | 'variables' | 'mcp' | 'mcp-servers' | 'integrations' | 'appearance' | 'general';

export interface SettingsShellArgs {
  active: SettingsTab;
  body: SafeHtml;
  flash?: { kind: 'error' | 'info' | 'ok'; message: string };
}

/**
 * Shared chrome for every /settings/* route: page header + tab strip.
 * The per-tab content lives in settings-secrets.ts / settings-general.ts /
 * settings-integrations.ts and is rendered into `body`.
 */
export function renderSettingsShell(args: SettingsShellArgs): string {
  const tab = (id: SettingsTab, label: string) => html`
    <a href="/settings/${id}" class="${args.active === id ? 'is-active' : ''}">${label}</a>
  `;

  const body = html`
    ${pageHeader({ title: 'Settings' })}
    <nav class="tab-strip">
      ${tab('secrets', 'Secrets')}
      ${tab('variables', 'Variables')}
      ${tab('mcp', 'MCP')}
      ${tab('mcp-servers', 'MCP Servers')}
      ${tab('integrations', 'Integrations')}
      ${tab('appearance', 'Appearance')}
      ${tab('general', 'General')}
    </nav>
    <div class="settings-shell">
      ${args.body}
    </div>
  `;

  return render(layout(
    { title: 'Settings', activeNav: 'settings', flash: args.flash },
    body,
  ));
}
