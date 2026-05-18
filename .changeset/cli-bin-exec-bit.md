---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Preserve the execute bit on `dist/index.js` across rebuilds so `sua` stays runnable when the package is `npm link`-ed.

`tsc` emits plain files without `+x`, so a clean rebuild against a globally-linked install (`npm link @some-useful-agents/cli`) silently breaks the `sua` shim until the next `npm install`. The build script now chmods the bin file after compilation. No effect on fresh installs (npm sets the bit itself during install) or published tarballs (npm preserves it).
