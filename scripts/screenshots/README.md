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
mode, dismiss the intro hints ("Got it"), close the conversation panel (it
follows you from page to page), and capture the window at **1280×720**:

| File | Page | Notes |
| --- | --- | --- |
| `home.png` | `/` | |
| `notebook.png` | `/notebooks/buy-a-used-hatchback-for-commuting` | |
| `drawer.png` | the same notebook | click **Continue the conversation**, then scroll to the top; take it last (the panel stays open) |
| `meeting-briefing.png` | `/notebooks/prepare-for-a-meeting-with-dana-reyes` | scrolled to the page body (Who they are) |
| `notebook-add-file.png` | the same notebook | open **Add a file or paste** and type a name |
| `new-notebook.png` | `/notebooks/new` | the suggestion pills and two templates are seeded |
| `new-notebook-draft.png` | `/notebooks/new` | type a made-up sentence ("A quiet two-bedroom rental near downtown, under $2,400 a month, pets allowed, moving by December 1."), **Draft it**, scroll to the draft (needs a model) |
| `pulse.png` | `/pulse` | Today's edition, from the seeded runs |
| `pulse-agents.png` | `/pulse/agents` | six tiles are placed |
| `experiment.png` | `/experiments/does-the-new-digest-find-different-headl` | results are seeded |
| `experiment-new.png` | `/experiments/new` | |
| `agents-list.png` | `/agents?tab=examples` | |
| `scheduled.png` | `/scheduled` | |
| `agent-overview.png` | `/agents/daily-summary` | |
| `agent-config.png` | `/agents/daily-summary/config` | |
| `run-detail.png` | a `two-step-digest` run (`/runs`) | |
| `appearance.png` | `/settings/appearance` | two brands are seeded |
| `settings-files.png` | `/settings/general` | only the **Files sua takes** card: the **Paths** card below it shows your home folder, so leave it out of the picture |

**Pictures.** A notebook's page looks for example photos on the web the first
time it is opened. Those are real photos, so put the drawn illustration back
before capturing (wait until the page stops saying it is getting photos):

```sh
sqlite3 /tmp/sua-screens/data/runs.db "update notebook_photos set kind='illustration', source_url='illustration', content_type='image/svg+xml', bytes=cast('<svg xmlns=\"http://www.w3.org/2000/svg\"/>' as blob), tried_url=null where kind<>'illustration'"
```

**Not retaken by this seed.** The step and fix pictures (`notebook-steps*.png`,
`notebook-step-move-on.png`, `notebook-source-step-facts.png`,
`new-notebook-steps.png`, `agent-fix-calls-agent.png`,
`agent-build-and-wire.png`) each need a notebook or a conversation caught
mid-step; they date from October 2026.

The seed runs only example agents that work offline and print nothing
personal (`system-health` and `git-activity` are left out on purpose: they
read your machine and your git history). Before committing new shots, look
at each one for anything that isn't fixture data.
