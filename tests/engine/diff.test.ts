import { describe, expect, it } from 'vitest';
import { diffIsEmpty, diffSnapshots } from '../../src/engine/diff.js';
import { makeSignal } from '../../src/signals/context.js';
import type { Signal } from '../../src/types.js';
import { collected, policy, snapshot } from '../fixtures/builders.js';

/** Compose signals through makeSignal so ids stay canonical (no literals). */
function ctxWith(now: string) {
  return {
    release: collected(),
    policy: policy(),
    now,
    waivers: [],
    previousSignals: [] as Signal[],
    pastOutcomes: [],
  };
}

function signal(id: string): Signal {
  const [code, subjectType, subjectId] = id.split(':');
  return makeSignal(ctxWith('2026-11-10T10:00:00.000Z'), {
    code: code as Signal['code'],
    subject: {
      subjectType: subjectType as Signal['subjectType'],
      subjectId,
    },
    finding: { key: 'signal.comp01.finding', params: { key: subjectId } },
    evidence: [],
  });
}

describe('engine/diff', () => {
  const sig1 = signal('COMP-01:issue:id-pay-131');
  const sig2 = signal('COMP-02:issue:id-pay-132');

  it('pas de précédent : previousSnapshotId null, tout est ajouté', () => {
    const snap = snapshot({ id: 'snap-1', verdict: 'no-go' });
    const diff = diffSnapshots(null, { snapshot: snap, signals: [sig1] });

    expect(diff.previousSnapshotId).toBeNull();
    expect(diff.added).toEqual([sig1]);
    expect(diff.cleared).toEqual([]);
    expect(diff.severityChanged).toEqual([]);
    expect(diff.verdictChange).toBeNull();
    expect(diffIsEmpty(diff)).toBe(false);
  });

  it('dossiers identiques : diff vide', () => {
    const diff = diffSnapshots(
      { snapshot: snapshot({ id: 'snap-1', verdict: 'go' }), signals: [sig1] },
      { snapshot: snapshot({ id: 'snap-2', verdict: 'go' }), signals: [sig1] },
    );

    expect(diff.previousSnapshotId).toBe('snap-1');
    expect(diffIsEmpty(diff)).toBe(true);
  });

  it('ajouté / disparu / changement d’avis (RI-14 « depuis hier »)', () => {
    const diff = diffSnapshots(
      {
        snapshot: snapshot({ id: 'snap-1', verdict: 'no-go' }),
        signals: [sig1],
      },
      {
        snapshot: snapshot({ id: 'snap-2', verdict: 'conditional-go' }),
        signals: [sig2],
      },
    );

    expect(diff.added).toEqual([sig2]);
    expect(diff.cleared).toEqual([sig1]);
    expect(diff.verdictChange).toEqual({
      from: 'no-go',
      to: 'conditional-go',
    });
    expect(diffIsEmpty(diff)).toBe(false);
  });

  it('changement de gravité sur un signal existant', () => {
    const upgraded: Signal = { ...sig1, severity: 'major' };
    const diff = diffSnapshots(
      { snapshot: snapshot({ id: 'snap-1' }), signals: [sig1] },
      { snapshot: snapshot({ id: 'snap-2' }), signals: [upgraded] },
    );

    expect(diff.added).toHaveLength(0);
    expect(diff.cleared).toHaveLength(0);
    expect(diff.severityChanged).toEqual([
      { signalId: sig1.id, from: 'blocking', to: 'major' },
    ]);
    expect(diffIsEmpty(diff)).toBe(false);
  });

  it('changement de statut seul (active → waived) n’est ni ajout ni disparition', () => {
    const waived: Signal = { ...sig1, status: 'waived' };
    const diff = diffSnapshots(
      { snapshot: snapshot({ id: 'snap-1' }), signals: [sig1] },
      { snapshot: snapshot({ id: 'snap-2' }), signals: [waived] },
    );
    expect(diffIsEmpty(diff)).toBe(true);
  });
});
