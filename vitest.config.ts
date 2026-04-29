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
  },
});
