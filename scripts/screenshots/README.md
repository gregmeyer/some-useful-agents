# Screenshots

The images in `docs/images/` come from made-up fixture data, never a real
install: no names, no real listings, no machine, git or account details.
`seed.mjs` builds that fixture as a fresh sua project.

## Regenerate

```sh
npm run build
node scripts/screenshots/seed.mjs /tmp/sua-screens
cd /tmp/sua-screens
node <repo>/packages/cli/dist/index.js schedule start &                     # so the scheduler shows as running
node <repo>/packages/cli/dist/index.js dashboard start --port 3099 --provider local
```

Sign in at `http://127.0.0.1:3099/auth` with your dashboard token, use dark
mode, dismiss the intro hints ("Got it"), and capture at **1280×720**:

| File | Page | Notes |
| --- | --- | --- |
| `home.png` | `/` | |
| `notebook.png` | `/notebooks/buy-a-used-hatchback-for-commuting` | |
| `drawer.png` | the same notebook | click **Continue the conversation**, then scroll to the top |
| `new-notebook.png` | `/notebooks/new` | the suggestion pills are seeded |
| `new-notebook-draft.png` | `/notebooks/new` | type a made-up sentence ("A quiet two-bedroom rental near downtown, under $2,400 a month, pets allowed, moving by December 1."), **Draft it**, scroll to the draft (needs a model) |
| `pulse.png` | `/pulse` | six tiles are placed |
| `agents-list.png` | `/agents?tab=examples` | |
| `scheduled.png` | `/scheduled` | |
| `agent-overview.png` | `/agents/daily-summary` | |
| `agent-config.png` | `/agents/daily-summary/config` | |
| `run-detail.png` | a `two-step-digest` run (`/runs`) | |
| `appearance.png` | `/settings/appearance` | two brands are seeded |

The seed runs only example agents that work offline and print nothing
personal (`system-health` and `git-activity` are left out on purpose: they
read your machine and your git history). Before committing new shots, look
at each one for anything that isn't fixture data.
