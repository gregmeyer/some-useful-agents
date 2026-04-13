import { Command } from 'commander';
import chalk from 'chalk';
import {
  ensureMcpToken,
  getMcpTokenPath,
  readMcpToken,
  rotateMcpToken,
} from '@some-useful-agents/core';
import { loadConfig, getAgentDirs, getDbPath, getSecretsPath } from '../config.js';

export const mcpCommand = new Command('mcp')
  .description('MCP server management');

mcpCommand
  .command('start')
  .description('Start the MCP server')
  .option('-p, --port <port>', 'Port to listen on')
  .option(
    '--host <host>',
    'Bind host (default 127.0.0.1; set 0.0.0.0 only if you genuinely need LAN exposure)',
  )
  .action(async (options) => {
    const config = loadConfig();
    const port = options.port ? parseInt(options.port, 10) : config.mcpPort;
    const host: string = options.host ?? '127.0.0.1';
    const dirs = getAgentDirs(config);
    const dbPath = getDbPath(config);
    const tokenPath = getMcpTokenPath();
    const { token } = ensureMcpToken(tokenPath);

    // Dynamic import to avoid loading MCP deps when not needed
    const { startMcpServer } = await import('@some-useful-agents/mcp-server');

    console.log(chalk.bold('Starting MCP server...'));
    console.log(chalk.dim(`  Host:   ${host}`));
    console.log(chalk.dim(`  Port:   ${port}`));
    console.log(chalk.dim(`  Agents: ${dirs.all.join(', ')}`));
    console.log(chalk.dim(`  DB:     ${dbPath}`));
    console.log(chalk.dim(`  Token:  ${tokenPath}`));
    console.log('');

    if (host !== '127.0.0.1' && host !== '::1' && host !== 'localhost') {
      console.warn(
        chalk.yellow(
          `⚠ MCP is binding to ${host}. The bearer token is your only defense ` +
            `against remote callers. Keep ${tokenPath} secret.`,
        ),
      );
      console.log('');
    }

    console.log(chalk.bold('Add this to your MCP client config (Claude Desktop, etc.):'));
    console.log('');
    const snippet = {
      mcpServers: {
        'some-useful-agents': {
          url: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}/mcp`,
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      },
    };
    console.log(chalk.cyan(JSON.stringify(snippet, null, 2)));
    console.log('');

    await startMcpServer({
      port,
      host,
      // MCP sees runnable + catalog; the `mcp: true` filter in tools.ts
      // decides which agents are actually callable from MCP clients.
      agentDirs: dirs.all,
      dbPath,
      secretsPath: getSecretsPath(config),
      tokenPath,
    });
  });

mcpCommand
  .command('rotate-token')
  .description('Generate a new MCP bearer token (existing clients will need to be updated)')
  .action(() => {
    const tokenPath = getMcpTokenPath();
    const existing = readMcpToken(tokenPath);
    const action = existing ? 'Rotated' : 'Created';
    const newToken = rotateMcpToken(tokenPath);
    console.log(chalk.green(`${action} bearer token at ${tokenPath} (mode 0600).`));
    console.log('');
    console.log(chalk.bold('New bearer token:'));
    console.log(chalk.cyan(newToken));
    console.log('');
    console.log(
      chalk.yellow(
        '⚠ Update your MCP client configs (Claude Desktop, etc.) with the new token. ' +
          'Restart any running `sua mcp start` to pick it up.',
      ),
    );
  });

mcpCommand
  .command('token')
  .description('Print the current MCP bearer token')
  .action(() => {
    const tokenPath = getMcpTokenPath();
    const existing = readMcpToken(tokenPath);
    if (!existing) {
      console.error(chalk.red(`No MCP token at ${tokenPath}. Run \`sua init\` or \`sua mcp rotate-token\`.`));
      process.exit(1);
    }
    console.log(existing);
  });
