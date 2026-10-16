---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Job and company notebooks show company logos, and the brief shows each option's picture.

In a notebook of jobs or companies, an option's picture is now its company's logo, taken from the company's own website (its app icon, a large icon, or a 128px favicon). The website comes from the option's facts, or the picture agent names it; job boards and recruiters never count. Logos are a new picture kind (`logo`): they show whole on a white tile, with no "example photo" label, and earlier example photos the agent described as logos are relabelled. The brief's table shows a small picture beside each name, the extended brief shows it at the top of each option, and a downloaded brief carries its pictures inside the file. Core adds `siteIcons(url)`, which lists a site's own icons for a logo.
