import { resolve } from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import {
  loadAgents,
  LocalScheduler,
  inspectSecretsFile,
  RunStore,
  cronToHuman,
  getSchedulerStatus,
  nextFireTime,
} from '@some-useful-agents/core';
import { loadConfig, getAgentDirs, getSecretsPath, getDbPath } from '../config.js';
import { createProvider } from '../provider-factory.js';
import * as ui from '../ui.js';

export const scheduleCommand = new Command('schedule')
  .description('Manage scheduled agent runs');

scheduleCommand
  .command('list')
  .description('List agents with a schedule field')
  .action(() => {
    const config = loadConfig();
    const dirs = getAgentDirs(config);
    const { agents } = loadAgents({ directories: dirs.all });

    const scheduled = Array.from(agents.values()).filter(a => a.schedule);
    if (scheduled.length === 0) {
      ui.info('No agents have a schedule. Add `schedule: "<cron>"` to an agent YAML.');
      return;
    }

    const table = new Table({
      head: [chalk.bold('Name'), chalk.bold('Schedule'), chalk.bold('Human'), chalk.bold('Valid?')],
    });
    for (const agent of scheduled) {
      const valid = LocalScheduler.isValid(agent.schedule!);
      table.push([
        ui.agent(agent.name),
        agent.schedule!,
        cronToHuman(agent.schedule!),
        valid ? chalk.green('yes') : chalk.red('no'),
      ]);
    }
    ui.section('Scheduled Agents');
    console.log(table.toString());
  });

scheduleCommand
  .command('validate')
  .description('Validate the cron expression of a scheduled agent')
  .argument('<name>', 'Agent name')
  .action((name: string) => {
    const config = loadConfig();
    const dirs = getAgentDirs(config);
    const { agents } = loadAgents({ directories: dirs.all });
    const agent = agents.get(name);
    if (!agent) {
      ui.fail(`Agent "${name}" not found.`);
      process.exit(1);
    }
    if (!agent.schedule) {
      ui.warn(`Agent "${name}" has no schedule field.`);
      return;
    }
    const valid = LocalScheduler.isValid(agent.schedule);
    if (valid) {
      ui.ok(`"${agent.schedule}" is a valid cron expression (${cronToHuman(agent.schedule)}).`);
    } else {
      ui.fail(`"${agent.schedule}" is not a valid cron expression.`);
      process.exit(1);
    }
  });

scheduleCommand
  .command('status')
  .description('Show scheduler status and next fire times')
  .action(() => {
    const config = loadConfig();
    const dataDir = resolve(config.dataDir);
    const { status, heartbeat } = getSchedulerStatus(dataDir);

    if (status === 'stopped') {
      ui.fail('Scheduler: stopped');
      console.log(ui.dim('Run `sua schedule start` to start the scheduler.\n'));

      // Still show scheduled agents from YAML.
      const dirs = getAgentDirs(config);
      const { agents } = loadAgents({ directories: dirs.all });
      const scheduled = Array.from(agents.values()).filter(a => a.schedule);

      if (scheduled.length > 0) {
        // Check last fire times from run store.
        const dbPath = getDbPath(config);
        const runStore = new RunStore(dbPath);

        for (const agent of scheduled) {
          const result = runStore.queryRuns({
            agentName: agent.name,
            triggeredBy: 'schedule',
            limit: 1,
          });
          const lastRun = result.rows[0];
          const lastFire = lastRun ? formatRelative(lastRun.startedAt) : 'never';
          const missed = lastRun ? isMissed(agent.schedule!, lastRun.startedAt) : false;
          const missedTag = missed ? chalk.red(' MISSED') : '';
          console.log(
            `  ${ui.agent(agent.name.padEnd(24))} ${cronToHuman(agent.schedule!).padEnd(28)} last fired ${lastFire}${missedTag}`,
          );
        }
        runStore.close();
      }
      return;
    }

    if (status === 'stale') {
      const age = heartbeat ? formatRelative(heartbeat.lastHeartbeat) : 'unknown';
      ui.warn(`Scheduler: stale (last heartbeat ${age})`);
      console.log(ui.dim('The scheduler process may have crashed. Restart with `sua schedule start`.\n'));
    } else {
      const uptime = heartbeat ? formatUptime(heartbeat.startedAt) : 'unknown';
      ui.ok(`Scheduler: running (PID ${heartbeat!.pid}, uptime ${uptime})`);
    }

    if (heartbeat) {
      const dbPath = getDbPath(config);
      const runStore = new RunStore(dbPath);

      for (const name of heartbeat.agents) {
        const next = heartbeat.nextFires[name];
        const nextStr = next ? `next ${formatRelative(next, true)}` : '';
        const result = runStore.queryRuns({
          agentName: name,
          triggeredBy: 'schedule',
          limit: 1,
        });
        const lastRun = result.rows[0];
        const lastStr = lastRun ? `last fired ${formatRelative(lastRun.startedAt)}` : 'never fired';
        console.log(`  ${ui.agent(name.padEnd(24))} ${lastStr.padEnd(24)} ${nextStr}`);
      }
      runStore.close();
    }
  });

function collectName(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function collectInput(value: string, previous: Record<string, string>): Record<string, string> {
  const eq = value.indexOf('=');
  if (eq <= 0) {
    throw new Error(`--input expects KEY=value (got: "${value}")`);
  }
  return { ...previous, [value.slice(0, eq)]: value.slice(eq + 1) };
}

scheduleCommand
  .command('start')
  .description('Start the scheduler daemon (foreground)')
  .option(
    '--allow-untrusted-shell <name>',
    'Permit a community shell agent to fire on schedule (repeatable; per-agent, not global)',
    collectName,
    [] as string[],
  )
  .option(
    '--input <KEY=value>',
    'Daemon-wide input override applied to every fired run (repeatable). Agents that don\'t declare the input ignore it.',
    collectInput,
    {} as Record<string, string>,
  )
  .action(async (options: { allowUntrustedShell: string[]; input: Record<string, string> }) => {
    const config = loadConfig();
    const dirs = getAgentDirs(config);
    const dataDir = resolve(config.dataDir);
    // Load runnable + catalog so community agents can fire on schedule;
    // the shell gate in executeAgent enforces per-agent opt-in.
    const { agents, warnings } = loadAgents({ directories: dirs.all });

    for (const w of warnings) {
      ui.warn(`${w.file}: ${w.message}`);
    }

    // Preflight: if any scheduled agent needs secrets and the store is v2
    // passphrase-protected without SUA_SECRETS_PASSPHRASE set, fail fast.
    // Otherwise the daemon starts, fires on schedule, and every fire fails
    // silently at secret-resolution time — a nasty UX.
    const scheduledAgents = Array.from(agents.values()).filter((a) => a.schedule);
    const needsSecrets = scheduledAgents.some((a) => (a.secrets ?? []).length > 0);
    if (needsSecrets) {
      const status = inspectSecretsFile(getSecretsPath(config));
      const envPass = process.env.SUA_SECRETS_PASSPHRASE;
      if (status.mode === 'passphrase' && (envPass === undefined || envPass.length === 0)) {
        ui.fail(
          'Scheduler cannot start: at least one scheduled agent needs secrets, ' +
            'but the secrets store is passphrase-protected and SUA_SECRETS_PASSPHRASE is not set.',
        );
        console.error(
          ui.dim(
            'Export SUA_SECRETS_PASSPHRASE before starting the daemon, or run `sua secrets migrate` ' +
              'to switch to the legacy hostname-derived key (insecure).',
          ),
        );
        process.exit(1);
      }
    }

    const provider = await createProvider(config, {
      allowUntrustedShell: new Set(options.allowUntrustedShell),
    });

    // Create a read-only RunStore for catch-up queries.
    const dbPath = getDbPath(config);
    const runStore = new RunStore(dbPath);

    const scheduler = new LocalScheduler({
      provider,
      agents,
      inputs: options.input,
      dataDir,
      runStore,
      onFire: (agent, runId) => {
        const ts = new Date().toISOString();
        console.log(`${ui.dim(ts)} ${chalk.green('fired')} ${ui.agent(agent.name)} ${ui.dim(`run=${runId.slice(0, 8)}`)}`);
      },
      onError: (agent, err) => {
        ui.fail(`Error firing ${agent.name}: ${err.message}`);
      },
    });

    let entries;
    try {
      entries = await scheduler.start();
    } catch (err) {
      ui.fail((err as Error).message);
      runStore.close();
      await provider.shutdown();
      process.exit(1);
    }

    if (entries.length === 0) {
      ui.warn('No agents have a schedule. Add `schedule: "<cron>"` to an agent YAML and restart.');
      runStore.close();
      await provider.shutdown();
      return;
    }

    const bannerLines = entries.map(
      ({ agent, schedule }) => `${agent.name.padEnd(24)} ${cronToHuman(schedule)}`,
    );
    ui.banner(`Scheduler running (${entries.length} agent${entries.length === 1 ? '' : 's'})`, bannerLines);
    console.log(ui.dim('Press Ctrl+C to stop.\n'));

    const shutdown = async () => {
      console.log('\nShutting down scheduler...');
      scheduler.stop();
      runStore.close();
      await provider.shutdown();
      process.exit(0);
    };
    process.on('SIGINT', () => { void shutdown(); });
    process.on('SIGTERM', () => { void shutdown(); });
  });

// ── Helpers ─────────────────────────────────────────────────────────────

function formatRelative(isoDate: string, future = false): string {
  const diff = future
    ? new Date(isoDate).getTime() - Date.now()
    : Date.now() - new Date(isoDate).getTime();
  if (diff < 0) return future ? 'now' : 'just now';
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ${future ? 'from now' : 'ago'}`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${future ? 'from now' : 'ago'}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${future ? 'from now' : 'ago'}`;
  const days = Math.floor(hours / 24);
  return `${days}d ${future ? 'from now' : 'ago'}`;
}

function formatUptime(startedAt: string): string {
  const seconds = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function isMissed(cronExpr: string, lastFireISO: string): boolean {
  const next = nextFireTime(cronExpr);
  if (!next) return false;
  // If the next fire computed from now is in the future, but we can check
  // if a fire should have happened between lastFire and now.
  try {
    const { CronExpressionParser } = require('cron-parser');
    const expr = CronExpressionParser.parse(cronExpr, { currentDate: new Date(lastFireISO) });
    const nextAfterLast = expr.next();
    return nextAfterLast.getTime() < Date.now();
  } catch {
    return false;
  }
}
