import { describe, expect, it } from 'vitest';
import { requestWaiver, simulateWithout } from '../../src/actions/decisions';
import { parseIssueKeys, parseRequestWaiverInput, parseSeverity } from '../../src/actions/types';
import type { DetectionContext } from '../../src/signals/context';
import { detectComp } from '../../src/signals/comp';
import type { CollectedRelease, Signal } from '../../src/types';
import { collected, fullCoverage, issue, policy, snapshot } from '../fixtures/builders';
import { NOW, RELEASE_LEAD, FakeIndex, FakeStore, depsFor } from './fake-store';

/**
 * `simulate-without` and `request-waiver` (SPEC §10, RI-07, RI-13).
 *
 * One in-progress ticket raises COMP-01 (blocking): removing it must lift the
 * NO-GO, which is exactly the video scenario ("simulation sans PAY-131").
 */
const VERSION_ID = 'ver-24';
const BLOCKING_KEY = 'PAY-131';
const CLEAN_KEY = 'PAY-132';

function release(): CollectedRelease {
  return collected({
    issues: [
      issue(BLOCKING_KEY, { statusName: 'In Progress', statusCategory: 'in-progress' }),
      issue(CLEAN_KEY),
    ],
  });
}

function signalsOf(releaseFixture: CollectedRelease): Signal[] {
  const ctx: DetectionContext = {
    release: releaseFixture,
    policy: policy(),
    now: NOW,
    waivers: [],
    previousSignals: [],
    pastOutcomes: [],
  };
  return detectComp(ctx);
}

function seeded() {
  const store = new FakeStore();
  const index = new FakeIndex();
  const releaseFixture = release();
  const signals = signalsOf(releaseFixture);
  store.seedPolicy(policy()).seedDossier({
    snapshot: snapshot({
      versionId: VERSION_ID,
      verdict: 'no-go',
      coverage: fullCoverage(2),
      counts: { blocking: 1, major: 0, minor: 0, info: 0 },
    }),
    signals,
    waivers: [],
    decisions: [],
    outcome: null,
  });
  index
    .addFacts(VERSION_ID, { cachedAt: '2026-11-11T06:00:00.000Z', release: releaseFixture })
    .addSignals(VERSION_ID, signals);
  return { store, index, signals, release: releaseFixture };
}

describe('action simulate-without', () => {
  it('recalcule l’avis sans les tickets demandés (issueKeys en chaîne)', async () => {
    const { store, index } = seeded();
    const result = await simulateWithout(
      { versionId: VERSION_ID, issueKeys: `${BLOCKING_KEY}, ${CLEAN_KEY}` },
      depsFor(store, index),
    );

    expect(result.removedIssueKeys).toEqual([BLOCKING_KEY, CLEAN_KEY]);
    expect(result.verdictBefore).toBe('no-go');
    expect(result.verdict).toBe('go');
    expect(result.droppedSignalCount).toBe(1);
    expect(result.droppedSignalIds).toEqual([`COMP-01:issue:id-${BLOCKING_KEY.toLowerCase()}`]);
    expect(result.unknownIssueKeys).toEqual([]);
  });

  it('signale les clés absentes de la version sans les ignorer en silence', async () => {
    const { store, index } = seeded();
    const result = await simulateWithout(
      { versionId: VERSION_ID, issueKeys: `${BLOCKING_KEY},PAY-999` },
      depsFor(store, index),
    );
    expect(result.unknownIssueKeys).toEqual(['PAY-999']);
    expect(result.verdict).toBe('go');
  });

  it('laisse l’avis inchangé quand le ticket retiré n’est pas bloquant', async () => {
    const { store, index } = seeded();
    const result = await simulateWithout(
      { versionId: VERSION_ID, issueKeys: CLEAN_KEY },
      depsFor(store, index),
    );
    expect(result.verdict).toBe('no-go');
    expect(result.droppedSignalCount).toBe(0);
  });

  it('échoue explicitement sans collecte en cache ou sur une version inconnue', async () => {
    const { store, index } = seeded();
    const noFacts = new FakeIndex();
    await expect(
      simulateWithout(
        { versionId: VERSION_ID, issueKeys: BLOCKING_KEY },
        depsFor(store, noFacts),
      ),
    ).rejects.toMatchObject({ code: 'no-facts' });
    await expect(
      simulateWithout(
        { versionId: 'ver-404', issueKeys: BLOCKING_KEY },
        depsFor(store, index),
      ),
    ).rejects.toMatchObject({ code: 'version-unknown' });
  });

  it('accepte une chaîne de clés séparées par des virgules, sans doublon', () => {
    expect(parseIssueKeys(' PAY-1, PAY-2 ;PAY-1 ')).toEqual(['PAY-1', 'PAY-2']);
    expect(parseIssueKeys('')).toEqual([]);
  });
});

describe('action request-waiver', () => {
  it('crée la dérogation quand le motif et le droit sont là', async () => {
    const { store, index, signals } = seeded();
    const result = await requestWaiver(
      { signalId: signals[0]!.id, reason: 'Late cut approved by the release lead', hours: 24 },
      depsFor(store, index),
    );

    expect(result.granted).toBe(true);
    if (!result.granted) return;
    expect(result.waiver.reason).toBe('Late cut approved by the release lead');
    expect(result.waiver.grantedBy).toBe(RELEASE_LEAD);
    expect(result.waiver.grantedAt).toBe(NOW);
    expect(result.waiver.expiresAt).toBe('2026-11-12T10:00:00.000Z');
    expect(await store.getWaivers(VERSION_ID)).toHaveLength(1);
  });

  it('applique la durée par défaut de la politique quand hours est absent', async () => {
    const { store, index, signals } = seeded();
    const result = await requestWaiver(
      { signalId: signals[0]!.id, reason: 'Accepted risk' },
      depsFor(store, index),
    );
    expect(result.granted).toBe(true);
    if (!result.granted) return;
    // policy().defaultWaiverHours = 48: the waiver expires 48 h after NOW.
    expect(result.waiver.expiresAt).toBe('2026-11-13T10:00:00.000Z');
  });

  it('refuse avec un motif quand la raison est vide', async () => {
    const { store, index, signals } = seeded();
    const result = await requestWaiver(
      { signalId: signals[0]!.id, reason: '   ' },
      depsFor(store, index),
    );
    expect(result.granted).toBe(false);
    if (result.granted) return;
    expect(result.refusal.key).toBe('waiver.reason.required');
    expect(result.refusal.params).toEqual({ signalCode: 'COMP-01' });
    expect(await store.getWaivers(VERSION_ID)).toHaveLength(0);
  });

  it('refuse avec un motif quand le demandeur n’a pas le droit de déroger', async () => {
    const { store, index, signals } = seeded();
    const result = await requestWaiver(
      { signalId: signals[0]!.id, reason: 'I would like to ship' },
      depsFor(store, index, { viewer: { accountId: 'user-intruder' } }),
    );
    expect(result.granted).toBe(false);
    if (result.granted) return;
    expect(result.refusal.key).toBe('waiver.approver.unauthorized');
    expect(result.refusal.params).toEqual({ approver: 'user-intruder' });
    expect(await store.getWaivers(VERSION_ID)).toHaveLength(0);
  });

  it('accepte le porteur du rôle projet même absent de la liste des approbateurs', async () => {
    const { store, index, signals } = seeded();
    store.seedPolicy(policy({ waiverApprovers: [] }));
    const result = await requestWaiver(
      { signalId: signals[0]!.id, reason: 'Project role holder decision' },
      depsFor(store, index, { viewer: { accountId: RELEASE_LEAD, canWaive: true } }),
    );
    expect(result.granted).toBe(true);
  });

  it('refuse une durée hors bornes et un signal inconnu', async () => {
    const { store, index, signals } = seeded();
    const tooLong = await requestWaiver(
      { signalId: signals[0]!.id, reason: 'A year', hours: 9000 },
      depsFor(store, index),
    );
    expect(tooLong.granted).toBe(false);
    if (!tooLong.granted) expect(tooLong.refusal.key).toBe('waiver.hours.invalid');

    await expect(
      requestWaiver({ signalId: 'COMP-99:issue:id-ghost', reason: 'x' }, depsFor(store, index)),
    ).rejects.toMatchObject({ code: 'signal-unknown' });
  });

  it('lit les entrées brutes du manifest (raison absente, heures en chaîne)', () => {
    expect(parseRequestWaiverInput({ signalId: 'sig-1' })).toEqual({
      signalId: 'sig-1',
      reason: '',
    });
    expect(parseRequestWaiverInput({ signalId: 'sig-1', reason: 'ok', hours: '48' })).toEqual({
      signalId: 'sig-1',
      reason: 'ok',
      hours: 48,
    });
    expect(() => parseRequestWaiverInput({})).toThrow(/signalId/);
    expect(parseSeverity('CRITICAL')).toBe('blocking');
    expect(() => parseSeverity('urgent')).toThrow(/Unknown severity/);
  });
});
