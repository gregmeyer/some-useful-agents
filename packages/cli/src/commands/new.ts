import { Command } from 'commander';
import { createInterface, type Interface as Rl } from 'node:readline/promises';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { stringify as yamlStringify } from 'yaml';
import { agentDefinitionSchema } from '@some-useful-agents/core';
import { loadConfig, getAgentDirs } from '../config.js';

export interface AgentAnswers {
  name: string;
  description?: string;
  type: 'shell' | 'claude-code';
  command?: string;
  prompt?: string;
  model?: string;
  timeout?: number;
  schedule?: string;
  secrets?: string[];
  mcp?: boolean;
  redactSecrets?: boolean;
}

/**
 * Build a YAML document for an agent given a set of prompt answers.
 *
 * Pure function so it can be unit-tested without running the interactive
 * flow. Key order is stable and semantic (identity first, execution next,
 * scheduling third, capabilities last) so generated files read the same
 * as hand-written ones.
 */
export function buildAgentYaml(answers: AgentAnswers): string {
  const doc: Record<string, unknown> = { name: answers.name };
  if (answers.description) doc.description = answers.description;
  doc.type = answers.type;
  if (answers.type === 'shell' && answers.command) {
    doc.command = answers.command;
  }
  if (answers.type === 'claude-code' && answers.prompt) {
    doc.prompt = answers.prompt;
    if (answers.model) doc.model = answers.model;
  }
  if (typeof answers.timeout === 'number') doc.timeout = answers.timeout;
  if (answers.schedule) doc.schedule = answers.schedule;
  if (answers.secrets && answers.secrets.length > 0) doc.secrets = answers.secrets;
  if (answers.mcp) doc.mcp = true;
  if (answers.redactSecrets) doc.redactSecrets = true;
  return yamlStringify(doc);
}

const NAME_RE = /^[a-z0-9-]+$/;
const SECRET_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;

async function askNonEmpty(rl: Rl, prompt: string): Promise<string> {
  while (true) {
    const answer = (await rl.question(prompt)).trim();
    if (answer) return answer;
    console.log(chalk.red('  Required.'));
  }
}

async function askYesNo(rl: Rl, prompt: string, defaultYes = false): Promise<boolean> {
  const suffix = defaultYes ? ' [Y/n] ' : ' [y/N] ';
  const raw = (await rl.question(prompt + suffix)).trim().toLowerCase();
  if (!raw) return defaultYes;
  return raw === 'y' || raw === 'yes';
}

export const newCommand = new Command('new')
  .description('Interactively scaffold a new agent YAML under agents/local/')
  .action(async () => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      await runInteractive(rl);
    } finally {
      rl.close();
    }
  });

async function runInteractive(rl: Rl): Promise<void> {
  console.log('');
  console.log(chalk.bold('sua agent new') + chalk.dim(' — scaffold a new local agent'));
  console.log(chalk.dim('  Ctrl-C to abort. Nothing is written until you confirm at the end.'));
  console.log('');

  // 1. Type
  const typeRaw = (await rl.question(
    'Agent type:\n' +
      '  [1] shell        — runs a bash command\n' +
      '  [2] claude-code  — runs a Claude Code prompt (requires claude CLI)\n' +
      chalk.dim('  Choice (1/2) [1]: '),
  )).trim();
  const type: AgentAnswers['type'] =
    typeRaw === '2' || typeRaw.startsWith('c') ? 'claude-code' : 'shell';
  console.log(chalk.dim(`  → ${type}`));
  console.log('');

  // 2. Name
  let name = '';
  while (!name) {
    const raw = await askNonEmpty(rl, 'Agent name (lowercase, hyphens only, e.g. my-agent): ');
    if (!NAME_RE.test(raw)) {
      console.log(chalk.red('  Must match /^[a-z0-9-]+$/ — lowercase letters, digits, hyphens only.'));
      continue;
    }
    name = raw;
  }

  // 3. Description
  const descriptionRaw = (await rl.question(
    'One-line description (optional, press Enter to skip): ',
  )).trim();
  const description = descriptionRaw || undefined;

  // 4. Command or prompt
  let command: string | undefined;
  let prompt: string | undefined;
  let model: string | undefined;
  if (type === 'shell') {
    command = await askNonEmpty(rl, 'Shell command to run: ');
  } else {
    prompt = await askNonEmpty(rl, 'Prompt (single line; edit the YAML afterwards for multi-line): ');
    const modelRaw = (await rl.question(
      'Model (optional, e.g. claude-sonnet-4-20250514 — press Enter for default): ',
    )).trim();
    model = modelRaw || undefined;
  }

  // 5. Advanced fields gate
  const wantAdvanced = await askYesNo(
    rl,
    '\nCustomize more (timeout, schedule, secrets, MCP, redaction)?',
    false,
  );

  let timeout: number | undefined;
  let schedule: string | undefined;
  let secrets: string[] | undefined;
  let mcp = false;
  let redactSecrets = false;

  if (wantAdvanced) {
    console.log('');

    // Timeout
    const timeoutRaw = (await rl.question(
      'Timeout in seconds [300]: ',
    )).trim();
    if (timeoutRaw) {
      const n = Number(timeoutRaw);
      if (!Number.isFinite(n) || n <= 0) {
        console.log(chalk.yellow(`  Ignoring invalid timeout "${timeoutRaw}"; leaving default.`));
      } else {
        timeout = Math.floor(n);
      }
    }

    // Schedule
    schedule = (await rl.question(
      'Cron schedule (optional 5-field, e.g. "0 9 * * *", blank for manual-only): ',
    )).trim() || undefined;

    // Secrets
    const secretsRaw = (await rl.question(
      'Secrets this agent needs (comma-separated names like MY_API_KEY, blank for none): ',
    )).trim();
    if (secretsRaw) {
      const names = secretsRaw.split(',').map(s => s.trim()).filter(Boolean);
      const bad = names.filter(n => !SECRET_NAME_RE.test(n));
      if (bad.length > 0) {
        console.log(
          chalk.yellow(
            `  Ignoring invalid secret name(s): ${bad.join(', ')} (must be UPPERCASE_WITH_UNDERSCORES)`,
          ),
        );
      }
      const good = names.filter(n => SECRET_NAME_RE.test(n));
      if (good.length > 0) secrets = good;
    }

    // MCP
    mcp = await askYesNo(rl, 'Expose via MCP (callable from Claude Desktop etc.)?', false);

    // Redact
    redactSecrets = await askYesNo(
      rl,
      'Scrub known-prefix secrets (AWS, GitHub PAT, OpenAI, Slack) from captured output?',
      false,
    );
  }

  const answers: AgentAnswers = {
    name,
    description,
    type,
    command,
    prompt,
    model,
    timeout,
    schedule,
    secrets,
    mcp,
    redactSecrets,
  };

  // Validate via the same schema the loader uses. Should never fail given
  // the prompt guards, but better to catch here than at load time.
  const parsed = agentDefinitionSchema.safeParse({
    name: answers.name,
    description: answers.description,
    type: answers.type,
    command: answers.command,
    prompt: answers.prompt,
    model: answers.model,
    timeout: answers.timeout ?? 300,
    schedule: answers.schedule,
    secrets: answers.secrets,
    mcp: answers.mcp ?? false,
    redactSecrets: answers.redactSecrets ?? false,
  });
  if (!parsed.success) {
    console.error('');
    console.error(chalk.red('Validation failed. This is a bug — please report:'));
    for (const issue of parsed.error.issues) {
      console.error(chalk.red(`  ${issue.path.join('.')}: ${issue.message}`));
    }
    process.exit(1);
  }

  const yamlText = buildAgentYaml(answers);

  console.log('');
  console.log(chalk.bold('Preview:'));
  console.log(chalk.dim('---'));
  process.stdout.write(yamlText);
  console.log(chalk.dim('---'));
  console.log('');

  // Destination
  const config = loadConfig();
  const dirs = getAgentDirs(config);
  // First entry of runnable is examples; agents/local is second.
  const localDir = dirs.runnable[1];
  const destPath = join(localDir, `${name}.yaml`);

  if (existsSync(destPath)) {
    const overwrite = await askYesNo(
      rl,
      chalk.yellow(`${destPath} already exists. Overwrite?`),
      false,
    );
    if (!overwrite) {
      console.log(chalk.yellow('Aborted. No file written.'));
      return;
    }
  } else {
    const confirm = await askYesNo(rl, `Write to ${destPath}?`, true);
    if (!confirm) {
      console.log(chalk.yellow('Aborted. No file written.'));
      return;
    }
  }

  if (!existsSync(localDir)) mkdirSync(localDir, { recursive: true });
  writeFileSync(destPath, yamlText, 'utf-8');
  console.log(chalk.green(`✓ Created ${destPath}`));
  console.log('');
  console.log(chalk.bold('Next:'));
  console.log(`  ${chalk.cyan(`sua agent run ${name}`)}        ${chalk.dim('run it once')}`);
  if (schedule) {
    console.log(`  ${chalk.cyan('sua schedule start')}       ${chalk.dim(`fire on cron "${schedule}"`)}`);
  }
  if (mcp) {
    console.log(`  ${chalk.cyan('sua mcp start')}            ${chalk.dim('expose via MCP')}`);
  }
  console.log(`  ${chalk.cyan(`sua agent audit ${name}`)}     ${chalk.dim('inspect the generated YAML')}`);
}
