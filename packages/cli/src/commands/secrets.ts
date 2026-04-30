import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { createInterface } from 'node:readline';
import {
  EncryptedFileStore,
  inspectSecretsFile,
  loadAgents,
  type SecretsStoreStatus,
} from '@some-useful-agents/core';
import { loadConfig, getSecretsPath, getAgentDirs } from '../config.js';
import * as ui from '../ui.js';

interface OpenStoreOptions {
  /** When true, prompt the user for a passphrase if one is needed; otherwise
   *  surface a non-interactive error. Set this only for commands that write. */
  promptForPassphrase?: boolean;
}

/**
 * Resolve the right EncryptedFileStore + status for the current command. This
 * handles: cold init, v1→v2 auto-migration prompt, v2 passphrase prompts, and
 * the obfuscated-fallback pass-through (no prompt needed).
 */
async function openStore(
  options: OpenStoreOptions = {},
): Promise<{ store: EncryptedFileStore; status: SecretsStoreStatus; passphrase?: string }> {
  const config = loadConfig();
  const path = getSecretsPath(config);
  const status = inspectSecretsFile(path);

  const envPass = process.env.SUA_SECRETS_PASSPHRASE;

  // Read-only with obfuscatedFallback or v1: no passphrase needed.
  if (status.mode === 'hostname-obfuscated') {
    return { store: new EncryptedFileStore(path), status };
  }

  // Cold store: either we prompt (write path) or we return an empty read-only store.
  if (!status.exists) {
    if (options.promptForPassphrase) {
      const pass = await promptNewPassphrase();
      return {
        store: new EncryptedFileStore(path, {
          passphrase: pass ?? undefined,
          allowLegacyFallback: pass === undefined,
        }),
        status,
        passphrase: pass ?? undefined,
      };
    }
    return { store: new EncryptedFileStore(path), status };
  }

  // v2 passphrase-protected: env var wins, otherwise prompt.
  if (envPass !== undefined && envPass.length > 0) {
    return { store: new EncryptedFileStore(path, { passphrase: envPass }), status, passphrase: envPass };
  }

  if (!process.stdin.isTTY) {
    ui.fail(
      'Secrets store is passphrase-protected but SUA_SECRETS_PASSPHRASE is not set ' +
        'and stdin is not a TTY.',
    );
    process.exit(1);
  }

  const pass = await promptExistingPassphrase(path);
  return { store: new EncryptedFileStore(path, { passphrase: pass }), status, passphrase: pass };
}

export const secretsCommand = new Command('secrets').description('Manage secrets used by agents');

secretsCommand
  .command('set')
  .description('Set a secret value')
  .argument('<name>', 'Secret name (e.g. MY_API_KEY)')
  .addHelpText(
    'after',
    `
Passphrase handling:
  Against a cold or v1 store, 'set' prompts for a new passphrase (hidden,
  confirmed) before asking for the secret value. An empty passphrase falls
  back to the legacy hostname-derived key (obfuscation, not encryption);
  the store is labeled 'obfuscatedFallback' in the payload and every load
  warns. Against an existing v2 passphrase-protected store, 'set' prompts
  for the existing passphrase once per invocation.

Non-TTY / CI:
  Set SUA_SECRETS_PASSPHRASE in the environment. Set it to the empty
  string to explicitly opt into the legacy hostname-derived fallback.
  Piped value input still works: \`echo "val" | sua secrets set KEY\`.

Examples:
  $ sua secrets set GITHUB_TOKEN               interactive
  $ SUA_SECRETS_PASSPHRASE=pp sua secrets set GITHUB_TOKEN < token.txt
  $ SUA_SECRETS_PASSPHRASE= sua secrets set DEMO_KEY <<< "demo"  # fallback
`,
  )
  .action(async (name: string) => {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) {
      ui.fail(`Invalid secret name "${name}". Must be uppercase with underscores (e.g. MY_API_KEY).`);
      process.exit(1);
    }

    const { store } = await openStore({ promptForPassphrase: true });

    const value = await promptSecret(name);
    if (!value) {
      ui.fail('No value provided.');
      process.exit(1);
    }

    await withStoreErrors(() => store.set(name, value));
    ui.ok(`Set secret ${ui.agent(name)}`);
  });

secretsCommand
  .command('get')
  .description('Print a secret value')
  .argument('<name>', 'Secret name')
  .action(async (name: string) => {
    const { store } = await openStore();
    const value = await withStoreErrors(() => store.get(name));
    if (value === undefined) {
      ui.fail(`Secret "${name}" not set.`);
      process.exit(1);
    }
    console.log(value);
  });

secretsCommand
  .command('list')
  .description('List secret names (values not shown)')
  .action(async () => {
    const { store, status } = await openStore();
    if (!status.exists) {
      ui.info('No secrets set. Run `sua secrets set <NAME>` to add one.');
      return;
    }
    const names = await withStoreErrors(() => store.list());

    if (names.length === 0) {
      ui.info('No secrets set. Run `sua secrets set <NAME>` to add one.');
      return;
    }

    const table = new Table({ head: [chalk.bold('Name')] });
    for (const name of names) {
      table.push([ui.agent(name)]);
    }
    console.log(table.toString());
    console.log(ui.dim(`\n${names.length} secret(s)`));
  });

secretsCommand
  .command('delete')
  .alias('rm')
  .alias('remove')
  .description('Delete a secret (aliases: rm, remove)')
  .argument('<name>', 'Secret name')
  .action(async (name: string) => {
    const { store } = await openStore({ promptForPassphrase: true });
    if (!(await withStoreErrors(() => store.has(name)))) {
      ui.warn(`Secret "${name}" not found.`);
      process.exit(1);
    }
    await withStoreErrors(() => store.delete(name));
    ui.ok(`Deleted secret ${ui.agent(name)}`);
  });

secretsCommand
  .command('migrate')
  .description('Re-encrypt the secrets store under a new passphrase (v1 → v2)')
  .addHelpText(
    'after',
    `
What 'migrate' does:
  - v1 store → decrypts with the legacy hostname-derived key, re-encrypts
    as v2 under a new passphrase (or under the labeled obfuscatedFallback
    if you supply an empty passphrase).
  - v2 obfuscatedFallback → decrypts with the legacy key, re-encrypts as
    v2 under the new passphrase.
  - v2 passphrase-protected → no-op with a confirmation message.

  Atomic: writes to a temp file and renames, so an interrupted migration
  leaves the original store intact.

Non-TTY / CI:
  Set SUA_SECRETS_PASSPHRASE to supply the new passphrase. The empty
  string keeps the legacy hostname-derived key (still v2 on disk, with
  obfuscatedFallback: true and loud warnings on every load).

Examples:
  $ sua secrets migrate                                   interactive
  $ SUA_SECRETS_PASSPHRASE=pp sua secrets migrate         non-TTY
`,
  )
  .action(async () => {
    const config = loadConfig();
    const path = getSecretsPath(config);
    const status = inspectSecretsFile(path);

    if (!status.exists) {
      ui.info('No secrets store to migrate.');
      return;
    }
    if (status.version === 2 && !status.obfuscatedFallback) {
      ui.ok('Secrets store is already v2 passphrase-protected. Nothing to migrate.');
      return;
    }

    const label =
      status.version === 1
        ? 'legacy v1'
        : 'v2 with hostname-obfuscated fallback';
    console.log(ui.dim(`Found ${label} secrets store at ${path}.`));
    console.log(
      ui.dim(
        'Re-encrypt under a new passphrase. Leave blank to keep the legacy hostname-derived key.',
      ),
    );

    const newPass = await promptNewPassphrase();

    // Reader uses legacy-fallback path because the file is currently
    // hostname-obfuscated (either v1 or v2-fallback). We decrypt with the
    // legacy seed, then write a fresh v2 under the chosen passphrase.
    const source = new EncryptedFileStore(path);
    const data = await withStoreErrors(() => source.getAll());

    // Atomic-ish: write to temp then rename. Fresh instance so the new
    // passphrase/mode takes effect instead of preserving the old payload.
    const tmpPath = `${path}.migrating`;
    const target = new EncryptedFileStore(tmpPath, {
      passphrase: newPass ?? undefined,
      allowLegacyFallback: newPass === undefined,
    });
    for (const [k, v] of Object.entries(data)) {
      await target.set(k, v);
    }
    const { renameSync } = await import('node:fs');
    renameSync(tmpPath, path);

    if (newPass === undefined) {
      ui.warn(
        'Re-wrote store with the legacy hostname-derived key. This is obfuscation, not encryption.',
      );
    } else {
      ui.ok(`Re-encrypted ${Object.keys(data).length} secret(s) under the new passphrase.`);
    }
  });

secretsCommand
  .command('check')
  .description('Show which secrets an agent needs and their status')
  .argument('<agent>', 'Agent name')
  .action(async (agentName: string) => {
    const config = loadConfig();
    const dirs = getAgentDirs(config);
    const { agents } = loadAgents({ directories: dirs.all });

    const agent = agents.get(agentName);
    if (!agent) {
      ui.fail(`Agent "${agentName}" not found.`);
      process.exit(1);
    }

    const declared = agent.secrets ?? [];
    if (declared.length === 0) {
      ui.info(`Agent "${agentName}" declares no secrets.`);
      return;
    }

    const { store } = await openStore();
    const table = new Table({ head: [chalk.bold('Secret'), chalk.bold('Status')] });

    for (const name of declared) {
      const has = await withStoreErrors(() => store.has(name));
      table.push([ui.agent(name), has ? chalk.green('set') : chalk.red('missing')]);
    }
    console.log(table.toString());
  });

/**
 * Prompt the user for a new passphrase with confirmation. Returns undefined
 * if the user submits an empty passphrase (meaning: use legacy fallback).
 * Loops on confirmation mismatch up to 3 attempts.
 */
async function promptNewPassphrase(): Promise<string | undefined> {
  // Non-TTY: never prompt; honor env var or error.
  if (!process.stdin.isTTY) {
    const envPass = process.env.SUA_SECRETS_PASSPHRASE;
    if (envPass === undefined) {
      ui.fail(
        'Non-interactive context: set SUA_SECRETS_PASSPHRASE to provide a passphrase ' +
          '(or set it to the empty string to explicitly choose the legacy fallback).',
      );
      process.exit(1);
    }
    return envPass.length > 0 ? envPass : undefined;
  }

  console.log(
    ui.dim(
      'Set a passphrase to encrypt the secrets store. Leave blank to fall back to the ' +
        'legacy hostname-derived key (obfuscation, not encryption).',
    ),
  );

  for (let attempt = 0; attempt < 3; attempt++) {
    const first = await readHiddenLine('Passphrase (leave blank for legacy): ');
    if (first.length === 0) return undefined;
    const second = await readHiddenLine('Confirm:                             ');
    if (first === second) return first;
    ui.warn("Passphrases didn't match. Try again.");
  }
  ui.fail('Too many passphrase mismatches. Aborting.');
  process.exit(1);
}

async function promptExistingPassphrase(path: string): Promise<string> {
  const pass = await readHiddenLine(`Enter passphrase for ${path}: `);
  if (pass.length === 0) {
    ui.fail('Empty passphrase rejected for passphrase-protected store.');
    process.exit(1);
  }
  return pass;
}

async function readHiddenLine(prompt: string): Promise<string> {
  process.stdout.write(chalk.dim(prompt));

  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const stdin = process.stdin as NodeJS.ReadStream & { setRawMode?: (m: boolean) => void };
    stdin.setRawMode?.(true);

    let value = '';
    const onData = (chunk: Buffer) => {
      const str = chunk.toString('utf-8');
      for (const ch of str) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode?.(false);
          stdin.removeListener('data', onData);
          rl.close();
          process.stdout.write('\n');
          resolve(value);
          return;
        } else if (ch === '\x03') {
          process.exit(130);
        } else if (ch === '\x7f') {
          value = value.slice(0, -1);
        } else {
          value += ch;
        }
      }
    };
    stdin.on('data', onData);
  });
}

/**
 * Wrap store operations so encryption/passphrase errors become one-line
 * `ui.fail` messages instead of stack traces.
 */
async function withStoreErrors<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (err) {
    ui.fail((err as Error).message);
    process.exit(1);
  }
}

async function promptSecret(name: string): Promise<string> {
  // Support piped input (echo "val" | sua secrets set KEY)
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks).toString('utf-8').trim();
  }

  return readHiddenLine(`Enter value for ${name} (input hidden): `);
}
