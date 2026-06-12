import { Command } from 'commander';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadConfig } from '../config.js';
import * as ui from '../ui.js';

const LAUNCH_AGENT_LABEL = 'com.some-useful-agents.worker';

function launchAgentPlistPath(): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${LAUNCH_AGENT_LABEL}.plist`);
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Build a user LaunchAgent plist that runs `sua worker start` in the user's
 * GUI (Aqua) session. Running there — vs. a detached daemon — is what lets
 * macOS surface TCC prompts (Reminders/Automation) and persist the grant, so
 * a background worker can actually drive the Apple integration.
 */
export function buildWorkerPlist(opts: {
  nodePath: string;
  cliEntry: string;
  cwd: string;
  env: Record<string, string>;
  logPath: string;
}): string {
  const envEntries = Object.entries(opts.env)
    .map(([k, v]) => `      <key>${xmlEscape(k)}</key>\n      <string>${xmlEscape(v)}</string>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(opts.nodePath)}</string>
    <string>${xmlEscape(opts.cliEntry)}</string>
    <string>worker</string>
    <string>start</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(opts.cwd)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${envEntries}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(opts.logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(opts.logPath)}</string>
</dict>
</plist>
`;
}

function requireDarwin(): void {
  if (process.platform !== 'darwin') {
    ui.fail('LaunchAgents are macOS-only.');
    process.exit(1);
  }
}

export const workerCommand = new Command('worker')
  .description('Temporal worker management');

workerCommand
  .command('start')
  .description('Start the Temporal worker (runs on host, needs access to shell + Claude CLI)')
  .option('--address <address>', 'Temporal server address')
  .option('--namespace <namespace>', 'Temporal namespace')
  .option('--task-queue <queue>', 'Task queue name')
  .action(async (options) => {
    const config = loadConfig();
    const address = options.address ?? config.temporalAddress ?? 'localhost:7233';
    const namespace = options.namespace ?? config.temporalNamespace ?? 'default';
    const taskQueue = options.taskQueue ?? config.temporalTaskQueue ?? 'sua-agents';

    const { startWorker } = await import('@some-useful-agents/temporal-provider');

    ui.banner('Starting Temporal worker', [
      `Address:    ${address}`,
      `Namespace:  ${namespace}`,
      `Task queue: ${taskQueue}`,
    ]);

    try {
      const worker = await startWorker({ address, namespace, taskQueue });
      ui.ok('Worker connected. Listening for agent runs...');
      console.log(ui.dim('Press Ctrl+C to stop.\n'));

      process.on('SIGINT', () => {
        console.log('\nShutting down worker...');
        worker.shutdown();
      });

      await worker.run();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ui.fail(`Worker failed: ${msg}`);
      if (msg.includes('ECONNREFUSED') || msg.includes('connection refused')) {
        console.error(ui.dim(`\nIs Temporal running? Start it with: ${ui.cmd('docker compose up -d')}`));
      }
      process.exit(1);
    }
  });

workerCommand
  .command('install-launchagent')
  .description('Install a user LaunchAgent so the worker runs in your GUI session (persistent macOS Reminders/Notes access)')
  .action(() => {
    requireDarwin();
    const uid = process.getuid?.() ?? 0;
    const cwd = process.cwd();
    const nodePath = process.execPath;
    // The CLI entry (dist/index.js) — resolve through the `sua` symlink.
    let cliEntry: string;
    try {
      cliEntry = realpathSync(process.argv[1]);
    } catch {
      cliEntry = process.argv[1];
    }

    const config = loadConfig();
    // WorkingDirectory makes the worker's loadConfig find this sua.config.json,
    // which bridges experimental.apple → SUA_EXPERIMENTAL_APPLE. We also pass the
    // env explicitly so it works even if the flag is only set via env right now.
    const env: Record<string, string> = {
      PATH: ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', process.env.PATH ?? ''].filter(Boolean).join(':'),
    };
    if (process.env.SUA_EXPERIMENTAL_APPLE) env.SUA_EXPERIMENTAL_APPLE = process.env.SUA_EXPERIMENTAL_APPLE;
    else if (config.experimental?.apple) env.SUA_EXPERIMENTAL_APPLE = '1';
    if (config.temporalAddress) env.SUA_TEMPORAL_ADDRESS = config.temporalAddress;

    const logPath = join(cwd, 'data', 'daemon', 'logs', 'worker-launchagent.log');
    mkdirSync(dirname(logPath), { recursive: true });

    const plistPath = launchAgentPlistPath();
    mkdirSync(dirname(plistPath), { recursive: true });
    writeFileSync(plistPath, buildWorkerPlist({ nodePath, cliEntry, cwd, env, logPath }), 'utf-8');
    ui.ok(`Wrote ${plistPath}`);

    // Reload: bootout first (ignore "not loaded"), then bootstrap into the GUI domain.
    spawnSync('launchctl', ['bootout', `gui/${uid}`, plistPath], { stdio: 'ignore' });
    const boot = spawnSync('launchctl', ['bootstrap', `gui/${uid}`, plistPath], { encoding: 'utf-8' });
    if (boot.status !== 0) {
      ui.fail(`launchctl bootstrap failed: ${(boot.stderr || boot.stdout || '').trim()}`);
      console.log(ui.dim('  Try: launchctl bootout gui/$(id -u) "' + plistPath + '" then re-run.'));
      process.exit(1);
    }
    ui.ok('Loaded LaunchAgent into your GUI session.');
    console.log('');
    ui.warn('Stop the detached daemon worker so they do not both consume the queue:');
    console.log(`  ${ui.cmd('sua daemon stop --service worker')}`);
    console.log('');
    console.log(ui.dim('The first reminder run will trigger a macOS permission prompt — approve it once.'));
    console.log(ui.dim(`Logs: ${logPath}`));
    console.log(ui.dim(`Status: ${ui.cmd('sua worker launchagent-status')}  ·  Remove: ${ui.cmd('sua worker uninstall-launchagent')}`));
  });

workerCommand
  .command('uninstall-launchagent')
  .description('Remove the worker LaunchAgent')
  .action(() => {
    requireDarwin();
    const uid = process.getuid?.() ?? 0;
    const plistPath = launchAgentPlistPath();
    spawnSync('launchctl', ['bootout', `gui/${uid}`, plistPath], { stdio: 'ignore' });
    if (existsSync(plistPath)) {
      rmSync(plistPath, { force: true });
      ui.ok(`Removed ${plistPath} and unloaded it.`);
    } else {
      ui.warn('No worker LaunchAgent installed.');
    }
  });

workerCommand
  .command('launchagent-status')
  .description('Show whether the worker LaunchAgent is loaded')
  .action(() => {
    requireDarwin();
    const uid = process.getuid?.() ?? 0;
    const plistPath = launchAgentPlistPath();
    ui.kv('Plist', existsSync(plistPath) ? plistPath : 'not installed');
    try {
      const out = execFileSync('launchctl', ['print', `gui/${uid}/${LAUNCH_AGENT_LABEL}`], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
      const state = /state = (\S+)/.exec(out)?.[1] ?? 'loaded';
      const pid = /pid = (\d+)/.exec(out)?.[1];
      ui.ok(`LaunchAgent loaded (state: ${state}${pid ? `, pid ${pid}` : ''}).`);
    } catch {
      ui.warn('LaunchAgent not loaded.');
    }
  });
