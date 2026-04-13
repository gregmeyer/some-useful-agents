/**
 * Filter known-noise Node warnings so the CLI output stays clean.
 *
 * This MUST be imported as the first line of index.ts. ESM evaluates imports
 * in the source order of the importing module; registering the listener here
 * before any other import ensures it's attached before `node:sqlite` (loaded
 * transitively via @some-useful-agents/core) fires its experimental warning.
 *
 * Node 22.x emits ExperimentalWarning for the built-in sqlite module. In
 * Node 24+ sqlite is stable and this filter becomes a no-op. Keep until the
 * project raises its minimum Node version.
 *
 * Other warnings pass through untouched so real issues still surface.
 */

const shouldSuppress = (warning: Error): boolean => {
  return warning.name === 'ExperimentalWarning' && /SQLite/.test(warning.message);
};

// Replace Node's default warning listener (which always prints) with a
// filtered one. We remove ALL existing listeners first so the default
// doesn't also run alongside ours.
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (shouldSuppress(warning)) return;
  process.stderr.write(`(node:${process.pid}) ${warning.name}: ${warning.message}\n`);
  if (warning.stack) {
    process.stderr.write(`${warning.stack}\n`);
  }
});
