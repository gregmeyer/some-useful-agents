import { html, render, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader } from './page-header.js';

interface CliCommand {
  cmd: string;
  desc: string;
  /** If the same action is available in the dashboard, link to it here. */
  inDashboard?: { label: string; href: string };
}

/**
 * CLI surface organized by purpose. Mirrored from `sua --help` output.
 * Keep this list up-to-date when new top-level verbs land — easiest way
 * is to add the entry here in the same PR as the CLI change.
 */
const CLI_GROUPS: Array<{ title: string; commands: CliCommand[] }> = [
  {
    title: 'Getting started',
    commands: [
      { cmd: 'sua tutorial', desc: 'Interactive onboarding walkthrough. Covers init, first agent, first run.' },
      { cmd: 'sua init', desc: 'Scaffold sua.config.json and an agents/ directory in the current project.' },
      { cmd: 'sua doctor --security', desc: 'Check prerequisites, secrets store mode, MCP token, agent sources.' },
    ],
  },
  {
    title: 'Agents & workflows',
    commands: [
      { cmd: 'sua agent new', desc: 'Interactive scaffolder for a new YAML agent.' },
      {
        cmd: 'sua workflow list',
        desc: 'List DAG agents in the run DB.',
        inDashboard: { label: 'Agents page', href: '/agents' },
      },
      {
        cmd: 'sua workflow run <id>',
        desc: 'Execute a DAG agent once, synchronously.',
        inDashboard: { label: '"Run now" on agent detail', href: '/agents' },
      },
      {
        cmd: 'sua workflow show <id>',
        desc: 'Print the DAG of an agent as text or YAML.',
        inDashboard: { label: 'DAG viz on agent detail', href: '/agents' },
      },
      { cmd: 'sua workflow import agents/ --apply', desc: 'Migrate v1 YAML chains into merged v2 DAG agents.' },
      { cmd: 'sua workflow export <id>', desc: 'Emit an agent\u2019s YAML to stdout (lossless round-trip).' },
      { cmd: 'sua workflow status <id> <newStatus>', desc: 'Set active | paused | archived | draft. UI toggle lands in the next v0.15 PR.' },
      {
        cmd: 'sua workflow logs <runId>',
        desc: 'Per-node execution records for a run.',
        inDashboard: { label: 'Run detail', href: '/runs' },
      },
      { cmd: 'sua workflow replay <runId> --from <nodeId>', desc: 'Re-run a prior run from a specific node, reusing upstream outputs. UI arrives in v0.15.' },
    ],
  },
  {
    title: 'Scheduling',
    commands: [
      { cmd: 'sua schedule start', desc: 'Fire scheduled agents on their cron expressions.' },
      { cmd: 'sua schedule list', desc: 'Show configured schedules.' },
    ],
  },
  {
    title: 'Secrets',
    commands: [
      { cmd: 'sua secrets set <NAME>', desc: 'Store an encrypted secret (value prompted, never echoed).' },
      { cmd: 'sua secrets list', desc: 'List declared secret names. Values are never shown.' },
      { cmd: 'sua secrets migrate', desc: 'Upgrade legacy v1 secrets file to v2 passphrase-protected form.' },
    ],
  },
  {
    title: 'MCP & dashboard',
    commands: [
      { cmd: 'sua mcp start', desc: 'Start the MCP server on 127.0.0.1:3003.' },
      { cmd: 'sua mcp rotate-token', desc: 'Generate a new MCP bearer token. UI button arrives in v0.15 General settings.' },
      { cmd: 'sua dashboard start', desc: 'Start this web UI.' },
    ],
  },
];

function cliRow(cmd: CliCommand): SafeHtml {
  const mapped = cmd.inDashboard
    ? html`<a class="badge badge--info" href="${cmd.inDashboard.href}">${cmd.inDashboard.label}</a>`
    : html`<span class="dim subtle">CLI only</span>`;
  return html`
    <tr>
      <td><code>${cmd.cmd}</code></td>
      <td class="dim">${cmd.desc}</td>
      <td>${mapped}</td>
    </tr>
  `;
}

export function renderHelp(): string {
  const groups = CLI_GROUPS.map((g) => html`
    <section style="margin-top: var(--space-6);">
      <h2>${g.title}</h2>
      <table class="table">
        <thead>
          <tr>
            <th>Command</th>
            <th>What it does</th>
            <th>Where in the UI</th>
          </tr>
        </thead>
        <tbody>${g.commands.map(cliRow) as unknown as SafeHtml[]}</tbody>
      </table>
    </section>
  `);

  const body = html`
    ${pageHeader({
      title: 'Help & tutorial',
      description: 'Your map for using sua from the terminal and the dashboard. ' +
        'The CLI is authoritative; the dashboard is the ergonomic surface.',
    })}

    <section class="card" style="margin-bottom: var(--space-6);">
      <p class="card__title">Start here</p>
      <p>Run the built-in interactive walkthrough from your terminal:</p>
      <pre style="background: var(--color-terminal-bg); color: var(--color-terminal-fg); margin: var(--space-3) 0;">sua tutorial</pre>
      <p class="dim" style="margin: 0;">
        It scaffolds a starter agent, runs it, and shows you how to read the output.
        Safe to run in an empty directory \u2014 no network calls, no secrets required.
      </p>
    </section>

    <section class="card card--muted" style="margin-bottom: var(--space-6);">
      <p class="card__title">Dashboard in 60 seconds</p>
      <ol style="margin: 0; padding-left: var(--space-6); line-height: 1.8;">
        <li><a href="/agents">Agents</a> \u2014 every DAG agent registered in this project.</li>
        <li>Click an agent \u2014 see its DAG, nodes, and recent runs. Click <strong>Run now</strong>.</li>
        <li><a href="/runs">Runs</a> \u2014 every execution. Click one to see per-node stdout, exit codes, and errors.</li>
        <li><a href="/settings">Settings</a> \u2014 secrets, integrations, MCP token, retention (expanding through v0.15).</li>
      </ol>
    </section>

    ${groups as unknown as SafeHtml[]}

    <section style="margin-top: var(--space-8);">
      <h2>Further reading</h2>
      <ul>
        <li><a href="https://github.com/gregmeyer/some-useful-agents" target="_blank" rel="noreferrer">Project README</a></li>
        <li><a href="https://github.com/gregmeyer/some-useful-agents/blob/main/docs/SECURITY.md" target="_blank" rel="noreferrer">Security model &amp; trust boundaries</a></li>
        <li><a href="https://github.com/gregmeyer/some-useful-agents/tree/main/docs" target="_blank" rel="noreferrer">Full docs directory</a></li>
      </ul>
    </section>
  `;

  return render(layout({ title: 'Help', activeNav: 'help' }, body));
}
