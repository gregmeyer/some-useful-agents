# Contributing to some-useful-agents

We welcome contributions. Whether it's a new agent, a bug fix, or a feature, here's how to get involved.

## Contributing an agent

Agents are YAML files in the `agents/community/` directory. To contribute one:

1. Fork the repo
2. Create a YAML file in `agents/community/`
3. Open a PR

### Agent YAML schema

```yaml
# Required fields
name: my-agent              # unique slug, lowercase, hyphens only
description: What it does   # one-line description
type: shell                 # "shell" or "claude-code"

# For shell agents
command: "echo hello"       # the shell command to run

# For claude-code agents
prompt: "Do something"      # the prompt to send to Claude
model: claude-sonnet-4-20250514  # optional, defaults to claude-sonnet-4-20250514
maxTurns: 10                # optional, max conversation turns
allowedTools: []            # optional, Claude Code tool allowlist

# Common fields
timeout: 300                # seconds, default 300
env:                        # optional environment variables
  MY_VAR: "value"
schedule: "0 9 * * *"      # optional cron expression
workingDirectory: "."       # optional, defaults to repo root

# Chaining (Phase 2a)
dependsOn: [other-agent]    # optional, agents that must run first
input: "{{outputs.other-agent.result}}"  # optional, template for piping

# Metadata (required for community agents)
author: your-github-handle
version: "1.0.0"
tags: [category, keyword]
```

### Requirements for community agents

- `name` must be unique across all agents in the repo
- `author` must be your GitHub handle
- `version` must follow semver
- `tags` must include at least one descriptive tag
- Shell commands must not be destructive (no `rm -rf`, no `sudo`)
- Agent must include a `description` explaining what it does and why

### Security review checklist

All community agent PRs are reviewed for security before merge:

- [ ] Shell commands are non-destructive and don't require elevated permissions
- [ ] No hardcoded secrets, API keys, or credentials
- [ ] No network calls to untrusted endpoints
- [ ] No file writes outside the working directory
- [ ] Claude-code prompts don't instruct the model to bypass safety guardrails
- [ ] Timeout is set to a reasonable value (not > 600s without justification)

Shell agents from the community catalog run in a Docker sandbox with restricted permissions.

## Contributing code

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run tests: `npm test`
5. Run the build: `npm run build`
6. Open a PR against `main`

### Development setup

```bash
git clone https://github.com/gregmeyer/some-useful-agents.git
cd some-useful-agents
nvm use           # uses Node 22 from .nvmrc
npm install
npm run build
npm test
```

### Code style

- TypeScript strict mode
- Explicit over clever
- Tests for every new codepath
- No `any` types without justification
