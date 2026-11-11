import { describe, expect, it } from 'vitest';
import { getReleaseOutcome, listImpactedTeams } from '../../src/actions/teams.js';
import type { CollectedRelease, Decision, Outcome } from '../../src/types.js';
import { collected, graphFacts, issue, snapshot, team } from '../fixtures/builders.js';
import { paiementsPolicy, paiementsRelease } from '../fixtures/paiements.js';
import { FakeIndex, FakeStore, depsFor } from './fake-store.js';

/**
 * `list-impacted-teams` and `get-release-outcome` (SPEC §10).
 *
 * Built on the canonical "Paiements 2.4" dataset, extended with one
 * component-mapped team and one cross-project ticket, so the three discovery
 * paths (`graph`, `component`, `link`) are each exercised.
 */
const VERSION_ID = 'ver-24';

function release(): CollectedRelease {
  const base = paiementsRelease();
  return collected({
    ...base,
    teams: [
      team('team-mobile', { name: 'Mobile', componentIds: ['cmp-mobile'] }),
      team('team-checkout', { name: 'Checkout', componentIds: ['checkout-api'] }),
    ],
    graph: graphFacts({
      ...base.graph,
      teamsByIssueId: {
        'id-pay-127': [team('team-mobile', { name: 'Mobile', componentIds: ['cmp-mobile'] })],
      },
    }),
    linkedOutsideIssues: [
      issue('MOB-77', {
        projectKey: 'MOB',
        summary: 'Mobile: surface new payment methods',
        components: ['cmp-mobile'],
        serviceId: 'svc-mobile-app',
        serviceName: 'mobile-app',
      }),
    ],
  });
}

function seeded(options: { decision?: Decision; outcome?: Outcome; withFacts?: boolean } = {}) {
  const store = new FakeStore();
  const index = new FakeIndex();
  const releaseFixture = release();
  store
    .seedPolicy(paiementsPolicy())
    .seedDossier({
      snapshot: snapshot({ versionId: VERSION_ID, verdict: 'no-go' }),
      signals: [],
      waivers: [],
      decisions: options.decision ? [options.decision] : [],
      outcome: options.outcome ?? null,
    });
  if (options.withFacts !== false) {
    index.addFacts(VERSION_ID, { cachedAt: '2026-11-11T06:00:00.000Z', release: releaseFixture });
  }
  return { store, index };
}

describe('action list-impacted-teams', () => {
  it('renvoie les équipes, les services et les tickets liés', async () => {
    const { store, index } = seeded();
    const result = await listImpactedTeams({ versionId: VERSION_ID }, depsFor(store, index));

    expect(result.versionId).toBe(VERSION_ID);
    expect(result.factsCachedAt).toBe('2026-11-11T06:00:00.000Z');
    const names = result.teams.map((entry) => entry.teamName);
    expect(names).toContain('Mobile');
    expect(names).toContain('Checkout');

    // PAY-127 is attached to Mobile by the graph, so Checkout gets it only
    // through the component map: both discovery paths are visible here.
    const mobile = result.teams.find((entry) => entry.teamName === 'Mobile');
    expect(mobile?.issues.some((entry) => entry.key === 'PAY-127')).toBe(true);
    const checkout = result.teams.find((entry) => entry.teamName === 'Checkout');
    expect(checkout?.via).toBe('component');
    expect(checkout?.issues.some((entry) => entry.key === 'PAY-128')).toBe(true);
    expect(checkout?.services[0]?.serviceId).toBe('svc-checkout-api');

    const services = result.services.map((entry) => entry.serviceId);
    expect(services).toContain('svc-checkout-api');
    expect(services).toContain('svc-mobile-app');

    const outside = result.tickets.find((entry) => entry.key === 'MOB-77');
    expect(outside?.inRelease).toBe(false);
    expect(outside?.projectKey).toBe('MOB');
    expect(result.tickets.find((entry) => entry.key === 'PAY-127')?.inRelease).toBe(true);
  });

  it('trouve une équipe par le graphe et marque le chemin « graph »', async () => {
    const { store, index } = seeded();
    const result = await listImpactedTeams({ versionId: VERSION_ID }, depsFor(store, index));
    const mobile = result.teams.find((entry) => entry.teamName === 'Mobile');
    expect(mobile?.via).toBe('graph');
  });

  it('renvoie une liste vide et datée quand rien n’a été collecté', async () => {
    const { store, index } = seeded({ withFacts: false });
    const result = await listImpactedTeams({ versionId: VERSION_ID }, depsFor(store, index));
    expect(result.teams).toEqual([]);
    expect(result.services).toEqual([]);
    expect(result.tickets).toEqual([]);
    expect(result.factsCachedAt).toBeNull();
  });

  it('échoue explicitement sur une version inconnue', async () => {
    const { store, index } = seeded();
    await expect(
      listImpactedTeams({ versionId: 'ver-404' }, depsFor(store, index)),
    ).rejects.toMatchObject({ code: 'version-unknown' });
  });
});

describe('action get-release-outcome', () => {
  const decision: Decision = {
    id: 'dec-ver-24-snap-1',
    versionId: VERSION_ID,
    snapshotId: 'snap-1',
    decidedBy: 'user-release-lead',
    decidedAt: '2026-11-12T09:00:00.000Z',
    decision: 'ship',
    verdictAtDecision: 'no-go',
    note: 'Shipped with a 24h waiver on COMP-01.',
  };

  const outcome: Outcome = {
    versionId: VERSION_ID,
    checkedAt: '2026-11-15T09:00:00.000Z',
    incidents: [
      {
        key: 'INC-61',
        severity: 'major',
        resolvedAfterMinutes: 45,
        url: 'https://pay.atlassian.net/browse/INC-61',
      },
    ],
    rollback: false,
    notes: 'One major incident, resolved in 45 minutes.',
  };

  it('renvoie la décision prise et le bilan à 72 h', async () => {
    const { store, index } = seeded({ decision, outcome });
    const result = await getReleaseOutcome({ versionId: VERSION_ID }, depsFor(store, index));

    expect(result.decision?.kind).toBe('ship');
    expect(result.decision?.verdictAtDecision).toBe('no-go');
    expect(result.decision?.note).toContain('24h waiver');
    expect(result.outcome?.incidents).toHaveLength(1);
    expect(result.outcome?.incidents[0]?.key).toBe('INC-61');
    expect(result.outcome?.summary.key).toBe('outcome.summary.incidents');
    expect(result.outcome?.summary.params).toMatchObject({ count: 1, majorCount: 1, minorCount: 0 });
  });

  it('garde la dernière décision et signale l’absence de bilan', async () => {
    const older: Decision = { ...decision, id: 'dec-older', decidedAt: '2026-11-11T09:00:00.000Z' };
    const { store, index } = seeded();
    store.seedDossier({
      snapshot: snapshot({ versionId: VERSION_ID, verdict: 'no-go' }),
      signals: [],
      waivers: [],
      decisions: [older, decision],
      outcome: null,
    });
    const result = await getReleaseOutcome({ versionId: VERSION_ID }, depsFor(store, index));
    expect(result.decision?.id).toBe('dec-ver-24-snap-1');
    expect(result.outcome).toBeNull();
  });

  it('ne fabrique ni décision ni bilan quand rien n’existe', async () => {
    const { store, index } = seeded();
    const result = await getReleaseOutcome({ versionId: VERSION_ID }, depsFor(store, index));
    expect(result.decision).toBeNull();
    expect(result.outcome).toBeNull();
    expect(result.versionReleased).toBe(false);
  });

  it('échoue explicitement sur une version inconnue', async () => {
    const { store, index } = seeded();
    await expect(
      getReleaseOutcome({ versionId: 'ver-404' }, depsFor(store, index)),
    ).rejects.toMatchObject({ code: 'version-unknown' });
  });
});
