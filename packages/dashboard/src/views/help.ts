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
      <p class="card__title">What is sua?</p>
      <p style="margin-bottom: var(--space-3); line-height: 1.6;">
        A <strong>local-first agent playground</strong>. Your agents are YAML files that run on your
        machine \u2014 shell commands, Claude/Codex prompts, and tools chained into DAGs. No cloud.
        Runs, secrets, and imported MCP tools all live in <code>data/runs.db</code> beside the project.
      </p>
      <p class="dim" style="margin: 0; line-height: 1.6;">
        Start the dashboard (you're here), author agents in the browser or your editor, schedule them
        on cron, and expose them to Claude Desktop via the MCP server if you want. Everything is inspectable,
        everything is yours.
      </p>
    </section>

    <section class="card" style="margin-bottom: var(--space-6);">
      <p class="card__title">From idea to dashboard \u2014 the 10-step tour</p>
      <ol style="margin: 0; padding-left: var(--space-6); line-height: 1.9;">
        <li>
          <strong>Start with a goal.</strong> On <a href="/agents">Agents</a>, click
          <em>Build from goal</em> and describe what you want in plain English \u2014 Claude
          designs a complete agent with nodes, inputs, and tools. Or use <em>New agent</em> to
          scaffold manually.
        </li>
        <li>
          <strong>Pick your tools.</strong> Browse built-in tools (<code>http-get</code>,
          <code>claude-code</code>, <code>csv-to-chart-json</code>, etc.) on
          <a href="/tools?tab=builtin">/tools \u2192 Built-in</a>.
          Need something third-party? Paste a Claude-Desktop <code>mcpServers</code> config at
          <a href="/tools/mcp/import">/tools/mcp/import</a> and pick which tools to import.
        </li>
        <li>
          <strong>Write the agent.</strong> Chain nodes with <code>dependsOn</code>. Pass upstream
          data via <code>{{upstream.&lt;id&gt;.result}}</code> (claude-code) or
          <code>$UPSTREAM_&lt;ID&gt;_RESULT</code> (shell). Edit nodes directly on
          <a href="/agents">agent detail \u2192 Nodes tab</a>, or author YAML and
          <code>sua workflow import-yaml</code>.
        </li>
        <li>
          <strong>Style the output.</strong> On the agent's <em>Config</em> tab, configure an
          <strong>Output Widget</strong>: pick a widget card (raw / key-value / diff-apply / dashboard),
          or try <em>AI template \u2728</em> \u2014 describe the layout, Claude generates sanitized HTML,
          you see a live preview as you edit.
        </li>
        <li>
          <strong>Run it.</strong> Click <em>Run now</em> on the agent card. Watch
          <a href="/runs">live run progress</a> \u2014 per-node stdout, stream-json turn events,
          exit codes, timings.
        </li>
        <li>
          <strong>Fix with an LLM.</strong> A failing run's detail page has <em>Suggest improvements</em> \u2014
          the built-in <code>agent-analyzer</code> reviews your YAML, the classification, and the error,
          then returns an <em>auto-validated</em> diff you can apply with one click. Works with Claude and Codex.
        </li>
        <li>
          <strong>Share secrets + variables.</strong> Put API keys in
          <a href="/settings/secrets">Secrets</a> (encrypted, passphrase-unlocked). Put non-sensitive
          config in <a href="/settings/variables">Variables</a> (plain-text, available as
          <code>$NAME</code> / <code>{{vars.NAME}}</code>).
        </li>
        <li>
          <strong>Schedule it (optional).</strong> Set a cron expression on the agent. Start the local
          scheduler with <code>sua schedule start</code> \u2014 it fires active scheduled agents and
          logs to the dashboard.
        </li>
        <li>
          <strong>Pin it to Pulse.</strong> Add a <code>signal:</code> block to the agent. Pick
          template <code>widget</code> and the agent's own output widget becomes a live tile on
          <a href="/pulse">/pulse</a> \u2014 no slot mapping needed.
        </li>
        <li>
          <strong>Serve it to other agents.</strong> Set <code>mcp: true</code> on the agent and run
          <code>sua mcp start</code>. Claude Desktop, Cursor, or any MCP client with your bearer
          token can invoke the agent like any other tool. The sua process itself can also run in
          Docker if you want it as a long-lived service beside your app.
        </li>
      </ol>
    </section>

    <section class="card card--muted" style="margin-bottom: var(--space-6);">
      <p class="card__title">Start here</p>
      <p style="margin-bottom: var(--space-3);">
        <strong>
          <a href="/help/tutorial" class="btn btn--primary">Open the dashboard tutorial \u2192</a>
        </strong>
      </p>
      <p class="dim" style="margin: 0;">
        A progress-tracked walkthrough tied to your project's state: registered agents, first run,
        per-node outputs, multi-node DAGs, secrets. Each step links to the dashboard page where
        the action happens. For a terminal-first walkthrough instead, run
        <code>sua tutorial</code> from your project directory.
      </p>
    </section>

    ${groups as unknown as SafeHtml[]}

    <section style="margin-top: var(--space-8);">
      <h2>User guides</h2>
      <p class="dim" style="margin: 0 0 var(--space-3);">
        Longer-form documentation on GitHub. Pair each guide with the in-dashboard page it covers.
      </p>
      <ul style="line-height: 1.8;">
        <li><a href="https://github.com/gregmeyer/some-useful-agents/blob/main/docs/quickstart.md" target="_blank" rel="noreferrer">Quickstart</a> \u2014 30-minute first-touch guide, from install to chained agents.</li>
        <li><a href="https://github.com/gregmeyer/some-useful-agents/blob/main/docs/agents.md" target="_blank" rel="noreferrer">Agent YAML reference</a> \u2014 every field: inputs, nodes, schedule, signal, output widget.</li>
        <li><a href="https://github.com/gregmeyer/some-useful-agents/blob/main/docs/flows.md" target="_blank" rel="noreferrer">Flow control</a> \u2014 conditional, switch, loop, agent-invoke, branch, end, break.</li>
        <li><a href="https://github.com/gregmeyer/some-useful-agents/blob/main/docs/tools.md" target="_blank" rel="noreferrer">Tools</a> \u2014 built-in + MCP + user-authored; one page per tool.</li>
        <li><a href="https://github.com/gregmeyer/some-useful-agents/blob/main/docs/mcp.md" target="_blank" rel="noreferrer">MCP servers</a> \u2014 paste-config import, enable/disable, cascade delete (<a href="/tools/mcp/import">/tools/mcp/import</a>).</li>
        <li><a href="https://github.com/gregmeyer/some-useful-agents/blob/main/docs/output-widgets.md" target="_blank" rel="noreferrer">Output widgets</a> \u2014 widget types + AI-generated HTML templates (<a href="/agents">agent config</a>).</li>
        <li><a href="https://github.com/gregmeyer/some-useful-agents/blob/main/docs/templating.md" target="_blank" rel="noreferrer">Templating</a> \u2014 <code>{{inputs.X}}</code>, <code>{{upstream.X.result}}</code>, <code>{{vars.X}}</code>, <code>{{outputs.X}}</code>.</li>
        <li><a href="https://github.com/gregmeyer/some-useful-agents/blob/main/docs/dashboard.md" target="_blank" rel="noreferrer">Dashboard tour</a> \u2014 every page: what it's for + when to use it.</li>
      </ul>
    </section>

    <section style="margin-top: var(--space-6);">
      <h2>Reference</h2>
      <ul>
        <li><a href="https://github.com/gregmeyer/some-useful-agents" target="_blank" rel="noreferrer">Project README</a></li>
        <li><a href="https://github.com/gregmeyer/some-useful-agents/blob/main/docs/SECURITY.md" target="_blank" rel="noreferrer">Security model &amp; trust boundaries</a></li>
        <li><a href="https://github.com/gregmeyer/some-useful-agents/tree/main/docs/adr" target="_blank" rel="noreferrer">Architecture decisions (ADRs)</a></li>
        <li><a href="https://github.com/gregmeyer/some-useful-agents/blob/main/CHANGELOG.md" target="_blank" rel="noreferrer">Changelog</a></li>
        <li><a href="https://github.com/gregmeyer/some-useful-agents/blob/main/ROADMAP.md" target="_blank" rel="noreferrer">Roadmap</a></li>
      </ul>
    </section>
  `;

  return render(layout({ title: 'Help', activeNav: 'help' }, body));
}
