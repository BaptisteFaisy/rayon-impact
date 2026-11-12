import { describe, expect, it } from 'vitest';
import {
  DECISION_KINDS_EXHAUSTIVE,
  MAX_DECISION_NOTE,
  parseRecordDecisionInput,
  recordDecisionAction,
} from '../../src/actions/decisions';
import type { RecordDecisionOutput } from '../../src/actions/decisions';
import { ACTION_KEYS, ACTIONS } from '../../src/actions/registry';
import { latestDecision, recordDecision } from '../../src/engine/decision';
import type { Verdict } from '../../src/types';
import { fullCoverage, snapshot } from '../fixtures/builders';
import { NOW, RELEASE_LEAD, FakeIndex, FakeStore, depsFor } from './fake-store';

/**
 * `record-decision` (SPEC §10, RI-08, SPEC §15 traceability).
 *
 * Scenario §6.1 step 7: the verdict turned conditional-go, the lead records
 * "on livre". The verdict frozen in the decision is the dossier's, the decider
 * is the Forge viewer — inputs from the LLM never decide either (R2 §2.3).
 */
const VERSION_ID = 'ver-24';
const SNAPSHOT_ID = 'snap-1';
const LATER = '2026-11-11T12:00:00.000Z';

function seeded(verdict: Verdict = 'conditional-go') {
  const store = new FakeStore();
  const index = new FakeIndex();
  store.seedDossier({
    snapshot: snapshot({ versionId: VERSION_ID, verdict, coverage: fullCoverage(2) }),
    signals: [],
    waivers: [],
    decisions: [],
    outcome: null,
  });
  return { store, index };
}

/** Deps whose clock answers `LATER`, for the two-successive-decisions case. */
function laterDeps(store: FakeStore, index: FakeIndex) {
  return { ...depsFor(store, index), clock: { now: () => LATER } };
}

describe('action record-decision (RI-08)', () => {
  it('cas nominal : enregistre la décision avec l’avis du dossier et l’identité du viewer', async () => {
    const { store, index } = seeded();
    const result = await recordDecisionAction(
      { versionId: VERSION_ID, decision: 'ship', note: '  Conditions suivies par le lead  ' },
      depsFor(store, index),
    );

    expect(result.decision.id).toBe(`dec-${VERSION_ID}-${SNAPSHOT_ID}-${NOW}`);
    expect(result.decision.decision).toBe('ship');
    expect(result.decision.decidedBy).toBe(RELEASE_LEAD);
    expect(result.decision.decidedAt).toBe(NOW);
    expect(result.decision.snapshotId).toBe(SNAPSHOT_ID);
    expect(result.decision.note).toBe('Conditions suivies par le lead');
    expect(result.verdictAtDecision).toBe('conditional-go');
    expect(result.decision.verdictAtDecision).toBe('conditional-go');
    expect(result.verdictChanged).toBe(false);
    expect(await store.getDecisions(VERSION_ID)).toHaveLength(1);
  });

  it('refuse avec un motif explicite quand le dossier est absent ou la version inconnue', async () => {
    const empty = new FakeStore();
    await expect(
      recordDecisionAction({ versionId: VERSION_ID, decision: 'ship' }, depsFor(empty, new FakeIndex())),
    ).rejects.toMatchObject({ code: 'version-unknown' });

    const { store, index } = seeded();
    await expect(
      recordDecisionAction({ versionId: 'ver-404', decision: 'ship' }, depsFor(store, index)),
    ).rejects.toMatchObject({ code: 'version-unknown' });
    expect(await store.getDecisions('ver-404')).toHaveLength(0);
  });

  it('refuse avec un motif une valeur de decision invalide, sans quatrième valeur possible', async () => {
    expect(() => parseRecordDecisionInput({ versionId: VERSION_ID, decision: 'maybe' })).toThrow(
      /Unknown decision "maybe"\. Use ship, hold, delay\./,
    );
    expect(() => parseRecordDecisionInput({ versionId: VERSION_ID })).toThrow(/decision/);
    expect(DECISION_KINDS_EXHAUSTIVE).toBe(true);

    const { store, index } = seeded();
    // `run` rethrows the parse error synchronously (ActionDefinition.run).
    expect(() =>
      ACTIONS['record-decision'].run(
        { versionId: VERSION_ID, decision: 'livrer' },
        depsFor(store, index),
      ),
    ).toThrow(/Unknown decision "livrer"/);
  });

  it('refuse une note au-delà de la borne et accepte la borne exacte', () => {
    const tooLong = 'x'.repeat(MAX_DECISION_NOTE + 1);
    expect(() =>
      parseRecordDecisionInput({ versionId: VERSION_ID, decision: 'ship', note: tooLong }),
    ).toThrow(new RegExp(`limited to ${MAX_DECISION_NOTE} characters`));
    expect(
      parseRecordDecisionInput({
        versionId: VERSION_ID,
        decision: 'hold',
        note: 'x'.repeat(MAX_DECISION_NOTE),
      }),
    ).toEqual({ versionId: VERSION_ID, decision: 'hold', note: 'x'.repeat(MAX_DECISION_NOTE) });
  });

  it('deux décisions successives : latestDecision rend la dernière, les deux sont conservées (SPEC §15)', async () => {
    const { store, index } = seeded();
    await recordDecisionAction(
      { versionId: VERSION_ID, decision: 'hold', note: 'On attend le build' },
      depsFor(store, index),
    );
    const second = await recordDecisionAction(
      { versionId: VERSION_ID, decision: 'ship' },
      laterDeps(store, index),
    );

    const decisions = await store.getDecisions(VERSION_ID);
    expect(decisions).toHaveLength(2);
    expect(latestDecision(decisions)).toEqual(second.decision);
    expect(second.decision.decidedAt).toBe(LATER);
    expect(second.decision.id).not.toBe(decisions[0]!.id);
    expect(second.verdictChanged).toBe(false);
  });

  it('signale verdictChanged quand l’avis a bougé depuis la dernière décision', async () => {
    const store = new FakeStore();
    const previous = recordDecision({
      versionId: VERSION_ID,
      snapshotId: SNAPSHOT_ID,
      decidedBy: 'user-previous-lead',
      decision: 'hold',
      verdictAtDecision: 'no-go',
      now: '2026-11-10T10:00:00.000Z',
    });
    store.seedDossier({
      snapshot: snapshot({ versionId: VERSION_ID, verdict: 'conditional-go' }),
      signals: [],
      waivers: [],
      decisions: [previous],
      outcome: null,
    });

    const result = await recordDecisionAction(
      { versionId: VERSION_ID, decision: 'ship' },
      depsFor(store, new FakeIndex()),
    );
    expect(result.verdictChanged).toBe(true);
    expect(result.verdictAtDecision).toBe('conditional-go');
    expect(await store.getDecisions(VERSION_ID)).toHaveLength(2);
  });

  it('ignore l’avis et l’identité fournis par l’appelant : seul le dossier fait foi', async () => {
    const { store, index } = seeded('no-go');
    const raw = await ACTIONS['record-decision'].run(
      {
        versionId: VERSION_ID,
        decision: 'ship',
        note: '',
        verdict: 'go',
        verdictAtDecision: 'go',
        decidedBy: 'user-intruder',
      },
      depsFor(store, index),
    );
    const result = raw as RecordDecisionOutput;
    expect(result.verdictAtDecision).toBe('no-go');
    expect(result.decision.decidedBy).toBe(RELEASE_LEAD);
    expect(await store.getDecisions(VERSION_ID)).toHaveLength(1);
  });

  it('est bien enregistrée dans le registre avec le verbe CREATE', () => {
    expect(ACTION_KEYS).toContain('record-decision');
    expect(ACTIONS['record-decision'].verb).toBe('CREATE');
    expect(ACTIONS['record-decision'].key).toBe('record-decision');
    // The manifest description must stay under the Forge linter limit.
    expect(ACTIONS['record-decision'].description.length).toBeLessThan(255);
    expect(Object.keys(ACTIONS['record-decision'].inputs)).toEqual([
      'versionId',
      'decision',
      'note',
    ]);
    // waiver-loop.test.ts pins the order: `close-waiver` stays last.
    expect(ACTION_KEYS[ACTION_KEYS.length - 1]).toBe('close-waiver');
  });
});
