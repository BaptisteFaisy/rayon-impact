import { describe, expect, it } from 'vitest';
import { detectAllSignals, recomputeRelease } from '../../src/engine/pipeline.js';
import { computeCoverage } from '../../src/engine/coverage.js';
import type { DetectionContext } from '../../src/signals/context.js';
import { paiementsPolicy, paiementsRelease } from '../fixtures/paiements.js';
import { InMemoryReleaseStore } from './fakes.js';
import type { NarrativeWriter, PipelineDeps } from '../../src/ports.js';
import type { CollectedRelease, Signal } from '../../src/types.js';

/**
 * End-to-end of the recompute pipeline: collect, detect, decide, write, store.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

const NOW = '2026-11-11T06:00:00.000Z';

function detectionContext(release: CollectedRelease): DetectionContext {
  return {
    release,
    policy: paiementsPolicy(),
    now: NOW,
    waivers: [],
    previousSignals: [],
    pastOutcomes: [],
  };
}

/** A summary that cites only what the signals say. */
const HONEST_SUMMARY = [
  'COMP-01 COMP-03 — PAY-131 is still in progress and has one open pull request.',
  'QUAL-01 — the last build on PAY-129 failed.',
  'EXP-01 — INC-52 is open on checkout-api.',
  'DEP-01 — PAY-130 is blocked by PAY-118, still in progress.',
  'QUAL-02 — PAY-135 contains a pull request merged without approval.',
].join('\n');

function depsFor(release: CollectedRelease, narrative: NarrativeWriter) {
  const store = new InMemoryReleaseStore();
  const deps: PipelineDeps = {
    store,
    collector: { async collect() { return release; } },
    narrative,
    clock: { now: () => NOW },
    logger: { log() {} },
  };
  return { deps, store };
}

const request = {
  projectId: 'proj-pay',
  versionId: 'ver-24',
  viewerAccountId: null,
  reason: 'event' as const,
};

describe('detectAllSignals', () => {
  it('raises the blocking signals of the demo release, ordered by severity', () => {
    const signals = detectAllSignals(detectionContext(paiementsRelease()));
    const blocking = signals.filter((signal) => signal.severity === 'blocking');
    expect(blocking.map((signal) => signal.code)).toContain('COMP-01');
    expect(blocking.map((signal) => signal.code)).toContain('COMP-03');
    expect(blocking.map((signal) => signal.code)).toContain('EXP-01');

    const rank = { blocking: 0, major: 1, minor: 2, info: 3 } as const;
    const ranks = signals.map((signal) => rank[signal.severity]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('never raises the same signal twice', () => {
    const signals = detectAllSignals(detectionContext(paiementsRelease()));
    const ids = signals.map((signal) => signal.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('recomputeRelease', () => {
  it('stores a no-go dossier with a verified summary', async () => {
    const { deps, store } = depsFor(paiementsRelease(), {
      async write() { return HONEST_SUMMARY; },
    });
    const result = await recomputeRelease(deps, request);

    expect(result.snapshot.verdict).toBe('no-go');
    expect(result.narrativeFromModel).toBe(true);
    const stored = await store.getDossier('ver-24');
    expect(stored?.signals.length).toBeGreaterThan(0);
    expect(stored?.snapshot.narrative).toContain('COMP-01');
  });

  it('falls back to the deterministic summary when the model invents a ticket', async () => {
    const { deps } = depsFor(paiementsRelease(), {
      async write() {
        return 'PAY-999 is blocking the release even though nobody mentioned it.';
      },
    });
    const result = await recomputeRelease(deps, request);

    expect(result.narrativeFromModel).toBe(false);
    expect(result.snapshot.narrative).not.toContain('PAY-999');
  });

  it('caches the collection with the dossier', async () => {
    const { deps, store } = depsFor(paiementsRelease(), { async write() { return ''; } });
    await recomputeRelease(deps, request);
    const cached = await store.getCollection('ver-24');
    expect(cached?.release.issues.length).toBe(14);
  });

  it('keeps the previous snapshot as the reference of the next one', async () => {
    const { deps } = depsFor(paiementsRelease(), { async write() { return ''; } });
    const first = await recomputeRelease(deps, request);
    const second = await recomputeRelease(deps, request);
    expect(second.snapshot.previousSnapshotId).toBe(first.snapshot.id);
  });

  it('does not store a dossier when the collection fails', async () => {
    const { deps, store } = depsFor(paiementsRelease(), { async write() { return ''; } });
    deps.collector = {
      async collect(): Promise<CollectedRelease> {
        throw new Error('jira is down');
      },
    };
    await expect(recomputeRelease(deps, request)).rejects.toThrow('jira is down');
    expect(await store.getDossier('ver-24')).toBeNull();
  });

  it('carries firstSeenAt over when a signal was already raised', async () => {
    const release = paiementsRelease();
    const previous: Signal[] = detectAllSignals(detectionContext(release)).map((signal) => ({
      ...signal,
      firstSeenAt: '2026-11-01T00:00:00.000Z',
    }));
    expect(previous.length).toBeGreaterThan(0);

    const { deps, store } = depsFor(release, { async write() { return ''; } });
    await store.saveSnapshot(
      {
        id: 'snap-prev',
        projectId: 'proj-pay',
        projectKey: 'PAY',
        versionId: 'ver-24',
        versionName: '2.4',
        versionReleased: false,
        computedAt: '2026-11-01T00:00:00.000Z',
        verdict: 'no-go',
        confidence: 'high',
        coverage: computeCoverage(release),
        counts: { blocking: 0, major: 0, minor: 0, info: 0 },
        narrative: '',
        narrativeVerified: false,
        narrativeRejections: [],
        graphCachedAt: null,
        previousSnapshotId: null,
      },
      previous,
    );

    const result = await recomputeRelease(deps, request);
    const carried = result.signals.find((signal) => signal.id === previous[0].id);
    expect(carried?.firstSeenAt).toBe('2026-11-01T00:00:00.000Z');
  });
});
