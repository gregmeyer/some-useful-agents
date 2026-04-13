import { Command } from 'commander';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { ensureMcpToken, getMcpTokenPath } from '@some-useful-agents/core';
import { HELLO_AGENT_YAML } from '../scaffolds.js';

export const initCommand = new Command('init')
  .description('Initialize some-useful-agents in the current directory')
  .action(() => {
    const configPath = join(process.cwd(), 'sua.config.json');

    if (existsSync(configPath)) {
      console.log(chalk.yellow('sua.config.json already exists. Skipping.'));
      // Still ensure the per-user MCP token exists, since init can be re-run.
      ensureMcpToken();
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

    // Scaffold the hello agent so `sua agent list` isn't empty
    const helloPath = join(agentsLocal, 'hello.yaml');
    if (!existsSync(helloPath)) {
      writeFileSync(helloPath, HELLO_AGENT_YAML);
      console.log(chalk.green(`Created ${helloPath}`));
    }

    // Generate the per-user MCP bearer token. Idempotent.
    const tokenPath = getMcpTokenPath();
    const { created } = ensureMcpToken(tokenPath);
    if (created) {
      console.log(chalk.green(`Created ${tokenPath} (mode 0600) — MCP bearer token`));
    }

    console.log('');
    console.log(chalk.bold('Next steps:'));
    console.log(`  ${chalk.cyan('sua tutorial')}           ${chalk.dim('- guided walkthrough (recommended)')}`);
    console.log(`  ${chalk.cyan('sua agent run hello')}    ${chalk.dim('- run your first agent')}`);
    console.log(`  ${chalk.cyan('sua doctor')}             ${chalk.dim('- check prerequisites')}`);
    console.log(`  ${chalk.cyan('sua mcp start')}          ${chalk.dim('- start the local MCP server (localhost:3003)')}`);
  });
