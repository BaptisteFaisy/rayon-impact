import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@forge/react', async () => (await import('./mocks')).forgeReactMock);
vi.mock('@forge/bridge', async () => (await import('./mocks')).forgeBridgeMock);

import { demoData, resetForgeMocks, setProductContext } from './mocks';
import { ProjectPage } from '../../src/ui/projectPage';
import { IssueContext, IssueContextView } from '../../src/ui/issueContext';
import { SettingsPage } from '../../src/ui/settingsPage';
import { DashboardGadget, GadgetList } from '../../src/ui/gadget';
import {
  gadgetLoaded,
  issueContextLoaded,
  projectPageLoaded,
  settingsLoaded,
} from './screenViews';
import { listSignalCodes } from '../../src/signals/registry';

/**
 * The four Forge screens, really rendered (SPEC §11).
 *
 * `renderToStaticMarkup` never runs effects: `useScreen`'s `invoke` does not
 * fire, so each screen is asserted twice — initial state (loading) on the
 * screen component itself, loaded state on the props-driven production
 * sub-components it renders once the resolver answered (see screenViews.tsx).
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

beforeEach(() => {
  resetForgeMocks();
});

describe('screen 1 — jira:projectPage', () => {
  it('renders the loading state without crashing', () => {
    setProductContext({ moduleKey: 'rayon-impact-project-page' });
    const html = renderToStaticMarkup(<ProjectPage />);
    expect(html).toContain('role="status"');
    expect(html).toContain('…');
  });

  it('renders the loaded dossier: verdict, coverage, diff, signals (EN)', () => {
    const html = renderToStaticMarkup(projectPageLoaded(demoData, 'en'));
    expect(html).toContain('NO-GO');
    expect(html).toContain('High confidence');
    expect(html).toContain('2.4');
    expect(html).toContain('Since the last dossier');
    expect(html).toContain('COMP-01');
    expect(html).toContain('PAY-131');
    expect(html).toContain('13/14');
    expect(html).toContain('Simulate without');
  });

  it('renders the loaded dossier in French', () => {
    const html = renderToStaticMarkup(projectPageLoaded(demoData, 'fr'));
    expect(html).toContain('Confiance haute');
    expect(html).toContain('Depuis le dernier dossier');
    expect(html).toContain('Bloquant');
    expect(html).toContain('Simuler sans');
    expect(html).toContain('Version :');
  });

  it('renders every tab body: graph, teams, waivers, history', () => {
    const graph = renderToStaticMarkup(projectPageLoaded(demoData, 'en', 1));
    expect(graph).toContain('aria-label="impact graph"');
    const teams = renderToStaticMarkup(projectPageLoaded(demoData, 'en', 2));
    expect(teams).toContain('Mobile');
    expect(teams).toContain('mobile-app');
    const waivers = renderToStaticMarkup(projectPageLoaded(demoData, 'en', 3));
    expect(waivers).toContain('Business commitment for the SEPA launch.');
    expect(waivers).toContain('expires');
    const history = renderToStaticMarkup(projectPageLoaded(demoData, 'en', 4));
    expect(history).toContain('72 h outcome: 1 incident(s)');
    expect(history).toContain('Hold');
  });
});

describe('screen 2 — jira:issueContext', () => {
  it('renders the loading state without crashing', () => {
    setProductContext({ moduleKey: 'rayon-impact-issue-context' });
    const html = renderToStaticMarkup(<IssueContext />);
    expect(html).toContain('role="status"');
  });

  it('says the ticket holds the release back, with the signal reason (EN)', () => {
    const html = renderToStaticMarkup(issueContextLoaded(demoData, 'en'));
    expect(html).toContain('This ticket holds back 2.4');
    expect(html).toContain('COMP-01');
  });

  it('says the same in French', () => {
    const html = renderToStaticMarkup(issueContextLoaded(demoData, 'fr'));
    expect(html).toContain('Ce ticket retient la version 2.4');
  });

  it('observation mode shows no verdict on the ticket (SPEC §20)', () => {
    const observed = {
      ...demoData.issueContext,
      observationMode: true,
    };
    const html = renderToStaticMarkup(
      <IssueContextView data={observed} issueId={observed.issueId} locale="en" />,
    );
    expect(html).toContain('No dossier for this ticket.');
  });

  it('a ticket in no tracked version says so, honestly', () => {
    const empty = { ...demoData.issueContext, versions: [] };
    const html = renderToStaticMarkup(
      <IssueContextView data={empty} issueId={empty.issueId} locale="en" />,
    );
    expect(html).toContain('This ticket is not part of any tracked release.');
  });
});

describe('screen 3 — jira:projectSettingsPage', () => {
  it('renders the loading state without crashing', () => {
    setProductContext({ moduleKey: 'rayon-impact-project-settings' });
    const html = renderToStaticMarkup(<SettingsPage />);
    expect(html).toContain('role="status"');
  });

  it('renders one severity row per signal of the catalogue (EN)', () => {
    const html = renderToStaticMarkup(settingsLoaded(demoData, 'en'));
    expect(html).toContain('Release impact settings');
    expect(html).toContain('<table');
    for (const code of listSignalCodes()) {
      expect(html).toContain(code);
    }
    expect(html).toContain('Watched JSM projects (keys)');
    expect(html).toContain('Who may waive (accountId)');
    expect(html).toContain('Observation mode');
    expect(html).toContain('Save');
  });

  it('renders the settings in French', () => {
    const html = renderToStaticMarkup(settingsLoaded(demoData, 'fr'));
    expect(html).toContain('Réglages du rayon d’impact');
    expect(html).toContain('Enregistrer');
    expect(html).toContain('Gravité');
  });
});

describe('screen 4 — jira:dashboardGadget', () => {
  it('renders the loading state without crashing', () => {
    setProductContext({ moduleKey: 'rayon-impact-dashboard-gadget' });
    const html = renderToStaticMarkup(<DashboardGadget />);
    expect(html).toContain('role="status"');
  });

  it('renders the upcoming version with its verdict', () => {
    const html = renderToStaticMarkup(gadgetLoaded(demoData, 'en'));
    expect(html).toContain('2.4');
    expect(html).toContain('NO-GO');
    expect(html).toContain('High confidence');
  });

  it('a version outside the 14-day window is not "upcoming"', () => {
    const far = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
    const rows = demoData.gadgetRows.map((row) => ({ ...row, releaseDate: far }));
    const html = renderToStaticMarkup(<GadgetList rows={rows} locale="en" />);
    expect(html).toContain('No release planned in the next 14 days.');
    expect(html).not.toContain('NO-GO');
  });
});
