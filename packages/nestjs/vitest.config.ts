import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@node-xray/types': resolve(__dirname, '../types/src/index.ts'),
      '@node-xray/core': resolve(__dirname, '../core/src/index.ts'),
    },
  },
  test: {
    include: ['src/**/*.{test,spec}.ts'],
    testTimeout: 15_000,
  },
});
