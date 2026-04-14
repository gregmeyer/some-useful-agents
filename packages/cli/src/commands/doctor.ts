import { Command } from 'commander';
import { execSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { platform } from 'node:os';
import chalk from 'chalk';
import { loadConfig, getAgentDirs, getSecretsPath, getDbPath } from '../config.js';
import {
  loadAgents,
  EncryptedFileStore,
  LocalScheduler,
  detectLlms,
  getMcpTokenPath,
  readMcpToken,
  inspectSecretsFile,
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
          return { ok: valid, message: valid ? 'node-cron ready' : 'node-cron not functioning' };
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
          const dirs = getAgentDirs(config);
          const { agents } = loadAgents({ directories: dirs.all });
          const scheduled = Array.from(agents.values()).filter(a => a.schedule);
          if (scheduled.length === 0) {
            return { ok: true, message: 'none' };
          }
          const invalid = scheduled.filter(a => !LocalScheduler.isValid(a.schedule!));
          if (invalid.length > 0) {
            return { ok: false, message: `${invalid.length} agent(s) with invalid cron: ${invalid.map(a => a.name).join(', ')}` };
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
