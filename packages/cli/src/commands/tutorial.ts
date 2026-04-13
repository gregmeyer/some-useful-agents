import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { createInterface } from 'node:readline/promises';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadAgents,
  detectLlms,
  invokeLlm,
  type LlmProvider,
} from '@some-useful-agents/core';
import { loadConfig, getAgentDirs } from '../config.js';
import { createProvider } from '../provider-factory.js';
import { DAD_JOKE_AGENT_YAML, DAILY_9AM_SCHEDULE, HELLO_AGENT_YAML } from '../scaffolds.js';

const STAGES = [
  'What is sua?',
  'The agent YAML format',
  'Run your first agent',
  'Build the dad-joke agent',
  'Schedule it',
] as const;

type Rl = ReturnType<typeof createInterface>;

interface Ctx {
  rl: Rl;
  llm: LlmProvider | null;
  config: ReturnType<typeof loadConfig>;
  agentsLocalDir: string;
}

async function runTutorial(): Promise<void> {
  const config = loadConfig();
  const agentsLocalDir = join(config.agentsDir, 'local');
  if (!existsSync(agentsLocalDir)) mkdirSync(agentsLocalDir, { recursive: true });

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const llm = await pickLlm(rl);

  const ctx: Ctx = { rl, llm, config, agentsLocalDir };

  try {
    printHeader();
    await stage1(ctx);
    await stage2(ctx);
    await stage3(ctx);
    await stage4(ctx);
    await stage5(ctx);
    printOutro();
  } finally {
    rl.close();
  }
}

async function pickLlm(rl: Rl): Promise<LlmProvider | null> {
  const avail = detectLlms();
  if (avail.claude.installed && avail.codex.installed) {
    const answer = (await rl.question(chalk.dim('Both Claude and Codex are installed. Use which for `explain`? [claude/codex] (default: claude) '))).trim().toLowerCase();
    if (answer === 'codex') return 'codex';
    return 'claude';
  }
  if (avail.claude.installed) return 'claude';
  if (avail.codex.installed) return 'codex';
  return null;
}

function printHeader(): void {
  console.log('');
  console.log(chalk.bold.cyan('sua tutorial'));
  console.log(chalk.dim('A 5-stage guided walkthrough. Type ') + chalk.cyan('explain') + chalk.dim(' at any prompt for a deeper dive.'));
  console.log('');
}

function stageBanner(n: number, title: string): void {
  console.log('');
  console.log(chalk.bold(`[${n}/${STAGES.length}] ${title}`));
  console.log(chalk.dim('─'.repeat(60)));
}

async function pause(ctx: Ctx, stageTopic: string): Promise<void> {
  if (!ctx.llm) {
    await ctx.rl.question(chalk.dim('\nPress Enter to continue... '));
    return;
  }
  const prompt = chalk.dim(`\nPress Enter to continue, or type `) + chalk.cyan('explain') + chalk.dim(` for a ${ctx.llm} deep-dive: `);
  const answer = (await ctx.rl.question(prompt)).trim().toLowerCase();
  if (answer === 'explain') {
    await doExplain(ctx, stageTopic);
    // After explain, another pause (but skip the explain option to avoid loops)
    await ctx.rl.question(chalk.dim('\nPress Enter to continue... '));
  }
}

async function doExplain(ctx: Ctx, topic: string): Promise<void> {
  if (!ctx.llm) return;
  const prompt = buildExplainPrompt(topic);
  const spinner = ora(`Asking ${ctx.llm}...`).start();
  const result = await invokeLlm({ prompt, provider: ctx.llm, timeoutMs: 60_000 });
  spinner.stop();
  if (result.exitCode !== 0) {
    console.log(chalk.red(`[${ctx.llm} error] ${result.error ?? 'unknown'}`));
    return;
  }
  console.log('\n' + chalk.dim('─── ' + ctx.llm + ' says ───'));
  console.log(result.output.trim());
  console.log(chalk.dim('─'.repeat(60)));
}

function buildExplainPrompt(topic: string): string {
  return `You are explaining the "some-useful-agents" (sua) CLI tool to a developer working through the built-in tutorial. sua is a local-first agent playground. Agents are defined in YAML files (either shell commands or Claude Code prompts), can be chained (dependsOn + {{outputs.X.result}} template syntax), can be scheduled via cron, and can run through a LocalProvider (child_process) or Temporal. Secrets are stored in an encrypted file store, and env filtering prevents secret leakage to community agents.

The user just reached this tutorial stage: "${topic}"

Give a 3-5 sentence deeper explanation of this specific stage. Be concrete. No marketing language. End with one practical tip they can try right now.`;
}

async function stage1(ctx: Ctx): Promise<void> {
  stageBanner(1, 'What is sua?');
  console.log('sua is a local-first agent playground.');
  console.log('');
  console.log('You define agents in YAML files — they can be shell commands');
  console.log('(running ' + chalk.cyan('curl') + ', ' + chalk.cyan('git') + ', any script) or Claude Code prompts.');
  console.log('Run them manually, on a schedule, or expose them to Claude Code');
  console.log('via MCP so any AI tool can trigger them.');
  console.log('');
  console.log('By the end of this tutorial you will have fetched a dad joke');
  console.log('from an external API and scheduled it to arrive every morning.');
  await pause(ctx, 'What is sua and what makes it different from cron + shell scripts?');
}

async function stage2(ctx: Ctx): Promise<void> {
  stageBanner(2, 'The agent YAML format');
  console.log('An agent is just a YAML file. Here is the ' + chalk.cyan('hello') + ' agent that `sua init` scaffolded:');
  console.log('');
  console.log(chalk.dim(indent(HELLO_AGENT_YAML.trim(), '  ')));
  console.log('');
  console.log('Required fields: ' + chalk.bold('name') + ', ' + chalk.bold('type') + ' (shell | claude-code).');
  console.log('Shell agents need ' + chalk.bold('command') + '. Claude agents need ' + chalk.bold('prompt') + '.');
  console.log('Optional: ' + chalk.bold('timeout') + ', ' + chalk.bold('env') + ', ' + chalk.bold('secrets') + ', ' + chalk.bold('schedule') + ', ' + chalk.bold('dependsOn') + '.');
  await pause(ctx, 'The agent YAML schema and how trust levels (examples/local/community) affect env var inheritance.');
}

async function stage3(ctx: Ctx): Promise<void> {
  stageBanner(3, 'Run your first agent');
  console.log('Let us run the ' + chalk.cyan('hello') + ' agent right now.');
  console.log('');

  const { agents } = loadAgents({ directories: getAgentDirs(ctx.config).runnable });
  const agent = agents.get('hello');
  if (!agent) {
    console.log(chalk.yellow('The hello agent is missing. Did you run `sua init`?'));
    return;
  }

  const provider = await createProvider(ctx.config);
  const spinner = ora('Running hello...').start();
  try {
    const run = await provider.submitRun({ agent, triggeredBy: 'cli' });
    let current = run;
    while (current.status === 'running' || current.status === 'pending') {
      await new Promise(r => setTimeout(r, 250));
      const updated = await provider.getRun(run.id);
      if (updated) current = updated;
    }
    spinner.stop();

    if (current.status === 'completed') {
      console.log(chalk.green('✓ completed'));
      console.log(chalk.dim('  output: ') + (current.result ?? '').trim());
      console.log(chalk.dim('  run ID: ') + current.id);
      console.log(chalk.dim('  recorded in: ' + join(ctx.config.dataDir, 'runs.db')));
    } else {
      console.log(chalk.red('agent did not complete: ' + current.status));
      if (current.error) console.log(chalk.red(current.error));
    }
  } finally {
    await provider.shutdown();
  }

  await pause(ctx, 'Where runs are stored, how to query them, and when to use --provider temporal instead of local.');
}

async function stage4(ctx: Ctx): Promise<void> {
  stageBanner(4, 'Build the dad-joke agent');
  console.log('Now a real agent that calls an external API.');
  console.log('');
  console.log(chalk.dim(indent(DAD_JOKE_AGENT_YAML.trim(), '  ')));
  console.log('');

  const path = join(ctx.agentsLocalDir, 'dad-joke.yaml');
  if (existsSync(path)) {
    console.log(chalk.dim('(already exists at ' + path + ', skipping write)'));
  } else {
    writeFileSync(path, DAD_JOKE_AGENT_YAML);
    console.log(chalk.green('Wrote ' + path));
  }

  console.log('\nRunning it now...');
  const { agents } = loadAgents({ directories: getAgentDirs(ctx.config).runnable });
  const agent = agents.get('dad-joke');
  if (!agent) {
    console.log(chalk.yellow('dad-joke agent did not load. Check ' + path));
    return;
  }

  const provider = await createProvider(ctx.config);
  const spinner = ora('curl icanhazdadjoke.com...').start();
  try {
    const run = await provider.submitRun({ agent, triggeredBy: 'cli' });
    let current = run;
    while (current.status === 'running' || current.status === 'pending') {
      await new Promise(r => setTimeout(r, 250));
      const updated = await provider.getRun(run.id);
      if (updated) current = updated;
    }
    spinner.stop();

    if (current.status === 'completed') {
      console.log('');
      console.log(chalk.bold.yellow('🎭 ' + (current.result ?? '').trim()));
      console.log('');
    } else {
      console.log(chalk.red('failed: ' + (current.error ?? current.status)));
      console.log(chalk.dim('Network issue? Check `sua doctor` and try `sua agent run dad-joke` manually.'));
    }
  } finally {
    await provider.shutdown();
  }

  await pause(ctx, 'How the shell agent executes curl, where the output lives, and how you would add secrets (e.g. API keys) via `sua secrets`.');
}

async function stage5(ctx: Ctx): Promise<void> {
  stageBanner(5, 'Schedule it');
  console.log('Make the dad joke arrive every morning at 9am local time.');
  console.log('This adds ' + chalk.cyan('schedule: "0 9 * * *"') + ' to the agent and starts the cron scheduler.');
  console.log('');

  const answer = (await ctx.rl.question(chalk.dim('Schedule dad-joke daily at 9am? [Y/n] '))).trim().toLowerCase();
  if (answer === 'n' || answer === 'no') {
    console.log(chalk.dim('Skipped. You can add a schedule field manually and run `sua schedule start` later.'));
    return;
  }

  const path = join(ctx.agentsLocalDir, 'dad-joke.yaml');
  if (!existsSync(path)) {
    console.log(chalk.yellow('dad-joke.yaml missing. Re-run stage 4.'));
    return;
  }

  const { readFileSync } = await import('node:fs');
  const contents = readFileSync(path, 'utf-8');
  if (!contents.includes('schedule:')) {
    writeFileSync(path, contents.trimEnd() + '\n' + DAILY_9AM_SCHEDULE);
    console.log(chalk.green('Added schedule field to ' + path));
  } else {
    console.log(chalk.dim('Schedule already present in ' + path));
  }

  console.log('');
  console.log(chalk.bold('Next:') + ' start the scheduler to fire it on cron:');
  console.log('  ' + chalk.cyan('sua schedule start') + '   ' + chalk.dim('(foreground; Ctrl+C to stop)'));
  console.log('  ' + chalk.cyan('sua schedule list') + '    ' + chalk.dim('(see all scheduled agents)'));
  console.log('');
  console.log(chalk.dim('For the daemon to run unattended, use a process manager (pm2, launchd).'));

  await pause(ctx, 'How the cron scheduler works: node-cron loads agents with schedule fields, runs each on its own timer, records each fire in the run store with triggeredBy=schedule. What schedules look like (standard 5-field cron).');
}

function printOutro(): void {
  console.log('');
  console.log(chalk.bold.green('Tutorial complete.'));
  console.log('');
  console.log('You now have:');
  console.log('  • a working ' + chalk.cyan('hello') + ' agent');
  console.log('  • a ' + chalk.cyan('dad-joke') + ' agent that fetches from an external API');
  console.log('  • a schedule set for daily 9am fires');
  console.log('');
  console.log('Try:');
  console.log('  ' + chalk.cyan('sua agent list') + '              ' + chalk.dim('see what you have'));
  console.log('  ' + chalk.cyan('sua agent status') + '            ' + chalk.dim('see your run history'));
  console.log('  ' + chalk.cyan('sua agent run dad-joke') + '      ' + chalk.dim('get another joke now'));
  console.log('  ' + chalk.cyan('sua schedule start') + '          ' + chalk.dim('start the scheduler'));
  console.log('');
}

function indent(text: string, prefix: string): string {
  return text.split('\n').map(line => prefix + line).join('\n');
}

export const tutorialCommand = new Command('tutorial')
  .description('Run the interactive onboarding walkthrough')
  .action(async () => {
    try {
      await runTutorial();
    } catch (err) {
      console.error(chalk.red((err as Error).message));
      process.exit(1);
    }
  });
