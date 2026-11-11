import { describe, expect, it } from 'vitest';
import {
  explainSignal,
  getReleaseImpact,
  listReleaseSignals,
  topSignals,
} from '../../src/actions/release';
import type { DetectionContext } from '../../src/signals/context';
import { detectComp } from '../../src/signals/comp';
import type { CollectedRelease, Signal, Waiver } from '../../src/types';
import { collected, fullCoverage, issue, policy, snapshot } from '../fixtures/builders';
import { NOW, RELEASE_LEAD, FakeIndex, FakeStore, depsFor } from './fake-store';

/**
 * `get-release-impact`, `list-release-signals`, `explain-signal` (SPEC §10).
 *
 * The dataset is one in-progress ticket: it raises COMP-01 (blocking), so the
 * saved dossier is a plain NO-GO and every assertion reads a real signal.
 */
const VERSION_ID = 'ver-24';
const VERSION_NAME = '2.4';
const IN_PROGRESS_KEY = 'PAY-131';

function release(): CollectedRelease {
  return collected({
    issues: [
      issue(IN_PROGRESS_KEY, { statusName: 'In Progress', statusCategory: 'in-progress' }),
    ],
  });
}

function signalsOf(release: CollectedRelease): Signal[] {
  const ctx: DetectionContext = {
    release,
    policy: policy(),
    now: NOW,
    waivers: [],
    previousSignals: [],
    pastOutcomes: [],
  };
  return detectComp(ctx);
}

function dossierWith(waivers: Waiver[] = []) {
  const releaseFixture = release();
  const signals = signalsOf(releaseFixture);
  const dossier = {
    snapshot: snapshot({
      versionId: VERSION_ID,
      versionName: VERSION_NAME,
      verdict: 'no-go',
      confidence: 'high',
      coverage: fullCoverage(1),
      counts: { blocking: 1, major: 0, minor: 0, info: 0 },
      narrative: 'PAY-131 is still in progress.',
    }),
    signals,
    waivers,
    decisions: [],
    outcome: null,
  };
  return { release: releaseFixture, signals, dossier };
}

function seeded() {
  const store = new FakeStore();
  const index = new FakeIndex();
  const { release: releaseFixture, signals, dossier } = dossierWith();
  store.seedDossier(dossier).seedPolicy(policy());
  index
    .addVersion({ projectId: 'proj-pay', projectKey: 'PAY', versionId: VERSION_ID, versionName: VERSION_NAME })
    .addFacts(VERSION_ID, { cachedAt: '2026-11-11T06:00:00.000Z', release: releaseFixture })
    .addSignals(VERSION_ID, signals);
  return { store, index, signals, dossier };
}

describe('action get-release-impact', () => {
  it('renvoie l’avis, la confiance, la synthèse et le compte des signaux', async () => {
    const { store, index } = seeded();
    const result = await getReleaseImpact(
      { projectKey: 'PAY', versionName: VERSION_NAME },
      depsFor(store, index),
    );

    expect(result.versionId).toBe(VERSION_ID);
    expect(result.versionName).toBe(VERSION_NAME);
    expect(result.verdict).toBe('no-go');
    expect(result.verdictTitle).toEqual({ key: 'verdict.no-go' });
    expect(result.confidence).toBe('high');
    expect(result.confidenceTitle).toEqual({ key: 'confidence.high' });
    expect(result.counts.blocking).toBe(1);
    expect(result.signalCount).toBe(1);
    expect(result.summary).toBe('PAY-131 is still in progress.');
    expect(result.topSignals).toHaveLength(1);
    expect(result.topSignals[0]?.code).toBe('COMP-01');
    expect(result.topSignals[0]?.title).toEqual({ key: 'signal.comp01.title' });
  });

  it('échoue explicitement sur une version inconnue, sans planter', async () => {
    const { store, index } = seeded();
    await expect(
      getReleaseImpact({ projectKey: 'PAY', versionName: '9.9' }, depsFor(store, index)),
    ).rejects.toMatchObject({ code: 'version-unknown' });
    await expect(
      getReleaseImpact({ projectKey: 'PAY', versionName: '9.9' }, depsFor(store, index)),
    ).rejects.toThrow(/no version named "9.9"/);
  });

  it('échoue explicitement quand aucun dossier n’a encore été calculé', async () => {
    const store = new FakeStore().seedPolicy(policy());
    const index = new FakeIndex().addVersion({
      projectId: 'proj-pay',
      projectKey: 'PAY',
      versionId: VERSION_ID,
      versionName: VERSION_NAME,
    });
    await expect(
      getReleaseImpact({ projectKey: 'PAY', versionName: VERSION_NAME }, depsFor(store, index)),
    ).rejects.toMatchObject({ code: 'version-unknown' });
  });

  it('trie les signaux bloquants d’abord et s’arrête à trois', () => {
    const { signals } = seeded();
    const many = [...signals, ...signals, ...signals].map((signal, position) => ({
      ...signal,
      id: `${signal.id}-${position}`,
      severity: position === 3 ? ('minor' as const) : signal.severity,
    }));
    const top = topSignals(many, 3);
    expect(top).toHaveLength(3);
    expect(top.every((signal) => signal.severity === 'blocking')).toBe(true);
  });
});

describe('action list-release-signals', () => {
  it('liste les signaux détaillés avec leurs preuves', async () => {
    const { store, index } = seeded();
    const result = await listReleaseSignals({ versionId: VERSION_ID }, depsFor(store, index));

    expect(result.total).toBe(1);
    expect(result.severityFilter).toBeNull();
    const [view] = result.signals;
    expect(view?.code).toBe('COMP-01');
    expect(view?.finding.key).toBe('signal.comp01.finding');
    expect(view?.finding.params).toMatchObject({ key: IN_PROGRESS_KEY });
    expect(view?.why).toEqual({ key: 'signal.comp01.why' });
    expect(view?.clear).toEqual({ key: 'signal.comp01.clear' });
    expect(view?.evidence.length).toBeGreaterThan(0);
    expect(view?.evidence[0]?.subjectId).toBe(`id-${IN_PROGRESS_KEY.toLowerCase()}`);
  });

  it('filtre par gravité', async () => {
    const { store, index } = seeded();
    const blocking = await listReleaseSignals(
      { versionId: VERSION_ID, severity: 'blocking' },
      depsFor(store, index),
    );
    const minor = await listReleaseSignals(
      { versionId: VERSION_ID, severity: 'minor' },
      depsFor(store, index),
    );
    expect(blocking.total).toBe(1);
    expect(minor.total).toBe(0);
    expect(minor.severityFilter).toBe('minor');
  });

  it('échoue explicitement sur une version inconnue', async () => {
    const { store, index } = seeded();
    await expect(
      listReleaseSignals({ versionId: 'ver-404' }, depsFor(store, index)),
    ).rejects.toMatchObject({ code: 'version-unknown' });
  });
});

describe('action explain-signal', () => {
  it('explique un signal connu : constat, raison, levée possible', async () => {
    const { store, index, signals } = seeded();
    const result = await explainSignal(
      { signalId: signals[0]!.id },
      depsFor(store, index),
    );

    expect(result.signalId).toBe(signals[0]!.id);
    expect(result.versionId).toBe(VERSION_ID);
    expect(result.code).toBe('COMP-01');
    expect(result.lot).toBe('M');
    expect(result.finding.key).toBe('signal.comp01.finding');
    expect(result.why.key).toBe('signal.comp01.why');
    expect(result.clear.key).toBe('signal.comp01.clear');
    expect(result.source.key).toBe('signal.source.jira');
    expect(result.waiver).toBeNull();
    expect(result.canRequestWaiver).toBe(true);
  });

  it('renvoie la dérogation en cours et refuse la demande à qui n’en a pas le droit', async () => {
    const { store, index, signals } = seeded();
    const waiver: Waiver = {
      id: 'wv-24-comp01',
      versionId: VERSION_ID,
      signalCode: 'COMP-01',
      subjectType: 'issue',
      subjectId: signals[0]!.subjectId,
      grantedBy: RELEASE_LEAD,
      reason: 'Late cut approved',
      grantedAt: '2026-11-11T08:00:00.000Z',
      expiresAt: '2026-11-12T08:00:00.000Z',
    };
    const waived: Signal = { ...signals[0]!, status: 'waived', waiverId: waiver.id };
    store.seedDossier({ ...dossierWith([waiver]).dossier, signals: [waived] });
    index.addSignals(VERSION_ID, [waived]);

    const granted = await explainSignal({ signalId: signals[0]!.id }, depsFor(store, index));
    expect(granted.waiver?.id).toBe('wv-24-comp01');
    expect(granted.status).toBe('waived');

    const intruder = await explainSignal(
      { signalId: signals[0]!.id },
      depsFor(store, index, { viewer: { accountId: 'user-intruder' } }),
    );
    expect(intruder.canRequestWaiver).toBe(false);
  });

  it('échoue explicitement sur un identifiant de signal inconnu', async () => {
    const { store, index } = seeded();
    await expect(
      explainSignal({ signalId: 'COMP-99:issue:id-ghost' }, depsFor(store, index)),
    ).rejects.toMatchObject({ code: 'signal-unknown' });
  });
});
