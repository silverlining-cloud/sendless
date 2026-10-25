import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'ee/**/*.test.ts'],
    environment: 'node',
  },
});
