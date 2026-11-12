import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@forge/react', async () => (await import('./mocks')).forgeReactMock);
vi.mock('@forge/bridge', async () => (await import('./mocks')).forgeBridgeMock);

import { demoData, resetForgeMocks } from './mocks';
import { SignalsTab } from '../../src/ui/tabs/SignalsTab';
import { TeamsTab } from '../../src/ui/tabs/TeamsTab';
import { WaiversTab } from '../../src/ui/tabs/WaiversTab';
import { HistoryTab } from '../../src/ui/tabs/HistoryTab';
import { blockingIssueKeys } from '../../src/ui/issueKeys';

/**
 * The four tabs of the project page (SPEC §11), rendered with the demo dataset
 * (fixtures → engine) passed as props — the loaded state, which
 * `renderToStaticMarkup` cannot reach through the async `useScreen`.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

beforeEach(() => {
  resetForgeMocks();
});

describe('SignalsTab', () => {
  it('lists the signals and offers a waiver per active blocking one', () => {
    const html = renderToStaticMarkup(
      <SignalsTab
        signals={demoData.dossier.signals}
        locale="en"
        waiving={null}
        onWaive={() => {}}
        versionId="ver-24"
      />,
    );
    const blocking = demoData.dossier.signals.filter(
      (signal) => signal.severity === 'blocking' && signal.status === 'active',
    );
    expect(blocking.length).toBeGreaterThan(0);
    for (const signal of blocking) {
      expect(html).toContain(`Waive ${signal.code}`);
    }
    expect(html).toContain('<button');
  });

  it('offers the simulation on the keys holding the release back', () => {
    const held = blockingIssueKeys(demoData.dossier.signals);
    const html = renderToStaticMarkup(
      <SignalsTab
        signals={demoData.dossier.signals}
        locale="en"
        waiving={null}
        onWaive={() => {}}
        versionId="ver-24"
      />,
    );
    expect(held.length).toBeGreaterThan(0);
    expect(html).toContain('Simulate without');
  });

  it('no blocking key: no simulation panel', () => {
    const cleared = demoData.dossier.signals.map((signal) =>
      signal.severity === 'blocking' ? { ...signal, status: 'cleared' as const } : signal,
    );
    const html = renderToStaticMarkup(
      <SignalsTab
        signals={cleared}
        locale="fr"
        waiving={null}
        onWaive={() => {}}
        versionId="ver-24"
      />,
    );
    expect(html).not.toContain('Simuler sans');
  });
});

describe('TeamsTab', () => {
  it('names the impacted team, its services and its tickets', () => {
    const html = renderToStaticMarkup(<TeamsTab teams={demoData.teams} locale="en" />);
    expect(html).toContain('Mobile');
    expect(html).toContain('mobile-app');
    expect(html).toContain('PAY-127');
    expect(html).toContain('<ul');
  });

  it('no team identified is stated, in both locales', () => {
    expect(renderToStaticMarkup(<TeamsTab teams={[]} locale="en" />)).toContain(
      'No team identified.',
    );
    expect(renderToStaticMarkup(<TeamsTab teams={[]} locale="fr" />)).toContain(
      'Aucune équipe identifiée.',
    );
  });
});

describe('WaiversTab', () => {
  it('shows reason, approver, expiration — and closure when closed', () => {
    const html = renderToStaticMarkup(
      <WaiversTab waivers={demoData.dossier.waivers} locale="en" />,
    );
    expect(html).toContain('Business commitment for the SEPA launch.');
    expect(html).toContain('user-release-lead');
    expect(html).toContain('expires 2026-11-13T06:00:00.000Z');
    expect(html).toContain('closed 2026-11-01T09:05:00.000Z (Expired)');
  });

  it('is localized in French', () => {
    const html = renderToStaticMarkup(
      <WaiversTab waivers={demoData.dossier.waivers} locale="fr" />,
    );
    expect(html).toContain('expire 2026-11-13T06:00:00.000Z');
    expect(html).toContain('close 2026-11-01T09:05:00.000Z (Expired)');
  });

  it('no waiver renders an explicit dash', () => {
    expect(renderToStaticMarkup(<WaiversTab waivers={[]} locale="en" />)).toContain('—');
  });
});

describe('HistoryTab', () => {
  it('shows the decision with the verdict of the moment, localized', () => {
    const html = renderToStaticMarkup(
      <HistoryTab
        decisions={demoData.dossier.decisions}
        outcome={demoData.dossier.outcome}
        locale="en"
      />,
    );
    expect(html).toContain('Hold');
    expect(html).toContain('NO-GO');
    expect(html).toContain('by user-release-lead');
    expect(html).toContain('Waiting for INC-52 post-mortem.');
    expect(html).toContain('72 h outcome: 1 incident(s)');
  });

  it('translates the decision kind and the outcome line in French', () => {
    const html = renderToStaticMarkup(
      <HistoryTab
        decisions={demoData.dossier.decisions}
        outcome={demoData.dossier.outcome}
        locale="fr"
      />,
    );
    expect(html).toContain('Retenir');
    expect(html).toContain('par user-release-lead');
    expect(html).toContain('Bilan 72 h : 1 incident(s)');
  });

  it('a missing outcome is stated as missing, never as good news', () => {
    const html = renderToStaticMarkup(
      <HistoryTab decisions={[]} outcome={null} locale="en" />,
    );
    expect(html).toContain('72 h outcome: not available yet.');
  });
});
