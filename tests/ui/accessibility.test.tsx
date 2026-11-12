import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@forge/react', async () => (await import('./mocks')).forgeReactMock);
vi.mock('@forge/bridge', async () => (await import('./mocks')).forgeBridgeMock);

import { demoData, resetForgeMocks, setProductContext } from './mocks';
import { ProjectPage } from '../../src/ui/projectPage';
import { IssueContext } from '../../src/ui/issueContext';
import { SettingsPage } from '../../src/ui/settingsPage';
import { DashboardGadget } from '../../src/ui/gadget';
import { WaiverDialog } from '../../src/ui/components/WaiverDialog';
import {
  gadgetLoaded,
  issueContextLoaded,
  projectPageLoaded,
  settingsLoaded,
} from './screenViews';
import {
  findUnlabeledControls,
  findUnlabeledGraphics,
  hasSemanticElement,
} from './markupChecks';
import type { Locale } from '../../src/types';

/**
 * Basic accessibility of the rendered screens (not an audit):
 * - every loaded screen exposes at least one semantic element;
 * - every form control has an accessible name (aria-label, wrapping <label>,
 *   or a <label for> bound to its id);
 * - every image/svg is labeled (aria-label / role="img" / alt);
 * - loading states announce themselves with role="status".
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

beforeEach(() => {
  resetForgeMocks();
});

const LOCALES: Locale[] = ['en', 'fr'];

function loadedViews(locale: Locale): [string, string][] {
  return [
    ['projectPage', renderToStaticMarkup(projectPageLoaded(demoData, locale))],
    ['issueContext', renderToStaticMarkup(issueContextLoaded(demoData, locale))],
    ['settingsPage', renderToStaticMarkup(settingsLoaded(demoData, locale))],
    ['dashboardGadget', renderToStaticMarkup(gadgetLoaded(demoData, locale))],
  ];
}

describe('loaded screens expose semantic structure', () => {
  it.each(LOCALES)('every screen (%s) has a heading, table, list or button', (locale) => {
    for (const [screen, html] of loadedViews(locale)) {
      expect(hasSemanticElement(html), `screen ${screen} lacks a semantic element`).toBe(true);
    }
  });

  it('every tab body of the project page is semantic too', () => {
    for (const tab of [0, 1, 2, 3, 4]) {
      const html = renderToStaticMarkup(projectPageLoaded(demoData, 'en', tab));
      expect(hasSemanticElement(html), `tab ${tab} lacks a semantic element`).toBe(true);
    }
  });
});

describe('form controls are labeled', () => {
  it.each(LOCALES)('no unnamed input/select/textarea on any screen (%s)', (locale) => {
    for (const [screen, html] of loadedViews(locale)) {
      expect(findUnlabeledControls(html), `screen ${screen}`).toEqual([]);
    }
  });

  it('the waiver dialog labels its two fields', () => {
    const html = renderToStaticMarkup(
      <WaiverDialog
        signal={demoData.dossier.signals[0]}
        locale="en"
        onDone={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(findUnlabeledControls(html)).toEqual([]);
    expect(html).toContain('Reason (mandatory):');
  });
});

describe('graphics are labeled', () => {
  it('no unnamed img/svg on any screen, in either locale', () => {
    for (const locale of LOCALES) {
      for (const [screen, html] of loadedViews(locale)) {
        expect(findUnlabeledGraphics(html), `screen ${screen}`).toEqual([]);
      }
    }
  });

  it('the impact graph svg announces itself as an image', () => {
    const html = renderToStaticMarkup(projectPageLoaded(demoData, 'en', 1));
    expect(html).toContain('<svg');
    expect(html).toContain('role="img"');
    expect(findUnlabeledGraphics(html)).toEqual([]);
  });
});

describe('loading states announce themselves', () => {
  const screens: [string, () => string][] = [
    ['rayon-impact-project-page', () => renderToStaticMarkup(<ProjectPage />)],
    ['rayon-impact-issue-context', () => renderToStaticMarkup(<IssueContext />)],
    ['rayon-impact-project-settings', () => renderToStaticMarkup(<SettingsPage />)],
    ['rayon-impact-dashboard-gadget', () => renderToStaticMarkup(<DashboardGadget />)],
  ];

  it.each(screens)('%s renders a role="status" placeholder', (moduleKey, render) => {
    setProductContext({ moduleKey });
    expect(render()).toContain('role="status"');
  });
});
