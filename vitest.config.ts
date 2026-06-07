import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@some-useful-agents/core': `${here}packages/core/src/index.ts`,
      '@some-useful-agents/cli': `${here}packages/cli/src/index.ts`,
      '@some-useful-agents/dashboard': `${here}packages/dashboard/src/index.ts`,
      '@some-useful-agents/mcp-server': `${here}packages/mcp-server/src/index.ts`,
      '@some-useful-agents/temporal-provider': `${here}packages/temporal-provider/src/index.ts`,
    },
  },
  test: {
    globals: true,
    include: ['packages/*/src/**/*.test.ts'],
    // Several integration tests spin up real Express/MCP HTTP servers + sqlite.
    // On 2-core CI runners the suite oversubscribes the CPU (≈140s of test work
    // in ≈62s wall-clock), starving those tests so they tip past the default 5s
    // wall-clock deadline. Give them headroom; a genuine hang still fails, later.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
