import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // The engine is pure: no network, no timers left running.
    testTimeout: 10_000,
  },
});
