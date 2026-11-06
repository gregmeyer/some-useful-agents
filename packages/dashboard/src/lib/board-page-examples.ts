/**
 * Example boards, for checking that each still gets a page that fits it
 * (lib/board-page-examples.test.ts on every change, with the page agent's
 * recorded answers in fixtures/board-pages/answers.json). Each is set up as
 * a built board is: its agents with a tile signal and one completed run
 * whose result has the fields a real one has. Names and values are
 * invented; the shapes are the live Morning Brief's.
 */
import type { AgentStore, RunStore } from '@some-useful-agents/core';

export interface BoardPageExample {
  id: string;
  name: string;
  /** What the board was built for. */
  about: string;
  /** The page it should get: the front page, or one drawn for it. */
  expect: { page: 'grid' | 'front-page' | 'drawn'; lede?: string; rail?: string[] };
  /** Make its agents and their runs in the stores; returns the agent ids in the board's order. */
  seed: (agents: AgentStore, runs: RunStore) => string[];
}

const AT = '2026-11-06T15:00:00.000Z';

function agentWithRun(agents: AgentStore, runs: RunStore, id: string, title: string, signal: Record<string, unknown>, result: Record<string, unknown> | undefined): void {
  agents.createAgent({ id, name: title, status: 'active', source: 'local', mcp: false, nodes: [{ id: 'n', type: 'shell', command: 'echo' }], signal: { title, template: 'widget', ...signal } } as never, 'cli');
  if (!result) return;
  const text = JSON.stringify(result);
  runs.createRun({ id: `run-${id}`, agentName: id, status: 'completed', startedAt: AT, completedAt: AT, result: text, triggeredBy: 'cli' } as never);
  runs.createNodeExecution({ runId: `run-${id}`, nodeId: 'n', workflowVersion: 1, status: 'completed', startedAt: AT, completedAt: AT, result: text, outputsJson: JSON.stringify({ result: text }) } as never);
}

export const BOARD_PAGE_EXAMPLES: readonly BoardPageExample[] = [
  {
    id: 'morning-brief',
    name: 'Morning Brief',
    about: 'A morning front page with local headlines, weather, markets, sports, and national and world news',
    expect: { page: 'drawn', lede: 'world-news-brief', rail: ['weather-forecast', 'markets-today'] },
    seed(agents, runs) {
      agentWithRun(agents, runs, 'world-news-brief', 'World News', { icon: 'newspaper', size: '2x2' }, {
        lead_headline: 'Council approves the harbour plan after a year of hearings',
        lead_summary: 'The vote ends a long dispute over the waterfront; work starts in the spring.',
        national: [{ headline: 'Rates held steady', source: 'Wire', published: AT, brief: 'No change this quarter.' }],
        world: [{ headline: 'Talks resume', source: 'Wire', published: AT, brief: 'A second round next week.' }],
        coverage_note: 'Verified against publisher pages.',
      });
      agentWithRun(agents, runs, 'two-step-digest', 'Daily Digest', { icon: '📰', size: '2x1' }, {
        headlines: Array.from({ length: 10 }, (_, i) => ({ title: `Headline ${String(i + 1)}`, source: 'Example', category: i % 2 ? 'science' : 'tech' })),
        count: 10, summary: '10 headlines loaded.', note: '',
      });
      agentWithRun(agents, runs, 'weather-forecast', 'Weather', { size: '2x1', accent: 'blue' }, {
        temperature: '53°F', feels_like: '50°F', condition: 'Patchy rain nearby', humidity: 76, wind: '6 mph SSW', uv_index: 1, precipitation_chance: 29, sunrise: '07:00 AM', sunset: '04:45 PM', location: 'Example, WA',
        day_0: 'Thu — H 57° L 45°', day_1: 'Fri — H 55° L 44°',
      });
      agentWithRun(agents, runs, 'markets-today', 'Markets', { template: 'comparison', size: '2x1' }, {
        headline: 'Markets', summary: 'NASDAQ -1.2%, DOW -0.4%', as_of: AT, market_status: 'after-hours', trend: 'down',
        nasdaq_change_pct: -1.2, dow_change_pct: -0.4, nasdaq_7d_line: '█▆▄▃▄▅▁', dow_7d_line: '▄▄▁▂▂█▁', nasdaq_summary: '-1.2%', dow_summary: '-0.4%',
        indices: [{ name: 'NASDAQ', change: -1.2 }, { name: 'DOW', change: -0.4 }], indices_display: 'NASDAQ -1.2% · DOW -0.4%',
      });
      agentWithRun(agents, runs, 'multi-sport-scoreboard', 'Sports Scoreboard', { icon: 'trophy', size: '2x1', accent: 'blue' }, {
        headline: 'Scores', summary: '0 live, 27 upcoming', generated_at: AT, score_date: '2026-11-06', timezone: 'EST',
        game_count: 27, displayed_count: 24, live_count: 0, final_count: 0, scheduled_count: 27, requested_count: 6, fetched_count: 6, failed_count: 0,
        leagues: ['NBA', 'NHL'], rows: [{ league: 'NBA', matchup: 'A 0 @ B 0', status: '7:00 PM', league_key: 'nba', link: 'https://example.com/g/1' }], failed_feeds: [], selected_game: {},
      });
      return ['two-step-digest', 'weather-forecast', 'markets-today', 'multi-sport-scoreboard', 'world-news-brief'];
    },
  },
];
