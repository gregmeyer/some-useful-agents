import { Command } from 'commander';
import chalk from 'chalk';
import { join, resolve } from 'node:path';
import { loadConfig, getAgentDirs, getDbPath } from '../config.js';

export const mcpCommand = new Command('mcp')
  .description('MCP server management');

mcpCommand
  .command('start')
  .description('Start the MCP server')
  .option('-p, --port <port>', 'Port to listen on')
  .action(async (options) => {
    const config = loadConfig();
    const port = options.port ? parseInt(options.port, 10) : config.mcpPort;
    const dirs = getAgentDirs(config);
    const dbPath = getDbPath(config);

    // Dynamic import to avoid loading MCP deps when not needed
    const { startMcpServer } = await import('@some-useful-agents/mcp-server');

    console.log(chalk.bold('Starting MCP server...'));
    console.log(chalk.dim(`  Port:   ${port}`));
    console.log(chalk.dim(`  Agents: ${dirs.runnable.join(', ')}`));
    console.log(chalk.dim(`  DB:     ${dbPath}`));
    console.log('');

    await startMcpServer({
      port,
      agentDirs: dirs.runnable,
      dbPath,
    });
  });
