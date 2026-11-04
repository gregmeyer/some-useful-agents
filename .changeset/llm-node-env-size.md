---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

An LLM node no longer carries its big inputs in the child's environment as well as in the prompt.

sua's triage turn in a long notebook conversation failed before it started ("Refusing spawn: argv+env total … exceeds soft cap"): every input (the triage kernel, the layout guide, the notebook, the templates, the catalog) rode in the child process's environment as well as in the prompt on stdin, and together they passed the kernel's argument limit. An input the prompt substitutes (`{{inputs.NAME}}`) now stays out of the child's env once it is over 8KB; the prompt already has it. Smaller inputs, inputs the prompt doesn't name, and shell nodes are unchanged.
