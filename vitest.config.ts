import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const pkg = (name: string) => fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@tree-weaver/core': pkg('core'),
      '@tree-weaver/formats': pkg('formats'),
      '@tree-weaver/storage': pkg('storage'),
      '@tree-weaver/kits': pkg('kits'),
      '@tree-weaver/branches': pkg('branches'),
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    environment: 'node',
  },
});
