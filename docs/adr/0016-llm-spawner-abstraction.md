# ADR-0016: LlmSpawner abstraction for multi-provider CLI support

## Status
Accepted

## Context
The DAG executor hardcoded `claude --print` for all claude-code nodes. Adding support for Codex, Gemini, or other LLM CLIs required touching the spawn path, and there was no way to stream real-time turn progress during multi-turn execution. The executor was also 1482 lines handling too many concerns.

## Decision
Split the executor into 6 focused modules and introduce an `LlmSpawner` interface in `node-spawner.ts`:

```typescript
interface LlmSpawner {
  binary: string;
  buildArgs(opts): string[];
  parseProgress(line: string): SpawnProgress | null;
  extractResult(stdout: string): string;
}
```

Built-in implementations: `claudeSpawner` (stream-json mode with structured turn tracking), `claudeTextSpawner` (legacy text mode), `codexSpawner`. Nodes select their provider via a `provider` field (`claude` | `codex`).

The Claude spawner uses `--output-format stream-json --verbose` for line-by-line JSON events. Each event is parsed for turn boundaries and written to a `progressJson` column on `node_executions`, which the dashboard polls.

## Consequences
- Adding a new LLM CLI is ~30 lines (implement the interface)
- Real-time turn progress in the dashboard (no more time-based guesses)
- `progressJson` writes per-event to SQLite, which is slightly more I/O than batching
- Stream-json mode requires `--verbose` flag, adding some output overhead
- The file split means more imports but each module is <350 lines and testable in isolation
