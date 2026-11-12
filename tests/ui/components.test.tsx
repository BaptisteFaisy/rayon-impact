import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@forge/react', async () => (await import('./mocks')).forgeReactMock);
vi.mock('@forge/bridge', async () => (await import('./mocks')).forgeBridgeMock);

import { demoData, resetForgeMocks } from './mocks';
import { VerdictBanner } from '../../src/ui/components/VerdictBanner';
import { CoverageMeter } from '../../src/ui/components/CoverageMeter';
import { DiffBanner } from '../../src/ui/components/DiffBanner';
import { SignalList } from '../../src/ui/components/SignalList';
import { SimulationPanel } from '../../src/ui/components/SimulationPanel';
import { GraphView } from '../../src/ui/components/GraphView';
import { WaiverDialog } from '../../src/ui/components/WaiverDialog';
import { WaiverFields } from '../../src/ui/components/WaiverFields';
import { SeverityTable } from '../../src/ui/components/SeverityTable';
import { ListField } from '../../src/ui/components/ListField';
import { listSignalCodes } from '../../src/signals/registry';
import type { SnapshotDiff, Verdict } from '../../src/types';

/**
 * Loaded-state renders of every props-driven UI component (the units the four
 * screens are assembled from). `renderToStaticMarkup` never runs effects, so
 * these components receive the demo dataset (fixtures → engine) as props.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

beforeEach(() => {
  resetForgeMocks();
});

describe('VerdictBanner', () => {
  const verdicts: Verdict[] = ['go', 'conditional-go', 'no-go', 'not-applicable'];

  it('renders each verdict with its translated title (EN)', () => {
    for (const verdict of verdicts) {
      const html = renderToStaticMarkup(
        <VerdictBanner
          verdict={verdict}
          confidence="high"
          computedAt={demoData.dossier.snapshot.computedAt}
          locale="en"
        />,
      );
      expect(html).toContain('High confidence');
      expect(html).toContain(demoData.dossier.snapshot.computedAt);
    }
    const titles = verdicts.map((verdict) =>
      renderToStaticMarkup(
        <VerdictBanner
          verdict={verdict}
          confidence="low"
          computedAt=""
          locale="en"
        />,
      ),
    );
    expect(titles[0]).toContain('GO');
    expect(titles[1]).toContain('CONDITIONAL GO');
    expect(titles[2]).toContain('NO-GO');
    expect(titles[3]).toContain('NOT APPLICABLE');
  });

  it('renders the French titles and the coverage note as a warning', () => {
    const html = renderToStaticMarkup(
      <VerdictBanner
        verdict="conditional-go"
        confidence="low"
        computedAt=""
        locale="fr"
        coverageNote="Code coverage is partial."
      />,
    );
    expect(html).toContain('GO SOUS CONDITIONS');
    expect(html).toContain('Confiance basse');
    expect(html).toContain('Code coverage is partial.');
  });
});

describe('CoverageMeter', () => {
  it('shows issue, code and service coverage with percentages', () => {
    const coverage = demoData.dossier.snapshot.coverage;
    const html = renderToStaticMarkup(<CoverageMeter coverage={coverage} locale="en" />);
    expect(html).toContain(`${coverage.issuesWithCode}/${coverage.issueCount}`);
    expect(html).toContain(`${Math.round(coverage.codeRatio * 100)}%`);
    expect(html).toContain('Code coverage');
    expect(html).toContain('Service coverage');
  });

  it('is localized in French', () => {
    const coverage = demoData.dossier.snapshot.coverage;
    const html = renderToStaticMarkup(<CoverageMeter coverage={coverage} locale="fr" />);
    expect(html).toContain('Tickets');
    expect(html).toContain('Code visible');
    expect(html).toContain('Services connus');
  });
});

describe('DiffBanner', () => {
  const emptyDiff: SnapshotDiff = {
    previousSnapshotId: null,
    added: [],
    cleared: [],
    severityChanged: [],
    verdictChange: null,
  };

  it('states a first dossier honestly (no comparison yet)', () => {
    const html = renderToStaticMarkup(<DiffBanner diff={null} locale="en" />);
    expect(html).toContain('Only one dossier so far: nothing to compare yet.');
  });

  it('states an unchanged dossier', () => {
    const html = renderToStaticMarkup(<DiffBanner diff={emptyDiff} locale="fr" />);
    expect(html).toContain('Aucun changement depuis le dernier dossier.');
  });

  it('shows the verdict change and the new signals of the demo diff', () => {
    const html = renderToStaticMarkup(<DiffBanner diff={demoData.diff} locale="en" />);
    expect(html).toContain('Since the last dossier');
    expect(html).toContain('CONDITIONAL GO');
    expect(html).toContain('NO-GO');
    expect(html).toContain(`New signals (${demoData.diff.added.length})`);
  });
});

describe('SignalList', () => {
  it('says "no active signal" in both locales when empty', () => {
    expect(renderToStaticMarkup(<SignalList signals={[]} locale="en" />)).toContain(
      'No active signal.',
    );
    expect(renderToStaticMarkup(<SignalList signals={[]} locale="fr" />)).toContain(
      'Aucun signal actif.',
    );
  });

  it('groups the demo signals by severity with findings and evidence links', () => {
    const html = renderToStaticMarkup(
      <SignalList signals={demoData.dossier.signals} locale="en" />,
    );
    expect(html).toContain('Blocking');
    expect(html).toContain('Major');
    expect(html).toContain('COMP-01');
    expect(html).toContain('Ticket PAY-131 is still In Progress');
    expect(html).toContain('<ul');
    expect(html).toContain('href=');
  });
});

describe('SimulationPanel', () => {
  it('offers the simulation with the blocking keys and states it changes nothing', () => {
    const html = renderToStaticMarkup(
      <SimulationPanel versionId="ver-24" issueKeys={['PAY-131', 'PAY-129']} locale="en" />,
    );
    expect(html).toContain('Simulate without PAY-131, PAY-129');
    expect(html).toContain('Simulation only: nothing is changed in Jira.');
    expect(html).toContain('<button');
  });

  it('disables the run button when there is no key', () => {
    const html = renderToStaticMarkup(
      <SimulationPanel versionId="ver-24" issueKeys={[]} locale="fr" />,
    );
    expect(html).toContain('disabled');
    expect(html).toContain('Simulation uniquement');
  });
});

describe('GraphView', () => {
  it('renders the svg (role=img) and its translated list equivalent', () => {
    const html = renderToStaticMarkup(<GraphView graph={demoData.graph} locale="en" />);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="impact graph"');
    expect(html).toContain('<circle');
    expect(html).toContain('Tickets');
    expect(html).toContain('Services');
    expect(html).toContain('<ul');
  });

  it('announces truncation above the node limit, list stays complete', () => {
    const html = renderToStaticMarkup(
      <GraphView graph={{ ...demoData.graph, truncated: true }} locale="fr" />,
    );
    expect(html).toContain('Graphe tronqué');
    expect(html).toContain('La liste ci-dessous reste complète.');
  });
});

describe('WaiverDialog + WaiverFields', () => {
  it('renders the mandatory-reason form for the first demo signal', () => {
    const signal = demoData.dossier.signals[0];
    const html = renderToStaticMarkup(
      <WaiverDialog signal={signal} locale="en" onDone={() => {}} onCancel={() => {}} />,
    );
    expect(html).toContain('Grant a waiver');
    expect(html).toContain(signal.code);
    expect(html).toContain('<textarea');
    expect(html).toContain('type="number"');
    expect(html).toContain('Grant');
    expect(html).toContain('Cancel');
  });

  it('labels both fields in French', () => {
    const html = renderToStaticMarkup(
      <WaiverFields locale="fr" reason="" hours={48} onReason={() => {}} onHours={() => {}} />,
    );
    expect(html).toContain('Motif (obligatoire) :');
    expect(html).toContain('Durée (heures) :');
  });
});

describe('SeverityTable + ListField', () => {
  it('renders one accessible row per signal code', () => {
    const html = renderToStaticMarkup(
      <SeverityTable policy={demoData.policy} locale="en" onChange={() => {}} />,
    );
    expect(html).toContain('<table');
    for (const code of listSignalCodes()) {
      expect(html).toContain(`Severity for ${code}`);
      expect(html).toContain(`Enable ${code}`);
    }
    expect(html).toContain('<select');
    expect(html).toContain('type="checkbox"');
  });

  it('renders the comma-separated values of a list field', () => {
    const html = renderToStaticMarkup(
      <ListField label="Watched JSM projects (keys)" values={['INC', 'OPS']} onChange={() => {}} />,
    );
    expect(html).toContain('Watched JSM projects (keys)');
    expect(html).toContain('value="INC, OPS"');
  });
});
