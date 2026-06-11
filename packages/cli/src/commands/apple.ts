import { Command } from 'commander';
import { ensureAppleRunner, runAppleSubcommand, isAppleIntegrationEnabled } from '@some-useful-agents/core';
import * as ui from '../ui.js';

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
  });
