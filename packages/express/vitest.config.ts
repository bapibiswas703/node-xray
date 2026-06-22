import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@node-xray/types': resolve(__dirname, '../types/src/index.ts'),
      '@node-xray/core': resolve(__dirname, '../core/src/index.ts'),
      '@node-xray/dashboard': resolve(__dirname, '../dashboard/src/index.ts'),
    },
  },
  test: {
    include: ['src/**/*.{test,spec}.ts'],
    testTimeout: 10_000,
    server: {
      deps: {
        // The express adapter transitively imports `ws` through
        // `@node-xray/core`'s source. Inline it so vitest's optimizer
        // can resolve it without a separate install.
        inline: [/(^|\/)ws($|\/)/, /^@node-xray\//],
      },
    },
  },
});
