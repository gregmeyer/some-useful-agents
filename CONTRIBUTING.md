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
6. **Add a changeset** if your change affects any published package: `npx changeset`
7. Open a PR against `main`

### Changesets

We use [changesets](https://github.com/changesets/changesets) for version management.
When you change code in any `packages/*` directory, add a changeset:

```bash
npx changeset
```

This prompts you to:
1. Select which packages are affected (all ours version together, so pick any)
2. Choose bump type (patch / minor / major)
3. Write a one-line summary of what changed

The changeset is a markdown file in `.changeset/` that gets committed with your PR.
When PRs are merged to `main`, a bot opens a "Release" PR that aggregates all pending
changesets. Merging that Release PR then triggers a publish — but the publish step
is gated behind a GitHub Environment (`npm-publish`) that requires a maintainer to
approve the run before anything is pushed to npm.

### Publishing (maintainers only)

The `npm-publish` GitHub Environment has required reviewers. When a Release PR is
merged, the release workflow pauses and waits for a maintainer to approve the run
in the Actions tab before executing `npx changeset publish`. This prevents accidental
or malicious publishes.

We use **npm Trusted Publishing (OIDC)** — no NPM_TOKEN secret exists anywhere in
the repo. GitHub Actions exchanges a short-lived OIDC token directly with npm to
authenticate. If CI is compromised, there is no long-lived credential to exfiltrate.

To set this up on a fresh fork:

**1. GitHub side:**
- Settings → Environments → New environment → name it `npm-publish`
- Add required reviewers (maintainers who can approve releases)
- No secrets needed — the workflow uses `id-token: write` permission

**2. npm side (do this for EACH package — core, cli, mcp-server, temporal-provider, dashboard):**

You'll need to publish the package once manually first (one-time bootstrapping) so
it exists in the npm registry:

```bash
cd packages/core
npm publish --access public
```

Then configure the trusted publisher:
- Go to https://www.npmjs.com/package/@some-useful-agents/<package>/access
- Scroll to "Trusted Publisher"
- Click "GitHub Actions"
- Organization or user: `gregmeyer`
- Repository: `some-useful-agents`
- Workflow filename: `release.yml`
- Environment: `npm-publish`

After that, all subsequent publishes happen automatically through the workflow
with provenance attestations, and no one can publish these packages except via
that exact workflow from the `npm-publish` environment.

### Development setup

```bash
git clone https://github.com/gregmeyer/some-useful-agents.git
cd some-useful-agents
nvm use           # uses Node 22 from .nvmrc
npm install
npm run build
npm test
```

**`npm run build` is the type-check.** This is an npm-workspaces monorepo wired with TypeScript
project references, so the root `tsconfig.json` has `"files": []` and delegates to the packages.
That means a plain `tsc --noEmit` visits **zero files** and passes on anything — `npm run lint` is
therefore `tsc --build`, the same command, because composite references have to emit declarations
for downstream projects to check against. If a change type-checks locally but you skipped the
build, you have not type-checked it.

### Updating an install that runs from a checkout

If your daily install is a checkout of `main`, update it with `scripts/live-update.sh` (`--force` rebuilds even when it's already current). The script:
1. stops if any run or notebook step is in progress, or if the checkout has local changes;
2. backs up the databases as `*.db.bak-YYYYMMDD-HHMMSS`;
3. fast-forwards to `origin/main` and does a clean build;
4. prunes old backups and update logs;
5. restarts the daemon.

Pruning is `sua backups prune`: it keeps the newest 5 backup sets, plus the newest set from each of the last 7 days. A backup with any other name, such as `runs.db.bak-before-migration`, is never deleted. Use `--dry-run` to see what it would remove.

### Dashboard tests

Build a test dashboard with `createTestContext()` from `packages/dashboard/src/test-harness.ts`, and tear it down with `closeTestContext()` in `afterEach`.

- **Teardown order:** the harness waits for the work the test's routes started (Run now, triage, anything launched through `inBackground`), then closes the stores. Work still running at teardown fails that test, with its label.
- **When teardown fails:** stub the work with the context's `*Run` stand-ins, or wait for it in the test. Don't raise the timeout.
- **No real model runs in tests:** the harness leaves `ctx.live` unset, so the queue watchers don't start and system agents don't run a model.
- **Don't check for the test runner in shipped code:** use `ctx.live`, or a `ctx.*Run` stand-in that tests can set, instead of `process.env.VITEST`.

### Code style

- TypeScript strict mode
- Explicit over clever
- Tests for every new codepath
- No `any` types without justification
