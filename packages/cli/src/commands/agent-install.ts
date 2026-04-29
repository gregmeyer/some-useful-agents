import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { createInterface, type Interface as Rl } from 'node:readline/promises';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  AgentStore,
  parseAgent,
  AgentYamlParseError,
  assertSafeUrl,
  normalizeAgentUrl,
  fetchYaml,
  type Agent,
} from '@some-useful-agents/core';
import { loadConfig, getDbPath } from '../config.js';
import * as ui from '../ui.js';

/**
 * Result of running the install pipeline. Returned by `runAgentInstall` so
 * tests can drive the flow without going through commander/process.exit.
 */
export interface InstallResult {
  agent: Agent;
  /** True if an agent with the same id already existed and was upgraded. */
  upgraded: boolean;
  /** Whether the user confirmed the overwrite (only meaningful on collisions). */
  confirmed: boolean;
  /** Final URL after normalization. */
  fetchedFrom: string;
  /** Bytes read off the wire. */
  bytes: number;
}

export interface RunAgentInstallOptions {
  url: string;
  authHeader?: string;
  /** When true, never prompt — fail closed on id collisions. Set by `--yes`. */
  yes?: boolean;
  /** When true, treat any id collision as a confirmed upgrade. Set by `--force`. */
  force?: boolean;
  /** Test seam: provide a pre-built AgentStore (skips opening the DB). */
  agentStore?: AgentStore;
  /** Test seam: confirm prompt. Default reads from process.stdin. */
  confirm?: (msg: string) => Promise<boolean>;
  /** Test seam: substitute the global fetch implementation. */
  fetchImpl?: typeof fetch;
  /** Test seam: skip assertSafeUrl (tests with example.com etc.). */
  skipSafeUrlCheck?: boolean;
}

/**
 * The pure pipeline: normalize → SSRF check → fetch → parse → diff → upsert.
 * Exported for testing; CLI wraps this with output formatting.
 */
export async function runAgentInstall(opts: RunAgentInstallOptions): Promise<InstallResult> {
  const normalized = normalizeAgentUrl(opts.url);
  if (!opts.skipSafeUrlCheck) {
    await assertSafeUrl(normalized);
  }
  const fetched = await fetchYaml(normalized, {
    authHeader: opts.authHeader,
    fetchImpl: opts.fetchImpl,
  });

  let parsed: Agent;
  try {
    parsed = parseAgent(fetched.text);
  } catch (err) {
    if (err instanceof AgentYamlParseError) throw err;
    throw err;
  }

  // Installer takes ownership: even if the YAML declares 'community' or
  // 'examples', a local install lives in the user's `local` slot.
  const agent: Omit<Agent, 'version'> = { ...parsed, source: 'local' };
  // Strip the version field — upsertAgent computes that itself.
  const { version: _v, ...agentNoVersion } = parsed;
  void _v;
  const toUpsert = { ...agentNoVersion, source: 'local' as const };

  const store = opts.agentStore ?? openDefaultAgentStore();
  let closeStore = false;
  if (!opts.agentStore) closeStore = true;

  try {
    const existing = store.getAgent(parsed.id);
    let confirmed = true;
    if (existing && !opts.force) {
      if (opts.yes) {
        // --yes without --force does NOT confirm an overwrite; require explicit force.
        throw new Error(
          `Agent "${parsed.id}" already exists at version ${existing.version}. ` +
          `Re-run with --force to upgrade.`,
        );
      }
      const confirm = opts.confirm ?? defaultConfirm;
      confirmed = await confirm(formatCollisionPrompt(existing, parsed));
      if (!confirmed) {
        return {
          agent: parsed,
          upgraded: false,
          confirmed: false,
          fetchedFrom: fetched.url,
          bytes: fetched.bytes,
        };
      }
    }

    const result = store.upsertAgent(toUpsert, 'import', `Installed from ${opts.url}`);
    return {
      agent: result,
      upgraded: !!existing,
      confirmed,
      fetchedFrom: fetched.url,
      bytes: fetched.bytes,
    };
  } finally {
    if (closeStore) store.close();
  }
}

/** Open an `AgentStore` against the default project DB, creating dirs as needed. */
function openDefaultAgentStore(): AgentStore {
  const config = loadConfig();
  const dbPath = getDbPath(config);
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(dbPath);
  return AgentStore.fromHandle(db);
}

function formatCollisionPrompt(existing: Agent, incoming: Agent): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(chalk.bold(`Agent "${incoming.id}" already exists at version ${existing.version}.`));
  lines.push('');
  lines.push(chalk.dim('  existing → ') + describeAgent(existing));
  lines.push(chalk.dim('  incoming → ') + describeAgent(incoming));
  lines.push('');
  return lines.join('\n') + 'Overwrite?';
}

function describeAgent(a: Agent): string {
  const inputs = a.inputs ? Object.keys(a.inputs).join(',') : '—';
  const secrets = collectDeclaredSecrets(a).join(',') || '—';
  const schedule = a.schedule ?? '—';
  return [
    `inputs=${inputs}`,
    `secrets=${secrets}`,
    `mcp=${a.mcp ? 'y' : 'n'}`,
    `schedule=${schedule}`,
    `nodes=${a.nodes.length}`,
  ].join(' ');
}

/** Collect every secret name any node in the agent declares. Stable + deduped. */
export function collectDeclaredSecrets(a: Agent): string[] {
  const seen = new Set<string>();
  for (const n of a.nodes) {
    for (const s of n.secrets ?? []) seen.add(s);
  }
  return Array.from(seen).sort();
}

async function defaultConfirm(message: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    // Non-TTY: refuse to overwrite silently. The caller can pass --force.
    ui.fail(
      'Non-interactive context: agent already exists. Re-run with --force to overwrite.',
    );
    return false;
  }
  const rl: Rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${message} [y/N] `)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

// ── CLI verb ─────────────────────────────────────────────────────────────

export const installCommand = new Command('install')
  .description('Fetch an agent YAML over HTTPS and import it into the local store')
  .argument('<url>', 'HTTPS URL of an agent YAML (GitHub blob, gist, or raw)')
  .option('--from-gist', 'Treat the URL as a gist (no-op; gist URLs are auto-detected)')
  .option('--auth-header <value>', 'Authorization header value for private fetches (never persisted)')
  .option('--force', 'Overwrite an existing agent with the same id without prompting')
  .option('--yes', 'Non-interactive mode; refuses to overwrite existing agents (use --force)')
  .addHelpText(
    'after',
    `
Examples:
  $ sua agent install https://github.com/some-org/sua-agents/blob/main/weekly-digest.yaml
  $ sua agent install https://gist.github.com/alice/abc123
  $ sua agent install https://example.com/foo.yaml --auth-header "Bearer ghp_..."

The installer takes ownership of the agent — it's saved as source=local
regardless of what the YAML declares. The agent never auto-runs after install.
Auth headers are passed only to the fetch and are never persisted to disk.
`,
  )
  .action(async (url: string, options: { authHeader?: string; force?: boolean; yes?: boolean }) => {
    const spinner = ora(`Fetching ${chalk.cyan(url)}`).start();
    let result: InstallResult;
    try {
      result = await runAgentInstall({
        url,
        authHeader: options.authHeader,
        force: options.force,
        yes: options.yes,
      });
      spinner.stop();
    } catch (err) {
      spinner.stop();
      const e = err as Error;
      if (e instanceof AgentYamlParseError) {
        ui.fail(`Schema validation failed: ${e.message}`);
      } else {
        ui.fail(e.message);
      }
      process.exit(1);
    }

    if (!result.confirmed) {
      ui.warn('Install cancelled. No changes written.');
      return;
    }

    ui.ok(
      result.upgraded
        ? `Upgraded ${ui.agent(result.agent.id)} to version ${result.agent.version}`
        : `Installed ${ui.agent(result.agent.id)} (version ${result.agent.version})`,
    );
    console.log(ui.dim(`  source:   local (installer takes ownership)`));
    console.log(ui.dim(`  fetched:  ${result.fetchedFrom}`));
    console.log(ui.dim(`  bytes:    ${result.bytes}`));

    const inputs = result.agent.inputs ? Object.keys(result.agent.inputs) : [];
    const secrets = collectDeclaredSecrets(result.agent);
    if (inputs.length > 0) {
      ui.section('Declared inputs (callers must supply at run time):');
      for (const k of inputs) console.log(`  ${chalk.cyan(k)}`);
    }
    if (secrets.length > 0) {
      ui.section('Declared secrets (set before running):');
      for (const k of secrets) ui.step(`sua secrets set ${k}`, '');
    }
    if (result.agent.schedule) {
      ui.section('Schedule:');
      console.log(`  ${chalk.cyan(result.agent.schedule)}  ${ui.dim('(run `sua schedule start` to enable)')}`);
    }
    if (result.agent.mcp) {
      ui.section('MCP:');
      console.log(`  ${chalk.cyan('exposed')}  ${ui.dim('(this agent registers as an MCP tool when the server runs)')}`);
    }
    console.log('');
    ui.step(`sua agent run ${result.agent.id}`, 'run the installed agent');
  });
