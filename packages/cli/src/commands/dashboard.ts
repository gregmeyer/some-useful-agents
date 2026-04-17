import { Command } from 'commander';
import { startDashboardServer } from '@some-useful-agents/dashboard';
import { loadConfig, getAgentDirs, getDbPath, getSecretsPath, getVariablesPath, getRetentionDays } from '../config.js';
import * as ui from '../ui.js';

function collectName(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export const dashboardCommand = new Command('dashboard')
  .description('Read-only web UI for agents, runs, and run-now');

dashboardCommand
  .command('start')
  .description('Start the dashboard HTTP server (foreground)')
  .option('--port <port>', 'Port to listen on', '3000')
  .option('--host <host>', 'Bind host (default 127.0.0.1)', '127.0.0.1')
  .option(
    '--allow-untrusted-shell <name>',
    'Pre-allow a community shell agent to be triggered from the dashboard (repeatable)',
    collectName,
    [] as string[],
  )
  .addHelpText(
    'after',
    `
The dashboard shares the MCP bearer token at ~/.sua/mcp-token for auth.
On startup it prints a one-time URL like:

    Dashboard ready at http://127.0.0.1:3000/auth?token=<...>

Click that URL once to set the session cookie; after that, bookmark
http://127.0.0.1:3000/. If you don't have a token yet, run 'sua init'
or 'sua mcp rotate-token' first.

The dashboard runs foreground; Ctrl-C stops it. Daemonization is out
of scope for this release — wrap in launchd / systemd if you need it.
`,
  )
  .action(async (options: { port: string; host: string; allowUntrustedShell: string[] }) => {
    const port = Number.parseInt(options.port, 10);
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      ui.fail(`Invalid port "${options.port}".`);
      process.exit(1);
    }

    const config = loadConfig();
    const dirs = getAgentDirs(config);

    let handle;
    try {
      handle = await startDashboardServer({
        port,
        host: options.host,
        agentDirs: dirs.all,
        dbPath: getDbPath(config),
        secretsPath: getSecretsPath(config),
        variablesPath: getVariablesPath(config),
        retentionDays: getRetentionDays(config),
        allowUntrustedShell: new Set(options.allowUntrustedShell),
      });
    } catch (err) {
      ui.fail((err as Error).message);
      process.exit(1);
    }

    ui.banner(
      `Dashboard running on ${options.host}:${port}`,
      [
        `One-time sign-in URL:`,
        handle.authUrl,
        ``,
        `After that, bookmark http://${options.host}:${port}/`,
      ],
    );
    console.log(ui.dim('Press Ctrl+C to stop.\n'));

    const shutdown = async () => {
      console.log('\nShutting down dashboard...');
      await handle.close();
      process.exit(0);
    };
    process.on('SIGINT', () => { void shutdown(); });
    process.on('SIGTERM', () => { void shutdown(); });
  });
