import { Command } from 'commander';
import { readFileSync, readdirSync, existsSync, renameSync } from 'node:fs';
import { join, extname } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { loadAgents } from '@some-useful-agents/core';
import { loadConfig, getAgentDirs } from '../config.js';
import * as ui from '../ui.js';

const DISABLED_SUFFIX = '.disabled';

/**
 * Agent lifecycle: pause without deleting. Disabling renames
 * `<name>.yaml` → `<name>.yaml.disabled`, which the loader skips (it only
 * picks up `.yaml`/`.yml`). No schema changes, no hidden state — the
 * presence of the suffix IS the disabled state.
 *
 * Trade-off vs. a dedicated "trash" dir: keeping the file next to its
 * peers makes it obvious what's disabled when you ls the directory, and
 * it doesn't require the loader to learn a new concept.
 */
export const disableCommand = new Command('disable')
  .description('Pause an agent without deleting it (renames to .disabled)')
  .argument('<name>', 'Agent name')
  .option('--force', 'Allow disabling a community agent (refused by default)')
  .addHelpText(
    'after',
    `
Disabling renames the YAML file to <name>.yaml.disabled so the loader
skips it on subsequent invocations. Re-enable with 'sua agent enable
<name>'. Examples agents (bundled with sua) cannot be disabled —
they live inside the package.

If the disabled agent had a schedule and 'sua schedule start' is running
elsewhere, the daemon keeps firing the in-memory job until restarted.

Examples:
  $ sua agent disable claude-test
  $ sua agent list --disabled
  $ sua agent enable claude-test
`,
  )
  .action((name: string, options: { force?: boolean }) => {
    const config = loadConfig();
    const dirs = getAgentDirs(config);
    const { agents } = loadAgents({ directories: dirs.all });

    const agent = agents.get(name);
    if (!agent) {
      ui.fail(`Agent "${name}" not found.`);
      // Hint if it's already disabled — common user surprise.
      const disabled = findDisabledAgent(name, dirs.all);
      if (disabled) {
        console.error(ui.dim(`  "${name}" is already disabled at ${disabled.filePath}`));
        console.error(ui.dim(`  Re-enable with: sua agent enable ${name}`));
      }
      process.exit(1);
    }

    if (!agent.filePath) {
      ui.fail(`Agent "${name}" has no resolved file path (loader bug?).`);
      process.exit(1);
    }

    if (agent.source === 'examples') {
      ui.fail(
        `Agent "${name}" is a bundled example and cannot be disabled. ` +
          `Copy it to agents/local/ and modify from there.`,
      );
      process.exit(1);
    }

    if (agent.source === 'community' && !options.force) {
      ui.fail(
        `Agent "${name}" is a community agent. Disable refuses these by ` +
          `default to keep your install audit trail intact. Re-run with --force to override.`,
      );
      process.exit(1);
    }

    const target = agent.filePath + DISABLED_SUFFIX;
    if (existsSync(target)) {
      ui.fail(
        `Cannot disable: ${target} already exists. ` +
          `Resolve the conflict manually (likely leftover from a previous disable).`,
      );
      process.exit(1);
    }

    renameSync(agent.filePath, target);
    ui.ok(`Disabled ${ui.agent(name)}  ${ui.dim(`(${target})`)}`);

    if (agent.schedule) {
      ui.warn(
        `This agent has a schedule. If 'sua schedule start' is running elsewhere, ` +
          `restart it so it drops the in-memory cron job.`,
      );
    }
  });

export const enableCommand = new Command('enable')
  .description('Re-enable a previously disabled agent')
  .argument('<name>', 'Agent name')
  .action((name: string) => {
    const config = loadConfig();
    const dirs = getAgentDirs(config);

    const hit = findDisabledAgent(name, dirs.all);
    if (!hit) {
      ui.fail(`No disabled agent named "${name}" found.`);
      console.error(ui.dim(`Run 'sua agent list --disabled' to see what's paused.`));
      process.exit(1);
    }

    const restored = hit.filePath.slice(0, -DISABLED_SUFFIX.length);
    if (existsSync(restored)) {
      ui.fail(
        `Cannot enable: ${restored} already exists. ` +
          `A new agent with the same name was created while "${name}" was disabled. ` +
          `Resolve manually (rename or delete one of the files) then re-run.`,
      );
      process.exit(1);
    }

    renameSync(hit.filePath, restored);
    ui.ok(`Enabled ${ui.agent(name)}  ${ui.dim(`(${restored})`)}`);
  });

/**
 * Scan agent dirs for `<anything>.yaml.disabled` / `.yml.disabled` files,
 * parse each, and return the one whose `name:` field matches. We match on
 * the YAML's declared name rather than the filename so users who rename
 * files independently of the agent name still get the right result.
 */
export function findDisabledAgent(
  name: string,
  dirs: string[],
): { filePath: string; source: 'local' | 'community' | 'examples' } | undefined {
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(DISABLED_SUFFIX)) continue;
      const filePath = join(dir, entry);
      const beforeDisabled = entry.slice(0, -DISABLED_SUFFIX.length);
      const ext = extname(beforeDisabled).toLowerCase();
      if (ext !== '.yaml' && ext !== '.yml') continue;

      let raw: string;
      try {
        raw = readFileSync(filePath, 'utf-8');
      } catch {
        continue;
      }
      let parsed: { name?: unknown };
      try {
        parsed = parseYaml(raw) as { name?: unknown };
      } catch {
        continue;
      }
      if (parsed?.name === name) {
        return { filePath, source: inferSource(dir) };
      }
    }
  }
  return undefined;
}

/**
 * Enumerate every disabled agent across the given dirs. Used by
 * `sua agent list --disabled`. Parses each file to pull the declared name
 * and description for display.
 */
export function listDisabledAgents(dirs: string[]): Array<{
  name: string;
  type?: string;
  description?: string;
  filePath: string;
  source: 'local' | 'community' | 'examples';
}> {
  const out: Array<{
    name: string;
    type?: string;
    description?: string;
    filePath: string;
    source: 'local' | 'community' | 'examples';
  }> = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(DISABLED_SUFFIX)) continue;
      const beforeDisabled = entry.slice(0, -DISABLED_SUFFIX.length);
      const ext = extname(beforeDisabled).toLowerCase();
      if (ext !== '.yaml' && ext !== '.yml') continue;
      const filePath = join(dir, entry);
      let parsed: { name?: unknown; type?: unknown; description?: unknown };
      try {
        parsed = parseYaml(readFileSync(filePath, 'utf-8')) as typeof parsed;
      } catch {
        continue;
      }
      if (typeof parsed?.name !== 'string') continue;
      out.push({
        name: parsed.name,
        type: typeof parsed.type === 'string' ? parsed.type : undefined,
        description: typeof parsed.description === 'string' ? parsed.description : undefined,
        filePath,
        source: inferSource(dir),
      });
    }
  }
  return out;
}

function inferSource(dirPath: string): 'local' | 'community' | 'examples' {
  const n = dirPath.replace(/\\/g, '/');
  if (n.includes('/community')) return 'community';
  if (n.includes('/examples')) return 'examples';
  return 'local';
}

