import { Command } from 'commander';
import { execSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { platform } from 'node:os';
import chalk from 'chalk';
import { loadConfig, getAgentDirs, getSecretsPath, getDbPath, getDataRoot } from '../config.js';
import { listV2Agents } from '../v2-runtime.js';
import {
  loadAgents,
  EncryptedFileStore,
  LocalScheduler,
  detectLlms,
  getMcpTokenPath,
  readMcpToken,
  inspectSecretsFile,
  getSchedulerStatus,
} from '@some-useful-agents/core';
import * as ui from '../ui.js';

interface Check {
  name: string;
  run: () => { ok: boolean; message: string };
}

function checkMode600(path: string): { ok: boolean; message: string } {
  if (platform() === 'win32') {
    return { ok: true, message: 'skipped on Windows' };
  }
  if (!existsSync(path)) {
    return { ok: true, message: `not present (yet)` };
  }
  const mode = statSync(path).mode & 0o777;
  return {
    ok: mode === 0o600,
    message: mode === 0o600 ? `chmod 0600` : `chmod 0${mode.toString(8)} (want 0600)`,
  };
}

/**
 * Agents the scheduler would actually register: v1 + v2, active only.
 * Mirrors the filter in `schedule.ts` (`a.schedule && a.status === 'active'`)
 * so doctor's count matches what the daemon really picks up rather than
 * counting drafts and paused agents it will skip.
 */
function countScheduledAgents(config: ReturnType<typeof loadConfig>): number {
  let n = 0;
  try {
    const { agents } = loadAgents({ directories: getAgentDirs(config).all });
    // v1 has no `status` field — active/paused/draft is a v2 concept — so a
    // scheduled v1 agent is always registered.
    for (const a of agents.values()) {
      if (a.schedule) n++;
    }
  } catch { /* v1 dir unreadable — v2 count below still stands */ }
  for (const a of listV2Agents()) {
    if (a.schedule && a.status === 'active') n++;
  }
  return n;
}

function buildSecurityChecks(config: ReturnType<typeof loadConfig>): Check[] {
  const tokenPath = getMcpTokenPath();
  const secretsPath = getSecretsPath(config);
  const dbPath = getDbPath(config);
  const dirs = getAgentDirs(config);

  return [
    {
      name: `MCP bearer token (${tokenPath})`,
      run: () => {
        if (!existsSync(tokenPath)) {
          return { ok: false, message: 'not present — run `sua init` or `sua mcp rotate-token`' };
        }
        const token = readMcpToken(tokenPath);
        if (!token || token.length < 32) {
          return { ok: false, message: 'present but unexpectedly short' };
        }
        return { ok: true, message: `${token.length} chars` };
      },
    },
    { name: `Token file perms (${tokenPath})`, run: () => checkMode600(tokenPath) },
    { name: `Secrets file perms (${secretsPath})`, run: () => checkMode600(secretsPath) },
    {
      name: 'Secrets store encryption',
      run: () => {
        const status = inspectSecretsFile(secretsPath);
        if (!status.exists) {
          return { ok: true, message: 'no store created yet' };
        }
        if (status.mode === 'passphrase') {
          return { ok: true, message: 'v2 passphrase-protected' };
        }
        if (status.mode === 'hostname-obfuscated') {
          const version = status.version === 1 ? 'legacy v1' : 'v2 obfuscatedFallback';
          return {
            ok: false,
            message:
              `${version} — hostname-obfuscated, not encrypted. ` +
              `Run 'sua secrets migrate' to set a passphrase.`,
          };
        }
        return { ok: false, message: 'unrecognized store format' };
      },
    },
    { name: `Run-store perms (${dbPath})`, run: () => checkMode600(dbPath) },
    {
      name: 'MCP bind host',
      run: () => {
        const port = config.mcpPort ?? 3003;
        return {
          ok: true,
          message: `default 127.0.0.1:${port} (override with \`sua mcp start --host\`)`,
        };
      },
    },
    {
      name: 'Community shell agents',
      run: () => {
        const { agents } = loadAgents({ directories: dirs.all });
        const offenders = Array.from(agents.values()).filter(
          a => a.type === 'shell' && a.source === 'community',
        );
        if (offenders.length === 0) return { ok: true, message: 'none loaded' };
        return {
          ok: false,
          message:
            `${offenders.length} community shell agent(s): ${offenders.map(a => a.name).join(', ')}. ` +
            `Audit each with \`sua agent audit <name>\`; they refuse to run without ` +
            `\`--allow-untrusted-shell <name>\`.`,
        };
      },
    },
    {
      name: 'Agents exposed via MCP',
      run: () => {
        const { agents } = loadAgents({ directories: dirs.all });
        const exposed = Array.from(agents.values()).filter(a => a.mcp === true);
        return {
          ok: true,
          message:
            exposed.length === 0
              ? 'none opt in (MCP will see an empty catalog)'
              : `${exposed.length} opted in: ${exposed.map(a => a.name).join(', ')}`,
        };
      },
    },
  ];
}

export const doctorCommand = new Command('doctor')
  .description('Check prerequisites and system health')
  .option('--security', 'Run security-focused checks (file perms, MCP token, community shell)')
  .action((options: { security?: boolean }) => {
    const config = loadConfig();

    if (options.security) {
      const checks = buildSecurityChecks(config);
      ui.section('some-useful-agents doctor — security');
      let allOk = true;
      for (const check of checks) {
        const result = check.run();
        const icon = result.ok ? ui.SYMBOLS.ok : ui.SYMBOLS.fail;
        const msg = result.ok ? ui.dim(result.message) : chalk.red(result.message);
        console.log(`  ${icon}  ${check.name}  ${msg}`);
        if (!result.ok) allOk = false;
      }
      console.log('');
      if (allOk) {
        ui.ok('Security posture looks good.');
      } else {
        ui.warn('Security findings above. See docs/SECURITY.md.');
        process.exit(1);
      }
      return;
    }

    const checks: Check[] = [
      {
        name: 'Node.js >= 22.5',
        run: () => {
          const version = process.versions.node;
          const [major, minor] = version.split('.').map(Number);
          const ok = major > 22 || (major === 22 && minor >= 5);
          return { ok, message: ok ? `v${version}` : `v${version} (need >= 22.5)` };
        },
      },
      {
        name: 'npm available',
        run: () => {
          try {
            const version = execSync('npm --version', { encoding: 'utf-8' }).trim();
            return { ok: true, message: `v${version}` };
          } catch {
            return { ok: false, message: 'not found' };
          }
        },
      },
      {
        name: 'Claude Code CLI',
        run: () => {
          try {
            const version = execSync('claude --version', { encoding: 'utf-8' }).trim();
            return { ok: true, message: version };
          } catch {
            return { ok: false, message: 'not found (needed for claude-code agents)' };
          }
        },
      },
      {
        name: 'Docker available',
        run: () => {
          if (config.provider !== 'temporal') {
            return { ok: true, message: 'skipped (not using temporal provider)' };
          }
          try {
            execSync('docker info', { encoding: 'utf-8', stdio: 'pipe' });
            return { ok: true, message: 'running' };
          } catch {
            return { ok: false, message: 'not running (needed for temporal provider)' };
          }
        },
      },
      {
        name: 'Agents directory',
        run: () => {
          const dirs = getAgentDirs(config);
          const { agents, warnings } = loadAgents({ directories: dirs.all });
          if (agents.size === 0 && warnings.length > 0) {
            return { ok: false, message: `No agents found (${warnings.length} warning(s))` };
          }
          return { ok: agents.size > 0, message: `${agents.size} agent(s) found` };
        },
      },
      {
        name: 'Config file',
        run: () => {
          const exists = existsSync('sua.config.json');
          return { ok: exists, message: exists ? 'found' : 'not found (run "sua init")' };
        },
      },
      {
        name: 'Secrets backend',
        run: () => {
          const status = inspectSecretsFile(getSecretsPath(config));
          if (!status.exists) {
            return { ok: true, message: 'no store created yet' };
          }
          if (status.mode === 'passphrase') {
            return { ok: true, message: 'v2 passphrase-protected' };
          }
          if (status.mode === 'hostname-obfuscated') {
            return {
              ok: true,
              message:
                status.version === 1
                  ? 'legacy v1 (hostname-obfuscated) — run `sua secrets migrate`'
                  : 'v2 obfuscatedFallback (hostname-obfuscated)',
            };
          }
          return { ok: false, message: 'unrecognized store format' };
        },
      },
      {
        name: 'Scheduler',
        run: () => {
          const valid = LocalScheduler.isValid('* * * * *');
          if (!valid) return { ok: false, message: 'node-cron not functioning' };

          // "node-cron is importable" was the whole check. It passed happily
          // through nine days of the daemon being dead with 18 agents on cron
          // — `doctor` printed "All checks passed" the entire time. Whether
          // the library loads is not the question anyone is asking.
          const { status } = getSchedulerStatus(getDataRoot(config));
          const scheduled = countScheduledAgents(config);

          if (status === 'running') {
            return { ok: true, message: `daemon running, ${String(scheduled)} agent(s) scheduled` };
          }
          if (status === 'idle') {
            return scheduled > 0
              ? { ok: false, message: `daemon running but registered 0 agents while ${String(scheduled)} are scheduled — restart it: sua daemon start --service schedule` }
              : { ok: true, message: 'daemon running, nothing scheduled' };
          }
          if (scheduled === 0) {
            return { ok: true, message: `daemon ${status}, nothing scheduled` };
          }
          return {
            ok: false,
            message: `daemon ${status} — ${String(scheduled)} scheduled agent(s) will not run. Start it: sua daemon start --service schedule`,
          };
        },
      },
      {
        name: 'LLM CLIs (for sua tutorial --explain)',
        run: () => {
          const avail = detectLlms();
          const names: string[] = [];
          if (avail.claude.installed) names.push('claude');
          if (avail.codex.installed) names.push('codex');
          if (names.length === 0) {
            return { ok: true, message: 'none installed (tutorial explain feature disabled)' };
          }
          return { ok: true, message: names.join(', ') + ' available' };
        },
      },
      {
        name: 'Scheduled agents',
        run: () => {
          // `loadAgents` is the V1 loader and silently skips every v2 agent
          // (ADR-0032). This check therefore reported "none" on an install
          // where seven v2 agents were scheduled and firing.
          const dirs = getAgentDirs(config);
          const { agents } = loadAgents({ directories: dirs.all });
          const scheduled: Array<{ name: string; schedule: string }> = [];
          for (const a of agents.values()) {
            if (a.schedule) scheduled.push({ name: a.name, schedule: a.schedule });
          }
          for (const a of listV2Agents()) {
            if (a.schedule) scheduled.push({ name: a.name, schedule: a.schedule });
          }

          if (scheduled.length === 0) {
            return { ok: true, message: 'none' };
          }
          const invalid = scheduled.filter((a) => !LocalScheduler.isValid(a.schedule));
          if (invalid.length > 0) {
            return { ok: false, message: `${invalid.length} agent(s) with invalid cron: ${invalid.map((a) => a.name).join(', ')}` };
          }
          return { ok: true, message: `${scheduled.length} scheduled` };
        },
      },
      {
        name: 'Agent secrets',
        run: () => {
          const dirs = getAgentDirs(config);
          const { agents } = loadAgents({ directories: dirs.all });
          const store = new EncryptedFileStore(getSecretsPath(config));

          const declaredSecrets = new Set<string>();
          for (const [, agent] of agents) {
            for (const s of agent.secrets ?? []) declaredSecrets.add(s);
          }
          // v2 agents declare secrets per node, not on the agent (ADR-0032:
          // `loadAgents` skips them entirely, so this said "no agents declare
          // secrets" no matter how many did).
          for (const agent of listV2Agents()) {
            for (const node of agent.nodes ?? []) {
              for (const s of node.secrets ?? []) declaredSecrets.add(s);
            }
          }

          if (declaredSecrets.size === 0) {
            return { ok: true, message: 'no agents declare secrets' };
          }

          // Check synchronously by accessing private state — use hasSync via list()
          // Note: we use a sync approach by reading the file directly via store.list()'s promise
          // Since run() is sync, we check count only
          return { ok: true, message: `${declaredSecrets.size} secret(s) declared by agents` };
        },
      },
    ];

    ui.section('some-useful-agents doctor');

    let allOk = true;
    for (const check of checks) {
      const result = check.run();
      const icon = result.ok ? ui.SYMBOLS.ok : ui.SYMBOLS.fail;
      const msg = result.ok ? ui.dim(result.message) : chalk.red(result.message);
      console.log(`  ${icon}  ${check.name}  ${msg}`);
      if (!result.ok) allOk = false;
    }

    console.log('');
    if (allOk) {
      ui.ok('All checks passed.');
    } else {
      ui.warn('Some checks failed. See above.');
      process.exit(1);
    }
  });
