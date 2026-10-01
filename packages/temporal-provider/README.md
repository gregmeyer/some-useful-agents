# @some-useful-agents/temporal-provider

Temporal worker for some-useful-agents. Provides durable workflow execution as an alternative to the default local provider.

## When to use

- **Local provider** (default) — runs agents in-process. Good for development, single-machine deployments, and most use cases.
- **Temporal provider** — runs agents as Temporal workflows. Use when you need durable execution, retries, visibility, and multi-machine orchestration.

## Setup

Requires a running Temporal server (Docker recommended):

```bash
docker compose up -d  # starts Temporal server
sua worker start      # starts the Temporal worker
```

Configure in `sua.config.json`:

```json
{
  "provider": "temporal",
  "temporalAddress": "localhost:7233",
  "temporalNamespace": "default",
  "temporalTaskQueue": "sua-agents"
}
```

Workers use the same providers (including custom OpenAI-compatible ones), tools, tool policies and memory as local runs, reading LLM settings from the worker's data directory. `sua daemon` can run the worker as a service.

See the [main repo README](https://github.com/gregmeyer/some-useful-agents) and [docs/temporal.md](https://github.com/gregmeyer/some-useful-agents/blob/main/docs/temporal.md) for full documentation.

## License

MIT
