import { describe, expect, it } from 'vitest';
import {
  MIN_RECOMPUTE_INTERVAL_SECONDS,
  coalesceRequests,
  shouldRecompute,
  trailingPass,
} from '../../src/engine/debounce';
import type { RecomputeMessage } from '../../src/ports';

function request(
  versionId: string,
  reason: RecomputeMessage['reason'],
  requestedAt: string,
): RecomputeMessage {
  return { projectId: 'proj-pay', versionId, reason, requestedAt };
}

describe('engine/debounce — shouldRecompute', () => {
  const now = '2026-11-11T10:00:00.000Z';

  it('queues the first recompute of a version', () => {
    expect(shouldRecompute(null, now)).toBe(true);
  });

  it('defaults to a 60 s window (SPEC §12)', () => {
    expect(MIN_RECOMPUTE_INTERVAL_SECONDS).toBe(60);
    expect(shouldRecompute('2026-11-11T09:59:00.000Z', now)).toBe(true);
  });

  it('blocks a second recompute inside the minute', () => {
    expect(shouldRecompute('2026-11-11T09:59:59.000Z', now)).toBe(false);
  });

  it('honours a custom interval', () => {
    expect(shouldRecompute('2026-11-11T09:59:31.000Z', now, 30)).toBe(false);
    expect(shouldRecompute('2026-11-11T09:59:30.000Z', now, 30)).toBe(true);
  });

  it('fails open on an unreadable timestamp, so a dossier never freezes', () => {
    expect(shouldRecompute('not-a-date', now)).toBe(true);
    expect(shouldRecompute(now, 'not-a-date')).toBe(true);
  });

  it('fails closed on a timestamp from the future (clock skew)', () => {
    expect(shouldRecompute('2026-11-11T10:00:30.000Z', now)).toBe(false);
  });
});

describe('engine/debounce — coalesceRequests', () => {
  it('accepts the first request as is', () => {
    const incoming = request('ver-24', 'event', '2026-11-11T10:00:00.000Z');
    expect(coalesceRequests([], incoming)).toEqual([incoming]);
  });

  it('keeps at most one message per version', () => {
    const pending = [request('ver-24', 'event', '2026-11-11T10:00:00.000Z')];
    const incoming = request('ver-24', 'schedule', '2026-11-11T10:00:05.000Z');
    const merged = coalesceRequests(pending, incoming);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.versionId).toBe('ver-24');
  });

  it('keeps the strongest reason: manual > event > schedule > outcome', () => {
    const ladder: RecomputeMessage['reason'][] = [
      'outcome',
      'schedule',
      'event',
      'manual',
    ];
    for (const weaker of ladder) {
      for (const stronger of ladder) {
        const pending = [request('ver-24', weaker, '2026-11-11T10:00:00.000Z')];
        const incoming = request('ver-24', stronger, '2026-11-11T10:00:10.000Z');
        const expected =
          ladder.indexOf(stronger) >= ladder.indexOf(weaker) ? stronger : weaker;
        expect(coalesceRequests(pending, incoming)[0]?.reason).toBe(expected);
      }
    }
  });

  it('keeps the earliest request when the reasons tie', () => {
    const pending = [request('ver-24', 'event', '2026-11-11T10:00:30.000Z')];
    const incoming = request('ver-24', 'event', '2026-11-11T10:00:10.000Z');
    expect(coalesceRequests(pending, incoming)[0]?.requestedAt).toBe(
      '2026-11-11T10:00:10.000Z',
    );
  });

  it('keeps every distinct version, in order of first appearance', () => {
    const pending = [
      request('ver-24', 'event', '2026-11-11T10:00:00.000Z'),
      request('ver-25', 'outcome', '2026-11-11T10:00:00.000Z'),
    ];
    const incoming = request('ver-26', 'schedule', '2026-11-11T10:00:00.000Z');
    expect(coalesceRequests(pending, incoming).map((m) => m.versionId)).toEqual([
      'ver-24',
      'ver-25',
      'ver-26',
    ]);
  });

  it('never mutates the pending list', () => {
    const pending = [request('ver-24', 'outcome', '2026-11-11T10:00:00.000Z')];
    const copy = [...pending];
    coalesceRequests(pending, request('ver-24', 'manual', '2026-11-11T10:00:01.000Z'));
    expect(pending).toEqual(copy);
  });

  it('acceptance SPEC §16 — version renommée : recalcul regroupé, un seul par minute', () => {
    const bulk = [
      request('ver-24', 'event', '2026-11-11T10:00:00.000Z'),
      request('ver-24', 'event', '2026-11-11T10:00:02.000Z'),
      request('ver-24', 'schedule', '2026-11-11T10:00:20.000Z'),
      request('ver-24', 'event', '2026-11-11T10:00:40.000Z'),
    ];
    const merged = bulk.reduce<RecomputeMessage[]>(
      (pending, incoming) => coalesceRequests(pending, incoming),
      [],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.reason).toBe('event');
    expect(merged[0]?.requestedAt).toBe('2026-11-11T10:00:00.000Z');
  });
});

/* ------------------------------------------------- trailingPass (SPEC §12) */

const QUEUED = '2026-11-12T10:00:00.000Z';
const COLLECT = '2026-11-12T10:00:01.000Z';
const DEFERRED_AT = '2026-11-12T10:00:12.000Z';

function deferredAt(requestedAt: string): { reason: RecomputeMessage['reason']; requestedAt: string } {
  return { reason: 'event', requestedAt };
}

describe('engine/debounce — trailingPass', () => {
  it('n’a rien à rejouer quand aucune demande n’est reportée', () => {
    expect(trailingPass(QUEUED, null, COLLECT, '2026-11-12T10:00:10.000Z')).toEqual({
      action: 'none',
      waitMs: 0,
    });
  });

  it('solde une demande déjà vue par la collecte qui se termine', () => {
    const decision = trailingPass(
      QUEUED,
      deferredAt('2026-11-12T10:00:00.500Z'),
      COLLECT,
      '2026-11-12T10:00:10.000Z',
    );
    expect(decision).toEqual({ action: 'clear', waitMs: 0 });
  });

  it('rejoue une demande arrivée pendant la collecte, en fin de fenêtre', () => {
    const decision = trailingPass(QUEUED, deferredAt(DEFERRED_AT), COLLECT, '2026-11-12T10:00:20.000Z');
    expect(decision.action).toBe('run');
    expect(decision.waitMs).toBe(40_000);
  });

  it('ne fait plus attendre une fois la fenêtre écoulée', () => {
    expect(trailingPass(QUEUED, deferredAt(DEFERRED_AT), COLLECT, '2026-11-12T10:01:30.000Z')).toEqual({
      action: 'run',
      waitMs: 0,
    });
  });

  it('fail open sur un requestedAt illisible : jamais de dossier gelé', () => {
    expect(trailingPass(QUEUED, deferredAt('pas-une-date'), COLLECT, '2026-11-12T10:00:20.000Z')).toEqual({
      action: 'run',
      waitMs: 0,
    });
  });

  it('fail open sur un lastQueuedAt illisible', () => {
    expect(trailingPass('illisible', deferredAt(DEFERRED_AT), COLLECT, '2026-11-12T10:00:20.000Z')).toEqual({
      action: 'run',
      waitMs: 0,
    });
  });

  it('borne l’attente à la fenêtre quand l’horloge a dérivé', () => {
    const decision = trailingPass(
      '2026-11-12T10:05:00.000Z',
      deferredAt(DEFERRED_AT),
      COLLECT,
      '2026-11-12T10:00:20.000Z',
    );
    expect(decision).toEqual({ action: 'run', waitMs: MIN_RECOMPUTE_INTERVAL_SECONDS * 1000 });
  });

  it('honore un intervalle personnalisé', () => {
    const decision = trailingPass(QUEUED, deferredAt(DEFERRED_AT), COLLECT, '2026-11-12T10:00:20.000Z', 300);
    expect(decision.waitMs).toBe(280_000);
  });
});
