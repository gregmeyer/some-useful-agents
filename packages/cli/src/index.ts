#!/usr/bin/env node

// MUST be the first import so the warning filter is attached before any
// transitive import of node:sqlite fires the ExperimentalWarning.
import './suppress-warnings.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Command } from 'commander';
import { listCommand } from './commands/list.js';
import { runCommand } from './commands/run.js';
import { statusCommand } from './commands/status.js';
import { logsCommand } from './commands/logs.js';
import { cancelCommand } from './commands/cancel.js';
import { auditCommand } from './commands/audit.js';
import { editCommand } from './commands/edit.js';
import { disableCommand, enableCommand } from './commands/disable.js';
import { newCommand } from './commands/new.js';
import { installCommand } from './commands/agent-install.js';
import { initCommand } from './commands/init.js';
import { doctorCommand } from './commands/doctor.js';
import { mcpCommand } from './commands/mcp.js';
import { secretsCommand } from './commands/secrets.js';
import { workerCommand } from './commands/worker.js';
import { scheduleCommand } from './commands/schedule.js';
import { tutorialCommand } from './commands/tutorial.js';
import { dashboardCommand } from './commands/dashboard.js';
import { workflowCommand } from './commands/workflow.js';
import { toolCommand } from './commands/tool.js';
import { examplesCommand } from './commands/examples.js';
import { varsCommand } from './commands/vars.js';

// Read version from our own package.json so `sua --version` always matches
// the installed package version (no hardcoded drift).
const here = dirname(fileURLToPath(import.meta.url));
const pkgPath = join(here, '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string };

const program = new Command();

program
  .name('sua')
  .description('some-useful-agents — a local-first agent playground')
  .version(pkg.version)
  .showHelpAfterError(true)
  .addHelpText(
    'after',
    `
Examples:
  $ sua init                                     Create sua.config.json in the current dir
  $ sua agent new                                Scaffold a new agent interactively
  $ sua agent run my-agent                       Run an agent once
  $ sua agent run weather --input ZIP=94110      Supply a declared input
  $ sua agent list                               See everything runnable
  $ sua schedule start                           Fire scheduled agents on cron
  $ sua mcp start                                Start the MCP server on 127.0.0.1:3003
  $ sua doctor --security                        Audit security posture

Template syntax in agent YAML:
  {{inputs.X}}               caller-supplied values (see \`sua agent run --help\`)
  {{outputs.X.result}}       upstream chain output (inside the \`input:\` field only)

Security model: docs/SECURITY.md
Full docs:      https://github.com/gregmeyer/some-useful-agents
`,
  );

const agent = program
  .command('agent')
  .description('Manage and run agents');

agent.addCommand(listCommand);
agent.addCommand(newCommand);
agent.addCommand(runCommand);
agent.addCommand(statusCommand);
agent.addCommand(logsCommand);
agent.addCommand(cancelCommand);
agent.addCommand(auditCommand);
agent.addCommand(editCommand);
agent.addCommand(disableCommand);
agent.addCommand(enableCommand);
agent.addCommand(installCommand);

program.addCommand(initCommand);
program.addCommand(doctorCommand);
program.addCommand(mcpCommand);
program.addCommand(secretsCommand);
program.addCommand(workerCommand);
program.addCommand(scheduleCommand);
program.addCommand(tutorialCommand);
program.addCommand(dashboardCommand);
program.addCommand(workflowCommand);
program.addCommand(toolCommand);
program.addCommand(examplesCommand);
program.addCommand(varsCommand);

program.parse();
