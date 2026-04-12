import { Command } from 'commander';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import chalk from 'chalk';
import { loadConfig, getAgentDirs } from '../config.js';
import { loadAgents } from '@some-useful-agents/core';

interface Check {
  name: string;
  run: () => { ok: boolean; message: string };
}

export const doctorCommand = new Command('doctor')
  .description('Check prerequisites and system health')
  .action(() => {
    const config = loadConfig();

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
          const { agents, warnings } = loadAgents({ directories: dirs.runnable });
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
    ];

    console.log(chalk.bold('\nsome-useful-agents doctor\n'));

    let allOk = true;
    for (const check of checks) {
      const result = check.run();
      const icon = result.ok ? chalk.green('✓') : chalk.red('✗');
      const msg = result.ok ? chalk.dim(result.message) : chalk.red(result.message);
      console.log(`  ${icon} ${check.name} ${msg}`);
      if (!result.ok) allOk = false;
    }

    console.log('');
    if (allOk) {
      console.log(chalk.green('All checks passed.'));
    } else {
      console.log(chalk.yellow('Some checks failed. See above.'));
      process.exit(1);
    }
  });
