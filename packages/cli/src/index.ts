#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Command } from 'commander';
import { listCommand } from './commands/list.js';
import { runCommand } from './commands/run.js';
import { statusCommand } from './commands/status.js';
import { logsCommand } from './commands/logs.js';
import { cancelCommand } from './commands/cancel.js';
import { initCommand } from './commands/init.js';
import { doctorCommand } from './commands/doctor.js';
import { mcpCommand } from './commands/mcp.js';
import { secretsCommand } from './commands/secrets.js';
import { workerCommand } from './commands/worker.js';
import { scheduleCommand } from './commands/schedule.js';
import { tutorialCommand } from './commands/tutorial.js';

// Read version from our own package.json so `sua --version` always matches
// the installed package version (no hardcoded drift).
const here = dirname(fileURLToPath(import.meta.url));
const pkgPath = join(here, '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string };

const program = new Command();

program
  .name('sua')
  .description('some-useful-agents — a local-first agent playground')
  .version(pkg.version);

const agent = program
  .command('agent')
  .description('Manage and run agents');

agent.addCommand(listCommand);
agent.addCommand(runCommand);
agent.addCommand(statusCommand);
agent.addCommand(logsCommand);
agent.addCommand(cancelCommand);

program.addCommand(initCommand);
program.addCommand(doctorCommand);
program.addCommand(mcpCommand);
program.addCommand(secretsCommand);
program.addCommand(workerCommand);
program.addCommand(scheduleCommand);
program.addCommand(tutorialCommand);

program.parse();
