import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { getSchedulerStatus } from '@some-useful-agents/core';
import { loadConfig, getDaemonServices, getDaemonLogRotateBytes } from '../config.js';
import {
  ALL_SERVICES,
  type ServiceName,
  daemonPaths,
  getServiceStatus,
  spawnService,
  stopService,
  waitForServiceSettle,
} from '../daemon-supervisor.js';
import * as ui from '../ui.js';

export const daemonCommand = new Command('daemon')
  .description('Run sua services (schedule, dashboard, mcp) as detached background processes');

daemonCommand
  .command('start')
  .description('Start configured services as detached subprocesses')
  .option('--service <name>', 'Start only this service (repeatable)', collectService, [] as ServiceName[])
  .action(async (opts: { service: ServiceName[] }) => {
    const config = loadConfig();
    const dataDir = resolve(config.dataDir);
    const services = opts.service.length > 0 ? opts.service : getDaemonServices(config);
    const suaBin = process.argv[1];

    const spawned: { name: ServiceName; pid: number; logPath: string }[] = [];
    const skipped: string[] = [];
    const failed: { name: string; reason: string }[] = [];

    for (const name of services) {
      try {
        const result = spawnService(dataDir, name, {
          suaBin,
          cwd: process.cwd(),
          env: process.env,
          logRotateBytes: getDaemonLogRotateBytes(config),
        });
        spawned.push(result);
      } catch (err) {
        const msg = (err as Error).message;
        if (/already running/.test(msg)) {
          skipped.push(`${name}: ${msg}`);
        } else {
          failed.push({ name, reason: msg });
        }
      }
    }

    // Settle: wait long enough for the children to either bind their port,
    // hit their preflight, or crash. Then re-check liveness so users see
    // "crashed → check log" instead of a misleading "started" line.
    const settled = await Promise.all(
      spawned.map((s) => waitForServiceSettle(dataDir, s.name).then((status) => ({ ...s, status }))),
    );
    const started: string[] = [];
    const crashed: { name: ServiceName; logPath: string }[] = [];
    for (const { name, pid, logPath, status } of settled) {
      if (status.state === 'running') {
        started.push(`${name} (pid ${pid}) → ${logPath}`);
      } else {
        crashed.push({ name, logPath });
        // Clear the stale pid so the next `daemon start` doesn't think it's
        // an "already running" instance.
        stopService(dataDir, name);
      }
    }

    if (started.length > 0) {
      ui.section('Started');
      for (const line of started) console.log(`  ${chalk.green('✔')} ${line}`);
    }
    if (skipped.length > 0) {
      ui.section('Already running');
      for (const line of skipped) console.log(`  ${chalk.yellow('•')} ${line}`);
    }
    if (crashed.length > 0) {
      ui.section('Crashed on startup');
      for (const { name, logPath } of crashed) {
        console.log(`  ${chalk.red('✖')} ${name} — see ${logPath}`);
      }
    }
    if (failed.length > 0) {
      ui.section('Failed to spawn');
      for (const { name, reason } of failed) console.log(`  ${chalk.red('✖')} ${name}: ${reason}`);
    }

    if (failed.length > 0 || crashed.length > 0) process.exit(1);

    if (started.length === 0 && skipped.length === 0) {
      ui.warn('No services configured. Set `daemon.services` in sua.config.json or pass --service.');
    }
  });

daemonCommand
  .command('stop')
  .description('SIGTERM running services')
  .option('--service <name>', 'Stop only this service (repeatable)', collectService, [] as ServiceName[])
  .action((opts: { service: ServiceName[] }) => {
    const config = loadConfig();
    const dataDir = resolve(config.dataDir);
    const services = opts.service.length > 0 ? opts.service : getDaemonServices(config);

    const stopped: string[] = [];
    const notRunning: string[] = [];

    for (const name of services) {
      const result = stopService(dataDir, name);
      if (result.signalled) {
        stopped.push(`${name} (pid ${result.pid})`);
      } else {
        notRunning.push(name);
      }
    }

    if (stopped.length > 0) {
      ui.section('Stopped');
      for (const line of stopped) console.log(`  ${chalk.green('✔')} ${line}`);
    }
    if (notRunning.length > 0) {
      ui.section('Not running');
      for (const name of notRunning) console.log(`  ${chalk.dim('•')} ${name}`);
    }
  });

daemonCommand
  .command('restart')
  .description('Stop then start the configured services')
  .option('--service <name>', 'Restart only this service (repeatable)', collectService, [] as ServiceName[])
  .action(async (opts: { service: ServiceName[] }) => {
    const config = loadConfig();
    const dataDir = resolve(config.dataDir);
    const services = opts.service.length > 0 ? opts.service : getDaemonServices(config);

    for (const name of services) stopService(dataDir, name);
    // Brief pause so SIGTERM is received before respawn.
    await new Promise((r) => setTimeout(r, 250));

    const suaBin = process.argv[1];
    const spawned: { name: ServiceName; pid: number; logPath: string }[] = [];
    const failures: { name: string; reason: string }[] = [];
    for (const name of services) {
      try {
        const result = spawnService(dataDir, name, {
          suaBin,
          cwd: process.cwd(),
          env: process.env,
          logRotateBytes: getDaemonLogRotateBytes(config),
        });
        spawned.push(result);
      } catch (err) {
        failures.push({ name, reason: (err as Error).message });
      }
    }

    const settled = await Promise.all(
      spawned.map((s) => waitForServiceSettle(dataDir, s.name).then((status) => ({ ...s, status }))),
    );
    for (const { name, pid, logPath, status } of settled) {
      if (status.state === 'running') {
        ui.ok(`${name} restarted (pid ${pid})`);
      } else {
        failures.push({ name, reason: `crashed on startup — see ${logPath}` });
        stopService(dataDir, name);
      }
    }

    if (failures.length > 0) {
      ui.section('Failed');
      for (const { name, reason } of failures) ui.fail(`${name}: ${reason}`);
      process.exit(1);
    }
  });

daemonCommand
  .command('status')
  .description('Show pid + heartbeat health for each managed service')
  .action(() => {
    const config = loadConfig();
    const dataDir = resolve(config.dataDir);

    const table = new Table({
      head: [chalk.bold('Service'), chalk.bold('State'), chalk.bold('PID'), chalk.bold('Detail')],
    });

    for (const name of ALL_SERVICES) {
      const status = getServiceStatus(dataDir, name);
      let stateLabel: string;
      switch (status.state) {
        case 'running': stateLabel = chalk.green('running'); break;
        case 'stale':   stateLabel = chalk.red('stale (pid dead)'); break;
        default:        stateLabel = chalk.dim('stopped'); break;
      }

      let detail = '';
      if (name === 'schedule' && status.state === 'running') {
        const { status: schedStatus, heartbeat } = getSchedulerStatus(dataDir);
        if (schedStatus === 'running' && heartbeat) {
          detail = `heartbeat fresh, ${heartbeat.agents.length} agent${heartbeat.agents.length === 1 ? '' : 's'}`;
        } else if (schedStatus === 'stale') {
          detail = chalk.yellow('heartbeat stale');
        } else {
          detail = chalk.yellow('no heartbeat yet');
        }
      }

      table.push([name, stateLabel, status.pid?.toString() ?? '—', detail]);
    }

    ui.section('Daemon services');
    console.log(table.toString());
    console.log(ui.dim(`Logs: ${daemonPaths(dataDir).logsDir}\n`));
  });

daemonCommand
  .command('logs')
  .description('Print the tail of a service log')
  .argument('<service>', 'schedule | dashboard | mcp')
  .option('-n, --lines <count>', 'Number of trailing lines to show', '50')
  .action((service: string, opts: { lines: string }) => {
    if (!ALL_SERVICES.includes(service as ServiceName)) {
      ui.fail(`Unknown service "${service}". Expected one of: ${ALL_SERVICES.join(', ')}.`);
      process.exit(1);
    }
    const config = loadConfig();
    const dataDir = resolve(config.dataDir);
    const path = daemonPaths(dataDir).logPath(service as ServiceName);

    if (!existsSync(path)) {
      ui.warn(`No log yet at ${path}.`);
      return;
    }
    const n = Math.max(1, parseInt(opts.lines, 10) || 50);
    // Read up to last 256 KB to keep memory bounded; sufficient for n<=1000.
    const cap = 256 * 1024;
    const fd = readFileSync(path);
    const slice = fd.subarray(Math.max(0, fd.length - cap));
    const lines = slice.toString('utf-8').split('\n');
    const tail = lines.slice(Math.max(0, lines.length - n - 1)).join('\n');
    process.stdout.write(tail);
    if (!tail.endsWith('\n')) process.stdout.write('\n');
  });

function collectService(value: string, previous: ServiceName[]): ServiceName[] {
  if (!ALL_SERVICES.includes(value as ServiceName)) {
    throw new Error(`Unknown service "${value}". Expected one of: ${ALL_SERVICES.join(', ')}.`);
  }
  return [...previous, value as ServiceName];
}
