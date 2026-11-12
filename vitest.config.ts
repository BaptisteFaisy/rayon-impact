import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // UI screens are React (.tsx): the render tests live beside the pure ones.
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'node',
    // The engine is pure: no network, no timers left running.
    testTimeout: 10_000,
    // Native require() of Atlaskit's compiled .css files must not crash node.
    setupFiles: ['tests/ui/setupCssRequire.ts'],
    server: {
      deps: {
        // Atlaskit ships CJS that `require()`s .css files (e.g. @atlaskit/spinner):
        // node's loader cannot parse CSS, so vite must transform these packages
        // (its css handling stubs the stylesheets out in tests).
        inline: [/@atlaskit\//, /@compiled\//, /@emotion\//],
      },
    },
  },
});
