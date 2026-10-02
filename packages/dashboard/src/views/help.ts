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
    title: 'Agents',
    commands: [
      { cmd: 'sua agent new', desc: 'Interactive scaffolder for a new agent.' },
      {
        cmd: 'sua agent list',
        desc: 'List every agent you have, with a column saying which are still on the older format.',
        inDashboard: { label: 'Agents page', href: '/agents' },
      },
      {
        cmd: 'sua agent run <id>',
        desc: 'Run an agent once and wait for the result.',
        inDashboard: { label: '"Run now" on agent detail', href: '/agents' },
      },
      {
        cmd: 'sua agent chat <id>',
        desc: 'Talk to an agent and follow up; -m "…" sends one message, --session continues a conversation.',
        inDashboard: { label: 'Chat tab on agent detail', href: '/agents' },
      },
      {
        cmd: 'sua agent webhook <id> --on',
        desc: 'Let another service start the agent with POST /hooks/<id> (creates its secret).',
        inDashboard: { label: 'Webhook card on agent Config', href: '/agents' },
      },
      {
        cmd: 'sua workflow show <id>',
        desc: 'Print an agent\u2019s nodes and how they connect, as text or YAML.',
        inDashboard: { label: 'Diagram on agent detail', href: '/agents' },
      },
      { cmd: 'sua workflow import agents/ --apply', desc: 'Bring agents written in the older format up to date.' },
      { cmd: 'sua workflow export <id>', desc: 'Emit an agent\u2019s YAML to stdout (lossless round-trip).' },
      { cmd: 'sua workflow status <id> <newStatus>', desc: 'Set active | paused | archived | draft. No dashboard equivalent yet.' },
      {
        cmd: 'sua workflow logs <runId>',
        desc: 'Per-node records for a run.',
        inDashboard: { label: 'Run detail', href: '/runs' },
      },
      {
        cmd: 'sua workflow replay <runId> --from <nodeId>',
        desc: 'Re-run a past run from one node onward, reusing the outputs above it.',
        inDashboard: { label: 'Replay on run detail', href: '/runs' },
      },
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
      {
        cmd: 'sua secrets set <NAME>',
        desc: 'Store an encrypted secret (value prompted, never echoed).',
        inDashboard: { label: 'Settings → Secrets', href: '/settings/secrets' },
      },
      {
        cmd: 'sua secrets list',
        desc: 'List declared secret names. Values are never shown.',
        inDashboard: { label: 'Settings → Secrets', href: '/settings/secrets' },
      },
      { cmd: 'sua secrets migrate', desc: 'Upgrade legacy v1 secrets file to v2 passphrase-protected form.' },
    ],
  },
  {
    title: 'Memory, cost & safety',
    commands: [
      { cmd: 'sua memory list <id>', desc: 'What an agent remembers between runs (also: search, pin, forget).', inDashboard: { label: 'Memory on agent Overview', href: '/agents' } },
      { cmd: 'sua usage --days 30', desc: 'What runs cost, by agent and provider/model.', inDashboard: { label: 'Settings → Usage', href: '/settings/usage' } },
      { cmd: 'sua policy check <tool> [resource]', desc: 'Would this tool call be allowed? (also: show, validate)', inDashboard: { label: 'Settings → Policies', href: '/settings/policies' } },
      { cmd: 'sua behaviors list', desc: 'Agent Behavior specs in this project (also: show, validate).', inDashboard: { label: 'Behaviors', href: '/behaviors' } },
    ],
  },
  {
    title: 'MCP & dashboard',
    commands: [
      { cmd: 'sua mcp start', desc: 'Start the MCP server on 127.0.0.1:3003.' },
      { cmd: 'sua mcp rotate-token', desc: 'Generate a new MCP bearer token.', inDashboard: { label: 'Settings → Claude Desktop', href: '/settings/mcp' } },
      { cmd: 'sua dashboard start', desc: 'Start this web UI.' },
      { cmd: 'sua dashboard signin-url', desc: 'Print the sign-in link again (when the session has expired).' },
      { cmd: 'sua daemon start', desc: 'Run the dashboard, scheduler, MCP server (and a local model server or Temporal worker, if configured) in the background.' },
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
        machine \u2014 shell commands, model prompts (Claude, Codex, OpenAI-compatible or local models),
        goal nodes that work things out with tools, and other agents, wired together as nodes. No cloud.
        Runs and imported tools live in <code>data/runs.db</code>; secrets are encrypted in
        <code>data/secrets.enc</code>.
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
          <strong>Start with a goal.</strong> On <a href="/agents">Agents</a>, click <em>Build from goal</em>
          and describe what you want. Each draft shows its shape (a goal node that works it out, or a fixed
          flow) and why; switch it, or <em>Try it</em> before keeping it. Or use <em>New agent</em>.
        </li>
        <li>
          <strong>Pick its tools.</strong> Built-in tools (<code>web-fetch</code>, <code>http-get</code>,
          <code>file-read</code>, \u2026) are on <a href="/tools?tab=builtin">Tools \u2192 Built-in</a>; import
          third-party ones at <a href="/tools/mcp/import">/tools/mcp/import</a>. Put
          <code>agent:&lt;id&gt;</code> in a node's <code>tools:</code> to let it call another agent.
        </li>
        <li>
          <strong>Write the agent.</strong> Wire nodes on the agent's <em>Nodes</em> tab (or the graph's
          wiring mode): shell, llm-prompt, <strong>goal</strong> (a goal, tools and a budget), and
          <strong>ask</strong> (pause and ask you). Pass data with <code>{{upstream.&lt;id&gt;.result}}</code>.
        </li>
        <li>
          <strong>Shape the output.</strong> Give it an <a href="https://github.com/gregmeyer/some-useful-agents/blob/main/docs/a2ui-views.md" target="_blank" rel="noreferrer">A2UI <code>view:</code></a>
          (metrics, tables, buttons bound to its outputs) or an output widget on the <em>Config</em> tab.
          Either draws on the run page, Pulse, the inbox and in chat.
        </li>
        <li>
          <strong>Run it.</strong> <em>Run now</em>, then watch <a href="/runs">the run</a>: each node's output,
          the tools it called, its cost, and a goal node's budget used. A failed run offers
          <em>Suggest improvements</em>.
        </li>
        <li>
          <strong>Talk to it.</strong> The agent's <em>Chat</em> tab holds a conversation; replies stream in.
          Turn on <code>memory: true</code> and it remembers notes between runs.
        </li>
        <li>
          <strong>Keep it in bounds.</strong> Decide what tools it may call in
          <a href="/settings/policies">Settings \u2192 Policies</a>, cap what it spends in
          <a href="/settings/usage">Settings \u2192 Usage</a>, and keep keys in
          <a href="/settings/secrets">Secrets</a> (non-secret config in <a href="/settings/variables">Variables</a>).
        </li>
        <li>
          <strong>Trigger it.</strong> Set a cron schedule (run <code>sua schedule start</code> or <code>sua daemon start</code>),
          or let another service start it with a webhook (<code>POST /hooks/&lt;id&gt;</code>). When it needs
          you, it asks in the <a href="/">inbox</a>.
        </li>
        <li>
          <strong>Put it on a board.</strong> An agent with a <code>signal:</code> or a <code>view:</code> gets a
          tile on <a href="/pulse">Pulse</a>, with a Run button. <em>Arrange</em> lays out a board (sections,
          tabs, grids); <a href="/boards/new">New board</a> builds one from a description, using your agents and
          drafting any that are missing for your approval. Style everything in
          <a href="/settings/appearance#brand">Settings \u2192 Appearance \u2192 Brand</a>.
        </li>
        <li>
          <strong>Serve it to other agents.</strong> Set <code>mcp: true</code> and run <code>sua mcp start</code>:
          Claude Desktop, Cursor or any MCP client can run it, and hold a conversation with it.
        </li>
      </ol>
    </section>

    <section class="card card--muted" style="margin-bottom: var(--space-6);">
      <p class="card__title">Start here</p>
      <p style="margin-bottom: var(--space-3); display: flex; gap: var(--space-3); flex-wrap: wrap;">
        <a href="/start" class="btn btn--primary">Start here \u2014 run an agent \u2192</a>
        <a href="/help/tutorial" class="btn">Open the dashboard tutorial \u2192</a>
        <a href="/nodes" class="btn">Node reference \u2192</a>
      </p>
      <p style="margin: 0 0 var(--space-3); line-height: 1.6;">
        <strong>Start here</strong> is four agents, one per pattern \u2014 research something,
        watch something, draft something, or work something out. Run one and watch it move through its nodes; each is a few nodes
        wired together, and the YAML is a click away. Fastest way to see what this is.
      </p>
      <p class="dim" style="margin: 0; line-height: 1.6;">
        The <strong>tutorial</strong> is a progress-tracked walkthrough tied to your project's
        state: registered agents, first run, per-node outputs, multi-node agents, secrets. Each
        step links to the dashboard page where the action happens. For a terminal-first
        walkthrough instead, run <code>sua tutorial</code> from your project directory.
      </p>
      <p class="dim" style="margin: var(--space-3) 0 0; line-height: 1.6;">
        The <strong>node reference</strong> lists every kind of node an agent can be built from,
        with what each takes in and gives back. It moved here from its own nav tab — it is
        something to look up while building, not something you manage.
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
        <li><a href="https://github.com/gregmeyer/some-useful-agents/blob/main/docs/goal-agents.md" target="_blank" rel="noreferrer">Goal agents</a> \u2014 a model with a goal, tools and a budget.</li>
        <li><a href="https://github.com/gregmeyer/some-useful-agents/blob/main/docs/agents-as-tools.md" target="_blank" rel="noreferrer">Agents as tools</a> \u2014 let a model call other agents.</li>
        <li><a href="https://github.com/gregmeyer/some-useful-agents/blob/main/docs/conversations.md" target="_blank" rel="noreferrer">Conversations</a> \u2014 chat with an agent and follow up.</li>
        <li><a href="https://github.com/gregmeyer/some-useful-agents/blob/main/docs/memory.md" target="_blank" rel="noreferrer">Memory</a> \u2014 what an agent remembers between runs.</li>
        <li><a href="https://github.com/gregmeyer/some-useful-agents/blob/main/docs/ask-a-person.md" target="_blank" rel="noreferrer">Ask a person</a> \u2014 agents that stop and ask you.</li>
        <li><a href="https://github.com/gregmeyer/some-useful-agents/blob/main/docs/webhooks.md" target="_blank" rel="noreferrer">Webhooks</a> \u2014 start an agent from another service.</li>
        <li><a href="https://github.com/gregmeyer/some-useful-agents/blob/main/docs/cost.md" target="_blank" rel="noreferrer">Cost</a> \u2014 what runs cost, and spend limits (<a href="/settings/usage">Settings \u2192 Usage</a>).</li>
        <li><a href="https://github.com/gregmeyer/some-useful-agents/blob/main/docs/tool-policies.md" target="_blank" rel="noreferrer">Tool policies</a> \u2014 which tools agents may call (<a href="/settings/policies">Settings \u2192 Policies</a>).</li>
        <li><a href="https://github.com/gregmeyer/some-useful-agents/blob/main/docs/a2ui-views.md" target="_blank" rel="noreferrer">A2UI views</a> \u2014 how an agent's results look, everywhere.</li>
        <li><a href="https://github.com/gregmeyer/some-useful-agents/blob/main/docs/llm-providers.md" target="_blank" rel="noreferrer">LLM providers</a> \u2014 Claude, Codex, local and OpenAI-compatible models (<a href="/settings/llm">Settings \u2192 LLM</a>).</li>
        <li><a href="https://github.com/gregmeyer/some-useful-agents/blob/main/docs/build-from-goal.md" target="_blank" rel="noreferrer">Build from goal</a> \u2014 drafting agents from a description.</li>
        <li><a href="https://github.com/gregmeyer/some-useful-agents/blob/main/docs/behaviors.md" target="_blank" rel="noreferrer">Behaviors</a> \u2014 Agent Behavior specs (<a href="/behaviors">Behaviors</a>).</li>
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
