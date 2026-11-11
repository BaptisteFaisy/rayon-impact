import { describe, expect, it } from 'vitest';
import {
  MIN_RECOMPUTE_INTERVAL_SECONDS,
  coalesceRequests,
  shouldRecompute,
} from '../../src/engine/debounce.js';
import type { RecomputeMessage } from '../../src/ports.js';

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
