import { Command } from 'commander';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';

export const initCommand = new Command('init')
  .description('Initialize some-useful-agents in the current directory')
  .action(() => {
    const configPath = join(process.cwd(), 'sua.config.json');

    if (existsSync(configPath)) {
      console.log(chalk.yellow('sua.config.json already exists. Skipping.'));
      return;
    }

    const config = {
      provider: 'local',
      agentsDir: './agents',
      dataDir: './data',
      mcpPort: 3003,
    };

    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    console.log(chalk.green('Created sua.config.json'));

    // Ensure directories exist
    const agentsLocal = join(config.agentsDir, 'local');
    if (!existsSync(agentsLocal)) {
      mkdirSync(agentsLocal, { recursive: true });
      console.log(chalk.green(`Created ${agentsLocal}/`));
    }

    if (!existsSync(config.dataDir)) {
      mkdirSync(config.dataDir, { recursive: true });
      console.log(chalk.green(`Created ${config.dataDir}/`));
    }

    console.log(chalk.dim('\nRun "sua agent list" to see available agents.'));
    console.log(chalk.dim('Run "sua agent run hello-shell" to test your first agent.'));
  });
