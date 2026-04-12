#!/usr/bin/env node

import { Command } from 'commander';
import { listCommand } from './commands/list.js';
import { runCommand } from './commands/run.js';
import { statusCommand } from './commands/status.js';
import { logsCommand } from './commands/logs.js';
import { cancelCommand } from './commands/cancel.js';
import { initCommand } from './commands/init.js';
import { doctorCommand } from './commands/doctor.js';

const program = new Command();

program
  .name('sua')
  .description('some-useful-agents — a local-first agent playground')
  .version('0.1.0');

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

program.parse();
