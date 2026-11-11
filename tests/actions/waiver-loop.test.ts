/**
 * Boucle complète des dérogations (SPEC §15, §16, recette §17.3) :
 * accord → signal `waived` → avis `conditional-go` ; expiration nocturne →
 * clôture automatique au passage horaire → l'avis repasse `no-go` ; clôture
 * manuelle via `close-waiver` ; une dérogation close n'est jamais supprimée.
 *
 * Aucun réseau, aucune E/S : le faux store existant porte tout l'état.
 */
import { describe, expect, it } from 'vitest';
import {
  closeWaiverAction,
  parseCloseWaiverInput,
  requestWaiver,
} from '../../src/actions/decisions';
import { ACTION_KEYS, getAction } from '../../src/actions/registry';
import { computeVerdict } from '../../src/engine/verdict';
import { listLiveWaivers } from '../../src/engine/waiver';
import { detectComp } from '../../src/signals/comp';
import { createMemoryGate } from '../../src/triggers/events';
import {
  onScheduled,
  scheduledVersion,
  WAIVER_EXPIRED_REASON,
  type ScheduledDeps,
  type ScheduledVersion,
} from '../../src/triggers/scheduled';
import type { RecomputeMessage } from '../../src/ports';
import type { CollectedRelease, Signal, Verdict, Waiver } from '../../src/types';
import {
  collected,
  fullCoverage,
  issue,
  policy,
  snapshot,
  version,
} from '../fixtures/builders';
import {
  NOW,
  RELEASE_LEAD,
  FakeIndex,
  FakeStore,
  depsFor,
  recordingLogger,
} from './fake-store';

const VERSION_ID = 'ver-24';
const BLOCKING_KEY = 'PAY-131';
const WAIVER_ID = `wv-${VERSION_ID}-COMP-01-id-${BLOCKING_KEY.toLowerCase()}`;
/** Le lendemain matin : la dérogation de 24 h accordée à NOW a expiré (§16). */
const NEXT_MORNING = '2026-11-12T11:00:00.000Z';

function release(): CollectedRelease {
  return collected({
    issues: [
      issue(BLOCKING_KEY, { statusName: 'In Progress', statusCategory: 'in-progress' }),
      issue('PAY-132'),
    ],
  });
}

function seeded() {
  const store = new FakeStore();
  const index = new FakeIndex();
  const releaseFixture = release();
  store.seedPolicy(policy()).seedDossier({
    snapshot: snapshot({
      versionId: VERSION_ID,
      verdict: 'no-go',
      coverage: fullCoverage(2),
      counts: { blocking: 1, major: 0, minor: 0, info: 0 },
    }),
    signals: [],
    waivers: [],
    decisions: [],
    outcome: null,
  });
  index.addFacts(VERSION_ID, { cachedAt: '2026-11-11T06:00:00.000Z', release: releaseFixture });
  return { store, index, release: releaseFixture };
}

/** Recalcule détecteur + avis déterministe avec les dérogations du store. */
function recompute(fixture: CollectedRelease, waivers: Waiver[], at: string) {
  const ctx = {
    release: fixture,
    policy: policy(),
    now: at,
    waivers,
    previousSignals: [],
    pastOutcomes: [],
  };
  const signals: Signal[] = detectComp(ctx);
  return { signals, result: computeVerdict(signals, fullCoverage(2), fixture) };
}

async function grant24h(store: FakeStore, index: FakeIndex, signalId: string) {
  const result = await requestWaiver(
    { signalId, reason: 'Doc will follow within 24 h', hours: 24 },
    depsFor(store, index),
  );
  expect(result.granted).toBe(true);
  if (!result.granted) throw new Error('waiver refused');
  return result.waiver;
}

/** `onScheduled` horaire branché sur le même FakeStore que les actions. */
function scheduledDepsFor(store: FakeStore, at: string, open: ScheduledVersion[]) {
  const published: RecomputeMessage[] = [];
  const logger = recordingLogger();
  const deps: ScheduledDeps = {
    queue: {
      async publish(message: RecomputeMessage): Promise<void> {
        published.push(message);
      },
    },
    gate: createMemoryGate(),
    clock: { now: () => at },
    logger,
    versions: {
      async listOpenVersions(): Promise<ScheduledVersion[]> {
        return open;
      },
      async listReleasedVersions(): Promise<ScheduledVersion[]> {
        return [];
      },
    },
    store,
  };
  return { deps, published, logger };
}

async function blockingSignalId(store: FakeStore, index: FakeIndex): Promise<string> {
  const { signals } = recompute(
    (await index.getFacts(VERSION_ID))!.release,
    await store.getWaivers(VERSION_ID),
    NOW,
  );
  const blocking = signals.find((signal) => signal.severity === 'blocking');
  expect(blocking).toBeDefined();
  index.addSignals(VERSION_ID, signals);
  return blocking!.id;
}

describe('boucle dérogations — recette §17.3', () => {
  it('acceptance §17.3 : dérogation 24 h sur signal bloquant → waived + conditional-go avec la condition listée', async () => {
    const { store, index, release: fixture } = seeded();
    const signalId = await blockingSignalId(store, index);
    const waiver = await grant24h(store, index, signalId);
    expect(waiver.id).toBe(WAIVER_ID);
    expect(waiver.expiresAt).toBe('2026-11-12T10:00:00.000Z');

    const waivers = await store.getWaivers(VERSION_ID);
    expect(listLiveWaivers(waivers, NOW)).toHaveLength(1);
    const { signals, result } = recompute(fixture, waivers, NOW);
    expect(signals[0]!.status).toBe('waived');
    expect(signals[0]!.waiverId).toBe(WAIVER_ID);
    expect(result.verdict).toBe('conditional-go');
    expect(result.conditions.map((c) => c.signalCode)).toEqual(['COMP-01']);
    expect(result.conditions[0]!.subjectId).toBe(`id-${BLOCKING_KEY.toLowerCase()}`);
  });
});

describe('boucle dérogations — clôture manuelle via close-waiver', () => {
  it('clôt la dérogation, la garde en store (SPEC §15) et l’avis redevient no-go', async () => {
    const { store, index, release: fixture } = seeded();
    const signalId = await blockingSignalId(store, index);
    await grant24h(store, index, signalId);

    const result = await closeWaiverAction(
      { waiverId: WAIVER_ID, reason: 'Doc publiée en avance' },
      depsFor(store, index),
    );
    expect(result.closed).toBe(true);
    if (!result.closed) return;
    expect(result.waiver.closedAt).toBe(NOW);
    expect(result.waiver.closedReason).toBe('Doc publiée en avance');
    expect(result.waiver.reason).toBe('Doc will follow within 24 h');

    // Jamais supprimée : toujours une seule entrée, close, dans le store.
    const waivers = await store.getWaivers(VERSION_ID);
    expect(waivers).toHaveLength(1);
    expect(waivers[0]!.closedAt).toBe(NOW);
    expect(listLiveWaivers(waivers, NOW)).toHaveLength(0);

    const { signals, result: recomputed } = recompute(fixture, waivers, NOW);
    expect(signals[0]!.status).toBe('active');
    expect(recomputed.verdict).toBe('no-go');
  });

  it('refuse avec un motif : inconnue, déjà close, motif absent, demandeur non habilité', async () => {
    const { store, index } = seeded();
    const deps = depsFor(store, index);

    const unknown = await closeWaiverAction({ waiverId: 'wv-ghost', reason: 'x' }, deps);
    expect(unknown).toMatchObject({
      closed: false,
      refusal: { key: 'waiver.notFound', params: { waiverId: 'wv-ghost' } },
    });

    const signalId = await blockingSignalId(store, index);
    await grant24h(store, index, signalId);

    const noReason = await closeWaiverAction({ waiverId: WAIVER_ID, reason: '   ' }, deps);
    expect(noReason.closed).toBe(false);
    if (!noReason.closed) expect(noReason.refusal.key).toBe('waiver.reason.required');

    const intruder = await closeWaiverAction(
      { waiverId: WAIVER_ID, reason: 'I want to ship' },
      depsFor(store, index, { viewer: { accountId: 'user-intruder' } }),
    );
    expect(intruder.closed).toBe(false);
    if (!intruder.closed) {
      expect(intruder.refusal.key).toBe('waiver.approver.unauthorized');
      expect(intruder.refusal.params).toEqual({ approver: 'user-intruder' });
    }

    // Les refus n'ont rien écrit : la dérogation est toujours vivante.
    expect((await store.getWaivers(VERSION_ID))[0]!.closedAt).toBeUndefined();

    const first = await closeWaiverAction({ waiverId: WAIVER_ID, reason: 'Révoquée' }, deps);
    expect(first.closed).toBe(true);
    const twice = await closeWaiverAction({ waiverId: WAIVER_ID, reason: 'Encore' }, deps);
    expect(twice.closed).toBe(false);
    if (!twice.closed) {
      expect(twice.refusal.key).toBe('waiver.alreadyClosed');
      expect(twice.refusal.params).toMatchObject({ waiverId: WAIVER_ID, closedAt: NOW });
    }
    // Toujours une seule entrée en store : close, jamais supprimée (SPEC §15).
    expect(await store.getWaivers(VERSION_ID)).toHaveLength(1);
  });

  it('accepte le porteur du rôle projet (canWaive) comme le fait request-waiver', async () => {
    const { store, index } = seeded();
    store.seedPolicy(policy({ waiverApprovers: [] }));
    const signalId = await blockingSignalId(store, index);
    const granted = await requestWaiver(
      { signalId, reason: 'Project role holder decision', hours: 24 },
      depsFor(store, index, { viewer: { accountId: RELEASE_LEAD, canWaive: true } }),
    );
    expect(granted.granted).toBe(true);
    const closed = await closeWaiverAction(
      { waiverId: WAIVER_ID, reason: 'Finalement non' },
      depsFor(store, index, { viewer: { accountId: RELEASE_LEAD, canWaive: true } }),
    );
    expect(closed.closed).toBe(true);
  });

  it('lit les entrées brutes du manifest et l’action est bien enregistrée', () => {
    expect(parseCloseWaiverInput({ waiverId: 'wv-1', reason: 'r' })).toEqual({
      waiverId: 'wv-1',
      reason: 'r',
    });
    expect(parseCloseWaiverInput({ waiverId: 'wv-1' })).toEqual({ waiverId: 'wv-1', reason: '' });
    expect(() => parseCloseWaiverInput({ reason: 'r' })).toThrow(/waiverId/);

    expect(ACTION_KEYS[ACTION_KEYS.length - 1]).toBe('close-waiver');
    expect(getAction('close-waiver')?.verb).toBe('CREATE');
  });
});

describe('boucle dérogations — expiration nocturne (SPEC §16)', () => {
  it('expirée → plus vivante, close « expired » au passage horaire, avis de retour à no-go', async () => {
    const { store, index, release: fixture } = seeded();
    const signalId = await blockingSignalId(store, index);
    await grant24h(store, index, signalId);

    // Le lendemain matin : la dérogation de 24 h n'est plus vivante.
    const waivers = await store.getWaivers(VERSION_ID);
    expect(listLiveWaivers(waivers, NEXT_MORNING)).toHaveLength(0);

    const { deps, published, logger } = scheduledDepsFor(store, NEXT_MORNING, [
      scheduledVersion(version({ id: VERSION_ID })),
    ]);
    const messages = await onScheduled({ context: { moduleKey: 'hourly-refresh' } }, deps);

    // Clôture automatique : motif explicite, jamais supprimée (SPEC §15).
    const after = await store.getWaivers(VERSION_ID);
    expect(after).toHaveLength(1);
    expect(after[0]!.closedAt).toBe(NEXT_MORNING);
    expect(after[0]!.closedReason).toBe(WAIVER_EXPIRED_REASON);
    expect(logger.lines).toContainEqual({
      level: 'info',
      message: 'scheduled expired waivers closed',
    });

    // Le recalcul horaire est bien demandé pour la version ouverte.
    expect(messages.map((m) => m.versionId)).toEqual([VERSION_ID]);
    expect(published).toHaveLength(1);

    // Et l'avis repasse en no-go : plus aucun signal `waived` (SPEC §16).
    const { signals, result } = recompute(fixture, after, NEXT_MORNING);
    expect(signals[0]!.status).toBe('active');
    const verdict: Verdict = result.verdict;
    expect(verdict).toBe('no-go');
  });

  it('ne touche ni aux dérogations vivantes ni aux versions déjà closes', async () => {
    const { store, index } = seeded();
    const signalId = await blockingSignalId(store, index);
    await grant24h(store, index, signalId);

    // Passage horaire avant expiration : rien n'est clos.
    const before = scheduledDepsFor(store, NOW, [scheduledVersion(version({ id: VERSION_ID }))]);
    await onScheduled({ context: { moduleKey: 'hourly-refresh' } }, before.deps);
    expect((await store.getWaivers(VERSION_ID))[0]!.closedAt).toBeUndefined();

    // Une seconde clôture automatique après expiration est idempotente.
    const first = scheduledDepsFor(store, NEXT_MORNING, [
      scheduledVersion(version({ id: VERSION_ID })),
    ]);
    await onScheduled({ context: { moduleKey: 'hourly-refresh' } }, first.deps);
    const second = scheduledDepsFor(store, NEXT_MORNING, [
      scheduledVersion(version({ id: VERSION_ID })),
    ]);
    await onScheduled({ context: { moduleKey: 'hourly-refresh' } }, second.deps);
    const after = await store.getWaivers(VERSION_ID);
    expect(after).toHaveLength(1);
    expect(after[0]!.closedAt).toBe(NEXT_MORNING);
  });
});
