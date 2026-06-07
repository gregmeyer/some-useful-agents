import { Command } from 'commander';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startDashboardServer, getBuildInfo } from '@some-useful-agents/dashboard';
import { getMcpTokenPath, readMcpToken } from '@some-useful-agents/core';

const execFileAsync = promisify(execFile);
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

/** Build identity of a dashboard answering /health (see build-info.ts). */
export interface DashboardProbe {
  /** Git short SHA the running dashboard reports, or null if it predates the stamp. */
  commit: string | null;
  /** ISO build timestamp, or null. */
  builtAt: string | null;
}

/**
 * Probe a port that refused to bind, to tell "our dashboard is already running"
 * apart from "the port is taken by something else". Returns the serving
 * dashboard's build identity when /health answers with the sua-dashboard
 * signature, or null otherwise (foreign process / nothing listening).
 */
export async function probeServingDashboard(host: string, port: number): Promise<DashboardProbe | null> {
  try {
    const res = await fetch(`http://${dialableHost(host)}:${port}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { status?: string; scheduler?: unknown; commit?: string; builtAt?: string };
    if (body.status === 'ok' && 'scheduler' in body) {
      return { commit: body.commit ?? null, builtAt: body.builtAt ?? null };
    }
    return null;
  } catch {
    return null;
  }
}

/** Back-compat boolean wrapper around {@link probeServingDashboard}. */
export async function isDashboardServing(host: string, port: number): Promise<boolean> {
  return (await probeServingDashboard(host, port)) !== null;
}

/**
 * Best-effort: PIDs LISTENing on a TCP port, via `lsof` (darwin/linux).
 * Returns [] when lsof is missing or nothing is listening — callers must
 * tolerate an empty result rather than assume the port is free.
 */
export async function findListenerPids(port: number): Promise<number[]> {
  try {
    const { stdout } = await execFileAsync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']);
    return [...new Set(
      stdout.split('\n').map((s) => Number.parseInt(s.trim(), 10)).filter((n) => Number.isInteger(n) && n > 0),
    )];
  } catch {
    return [];
  }
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * SIGTERM the given pids, wait for the port to clear (up to timeoutMs), then
 * SIGKILL any stragglers. Returns true once the port has no LISTEN-ers.
 */
export async function reclaimPort(port: number, pids: number[], timeoutMs = 6000): Promise<boolean> {
  for (const pid of pids) {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
  }
  const deadline = Date.now() + timeoutMs;
  let escalated = false;
  while (Date.now() < deadline) {
    const still = await findListenerPids(port);
    if (still.length === 0) return true;
    // Halfway through, escalate to SIGKILL for anything that ignored SIGTERM.
    if (!escalated && Date.now() > deadline - timeoutMs / 2) {
      escalated = true;
      for (const pid of still) {
        try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
      }
    }
    await delay(200);
  }
  return (await findListenerPids(port)).length === 0;
}

/** Yes/no prompt on a TTY. Defaults to no on empty/EOF. */
async function confirmTty(question: string): Promise<boolean> {
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const ans = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return ans === 'y' || ans === 'yes';
  } catch {
    return false;
  } finally {
    rl.close();
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
  .option(
    '--replace',
    'If a dashboard is already serving this port, stop it and take over (no prompt). ' +
      'Without this, an interactive shell is asked; non-interactive starts refuse to clobber.',
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
  .action(async (options: { port: string; host: string; provider?: string; allowUntrustedShell: string[]; replace?: boolean }) => {
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

    const startOptions = {
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
      temporal: {
        address: config.temporalAddress ?? 'localhost:7233',
        namespace: config.temporalNamespace ?? 'default',
        taskQueue: config.temporalTaskQueue ?? 'sua-agents',
      },
    };

    const urlHost = dialableHost(options.host);
    let handle;
    try {
      handle = await startDashboardServer(startOptions);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') {
        ui.fail((err as Error).message);
        process.exit(1);
      }

      const probe = await probeServingDashboard(options.host, port);
      const pids = await findListenerPids(port);
      const pidLabel = pids.length ? `pid ${pids.join(', ')}` : 'unknown pid';

      // A foreign process (not a sua dashboard) holds the port — never kill it.
      if (!probe) {
        ui.fail(
          `Port ${port} is already in use by ${pidLabel} (not a sua dashboard). ` +
            `Stop it, or start on a different port: ${ui.cmd('sua dashboard start --port <port>')}.`,
        );
        process.exit(1);
      }

      // A sua dashboard is already here. Compare builds so a STALE instance
      // (the classic "I deployed but still see old code" trap) is obvious.
      const ours = getBuildInfo().commit;
      const theirs = probe.commit ?? 'unknown';
      const builtAt = probe.builtAt ? ` · built ${probe.builtAt}` : '';
      // 'dev' means we have no stamp of our own to compare against.
      const stale = ours !== 'dev' && theirs !== ours;

      let replace = options.replace === true;
      if (!replace && process.stdin.isTTY) {
        const detail = stale
          ? `It is serving an OLDER build (commit ${theirs}) than this one (commit ${ours}).`
          : `It is serving the same build (commit ${theirs}).`;
        ui.info(`A dashboard is already running on ${urlHost}:${port} (${pidLabel}${builtAt}).`);
        console.log(ui.dim(`  ${detail}`));
        replace = await confirmTty(`Stop ${pidLabel} and start this one here?`);
      }

      if (!replace) {
        const token = readMcpToken(getMcpTokenPath());
        ui.banner(
          `Dashboard already running on ${urlHost}:${port}`,
          [
            `${pidLabel} · commit ${theirs}${builtAt}`,
            stale
              ? `This is an OLDER build than the one you started (commit ${ours}).`
              : `Same build as this one (commit ${ours}) — no need to start a second.`,
            ``,
            `To take over the port with this build: ${ui.cmd('sua dashboard start --replace')}`,
            ...(token ? [``, `Sign-in: http://${urlHost}:${port}/auth#token=${token}`] : []),
            `Open http://${urlHost}:${port}/`,
          ],
        );
        // Exit non-zero when stale so a supervisor knows it did NOT take over.
        process.exit(stale ? 1 : 0);
      }

      if (!pids.length) {
        ui.fail(
          `Couldn't identify the process on ${urlHost}:${port} to stop ` +
            `(lsof unavailable?). Stop it manually, then retry.`,
        );
        process.exit(1);
      }
      ui.info(`Stopping existing dashboard (${pidLabel})…`);
      if (!(await reclaimPort(port, pids))) {
        ui.fail(`Port ${port} is still busy after stopping ${pidLabel}. Stop it manually, then retry.`);
        process.exit(1);
      }
      try {
        handle = await startDashboardServer(startOptions);
      } catch (err2) {
        ui.fail(`Failed to start after reclaiming port ${port}: ${(err2 as Error).message}`);
        process.exit(1);
      }
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
