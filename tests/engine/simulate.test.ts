import { describe, expect, it } from 'vitest';
import type { Signal } from '../../src/types.js';
import {
  describeRemoval,
  MAX_REMOVAL_SET,
  minimalRemovalSet,
  signalsWithoutIssues,
  simulateWithout,
} from '../../src/engine/simulate.js';
import { LINKED_OUTSIDE_ISSUES, paiementsRelease } from '../fixtures/paiements.js';
import { fullCoverage } from '../fixtures/builders.js';
import { computeVerdictStub } from './simulate-verdict-stub.js';

function makeTestSignal(partial: Partial<Signal> & { id: string }): Signal {
  const subjectId = partial.subjectId ?? 'id-pay-131';
  return {
    code: 'COMP-01',
    subjectType: 'issue',
    subjectId,
    severity: 'blocking',
    status: 'active',
    finding: { key: 'signal.comp01.finding', params: { key: subjectId } },
    evidence: [],
    detectedAt: '2026-11-11T06:00:00.000Z',
    firstSeenAt: '2026-11-11T06:00:00.000Z',
    ...partial,
  };
}

describe('signalsWithoutIssues', () => {
  it('returns identical copy if issueKeys is empty', () => {
    const s1 = makeTestSignal({ id: 's1', subjectId: 'id-pay-131' });
    const result = signalsWithoutIssues([s1], []);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('s1');
  });

  it('filters out signals whose subject is a removed issue by key or id', () => {
    const rel = paiementsRelease();
    const s1 = makeTestSignal({ id: 's1', subjectId: 'id-pay-131' });
    const s2 = makeTestSignal({ id: 's2', subjectId: 'id-pay-129' });
    const result = signalsWithoutIssues([s1, s2], ['PAY-131'], rel);
    expect(result.map((s) => s.id)).toEqual(['s2']);
  });

  it('drops DEP-01 whose blocker is in the removed set', () => {
    const rel = { ...paiementsRelease(), linkedOutsideIssues: LINKED_OUTSIDE_ISSUES };
    const dep01 = makeTestSignal({
      id: 'dep-01:issue:id-pay-130',
      code: 'DEP-01',
      subjectType: 'issue',
      subjectId: 'id-pay-130',
      evidence: [
        {
          subjectType: 'issue',
          subjectId: 'id-pay-118',
          label: { key: 'evidence.view' },
        },
      ],
    });
    const result = signalsWithoutIssues([dep01], ['PAY-118'], rel);
    expect(result).toHaveLength(0);
  });

  it('drops signal whose evidence contains multiple issues all of which are removed', () => {
    const rel = paiementsRelease();
    const exp01 = makeTestSignal({
      id: 'exp-01:incident:inc-52',
      code: 'EXP-01',
      subjectType: 'incident',
      subjectId: 'inc-52',
      evidence: [
        { subjectType: 'issue', subjectId: 'id-pay-127', label: { key: 'evidence.view' } },
        { subjectType: 'issue', subjectId: 'id-pay-131', label: { key: 'evidence.view' } },
      ],
    });
    const partialDrop = signalsWithoutIssues([exp01], ['PAY-127'], rel);
    expect(partialDrop).toHaveLength(1);

    const fullDrop = signalsWithoutIssues([exp01], ['PAY-127', 'PAY-131'], rel);
    expect(fullDrop).toHaveLength(0);
  });
});

describe('simulateWithout', () => {
  it('recalculates verdict and returns droppedSignalCount', () => {
    const rel = paiementsRelease();
    const cov = fullCoverage(14);
    const s1 = makeTestSignal({ id: 's1', subjectId: 'id-pay-131', severity: 'blocking' });
    const s2 = makeTestSignal({
      id: 's2',
      subjectId: 'id-pay-135',
      code: 'QUAL-02',
      severity: 'major',
    });

    const sim = simulateWithout({
      signals: [s1, s2],
      coverage: cov,
      release: rel,
      issueKeys: ['PAY-131'],
      verdict: computeVerdictStub,
    });

    expect(sim.removedIssueKeys).toEqual(['PAY-131']);
    expect(sim.droppedSignalCount).toBe(1);
    expect(sim.result.verdict).toBe('conditional-go');
  });

  it('removing a ticket without blocking signals does not lift no-go', () => {
    const rel = paiementsRelease();
    const cov = fullCoverage(14);
    const s1 = makeTestSignal({ id: 's1', subjectId: 'id-pay-131', severity: 'blocking' });
    const cleanIssueSignal = makeTestSignal({
      id: 's2',
      subjectId: 'id-pay-136',
      severity: 'info',
    });

    const sim = simulateWithout({
      signals: [s1, cleanIssueSignal],
      coverage: cov,
      release: rel,
      issueKeys: ['PAY-136'],
      verdict: computeVerdictStub,
    });

    expect(sim.result.verdict).toBe('no-go');
  });
});

describe('minimalRemovalSet', () => {
  it('returns empty set if initial verdict is not no-go', () => {
    const rel = paiementsRelease();
    const cov = fullCoverage(14);
    const maj = makeTestSignal({ id: 'm1', severity: 'major' });

    const res = minimalRemovalSet({
      signals: [maj],
      coverage: cov,
      release: rel,
      verdict: computeVerdictStub,
    });

    expect(res.issueKeys).toEqual([]);
    expect(res.simulationsRun).toBe(0);
    expect(res.provenMinimal).toBe(true);
  });

  it('finds a minimal set of 1 ticket', () => {
    const rel = paiementsRelease();
    const cov = fullCoverage(14);
    const s1 = makeTestSignal({ id: 's1', subjectId: 'id-pay-131', severity: 'blocking' });

    const res = minimalRemovalSet({
      signals: [s1],
      coverage: cov,
      release: rel,
      verdict: computeVerdictStub,
    });

    expect(res.issueKeys).toEqual(['PAY-131']);
    expect(res.simulationsRun).toBe(1);
    expect(res.provenMinimal).toBe(true);
  });

  it('finds a minimal set of 2 tickets', () => {
    const rel = paiementsRelease();
    const cov = fullCoverage(14);
    const s1 = makeTestSignal({ id: 's1', subjectId: 'id-pay-131', severity: 'blocking' });
    const s2 = makeTestSignal({ id: 's2', subjectId: 'id-pay-129', severity: 'blocking' });

    const res = minimalRemovalSet({
      signals: [s1, s2],
      coverage: cov,
      release: rel,
      verdict: computeVerdictStub,
    });

    expect(res.issueKeys.sort()).toEqual(['PAY-129', 'PAY-131'].sort());
    expect(res.provenMinimal).toBe(true);
  });

  it('reports no solution when blocking signal is not tied to removable tickets', () => {
    const rel = paiementsRelease();
    const cov = fullCoverage(14);
    const freeze = makeTestSignal({
      id: 'exp03',
      code: 'EXP-03',
      subjectType: 'version',
      subjectId: 'ver-24',
      severity: 'blocking',
      evidence: [],
    });

    const res = minimalRemovalSet({
      signals: [freeze],
      coverage: cov,
      release: rel,
      verdict: computeVerdictStub,
    });

    expect(res.issueKeys).toEqual([]);
    expect(res.provenMinimal).toBe(false);
  });

  it('sets provenMinimal to false when maxSetSize is reached without solution', () => {
    const rel = paiementsRelease();
    const cov = fullCoverage(14);
    const s1 = makeTestSignal({ id: 's1', subjectId: 'id-pay-131', severity: 'blocking' });
    const s2 = makeTestSignal({ id: 's2', subjectId: 'id-pay-129', severity: 'blocking' });

    const res = minimalRemovalSet({
      signals: [s1, s2],
      coverage: cov,
      release: rel,
      verdict: computeVerdictStub,
      maxSetSize: 1,
    });

    expect(res.issueKeys).toEqual([]);
    expect(res.provenMinimal).toBe(false);
  });

  it('defaults to MAX_REMOVAL_SET and refuses to combine beyond the bound', () => {
    expect(MAX_REMOVAL_SET).toBe(3);
    const rel = paiementsRelease();
    const cov = fullCoverage(14);
    const blockingKeys = ['id-pay-129', 'id-pay-130', 'id-pay-131'];
    const signals = blockingKeys.map((subjectId, i) =>
      makeTestSignal({ id: `b${i}`, subjectId, severity: 'blocking' }),
    );
    // Contrived verdict: only removing ALL FOUR candidate tickets lifts the no-go.
    const allOrNothing: typeof computeVerdictStub = (sigs, coverage, release) => {
      const result = computeVerdictStub(sigs, coverage, release);
      return sigs.length === 0 && signals.length === 4
        ? { ...result, verdict: 'conditional-go' as const }
        : result;
    };
    const fourSignals = [
      ...signals,
      makeTestSignal({ id: 'b3', subjectId: 'id-pay-132', severity: 'blocking' }),
    ];

    const res = minimalRemovalSet({
      signals: fourSignals,
      coverage: cov,
      release: rel,
      verdict: allOrNothing,
    });

    // 4 candidates, bound 3: C(4,1)+C(4,2)+C(4,3) = 14 simulations, no solution.
    expect(res.issueKeys).toEqual([]);
    expect(res.simulationsRun).toBe(14);
    expect(res.provenMinimal).toBe(false);
  });
});

describe('describeRemoval', () => {
  it('formats simulation.bestSet with count and keys', () => {
    const msg = describeRemoval({
      issueKeys: ['PAY-131', 'PAY-129'],
      simulationsRun: 3,
      provenMinimal: true,
    });
    expect(msg.key).toBe('simulation.bestSet');
    expect(msg.params).toEqual({ count: 2, keys: 'PAY-131, PAY-129' });
  });

  it('formats simulation.noSolution when issueKeys is empty', () => {
    const msg = describeRemoval({
      issueKeys: [],
      simulationsRun: 5,
      provenMinimal: false,
    });
    expect(msg.key).toBe('simulation.noSolution');
  });
});

describe('acceptance §6.1 step 4', () => {
  it('acceptance §6.1 step 4: removing PAY-131 changes the verdict to conditional-go', () => {
    const rel = paiementsRelease();
    const cov = fullCoverage(14);

    const sPay131Comp01 = makeTestSignal({
      id: 'comp01-131',
      code: 'COMP-01',
      subjectType: 'issue',
      subjectId: 'id-pay-131',
      severity: 'blocking',
    });
    const sPay131Comp03 = makeTestSignal({
      id: 'comp03-131',
      code: 'COMP-03',
      subjectType: 'issue',
      subjectId: 'id-pay-131',
      severity: 'blocking',
    });
    const sDoc01 = makeTestSignal({
      id: 'doc01-9001',
      code: 'DOC-01',
      subjectType: 'page',
      subjectId: '9001',
      severity: 'major',
    });

    const initial = computeVerdictStub([sPay131Comp01, sPay131Comp03, sDoc01], cov, rel);
    expect(initial.verdict).toBe('no-go');

    const sim = simulateWithout({
      signals: [sPay131Comp01, sPay131Comp03, sDoc01],
      coverage: cov,
      release: rel,
      issueKeys: ['PAY-131'],
      verdict: computeVerdictStub,
    });

    expect(sim.result.verdict).toBe('conditional-go');
    expect(sim.droppedSignalCount).toBe(2);

    const best = minimalRemovalSet({
      signals: [sPay131Comp01, sPay131Comp03, sDoc01],
      coverage: cov,
      release: rel,
      verdict: computeVerdictStub,
    });
    expect(best.issueKeys).toEqual(['PAY-131']);
    expect(best.provenMinimal).toBe(true);

    const description = describeRemoval(best);
    expect(description.key).toBe('simulation.bestSet');
    expect(description.params?.keys).toBe('PAY-131');
  });
});
