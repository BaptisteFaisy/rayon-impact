import { describe, expect, it } from 'vitest';
import {
  latestDecision,
  recordDecision,
  type DecisionInput,
} from '../../src/engine/decision';

describe('engine/decision', () => {
  const baseInput: DecisionInput = {
    versionId: 'ver-24',
    snapshotId: 'snap-1',
    decidedBy: 'user-release-lead',
    decision: 'ship',
    verdictAtDecision: 'conditional-go',
    note: 'Shipped under waivers',
    now: '2026-11-11T12:00:00.000Z',
  };

  it('enregistre la décision avec un id déterministe et l’avis du moment (RI-08)', () => {
    const decision = recordDecision(baseInput);

    expect(decision.id).toBe('dec-ver-24-snap-1-2026-11-11T12:00:00.000Z');
    expect(decision.versionId).toBe('ver-24');
    expect(decision.snapshotId).toBe('snap-1');
    expect(decision.decidedBy).toBe('user-release-lead');
    expect(decision.decidedAt).toBe('2026-11-11T12:00:00.000Z');
    expect(decision.decision).toBe('ship');
    expect(decision.verdictAtDecision).toBe('conditional-go');
    expect(decision.note).toBe('Shipped under waivers');
  });

  it('ignore une note absente ou vide', () => {
    const noNote = recordDecision({ ...baseInput, note: undefined });
    expect(noNote.note).toBeUndefined();

    const emptyNote = recordDecision({ ...baseInput, note: '   ' });
    expect(emptyNote.note).toBeUndefined();
  });

  it('les décisions ne sont jamais supprimées : latestDecision lit tout l’historique', () => {
    const d1 = recordDecision({
      ...baseInput,
      snapshotId: 'snap-1',
      decision: 'hold',
      verdictAtDecision: 'no-go',
      now: '2026-11-10T10:00:00.000Z',
    });
    const d2 = recordDecision({
      ...baseInput,
      snapshotId: 'snap-2',
      decision: 'ship',
      verdictAtDecision: 'conditional-go',
      now: '2026-11-11T10:00:00.000Z',
    });

    expect(latestDecision([])).toBeNull();
    expect(latestDecision([d1])).toEqual(d1);
    expect(latestDecision([d1, d2])).toEqual(d2);
    expect(latestDecision([d2, d1])).toEqual(d2);
  });
});
