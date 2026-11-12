/**
 * Test environment fixes for rendering the real Atlaskit components under
 * `react-dom/server` in a node environment (no Forge runtime, no DOM):
 *
 * 1. Atlaskit ships CJS builds that `require()` their compiled `.css` files
 *    (e.g. `@atlaskit/spinner/dist/cjs/spinner.js`). Node's CJS loader parses
 *    unknown extensions as JavaScript and dies on the first CSS selector
 *    ("Unexpected token '.'"). Styles are cosmetic in static-markup tests:
 *    register a no-op `.css` loader so the real components render.
 *
 * 2. Atlaskit components read feature gates whose client is only initialized
 *    inside the Forge runtime. Outside it, every check logs "Client must be
 *    initialized" and falls back to the default value. Stub the gate check to
 *    its fallback so the render output is the same without the noise. These
 *    packages load through node's native require (externalized CJS), which
 *    `vi.mock` cannot intercept — hence the runtime patch below, plus a
 *    `vi.mock` twin for any module vite does transform.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */
import { createRequire } from 'node:module';
import { vi } from 'vitest';

const nodeRequire = createRequire(import.meta.url);

const extensions = nodeRequire.extensions as Record<string, unknown>;
extensions['.css'] = (module: { exports: unknown }) => {
  module.exports = {};
};

/** Every gate answers its fallback (false) without touching the network. */
function stubFeatureGates(): void {
  try {
    // The CJS entry interops the FeatureGates class as its `default` export.
    const client = nodeRequire('@atlaskit/feature-gate-js-client') as {
      default?: { checkGate?: unknown };
    };
    if (client.default) client.default.checkGate = () => false;
  } catch {
    // Package absent: nothing to quiet.
  }
}

stubFeatureGates();

vi.mock('@atlaskit/platform-feature-flags', () => ({
  // Real signature: fg(name) or fg({ name, defaultValue }) → boolean.
  fg: (flag: unknown) =>
    typeof flag === 'object' && flag !== null
      ? Boolean((flag as { defaultValue?: unknown }).defaultValue)
      : false,
  checkGate: () => false,
  getBooleanFF: () => false,
  resolveBooleanFlag: () => false,
  setBooleanResolver: () => {},
}));
