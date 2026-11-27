---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Pictures an agent makes show in the conversation and can be added to an answer.

A tool server running in Docker saves inside its container, so Graphics creator's artboards never reached sua: the run said it worked, but nothing could show the file. sua now reads the folders a Docker server shares from its own `docker run` command and opens a path the server reports from the matching folder here (pictures, pages and PDFs only), and Graphics creator and Chart creator save into that shared `output` folder by default. A finished run's picture shows inline in the conversation with **Add this picture to [answer]**, the conversation's answer first. Adding it keeps a copy in the answer, as a note, and the answer's page shows it under **Pictures** in any layout. A picture left inside the container is said plainly, with its path, instead of a broken image. Graphics creator also picks its layout from the topic now (`auto`, the new default: a numbered grid for steps or panels, a timeline for dates, hero otherwise), and the shipped agent lists the graphics tools it calls.

Docker-run tool servers no longer pile up containers. sua closes a server it hasn't used for 10 minutes (its `--rm` container goes with whatever was saved inside it; the next call starts a fresh one), and **Clean up** on Tools → Servers removes the stopped and never-started containers a Docker-run server left behind, leaving running ones alone.
