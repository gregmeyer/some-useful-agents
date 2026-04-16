import { Command } from 'commander';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ensureMcpToken, getMcpTokenPath, AgentStore, parseAgent } from '@some-useful-agents/core';
import { HELLO_AGENT_YAML } from '../scaffolds.js';
import * as ui from '../ui.js';

export const initCommand = new Command('init')
  .description('Initialize some-useful-agents in the current directory')
  .action(async () => {
    const configPath = join(process.cwd(), 'sua.config.json');

    if (existsSync(configPath)) {
      ui.warn('sua.config.json already exists. Skipping.');
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
    ui.ok('Created sua.config.json');

    // Ensure directories exist
    const agentsLocal = join(config.agentsDir, 'local');
    if (!existsSync(agentsLocal)) {
      mkdirSync(agentsLocal, { recursive: true });
      ui.ok(`Created ${agentsLocal}/`);
    }

    if (!existsSync(config.dataDir)) {
      mkdirSync(config.dataDir, { recursive: true });
      ui.ok(`Created ${config.dataDir}/`);
    }

    // Scaffold the hello agent so `sua agent list` isn't empty
    const helloPath = join(agentsLocal, 'hello.yaml');
    if (!existsSync(helloPath)) {
      writeFileSync(helloPath, HELLO_AGENT_YAML);
      ui.ok(`Created ${helloPath}`);
    }

    // Generate the per-user MCP bearer token. Idempotent.
    const tokenPath = getMcpTokenPath();
    const { created } = ensureMcpToken(tokenPath);
    if (created) {
      ui.ok(`Created ${tokenPath} (mode 0600) — MCP bearer token`);
    }

    // Auto-install bundled example agents so the dashboard + agent list
    // aren't empty on first visit. Users can remove them later with
    // `sua examples remove`.
    ui.section('Installing example agents');
    try {
      const { examplesInstall } = await import('./examples.js');
      examplesInstall(join(config.dataDir, 'runs.db'), config.agentsDir);
    } catch {
      ui.info('Run `sua examples install` to add the bundled examples.');
    }

    ui.section('Next steps');
    ui.step('sua tutorial', 'guided walkthrough (recommended)');
    ui.step('sua agent run hello', 'run your first agent');
    ui.step('sua examples list', 'see installed example agents');
    ui.step('sua doctor', 'check prerequisites');
    ui.step('sua mcp start', 'start the local MCP server on 127.0.0.1:3003');
  });
