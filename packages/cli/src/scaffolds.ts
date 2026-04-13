/**
 * Inline YAML templates for `sua init` and `sua tutorial` scaffolding.
 * Kept here rather than shipping agents/examples/ files in the npm package
 * because the CLI `files` field lists only `dist`. Embedding keeps the package
 * small and avoids a post-install copy step.
 */

export const HELLO_AGENT_YAML = `name: hello
description: Your first sua agent — prints a greeting
type: shell
command: "echo 'Hello from some-useful-agents!'"
timeout: 10
tags: [starter]
`;

export const DAD_JOKE_AGENT_YAML = `name: dad-joke
description: Fetch a dad joke from icanhazdadjoke.com
type: shell
command: "curl -s -H 'Accept: text/plain' https://icanhazdadjoke.com/"
timeout: 10
tags: [example, http]
`;

/** Schedule line to append to the dad-joke YAML when the user opts in. */
export const DAILY_9AM_SCHEDULE = `schedule: "0 9 * * *"\n`;
