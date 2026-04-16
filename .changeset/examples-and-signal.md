---
"@some-useful-agents/core": minor
---

**feat: Pulse signal type + 7 curated example agents (docs sweep PR 1).**

Adds the `AgentSignal` type (title, icon, format, field, refresh, size) to the Agent interface and Zod schema. Each agent can optionally declare a `signal:` block that defines how its output renders on the `/pulse` dashboard (the agent info radiator — page itself ships later in the dashboard revamp).

Ships 7 curated v2 example agents that tell a tutorial narrative ("Build a daily briefing system"), replacing the 3 minimal v1 examples:

1. **hello** — first agent, proves install works
2. **two-step-digest** — 2-node DAG, teaches dependsOn + upstream passing
3. **daily-greeting** — cron scheduling
4. **parameterised-greet** — inputs with defaults (shell + claude-code companion)
5. **conditional-router** — flow control: conditional + onlyIf + branch merge
6. **research-digest** — agent-invoke + loop (nested flows)
7. **daily-joke** — real HTTP via http-get tool (icanhazdadjoke.com, the only example with network)

Each example has a `signal:` block, a header comment explaining what it teaches, and a run command. All offline examples use mock data from `agents/examples/data/`.
