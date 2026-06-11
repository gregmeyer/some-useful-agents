import { Command } from 'commander';
import {
  ensureAppleRunner,
  runAppleSubcommand,
  isAppleIntegrationEnabled,
  IntegrationsStore,
  type AppleSnapshot,
} from '@some-useful-agents/core';
import { loadConfig, getDbPath } from '../config.js';
import * as ui from '../ui.js';

const SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * `sua apple` — manage the macOS Apple Reminders/Notes integration.
 *
 * The `authorize` subcommand is the deliberate foreground moment for granting
 * macOS privacy access. TCC prompts attribute to the spawning process and a
 * headless daemon's prompt is silently denied, so the owner runs this once
 * from a Terminal: it compiles the runner, then makes a real Reminders call
 * (triggering the Reminders prompt) and a Notes call (triggering the
 * Automation prompt) so the dialogs actually appear.
 */
export const appleCommand = new Command('apple').description(
  'macOS Apple Reminders/Notes integration (experimental, macOS-only)',
);

appleCommand
  .command('authorize')
  .description('Grant macOS Reminders + Notes access by triggering the permission prompts (run from a Terminal)')
  .action(async () => {
    if (!isAppleIntegrationEnabled()) {
      ui.warn('The Apple integration is experimental and currently disabled.');
      console.log(
        ui.dim(
          '  Enable it with `experimental.apple: true` in sua.config.json or `export SUA_EXPERIMENTAL_APPLE=1`.\n' +
            '  You can still grant permissions now — they take effect once enabled.\n',
        ),
      );
    }

    const handle = ensureAppleRunner();
    if (handle.status !== 'ready') {
      ui.fail(`Cannot build the Apple runner: ${handle.message ?? handle.status}`);
      process.exit(1);
    }

    ui.info('Requesting Reminders access — approve the macOS dialog if it appears…');
    try {
      const rem = await runAppleSubcommand(handle.binaryPath, 'reminder-read', { limit: 1 }, { timeoutSec: 120 });
      if (rem.status === 'ok') ui.ok('Reminders: access granted.');
      else ui.fail(`Reminders: ${rem.errorMessage ?? rem.status}`);
    } catch (err) {
      ui.fail(`Reminders: ${(err as Error).message}`);
    }

    ui.info('Requesting Notes (Automation) access — approve the macOS dialog if it appears…');
    try {
      const notes = await runAppleSubcommand(handle.binaryPath, 'lists', {}, { timeoutSec: 120 });
      if (notes.status === 'ok') {
        const data = (notes.data ?? {}) as { note_folders?: unknown[] };
        const folderCount = Array.isArray(data.note_folders) ? data.note_folders.length : 0;
        ui.ok(`Notes: access granted (${folderCount} folder${folderCount === 1 ? '' : 's'} visible).`);
      } else {
        ui.fail(`Notes: ${notes.errorMessage ?? notes.status}`);
      }
    } catch (err) {
      ui.fail(`Notes: ${(err as Error).message}`);
    }

    console.log(
      ui.dim(
        '\nIf a bucket shows denied, grant it in System Settings → Privacy & Security ' +
          '(Reminders, and Automation → Notes), then re-run `sua apple authorize`.',
      ),
    );
    console.log(ui.dim('Next: `sua apple connect` (in this same Terminal) to register the integration.'));
  });

appleCommand
  .command('connect')
  .description('Register the Apple integration (introspects your lists/folders). Run in a granted Terminal.')
  .option('--id <slug>', 'Integration id slug', 'apple')
  .option('--name <name>', 'Display name', 'Apple')
  .action(async (options: { id: string; name: string }) => {
    if (!isAppleIntegrationEnabled()) {
      ui.fail('The Apple integration is experimental and disabled.');
      console.log(ui.dim('  Enable it with `experimental.apple: true` in sua.config.json or `export SUA_EXPERIMENTAL_APPLE=1`.'));
      process.exit(1);
    }
    const slug = options.id.trim();
    if (!SLUG_RE.test(slug)) {
      ui.fail('ID must be lowercase letters/digits/dashes/underscores, starting with a letter or digit.');
      process.exit(1);
    }

    const handle = ensureAppleRunner();
    if (handle.status !== 'ready') {
      ui.fail(`Apple runner unavailable: ${handle.message ?? handle.status}`);
      process.exit(1);
    }

    // Introspect HERE (in the user's granted Terminal) — the dashboard daemon
    // usually lacks Reminders access, so `lists` must run from a granted process.
    ui.info('Reading your reminder lists and note folders…');
    let snapshot: AppleSnapshot;
    try {
      const res = await runAppleSubcommand(handle.binaryPath, 'lists', {}, { timeoutSec: 120 });
      if (res.status !== 'ok') {
        ui.fail(`Could not read Reminders/Notes: ${res.errorMessage ?? res.status}`);
        console.log(ui.dim('  Run `sua apple authorize` in this Terminal first, then retry.'));
        process.exit(1);
      }
      const data = (res.data ?? {}) as { reminder_lists?: { id: string; title: string }[]; note_folders?: { id: string; name: string }[] };
      snapshot = {
        reminderLists: Array.isArray(data.reminder_lists) ? data.reminder_lists : [],
        noteFolders: Array.isArray(data.note_folders) ? data.note_folders : [],
        introspectedAt: new Date().toISOString(),
      };
    } catch (err) {
      ui.fail(`Could not reach the Apple runner: ${(err as Error).message}`);
      process.exit(1);
    }

    const config = loadConfig();
    const store = new IntegrationsStore(getDbPath(config));
    try {
      const id = `user:${slug}`;
      store.upsertIntegration({ id, packId: null, kind: 'apple', name: options.name, config: { schema: snapshot }, secretRefs: [] });
      ui.ok(`Connected Apple integration "${id}".`);
      console.log(ui.dim(`  ${snapshot.reminderLists.length} reminder list(s): ${snapshot.reminderLists.map((l) => l.title).join(', ') || '(none)'}`));
      console.log(ui.dim(`  ${snapshot.noteFolders.length} note folder(s): ${snapshot.noteFolders.map((f) => f.name).join(', ') || '(none)'}`));
      console.log('');
      console.log(`Tools now available: ${ui.cmd(`apple.${slug}.reminder-create`)}, ${ui.cmd(`apple.${slug}.reminder-read`)}, ${ui.cmd(`apple.${slug}.reminder-update`)}, ${ui.cmd(`apple.${slug}.note-create`)}, ${ui.cmd(`apple.${slug}.note-read`)}`);
      console.log(ui.dim('Run an agent from this Terminal with `SUA_PROVIDER=local` so reminder writes have access.'));
    } catch (err) {
      ui.fail(err instanceof Error ? err.message : String(err));
      process.exit(1);
    } finally {
      store.close();
    }
  });
