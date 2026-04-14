import { Command } from 'commander';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { loadAgents, agentDefinitionSchema } from '@some-useful-agents/core';
import { loadConfig, getAgentDirs } from '../config.js';
import * as ui from '../ui.js';

/**
 * Open an agent's source YAML in $EDITOR, then re-parse after the editor
 * exits so the user learns about validation errors immediately rather than
 * at the next `sua agent run`.
 *
 * Non-TTY / piped: print the resolved path to stdout so callers can compose
 * (`code "$(sua agent edit foo --print-path)"`) without an interactive spawn.
 */
export const editCommand = new Command('edit')
  .description('Open an agent YAML in $EDITOR (then re-validates on save)')
  .argument('<name>', 'Agent name')
  .option('--print-path', 'Print the resolved file path and exit (no editor spawn)')
  .addHelpText(
    'after',
    `
Editor selection:
  1. $EDITOR or $VISUAL, if set
  2. 'vi' on Unix / 'notepad' on Windows as a last resort

After the editor exits, the YAML is re-parsed and validated against the
schema. If parsing fails, you'll see the error and the agent file path so
you can jump back to fix it — the edit itself is already saved on disk.

Community agents are editable from this command (they live under your own
agents/community/ directory); the shell gate still applies at run time.

Examples:
  $ sua agent edit hello                       open in $EDITOR
  $ sua agent edit hello --print-path          just print the path
  $ code "$(sua agent edit hello --print-path)"   hand the path to VS Code
`,
  )
  .action(async (name: string, options: { printPath?: boolean }) => {
    const config = loadConfig();
    const dirs = getAgentDirs(config);
    const { agents, warnings } = loadAgents({ directories: dirs.all });

    const agent = agents.get(name);
    if (!agent) {
      ui.fail(`Agent "${name}" not found.`);
      // Mention warnings that might have hidden this agent (invalid YAML,
      // duplicate name in another dir, etc.) — common root cause when the
      // file exists on disk but the loader skipped it.
      const relevant = warnings.filter((w) => w.file.includes(`/${name}.y`));
      if (relevant.length > 0) {
        console.error(ui.dim('Matching files skipped by the loader:'));
        for (const w of relevant) console.error(ui.dim(`  ${w.file}: ${w.message}`));
      } else {
        console.error(ui.dim('Run "sua agent list" or "sua agent list --catalog" to see options.'));
      }
      process.exit(1);
    }

    if (!agent.filePath) {
      // Should never happen — every loaded agent has a filePath. Guard anyway.
      ui.fail(`Agent "${name}" has no resolved file path (loader bug?).`);
      process.exit(1);
    }

    if (options.printPath) {
      console.log(agent.filePath);
      return;
    }

    // Non-TTY: refuse to spawn an editor; behave like --print-path so the
    // caller can compose. Avoids spawning vi into a pipe.
    if (!process.stdout.isTTY || !process.stdin.isTTY) {
      console.log(agent.filePath);
      return;
    }

    const editor = resolveEditor();
    console.log(ui.dim(`Opening ${agent.filePath} in ${editor}...`));

    const exitCode = await runEditor(editor, agent.filePath);
    if (exitCode !== 0) {
      ui.warn(`Editor exited with code ${exitCode}. File may not have been saved.`);
    }

    // Re-validate. Give the user actionable errors NOW rather than at
    // `sua agent run` time when they've forgotten they were editing.
    const validation = revalidate(agent.filePath);
    if (!validation.ok) {
      ui.fail(`Saved file has errors:`);
      console.error(ui.dim(`  ${agent.filePath}`));
      console.error(`  ${validation.error}`);
      console.error(ui.dim('\nFix and re-run `sua agent edit` or `sua agent audit` to verify.'));
      process.exit(1);
    }

    ui.ok(`Edited ${ui.agent(name)} — YAML parses, schema valid.`);
  });

function resolveEditor(): string {
  const env = process.env.VISUAL ?? process.env.EDITOR;
  if (env && env.trim().length > 0) return env;
  return process.platform === 'win32' ? 'notepad' : 'vi';
}

async function runEditor(editor: string, path: string): Promise<number> {
  // Use shell-style invocation so $EDITOR values like `code --wait` work.
  // The command comes from the user's own env or the hardcoded fallback, so
  // shell expansion is the intended behavior here, not an injection sink.
  return new Promise((resolve) => {
    const child = spawn(editor, [path], { stdio: 'inherit', shell: true });
    child.on('exit', (code) => resolve(code ?? 0));
    child.on('error', () => resolve(127));
  });
}

function revalidate(filePath: string): { ok: true } | { ok: false; error: string } {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch (err) {
    return { ok: false, error: `Cannot read file: ${(err as Error).message}` };
  }
  if (!raw.trim()) return { ok: false, error: 'File is empty' };

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    return { ok: false, error: `Invalid YAML: ${(err as Error).message}` };
  }

  const result = agentDefinitionSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    return { ok: false, error: `Schema: ${issues}` };
  }
  return { ok: true };
}
