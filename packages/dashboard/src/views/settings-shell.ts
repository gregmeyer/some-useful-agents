import { html, render, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader } from './page-header.js';

/** `mcp-servers` and `integrations` left for the Tools page in ADR-0034. */
export type SettingsTab = 'secrets' | 'variables' | 'mcp' | 'llm' | 'temporal' | 'appearance' | 'general';

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
    ${pageHeader({
      title: 'Settings',
      description: 'Everything sua needs to reach the outside world — model providers, secrets, and connected services — plus how this dashboard looks.',
    })}
    <nav class="tab-strip">
      ${tab('secrets', 'Secrets')}
      ${tab('variables', 'Variables')}
      ${/* "MCP" sat next to "MCP Servers" and read as its pair, but it is the
            opposite direction: this is sua exposed AS a tool for other apps to
            call. Named for what it does. ADR-0034. */ html``}
      ${tab('mcp', 'Claude Desktop')}
      ${tab('llm', 'LLM')}
      ${tab('temporal', 'Temporal')}
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
