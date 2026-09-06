import { Command } from 'commander';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  AgentStore,
  IntegrationsStore,
  ensureErrorReferenceIntegration,
  parseAgent,
  listExampleYamls,
  type Agent,
} from '@some-useful-agents/core';
import { loadConfig, getDbPath, getAgentDirs } from '../config.js';
import * as ui from '../ui.js';

export const examplesCommand = new Command('examples')
  .description('Install or remove the bundled example agents');

/**
 * Discover example agent YAMLs.
 *
 * `listExampleYamls` prefers `<agentsDir>/examples/*.yaml` (repo checkout /
 * dev mode) and falls back to the copy bundled in `@some-useful-agents/core`,
 * which is what an npm install has. Both sets are the same 40+ agents — the
 * fallback used to be a hand-maintained subset of six, which is why an npm
 * user could not install the agents that build-from-goal needs.
 */
function discoverExamples(agentsDir: string): Record<string, string> {
  const yamls = listExampleYamls(join(agentsDir, 'examples'));
  // Key by the agent's declared id rather than its filename stem — the two
  // are conventionally equal but the store is keyed by the declared id.
  const byId: Record<string, string> = {};
  for (const content of Object.values(yamls)) {
    // Unparseable files are skipped rather than reported — one broken example
    // in the tree should not turn `examples install` into a wall of failures.
    try {
      byId[parseAgent(content).id] = content;
    } catch { /* skip */ }
  }
  return byId;
}

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
    ensureErrorReference(dbPath);

    const yamls = discoverExamples(config.agentsDir);
    let installed = 0;
    let skipped = 0;

    for (const [id, yaml] of Object.entries(yamls)) {
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

    const yamls = discoverExamples(config.agentsDir);
    let removed = 0;
    for (const id of Object.keys(yamls)) {
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

    const yamls = discoverExamples(config.agentsDir);
    for (const id of Object.keys(yamls).sort()) {
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
  ensureErrorReference(dbPath);
  const yamls = discoverExamples(agentsDir);
  let installed = 0;
  for (const [id, yaml] of Object.entries(yamls)) {
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

/**
 * Provision the read-only `error-reference` SQLite integration that backs the
 * `error-troubleshooter` example agent. Idempotent + non-fatal.
 */
function ensureErrorReference(dbPath: string): void {
  try {
    const store = new IntegrationsStore(dbPath);
    try {
      ensureErrorReferenceIntegration(store, dbPath);
    } finally {
      store.close();
    }
  } catch {
    // Non-fatal: the troubleshooter agent's sqlite tool just won't exist.
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
