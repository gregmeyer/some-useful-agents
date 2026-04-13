/**
 * Shared visual helpers for all `sua` CLI commands. One voice, one look.
 *
 * Every command should route its success/error/warning/info through these
 * helpers rather than reaching for `chalk.green` / `chalk.red` inline.
 * This keeps the CLI consistent as it grows and makes future changes
 * (theming, `--no-color`, `--quiet`) a one-file edit.
 *
 * Pure aside from writes to `process.stdout` / `process.stderr` via
 * `console.log` / `console.error`.
 */

import chalk from 'chalk';
import boxen from 'boxen';
import type { RunStatus } from '@some-useful-agents/core';

// ── Symbols ──────────────────────────────────────────────────────────────
// Unicode-with-variation-selector emoji. Renders as pictograph on modern
// terminals; widely supported. The one outlier we accept is old tmux
// (<2.2) rendering ⚠️ with the wrong width.

export const SYMBOLS = {
  ok: '✅',
  fail: '❌',
  warn: '⚠️ ',
  info: '💡',
  step: '🚀',
} as const;

// ── Status coloring (shared across status, schedule, doctor) ─────────────
// Moved here from commands/status.ts so every surface that displays a run
// status picks the same color.

export const STATUS_COLORS: Record<RunStatus, (s: string) => string> = {
  completed: chalk.green,
  running: chalk.blue,
  pending: chalk.yellow,
  failed: chalk.red,
  cancelled: chalk.gray,
};

export function colorStatus(status: RunStatus): string {
  const colorize = STATUS_COLORS[status] ?? chalk.white;
  return colorize(status);
}

// ── Line-level helpers ───────────────────────────────────────────────────

/** Success line. Goes to stdout. */
export function ok(message: string): void {
  console.log(`${SYMBOLS.ok}  ${chalk.green(message)}`);
}

/** Failure line. Goes to stderr so callers can redirect and get clean stdout. */
export function fail(message: string): void {
  console.error(`${SYMBOLS.fail}  ${chalk.red(message)}`);
}

/** Warning. Stderr. */
export function warn(message: string): void {
  console.error(`${SYMBOLS.warn} ${chalk.yellow(message)}`);
}

/** Informational note. Stdout. */
export function info(message: string): void {
  console.log(`${SYMBOLS.info}  ${chalk.cyan(message)}`);
}

/**
 * A "next step" suggestion: one-liner command + dim description.
 * Used in `sua init`, `sua agent new`, `sua tutorial` outros.
 */
export function step(command: string, description?: string): void {
  const cmdPart = chalk.cyan(command.padEnd(30));
  const descPart = description ? chalk.dim(description) : '';
  console.log(`  ${SYMBOLS.step} ${cmdPart}${descPart}`);
}

// ── Structural helpers ───────────────────────────────────────────────────

/** Section heading with blank lines above and below. Bold. */
export function section(title: string): void {
  console.log('');
  console.log(chalk.bold(title));
  console.log('');
}

/**
 * Boxed banner for daemon startup (MCP server, scheduler, Temporal worker).
 * Title is bold cyan; body lines are dim. Border is single-line cyan.
 */
export function banner(title: string, lines: string[] = []): void {
  const body = [
    chalk.bold.cyan(title),
    ...(lines.length > 0 ? [''] : []),
    ...lines.map(l => chalk.dim(l)),
  ].join('\n');
  console.log(
    boxen(body, {
      padding: { top: 0, bottom: 0, left: 2, right: 2 },
      margin: { top: 1, bottom: 1, left: 0, right: 0 },
      borderStyle: 'round',
      borderColor: 'cyan',
    }),
  );
}

/**
 * Wrap an agent's captured stdout (or logs) in a framed box so it's
 * visually distinct from sua's own output. Used by `sua agent run` and
 * `sua agent logs`.
 */
export function outputFrame(body: string): void {
  if (!body || !body.trim()) {
    console.log(chalk.dim('(no output)'));
    return;
  }
  const trimmed = body.trimEnd();
  console.log(chalk.dim('╭── output ──'));
  for (const line of trimmed.split('\n')) {
    console.log(chalk.dim('│ ') + line);
  }
  console.log(chalk.dim('╰────────────'));
}

/**
 * Key/value row — two dim columns. Replaces the ad-hoc `padEnd(18)` we
 * had in `sua agent audit`.
 */
export function kv(label: string, value: string, labelWidth = 18): void {
  console.log(`  ${chalk.dim(label.padEnd(labelWidth))} ${value}`);
}

// ── Inline helpers (return a string, don't print) ────────────────────────
// For use inside larger composed messages.

/** Format an agent name consistently everywhere. Cyan + bold. */
export function agent(name: string): string {
  return chalk.cyan.bold(name);
}

/** Format an inline CLI command reference. Plain cyan. */
export function cmd(command: string): string {
  return chalk.cyan(command);
}

/** Format a dim / secondary value. Re-exported for consistency. */
export function dim(text: string): string {
  return chalk.dim(text);
}

/** Format an ID, hex digest, or similar short opaque reference. Dim. */
export function id(value: string): string {
  return chalk.dim(value);
}
