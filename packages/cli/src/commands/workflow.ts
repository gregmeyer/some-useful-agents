import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import ora from 'ora';
import { DatabaseSync } from 'node:sqlite';
import {
  AgentStore,
  RunStore,
  EncryptedFileStore,
  loadAgents,
  executeAgentDag,
  executeAgentWithRetry,
  planMigration,
  applyMigration,
  exportAgent,
  parseAgent,
  AgentYamlParseError,
  type Agent,
  type AgentStatus,
  type V1Input,
} from '@some-useful-agents/core';
import { readFileSync, readdirSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { loadConfig, getAgentDirs, getDbPath, getSecretsPath, getDashboardBaseUrl } from '../config.js';
import * as ui from '../ui.js';

/**
 * `sua workflow` is the v2 CLI surface. v0.13 ships a read-first-then-run
 * subset of verbs that covers the core migration → inspect → execute loop:
 *
 *   sua workflow import [dir]              Run migration on agents/ YAML
 *   sua workflow list [--status/--source]  See all imported agents
 *   sua workflow show <id>                 Print the DAG as text
 *   sua workflow run <id> [--input K=V]    Execute (synchronous)
 *   sua workflow status <id> <status>      active/paused/archived/draft
 *   sua workflow logs <runId> [--node ...] [--category ...]   Per-node run logs
 *   sua workflow replay <runId> --from <nodeId>               Resume from a node
 *   sua workflow export <id>               Emit YAML to stdout
 *
 * Execution bypasses LocalProvider for this release — the executor takes
 * its own RunStore handle. PR 4b will wire LocalProvider.submitDagRun so
 * the MCP server and scheduler can trigger DAG agents too.
 */
export const workflowCommand = new Command('workflow')
  .description('Manage and run DAG agents (v2 model)');

function openStores(): { db: DatabaseSync; agents: AgentStore; runs: RunStore; close: () => void } {
  const config = loadConfig();
  const dbPath = getDbPath(config);
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(dbPath);
  const agents = AgentStore.fromHandle(db);
  const runs = RunStore.fromHandle(db);
  return {
    db,
    agents,
    runs,
    close: () => {
      agents.close();
      runs.close();
      db.close();
    },
  };
}

function collectInput(value: string, previous: Record<string, string>): Record<string, string> {
  const eq = value.indexOf('=');
  if (eq <= 0) throw new Error(`--input expects KEY=value (got: "${value}")`);
  return { ...previous, [value.slice(0, eq)]: value.slice(eq + 1) };
}

// -- import --

workflowCommand
  .command('import')
  .description('Scan v1 YAML agents + merge chains into v2 DAG agents in the run DB')
  .argument('[dir]', 'Root directory containing agents/ (defaults to current project)')
  .option('--apply', 'Commit the migration. Without this flag, prints the plan and exits.')
  .option(
    '--allow-broken',
    'Proceed even when some YAML files failed to parse or validate. Without this flag, ' +
      'any file-level error aborts the migration. Use only when you know what you are ignoring.',
  )
  .action(async (dir: string | undefined, options: { apply?: boolean; allowBroken?: boolean }) => {
    const config = loadConfig();
    const dirs = getAgentDirs(config);
    const directories = dir ? [dir] : dirs.all;

    // Load via the existing v1 loader (picks up local + community + examples).
    const { agents: v1Agents, warnings } = loadAgents({ directories });

    // Separate directory-level noise (missing optional dir, unreadable dir) from
    // file-level errors (parse failure, schema rejection, empty file). A file-
    // level error means we silently dropped a YAML file the user wrote; that
    // usually breaks `dependsOn` graphs in non-obvious ways, which is exactly
    // what ate time during the v0.13 bring-up on 2026-04-15 (shell quoting in
    // a double-quoted YAML string skipped `summarize`, leaving `post`'s
    // `dependsOn: [summarize]` dangling and the migration silently dropped the
    // chain link).
    const fileLevelWarnings = warnings.filter(
      (w) => /\.(ya?ml(\.disabled)?)$/i.test(w.file),
    );
    const dirLevelWarnings = warnings.filter(
      (w) => !/\.(ya?ml(\.disabled)?)$/i.test(w.file),
    );

    // Directory-level noise is informational — keep warning loud but advisory.
    for (const w of dirLevelWarnings) ui.warn(`${w.file}: ${w.message}`);

    // File-level problems are a hard error by default.
    if (fileLevelWarnings.length > 0) {
      ui.fail(
        `${fileLevelWarnings.length} YAML file(s) failed to load. ` +
          `These agents would be silently dropped from the migration, which usually breaks ` +
          `dependsOn chains without any further signal. Fix the files or re-run with --allow-broken.`,
      );
      for (const w of fileLevelWarnings) {
        console.error(`  ${chalk.red('✖')} ${w.file}`);
        // w.message often wraps multi-line YAML parser output; indent it so
        // the grouping stays visible.
        const indented = w.message.split('\n').map((l) => `      ${l}`).join('\n');
        console.error(indented);
      }
      if (!options.allowBroken) {
        console.error('');
        console.error(
          ui.dim(
            'To proceed anyway (skipping these agents), re-run with --allow-broken. ' +
              'Be aware that any `dependsOn` pointing at a skipped agent will produce a ' +
              'missing-dependency warning and land as a single-node DAG instead of a chain.',
          ),
        );
        process.exit(1);
      }
      ui.warn(
        `--allow-broken was set; proceeding with ${v1Agents.size} loadable agent(s) ` +
          `and dropping ${fileLevelWarnings.length} broken one(s).`,
      );
    }

    // Detect `.disabled` siblings: agent-loader doesn't list them, but
    // they exist on disk as `<name>.yaml.disabled`. Walk the dirs.
    const disabledNames = new Set<string>();
    for (const d of directories) {
      if (!existsSync(d)) continue;
      try {
        for (const entry of readdirSync(d)) {
          if (entry.endsWith('.yaml.disabled') || entry.endsWith('.yml.disabled')) {
            const trimmed = entry.replace(/\.(yaml|yml)\.disabled$/, '');
            disabledNames.add(trimmed);
          }
        }
      } catch { /* tolerate unreadable dir */ }
    }

    const inputs: V1Input[] = [];
    for (const [name, agent] of v1Agents) {
      inputs.push({ agent, disabled: disabledNames.has(name) });
    }

    const plan = planMigration(inputs);

    // Dry-run output.
    if (!options.apply) {
      ui.section(`Migration plan (${plan.agents.length} agent(s) to write)`);
      for (const p of plan.agents) {
        const contribs = p.contributingV1Names.join(', ');
        console.log(`  ${ui.agent(p.id)} ${ui.dim(`[${p.source}] ${p.nodes.length} node(s); from v1: ${contribs}`)}`);
      }
      if (plan.warnings.length > 0) {
        ui.section('Warnings');
        for (const w of plan.warnings) ui.warn(`[${w.kind}] ${w.message}`);
      }
      console.log('');
      ui.info(`Dry run. Re-run with ${chalk.cyan('--apply')} to commit to ${ui.dim(getDbPath(config))}.`);
      return;
    }

    // Apply.
    const stores = openStores();
    try {
      const result = applyMigration(plan, stores.agents);
      ui.ok(`Migration applied: ${result.imported} imported, ${result.skipped} unchanged.`);
      for (const w of plan.warnings) ui.warn(`[${w.kind}] ${w.message}`);
    } finally {
      stores.close();
    }
  });

// -- list --

workflowCommand
  .command('list')
  .description('List DAG agents in the run DB')
  .option('--status <status>', 'Filter by status (active | paused | archived | draft)')
  .option('--source <source>', 'Filter by source (local | community | examples)')
  .action((options: { status?: string; source?: string }) => {
    const stores = openStores();
    try {
      const list = stores.agents.listAgents({
        status: options.status as AgentStatus | undefined,
        source: options.source as Agent['source'] | undefined,
      });
      if (list.length === 0) {
        ui.info(`No DAG agents. Run ${chalk.cyan('sua workflow import --apply')} to migrate v1 agents.`);
        return;
      }
      const table = new Table({
        head: [chalk.bold('Id'), chalk.bold('Status'), chalk.bold('Source'), chalk.bold('Nodes'), chalk.bold('Schedule'), chalk.bold('Description')],
      });
      for (const a of list) {
        const status = statusBadge(a.status);
        table.push([
          ui.agent(a.id),
          status,
          ui.dim(a.source),
          String(a.nodes.length),
          a.schedule ?? ui.dim('—'),
          ui.dim(a.description ?? ''),
        ]);
      }
      ui.section('DAG Agents');
      console.log(table.toString());
    } finally {
      stores.close();
    }
  });

// -- show --

workflowCommand
  .command('show')
  .description('Print the DAG of an agent as text')
  .argument('<id>', 'Agent id')
  .option('--format <format>', 'Output format (text | yaml)', 'text')
  .action((id: string, options: { format: 'text' | 'yaml' }) => {
    const stores = openStores();
    try {
      const agent = stores.agents.getAgent(id);
      if (!agent) {
        ui.fail(`Agent "${id}" not found.`);
        process.exit(1);
      }

      if (options.format === 'yaml') {
        console.log(exportAgent(agent));
        return;
      }

      console.log('');
      console.log(chalk.cyan.bold(`Agent: ${agent.id}`) + ' ' + statusBadge(agent.status));
      console.log('');
      ui.kv('name', agent.name);
      ui.kv('description', agent.description ?? ui.dim('(none)'));
      ui.kv('source', agent.source);
      ui.kv('version', String(agent.version));
      ui.kv('schedule', agent.schedule ?? ui.dim('(none)'));
      ui.kv('mcp', agent.mcp ? 'exposed' : 'not exposed');
      console.log('');
      console.log(chalk.bold('Nodes:'));
      for (const node of agent.nodes) {
        const deps = node.dependsOn?.length ? ` ← ${node.dependsOn.join(', ')}` : '';
        console.log(`  ${ui.agent(node.id)} ${ui.dim(`(${node.type})`)}${ui.dim(deps)}`);
        if (node.type === 'shell' && node.command) {
          console.log('    ' + ui.dim(oneLine(node.command)));
        }
        if (node.type === 'claude-code' && node.prompt) {
          console.log('    ' + ui.dim(oneLine(node.prompt)));
        }
        if (node.secrets?.length) {
          console.log('    ' + ui.dim(`secrets: ${node.secrets.join(', ')}`));
        }
      }
      console.log('');
    } finally {
      stores.close();
    }
  });

// -- run --

workflowCommand
  .command('run')
  .description('Execute a DAG agent once (synchronous)')
  .argument('<id>', 'Agent id')
  .option('--input <KEY=value>', 'Supply an input (repeatable)', collectInput, {} as Record<string, string>)
  .option('--allow-untrusted-shell <id>', 'Pre-allow a community shell agent to run', (v: string, prev: string[]) => [...prev, v], [] as string[])
  .action(async (id: string, options: { input: Record<string, string>; allowUntrustedShell: string[] }) => {
    const config = loadConfig();
    const stores = openStores();
    const secretsStore = new EncryptedFileStore(getSecretsPath(config));
    const spinner = ora(`Running ${ui.agent(id)}...`).start();
    try {
      const agent = stores.agents.getAgent(id);
      if (!agent) {
        spinner.fail(`Agent "${id}" not found. Run \`sua workflow list\` to see options.`);
        process.exitCode = 1;
        return;
      }
      const run = await executeAgentWithRetry(
        agent,
        { triggeredBy: 'cli', inputs: options.input },
        {
          runStore: stores.runs,
          secretsStore,
          agentStore: stores.agents,
          allowUntrustedShell: new Set(options.allowUntrustedShell),
          dashboardBaseUrl: getDashboardBaseUrl(config),
          dataRoot: stores.agents.dataRoot,
        },
      );
      if (run.status === 'completed') {
        spinner.succeed(`${ui.agent(id)} completed`);
        if (run.result) {
          console.log('');
          ui.outputFrame(run.result);
        }
      } else {
        spinner.fail(`${ui.agent(id)} ${run.status}`);
        if (run.error) console.error(chalk.red(run.error));
      }
      console.log(ui.dim(`\nRun ID: ${run.id}`));
      console.log(ui.dim(`Inspect per-node logs: sua workflow logs ${run.id}`));
    } finally {
      stores.close();
    }
  });

// -- status --

workflowCommand
  .command('status')
  .description('Set the status of an agent (active | paused | archived | draft)')
  .argument('<id>', 'Agent id')
  .argument('<newStatus>', 'New status')
  .action((id: string, newStatus: string) => {
    if (!['active', 'paused', 'archived', 'draft'].includes(newStatus)) {
      ui.fail(`Invalid status "${newStatus}". Must be one of: active, paused, archived, draft.`);
      process.exit(1);
    }
    const stores = openStores();
    try {
      const agent = stores.agents.getAgent(id);
      if (!agent) {
        ui.fail(`Agent "${id}" not found.`);
        process.exit(1);
      }
      stores.agents.updateAgentMeta(id, { status: newStatus as AgentStatus });
      ui.ok(`Set ${ui.agent(id)} to ${chalk.cyan(newStatus)}.`);
    } finally {
      stores.close();
    }
  });

// -- rm (hard delete) --

workflowCommand
  .command('rm')
  .description('Hard delete an agent and all its versions (runs are kept as orphaned history)')
  .argument('<id>', 'Agent id')
  .option('--yes', 'Skip the confirmation prompt')
  .action(async (id: string, options: { yes?: boolean }) => {
    const stores = openStores();
    try {
      const agent = stores.agents.getAgent(id);
      if (!agent) {
        ui.fail(`Agent "${id}" not found.`);
        process.exit(1);
      }

      const versions = stores.agents.listVersions(id);
      const runResult = stores.runs.queryRuns({ agentName: id, limit: 1 });
      const totalRuns = runResult.total;
      const lastRun = runResult.rows[0];

      // Show what's about to be deleted so the operator knows what they're
      // orphaning. Runs are preserved as append-only history.
      console.log('');
      console.log(`  ${chalk.bold('Agent:')}     ${ui.agent(agent.id)} ${ui.dim(`(${agent.name})`)}`);
      console.log(`  ${chalk.bold('Status:')}    ${agent.status}`);
      console.log(`  ${chalk.bold('Source:')}    ${agent.source}`);
      console.log(`  ${chalk.bold('Versions:')}  ${versions.length}`);
      console.log(
        `  ${chalk.bold('Runs:')}      ${totalRuns}` +
          (lastRun ? ` ${ui.dim(`(last: ${lastRun.startedAt})`)}` : ''),
      );
      if (agent.schedule) {
        console.log(`  ${chalk.bold('Schedule:')}  ${agent.schedule}`);
      }
      console.log('');
      console.log(
        ui.dim(
          'This permanently deletes the agent + all versions. Run history is kept ' +
            '(orphaned — runs reference the agent by id as text, not by FK).',
        ),
      );
      console.log('');

      if (!options.yes) {
        const { createInterface } = await import('node:readline/promises');
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        try {
          const raw = (await rl.question(`Proceed? [y/N] `)).trim().toLowerCase();
          if (raw !== 'y' && raw !== 'yes') {
            ui.info('Cancelled.');
            return;
          }
        } finally {
          rl.close();
        }
      }

      try {
        stores.agents.deleteAgent(id);
      } catch (err) {
        // Most likely failure: another agent invokes this one.
        ui.fail((err as Error).message);
        process.exit(1);
      }

      ui.ok(
        `Deleted ${ui.agent(id)} (${versions.length} version${versions.length === 1 ? '' : 's'}, ` +
          `${totalRuns} run${totalRuns === 1 ? '' : 's'} orphaned).`,
      );
    } finally {
      stores.close();
    }
  });

// -- logs --

workflowCommand
  .command('logs')
  .description('Print per-node execution records for a run')
  .argument('<runId>', 'Run id (or prefix)')
  .option('--node <nodeId>', 'Only show this node')
  .option('--category <category>', 'Only show rows with this error category')
  .action((runIdArg: string, options: { node?: string; category?: string }) => {
    const stores = openStores();
    try {
      // Accept prefix matches to save typing.
      let runId = runIdArg;
      if (runIdArg.length < 36) {
        // Crude prefix: look it up via queryRuns.
        const { rows } = stores.runs.queryRuns({ q: runIdArg, limit: 2 });
        if (rows.length === 0) {
          ui.fail(`No run matching "${runIdArg}".`);
          process.exit(1);
        }
        if (rows.length > 1) {
          ui.fail(`Multiple runs match "${runIdArg}". Disambiguate with the full id.`);
          process.exit(1);
        }
        runId = rows[0].id;
      }

      const run = stores.runs.getRun(runId);
      if (!run) {
        ui.fail(`Run "${runId}" not found.`);
        process.exit(1);
      }

      const rows = stores.runs.listNodeExecutions(runId);
      const filtered = rows.filter((r) => {
        if (options.node && r.nodeId !== options.node) return false;
        if (options.category && r.errorCategory !== options.category) return false;
        return true;
      });

      if (filtered.length === 0) {
        ui.info(`No node executions match the filter.`);
        return;
      }

      console.log('');
      console.log(chalk.cyan.bold(`Run ${runId.slice(0, 8)}`) + ' ' + statusBadge(run.status));
      if (run.workflowId) ui.kv('agent', run.workflowId + (run.workflowVersion ? ` v${run.workflowVersion}` : ''));
      if (run.replayedFromRunId) ui.kv('replayed from', `${run.replayedFromRunId.slice(0, 8)} @ ${run.replayedFromNodeId}`);
      console.log('');

      for (const r of filtered) {
        const status = statusBadge(r.status);
        const cat = r.errorCategory ? ` ${chalk.red(`[${r.errorCategory}]`)}` : '';
        console.log(`${ui.agent(r.nodeId)} ${status}${cat}`);
        ui.kv('  started', r.startedAt);
        if (r.completedAt) ui.kv('  completed', r.completedAt);
        if (r.exitCode !== undefined) ui.kv('  exit', String(r.exitCode));
        if (r.error) ui.kv('  error', r.error);
        if (r.result) {
          console.log('  ' + chalk.dim('stdout:'));
          console.log('  ' + ui.dim(oneLine(r.result, 200)));
        }
        console.log('');
      }
    } finally {
      stores.close();
    }
  });

// -- replay --

workflowCommand
  .command('replay')
  .description('Re-run a prior run starting at a specific node, reusing upstream outputs')
  .argument('<runId>', 'Original run id')
  .requiredOption('--from <nodeId>', 'Node to start the replay from')
  .option('--allow-untrusted-shell <id>', 'Pre-allow a community shell agent', (v: string, prev: string[]) => [...prev, v], [] as string[])
  .action(async (runId: string, options: { from: string; allowUntrustedShell: string[] }) => {
    const config = loadConfig();
    const stores = openStores();
    const secretsStore = new EncryptedFileStore(getSecretsPath(config));
    try {
      const priorRun = stores.runs.getRun(runId);
      if (!priorRun) {
        ui.fail(`Run "${runId}" not found.`);
        process.exit(1);
      }
      if (!priorRun.workflowId) {
        ui.fail(`Run "${runId}" is not a DAG run (no workflow_id). Replay only supports v2 runs.`);
        process.exit(1);
      }
      const agent = stores.agents.getAgent(priorRun.workflowId);
      if (!agent) {
        ui.fail(`Agent "${priorRun.workflowId}" not found in store.`);
        process.exit(1);
      }

      const spinner = ora(`Replaying ${ui.agent(agent.id)} from ${chalk.cyan(options.from)}...`).start();
      const replay = await executeAgentDag(
        agent,
        {
          triggeredBy: 'cli',
          replayFrom: { priorRunId: runId, fromNodeId: options.from },
        },
        {
          runStore: stores.runs,
          secretsStore,
          agentStore: stores.agents,
          allowUntrustedShell: new Set(options.allowUntrustedShell),
          dashboardBaseUrl: getDashboardBaseUrl(config),
          dataRoot: stores.agents.dataRoot,
        },
      );
      if (replay.status === 'completed') {
        spinner.succeed(`${ui.agent(agent.id)} replay completed`);
      } else {
        spinner.fail(`${ui.agent(agent.id)} replay ${replay.status}`);
        if (replay.error) console.error(chalk.red(replay.error));
      }
      console.log(ui.dim(`\nReplay run ID: ${replay.id}`));
      console.log(ui.dim(`Inspect per-node logs: sua workflow logs ${replay.id}`));
    } finally {
      stores.close();
    }
  });

// -- export --

workflowCommand
  .command('export')
  .description('Emit an agent\'s YAML to stdout (lossless round-trip with parse)')
  .argument('<id>', 'Agent id')
  .action((id: string) => {
    const stores = openStores();
    try {
      const agent = stores.agents.getAgent(id);
      if (!agent) {
        ui.fail(`Agent "${id}" not found.`);
        process.exit(1);
      }
      process.stdout.write(exportAgent(agent));
    } finally {
      stores.close();
    }
  });

// -- import-yaml (single file) --

workflowCommand
  .command('import-yaml')
  .description('Read a v2 YAML file directly into the store (bypasses v1 migration)')
  .argument('<file>', 'Path to a v2 YAML file')
  .action((file: string) => {
    if (!existsSync(file) || statSync(file).isDirectory()) {
      ui.fail(`Not a file: ${file}`);
      process.exit(1);
    }
    let yamlText: string;
    try {
      yamlText = readFileSync(file, 'utf-8');
    } catch (err) {
      ui.fail(`Cannot read ${file}: ${(err as Error).message}`);
      process.exit(1);
    }
    let agent: Agent;
    try {
      agent = parseAgent(yamlText);
    } catch (err) {
      if (err instanceof AgentYamlParseError) {
        ui.fail(err.message);
        process.exit(1);
      }
      throw err;
    }
    const stores = openStores();
    try {
      const { version: _v2, ...agentNoVersion } = agent;
      void _v2;
      const result = stores.agents.upsertAgent(agentNoVersion, 'import', `Imported from ${file}`);
      ui.ok(`Imported ${ui.agent(result.id)} (version ${result.version})`);
    } finally {
      stores.close();
    }
  });

// -- helpers --

function statusBadge(status: string): string {
  switch (status) {
    case 'active': return chalk.green('active');
    case 'paused': return chalk.yellow('paused');
    case 'archived': return chalk.dim('archived');
    case 'draft': return chalk.cyan('draft');
    case 'completed': return chalk.green('completed');
    case 'failed': return chalk.red('failed');
    case 'running': return chalk.blue('running');
    case 'pending': return chalk.dim('pending');
    case 'cancelled': return chalk.yellow('cancelled');
    case 'skipped': return chalk.dim('skipped');
    default: return status;
  }
}

function oneLine(text: string, max = 80): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;
  return collapsed.slice(0, max - 1) + '…';
}

// Defensive extension for tests / extra tooling that needs to join against
// the loaded v1 set without re-implementing the filesystem walker.
void join;
void extname;
