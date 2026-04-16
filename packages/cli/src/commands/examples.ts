import { Command } from 'commander';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  AgentStore,
  parseAgent,
  type Agent,
} from '@some-useful-agents/core';
import { loadConfig, getDbPath, getAgentDirs } from '../config.js';
import * as ui from '../ui.js';

const EXAMPLE_IDS = [
  'hello', 'two-step-digest', 'daily-greeting', 'parameterised-greet',
  'parameterised-greet-claude', 'conditional-router', 'research-digest', 'daily-joke',
];

export const examplesCommand = new Command('examples')
  .description('Install or remove the bundled example agents');

examplesCommand
  .command('install')
  .description('Import all bundled example agents into the agent store')
  .option('--skip-existing', 'Skip agents that already exist instead of updating them')
  .action((options: { skipExisting?: boolean }) => {
    const config = loadConfig();
    const dbPath = getDbPath(config);
    const store = new AgentStore(dbPath);

    // Write data files that examples reference.
    const dataDir = join(config.agentsDir, 'examples', 'data');
    ensureDataFiles(dataDir);

    let installed = 0;
    let skipped = 0;

    for (const [id, yaml] of Object.entries(EXAMPLE_YAMLS)) {
      if (options.skipExisting && store.getAgent(id)) {
        skipped++;
        continue;
      }
      try {
        const agent = parseAgent(yaml);
        const { version: _v, ...agentNoVersion } = agent;
        void _v;
        store.upsertAgent(agentNoVersion, 'import', `Installed from bundled examples`);
        installed++;
        ui.ok(`${ui.agent(id)}`);
      } catch (err) {
        ui.fail(`${id}: ${(err as Error).message}`);
      }
    }

    store.close();
    console.log('');
    ui.info(`${installed} installed, ${skipped} skipped.`);
  });

examplesCommand
  .command('remove')
  .description('Remove all bundled example agents from the agent store')
  .action(() => {
    const config = loadConfig();
    const dbPath = getDbPath(config);
    const store = new AgentStore(dbPath);

    let removed = 0;
    for (const id of EXAMPLE_IDS) {
      const existing = store.getAgent(id);
      if (existing && existing.source === 'examples') {
        store.deleteAgent(id);
        removed++;
        ui.ok(`Removed ${ui.agent(id)}`);
      }
    }

    store.close();
    if (removed === 0) {
      ui.info('No example agents found to remove.');
    } else {
      console.log('');
      ui.info(`${removed} example agent(s) removed.`);
    }
  });

examplesCommand
  .command('list')
  .description('List the bundled example agents and whether each is installed')
  .action(() => {
    const config = loadConfig();
    const dbPath = getDbPath(config);
    const store = new AgentStore(dbPath);

    for (const id of EXAMPLE_IDS) {
      const exists = !!store.getAgent(id);
      const status = exists ? '✓ installed' : '  not installed';
      console.log(`  ${status}  ${ui.agent(id)}`);
    }

    store.close();
  });

/**
 * Programmatic entry point for `sua init` auto-import. Imports all
 * bundled examples, skipping any that already exist.
 */
export function examplesInstall(dbPath: string, agentsDir: string): void {
  const store = new AgentStore(dbPath);
  const dataDir = join(agentsDir, 'examples', 'data');
  ensureDataFiles(dataDir);
  let installed = 0;
  for (const [id, yaml] of Object.entries(EXAMPLE_YAMLS)) {
    if (store.getAgent(id)) continue;
    try {
      const agent = parseAgent(yaml);
      const { version: _v, ...agentNoVersion } = agent;
      void _v;
      store.upsertAgent(agentNoVersion, 'import', 'Installed from bundled examples');
      installed++;
    } catch { /* skip broken during init */ }
  }
  store.close();
  if (installed > 0) {
    ui.ok(`${installed} example agent(s) installed. Run \`sua examples list\` to see them.`);
  }
}

function ensureDataFiles(dataDir: string): void {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

  const headlinesPath = join(dataDir, 'sample-headlines.json');
  if (!existsSync(headlinesPath)) {
    writeFileSync(headlinesPath, SAMPLE_HEADLINES_JSON);
  }

  const topicsPath = join(dataDir, 'research-topics.json');
  if (!existsSync(topicsPath)) {
    writeFileSync(topicsPath, RESEARCH_TOPICS_JSON);
  }
}

// -- Embedded example YAMLs (match agents/examples/*.yaml) --

const EXAMPLE_YAMLS: Record<string, string> = {
  'hello': `id: hello
name: Hello
description: Your first sua agent — prints a greeting.
status: active
source: examples
signal:
  title: Hello
  icon: "\\U0001F44B"
  format: text
nodes:
  - id: greet
    type: shell
    command: echo "Hello from sua! You just ran your first agent."
`,

  'two-step-digest': `id: two-step-digest
name: Two-step digest
description: Reads local headlines and formats a summary. Teaches dependsOn + upstream passing.
status: active
source: examples
signal:
  title: Daily Digest
  icon: "\\U0001F4F0"
  format: text
  size: 2x1
nodes:
  - id: fetch
    type: shell
    tool: file-read
    toolInputs:
      path: agents/examples/data/sample-headlines.json
  - id: summarise
    type: shell
    command: |
      echo "=== Daily Digest ==="
      echo "$UPSTREAM_FETCH_RESULT" | head -5
      echo "---"
      TOTAL=$(echo "$UPSTREAM_FETCH_RESULT" | grep -c '"title"' || echo 0)
      echo "$TOTAL headlines loaded."
    dependsOn: [fetch]
`,

  'daily-greeting': `id: daily-greeting
name: Daily greeting
description: Scheduled agent — greets you every morning at 8am.
status: active
source: examples
schedule: "0 8 * * *"
signal:
  title: Morning Greeting
  icon: "\\u2600\\uFE0F"
  format: text
  refresh: 24h
nodes:
  - id: greet
    type: shell
    command: echo "Good morning! Today is $(date +%A), $(date +%B\\ %d)."
`,

  'parameterised-greet': `id: parameterised-greet
name: Parameterised greeting
description: Configurable greeting using agent inputs with defaults.
status: active
source: examples
signal:
  title: Greeting
  icon: "\\U0001F4AC"
  format: text
inputs:
  NAME: { type: string, default: "World", description: "Who to greet" }
  STYLE: { type: enum, values: [formal, casual], default: casual }
nodes:
  - id: greet
    type: shell
    command: |
      case "$STYLE" in
        formal) echo "Good day, $NAME. I trust you are well." ;;
        *)      echo "Hey $NAME! What's up?" ;;
      esac
`,

  'parameterised-greet-claude': `id: parameterised-greet-claude
name: Parameterised greeting (Claude)
description: Same concept as parameterised-greet, using Claude Code.
status: active
source: examples
inputs:
  NAME: { type: string, default: "World" }
  STYLE: { type: enum, values: [formal, casual], default: casual }
nodes:
  - id: greet
    type: claude-code
    prompt: "Greet {{inputs.NAME}} in a {{inputs.STYLE}} style. One sentence only."
`,

  'conditional-router': `id: conditional-router
name: Conditional router
description: Routes data through different paths based on content. Teaches flow control.
status: active
source: examples
signal:
  title: Router
  icon: "\\U0001F500"
  format: json
  field: merged
nodes:
  - id: classify
    type: shell
    command: echo '{"category":"tech","title":"New AI model released"}'
  - id: check
    type: conditional
    dependsOn: [classify]
    conditionalConfig:
      predicate: { field: category, equals: tech }
  - id: tech-path
    type: shell
    command: echo "TECH ALERT - $UPSTREAM_CLASSIFY_RESULT"
    dependsOn: [check]
    onlyIf: { upstream: check, field: matched, equals: true }
  - id: general-path
    type: shell
    command: echo "General news - $UPSTREAM_CLASSIFY_RESULT"
    dependsOn: [check]
    onlyIf: { upstream: check, field: matched, notEquals: true }
  - id: merge
    type: branch
    dependsOn: [tech-path, general-path]
`,

  'research-digest': `id: research-digest
name: Research digest
description: Boss agent that invokes sub-agents and loops over results.
status: active
source: examples
signal:
  title: Research
  icon: "\\U0001F50D"
  format: table
  field: items
  size: 2x1
nodes:
  - id: source
    type: shell
    tool: file-read
    toolInputs:
      path: agents/examples/data/research-topics.json
  - id: research
    type: loop
    dependsOn: [source]
    loopConfig:
      over: topics
      agentId: two-step-digest
      maxIterations: 3
  - id: compile
    type: shell
    command: |
      echo "=== Research Complete ==="
      echo "$UPSTREAM_RESEARCH_RESULT"
    dependsOn: [research]
`,

  'daily-joke': `id: daily-joke
name: Daily joke
description: Fetches a real joke from the internet using the http-get tool.
status: active
source: examples
signal:
  title: Joke of the Day
  icon: "\\U0001F3AD"
  format: text
  refresh: 24h
nodes:
  - id: fetch
    type: shell
    tool: http-get
    toolInputs:
      url: "https://icanhazdadjoke.com/"
  - id: format
    type: shell
    command: |
      echo "=== Joke of the Day ==="
      JOKE=$(echo "$UPSTREAM_FETCH_RESULT" | grep -o '"joke":"[^"]*"' | sed 's/"joke":"//;s/"$//' 2>/dev/null)
      if [ -n "$JOKE" ]; then
        echo "$JOKE"
      else
        echo "$UPSTREAM_FETCH_RESULT"
      fi
    dependsOn: [fetch]
`,
};

const SAMPLE_HEADLINES_JSON = `{
  "headlines": [
    { "title": "New AI safety framework published", "category": "tech" },
    { "title": "Global temperatures hit record high", "category": "science" },
    { "title": "Open source agent toolkit reaches 1.0", "category": "tech" },
    { "title": "Quantum computing milestone achieved", "category": "science" },
    { "title": "Developer productivity study shows 40% gains with AI", "category": "tech" }
  ]
}
`;

const RESEARCH_TOPICS_JSON = `{
  "topics": ["AI safety", "quantum computing", "climate tech"]
}
`;
