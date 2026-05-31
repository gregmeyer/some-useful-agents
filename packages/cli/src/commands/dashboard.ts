import { Command } from 'commander';
import { startDashboardServer } from '@some-useful-agents/dashboard';
import { getMcpTokenPath, readMcpToken } from '@some-useful-agents/core';
import { loadConfig, getAgentDirs, getDbPath, getSecretsPath, getVariablesPath, getLlmSettingsPath, getRetentionDays, getDashboardBaseUrl, resolveProvider } from '../config.js';
import { createProvider } from '../provider-factory.js';
import * as ui from '../ui.js';

function collectName(value: string, previous: string[]): string[] {
  return [...previous, value];
}

/** Wildcard bind hosts aren't dialable — map them to loopback for probe/print. */
export function dialableHost(host: string): string {
  return host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
}

/**
 * Probe a port that refused to bind, to tell "our dashboard is already running"
 * apart from "the port is taken by something else". Returns true only when
 * /health answers with the sua-dashboard signature.
 */
export async function isDashboardServing(host: string, port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://${dialableHost(host)}:${port}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { status?: string; scheduler?: unknown };
    return body.status === 'ok' && 'scheduler' in body;
  } catch {
    return false;
  }
}

export const dashboardCommand = new Command('dashboard')
  .description('Read-only web UI for agents, runs, and run-now');

dashboardCommand
  .command('start')
  .description('Start the dashboard HTTP server (foreground)')
  .option('--port <port>', 'Port to listen on', '3000')
  .option('--host <host>', 'Bind host (default 127.0.0.1)', '127.0.0.1')
  .option(
    '--provider <kind>',
    'Run-now backend: "local" (default) or "temporal". Overrides config/SUA_PROVIDER. ' +
      'Temporal requires the server (docker compose up -d) and a worker (sua worker start).',
  )
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

    Dashboard ready at http://127.0.0.1:3000/auth#token=<...>

Click that URL once to set the session cookie; after that, bookmark
http://127.0.0.1:3000/. If you don't have a token yet, run 'sua init'
or 'sua mcp rotate-token' first.

The dashboard runs foreground; Ctrl-C stops it. Daemonization is out
of scope for this release — wrap in launchd / systemd if you need it.
`,
  )
  .action(async (options: { port: string; host: string; provider?: string; allowUntrustedShell: string[] }) => {
    const port = Number.parseInt(options.port, 10);
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      ui.fail(`Invalid port "${options.port}".`);
      process.exit(1);
    }

    const config = loadConfig();
    const dirs = getAgentDirs(config);
    const allowUntrustedShell = new Set(options.allowUntrustedShell);

    // Build the run-now provider up front so a misconfigured or unreachable
    // Temporal server fails before we bind the HTTP listener. resolveProvider
    // validates the kind; createProvider connects (Temporal) or opens the
    // SQLite store (local).
    const providerKind = resolveProvider(config, options.provider);
    let provider;
    try {
      provider = await createProvider(config, {
        providerOverride: options.provider,
        allowUntrustedShell,
      });
    } catch (err) {
      const msg = (err as Error).message;
      ui.fail(`Could not start the ${providerKind} provider: ${msg}`);
      if (providerKind === 'temporal' && /ECONNREFUSED|connection refused/i.test(msg)) {
        console.error(ui.dim(`\nIs Temporal running? Start it with: ${ui.cmd('docker compose up -d')}`));
        console.error(ui.dim(`Then start a worker in another terminal: ${ui.cmd('sua worker start')}`));
      }
      process.exit(1);
    }

    let handle;
    try {
      handle = await startDashboardServer({
        port,
        host: options.host,
        agentDirs: dirs.all,
        dbPath: getDbPath(config),
        secretsPath: getSecretsPath(config),
        variablesPath: getVariablesPath(config),
        llmSettingsPath: getLlmSettingsPath(config),
        retentionDays: getRetentionDays(config),
        allowUntrustedShell,
        dashboardBaseUrl: getDashboardBaseUrl(config),
        provider,
      });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        const urlHost = dialableHost(options.host);
        if (await isDashboardServing(options.host, port)) {
          const token = readMcpToken(getMcpTokenPath());
          ui.banner(
            `Dashboard already running on ${urlHost}:${port}`,
            [
              `Another dashboard is already serving this port — no need to start a second one.`,
              ``,
              ...(token
                ? [`Sign-in URL:`, `http://${urlHost}:${port}/auth#token=${token}`, ``]
                : []),
              `Open http://${urlHost}:${port}/`,
            ],
          );
          process.exit(0);
        }
        ui.fail(
          `Port ${port} is already in use by another process. Stop it, or start on a ` +
            `different port: sua dashboard start --port <port>.`,
        );
        process.exit(1);
      }
      ui.fail((err as Error).message);
      process.exit(1);
    }

    ui.banner(
      `Dashboard running on ${options.host}:${port}`,
      [
        `Run-now provider: ${providerKind}${providerKind === 'temporal' ? ' (needs `sua worker start`)' : ''}`,
        ``,
        `One-time sign-in URL:`,
        handle.authUrl,
        ``,
        `After that, bookmark http://${options.host}:${port}/`,
      ],
    );
    console.log(ui.dim('Press Ctrl+C to stop.\n'));

    // Crash-logging contract. The daemon supervisor pipes stderr to
    // dashboard.log; previously the only thing that ever reached it
    // was the startup banner. Now signal-triggered shutdowns name
    // their signal, uncaught exceptions write the full stack before
    // exit, and unhandled rejections do the same. Without these the
    // dashboard would die mid-request and the operator would see an
    // empty log + no PID — exactly the symptom that prompted this.
    const ts = (): string => new Date().toISOString();
    const shutdown = async (reason: string) => {
      process.stderr.write(`[${ts()}] dashboard shutting down (${reason})\n`);
      try {
        await handle.close();
        process.exit(0);
      } catch (err) {
        process.stderr.write(
          `[${ts()}] dashboard shutdown error: ${(err as Error)?.message ?? String(err)}\n` +
          `${(err as Error)?.stack ?? ''}\n`,
        );
        process.exit(1);
      }
    };

    process.on('SIGINT', () => { void shutdown('SIGINT'); });
    process.on('SIGTERM', () => { void shutdown('SIGTERM'); });

    process.on('uncaughtException', (err) => {
      process.stderr.write(
        `[${ts()}] FATAL uncaughtException: ${err?.message ?? String(err)}\n${err?.stack ?? ''}\n`,
      );
      // Exit with 1 so the supervisor knows this wasn't a clean stop
      // and can decide whether to restart. Don't await handle.close()
      // — the process state is corrupt; leave the OS to reclaim fds.
      process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
      const err = reason instanceof Error ? reason : new Error(String(reason));
      process.stderr.write(
        `[${ts()}] FATAL unhandledRejection: ${err.message}\n${err.stack ?? ''}\n`,
      );
      process.exit(1);
    });
  });
