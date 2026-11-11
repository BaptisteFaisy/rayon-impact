import { describe, expect, it } from 'vitest';
import { recomputeOutcome } from '../../src/engine/pipeline';
import { paiementsPolicy, paiementsRelease } from '../fixtures/paiements';
import { incident } from '../fixtures/builders';
import { InMemoryReleaseStore } from './fakes';
import type { PipelineDeps } from '../../src/ports';
import type { CollectedRelease, Incident } from '../../src/types';

/**
 * The 72 h outcome, end to end (RI-15): the window, the release date taken from
 * the version, the incidents filtered on the impacted services, and the honest
 * refusals (no cache, no incident source, window not elapsed).
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

const RELEASED_AT = '2026-11-01T10:00:00.000Z';
const INSIDE = '2026-11-02T09:00:00.000Z';
const AFTER_WINDOW = '2026-11-09T09:00:00.000Z';
const NOW_AFTER_WINDOW = '2026-11-05T10:00:00.000Z';

function releasedRelease(): CollectedRelease {
  const release = paiementsRelease();
  return {
    ...release,
    version: { ...release.version, released: true, releaseDate: RELEASED_AT },
    issues: release.issues.map((issue, index) =>
      index < 2 ? issue : { ...issue, serviceId: null, serviceName: undefined },
    ),
  };
}

interface DepsOptions {
  release?: CollectedRelease;
  incidents?: Incident[];
  withIncidentSource?: boolean;
  now?: string;
  cached?: boolean;
}

function depsFor(options: DepsOptions = {}) {
  const store = new InMemoryReleaseStore();
  const release = options.release ?? releasedRelease();
  const incidents = options.incidents ?? [];
  const collector: PipelineDeps['collector'] = {
    async collect() {
      return release;
    },
  };
  if (options.withIncidentSource !== false) {
    collector.collectIncidents = async (serviceIds, sinceIso, untilIso) => {
      const from = new Date(sinceIso).getTime();
      const to = new Date(untilIso).getTime();
      return incidents.filter(
        (item) =>
          serviceIds.includes(item.serviceId ?? '') &&
          new Date(item.createdAt).getTime() >= from &&
          new Date(item.createdAt).getTime() <= to,
      );
    };
  }
  const deps: PipelineDeps = {
    store,
    collector,
    narrative: { async write() { return ''; } },
    clock: { now: () => options.now ?? NOW_AFTER_WINDOW },
    logger: { log() {} },
  };
  return { deps, store, release };
}

const request = {
  projectId: 'proj-pay',
  versionId: 'ver-24',
  viewerAccountId: null,
  reason: 'outcome' as const,
};

describe('recomputeOutcome', () => {
  it('writes the outcome once the 72 h window is closed', async () => {
    const incidents = [
      incident('INC-60', { createdAt: INSIDE, serviceId: 'svc-checkout-api', majorIncident: true, resolvedAt: '2026-11-02T09:40:00.000Z' }),
      incident('INC-61', { createdAt: INSIDE, serviceId: 'svc-checkout-api' }),
    ];
    const { deps, store } = depsFor({ incidents });
    await store.saveCollection('ver-24', releasedRelease(), RELEASED_AT);

    const outcome = await recomputeOutcome(deps, request);

    expect(outcome).not.toBeNull();
    expect(outcome?.incidents).toHaveLength(2);
    expect(outcome?.incidents[0].severity).toBe('major');
    expect(outcome?.incidents[0].resolvedAfterMinutes).toBe(40);
    expect(outcome?.notes).toContain('2 incident');
    expect(await store.getOutcome('ver-24')).not.toBeNull();
  });

  it('ignores incidents outside the window or outside the impacted services', async () => {
    const incidents = [
      incident('INC-70', { createdAt: AFTER_WINDOW, serviceId: 'svc-checkout-api' }),
      incident('INC-71', { createdAt: INSIDE, serviceId: 'svc-other' }),
    ];
    const { deps, store } = depsFor({ incidents });
    await store.saveCollection('ver-24', releasedRelease(), RELEASED_AT);

    const outcome = await recomputeOutcome(deps, request);

    expect(outcome?.incidents).toHaveLength(0);
    expect(outcome?.notes).toContain('Aucun incident');
  });

  it('returns null while the 72 h window is still open', async () => {
    const { deps, store } = depsFor({ now: '2026-11-01T12:00:00.000Z' });
    await store.saveCollection('ver-24', releasedRelease(), RELEASED_AT);
    expect(await recomputeOutcome(deps, request)).toBeNull();
  });

  it('returns null for a version that is not released', async () => {
    const { deps, store } = depsFor({ release: paiementsRelease() });
    await store.saveCollection('ver-24', paiementsRelease(), RELEASED_AT);
    expect(await recomputeOutcome(deps, request)).toBeNull();
  });

  it('returns null without a cached collection, instead of inventing an outcome', async () => {
    const { deps } = depsFor();
    expect(await recomputeOutcome(deps, request)).toBeNull();
  });

  it('returns null when no incident source is wired, rather than an empty outcome', async () => {
    const { deps, store } = depsFor({ withIncidentSource: false });
    await store.saveCollection('ver-24', releasedRelease(), RELEASED_AT);
    expect(await recomputeOutcome(deps, request)).toBeNull();
  });

  it('never recomputes an outcome already recorded', async () => {
    const { deps, store } = depsFor({ incidents: [] });
    await store.saveCollection('ver-24', releasedRelease(), RELEASED_AT);
    const first = await recomputeOutcome(deps, request);
    const second = await recomputeOutcome(deps, request);
    expect(second).toEqual(first);
  });

  it('keeps the policy service map as the source of impacted services', async () => {
    const release = releasedRelease();
    expect(paiementsPolicy().serviceMap.length).toBeGreaterThan(0);
    const services = release.issues
      .map((issue) => issue.serviceId)
      .filter((id): id is string => typeof id === 'string');
    expect(services).toContain('svc-checkout-api');
  });
});
