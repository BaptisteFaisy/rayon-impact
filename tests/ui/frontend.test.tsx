import { beforeAll, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';

vi.mock('@forge/react', async () => (await import('./mocks')).forgeReactMock);
vi.mock('@forge/bridge', async () => (await import('./mocks')).forgeBridgeMock);

// The four screens are stubbed here: this test verifies the module-key routing
// of src/ui/frontend/index.tsx, not the screens themselves (see screens.test).
vi.mock('../../src/ui/projectPage', async () => {
  const { createElement } = await import('react');
  return { ProjectPage: () => createElement('div', null, 'stub-project-page') };
});
vi.mock('../../src/ui/issueContext', async () => {
  const { createElement } = await import('react');
  return { IssueContext: () => createElement('div', null, 'stub-issue-context') };
});
vi.mock('../../src/ui/settingsPage', async () => {
  const { createElement } = await import('react');
  return { SettingsPage: () => createElement('div', null, 'stub-settings-page') };
});
vi.mock('../../src/ui/gadget', async () => {
  const { createElement } = await import('react');
  return { DashboardGadget: () => createElement('div', null, 'stub-dashboard-gadget') };
});

import { renderedRoots, setProductContext } from './mocks';

/**
 * The single UI entry point: Forge serves `resources.main` for all four
 * modules, so frontend/index.tsx must pick the right screen from the host's
 * moduleKey, and must call ForgeReconciler.render at import time.
 *
 * The entry module is imported once (ESM cache): `App` reads the product
 * context at render time, so the same captured root is rendered per moduleKey.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

let root: ReactElement;

beforeAll(async () => {
  await import('../../src/ui/frontend/index');
  expect(renderedRoots).toHaveLength(1);
  root = renderedRoots[0] as ReactElement;
});

describe('frontend entry point', () => {
  it('renders the root through ForgeReconciler at import time', () => {
    expect(root).toBeTruthy();
  });

  const cases: [string, string][] = [
    ['rayon-impact-project-page', 'stub-project-page'],
    ['rayon-impact-project-settings', 'stub-settings-page'],
    ['rayon-impact-issue-context', 'stub-issue-context'],
    ['rayon-impact-dashboard-gadget', 'stub-dashboard-gadget'],
  ];

  it.each(cases)('module %s picks the matching screen', (moduleKey, marker) => {
    setProductContext({ moduleKey });
    expect(renderToStaticMarkup(root)).toContain(marker);
  });

  it('an unknown module key falls back to the project page', () => {
    setProductContext({ moduleKey: '' });
    expect(renderToStaticMarkup(root)).toContain('stub-project-page');
  });
});
