import { describe, expect, it } from 'vitest';
import { computeCoverage } from '../../src/engine/coverage';
import {
  computeConfidence,
  computeVerdict,
  confidenceTitle,
  verdictTitle,
} from '../../src/engine/verdict';
import { t } from '../../src/i18n/index';
import type {
  Severity,
  Signal,
  SignalCode,
  SignalStatus,
} from '../../src/types';
import {
  collected,
  fullCoverage,
  issue,
  unknownDev,
  version,
} from '../fixtures/builders';
import { paiementsRelease } from '../fixtures/paiements';

function makeSignal(
  code: SignalCode,
  severity: Severity,
  issueKey: string,
  status: SignalStatus = 'active',
): Signal {
  return {
    id: `${code}:issue:id-${issueKey.toLowerCase()}`,
    code,
    subjectType: 'issue',
    subjectId: `id-${issueKey.toLowerCase()}`,
    severity,
    status,
    finding: {
      key: 'signal.comp01.finding',
      params: { key: issueKey, status: 'In Progress', category: 'in-progress' },
    },
    evidence: [],
    detectedAt: '2026-11-11T06:00:00.000Z',
    firstSeenAt: '2026-11-11T06:00:00.000Z',
    ...(status === 'waived' ? { waiverId: 'waiver-1' } : {}),
  };
}

describe('computeVerdict', () => {
  it('returns go and high confidence on a healthy release', () => {
    const release = collected({ issues: [issue('PAY-1'), issue('PAY-2')] });
    const cov = fullCoverage(2);
    const result = computeVerdict([], cov, release);

    expect(result.verdict).toBe('go');
    expect(result.confidence).toBe('high');
    expect(result.counts).toEqual({ blocking: 0, major: 0, minor: 0, info: 0 });
    expect(result.conditions).toEqual([]);
    expect(result.blockingIssueKeys).toEqual([]);
  });

  it('returns no-go with blockingIssueKeys when at least 1 active blocking signal exists', () => {
    const release = paiementsRelease();
    const cov = computeCoverage(release);
    const signals = [
      makeSignal('COMP-01', 'blocking', 'PAY-131'),
      makeSignal('QUAL-01', 'blocking', 'PAY-129'),
      makeSignal('COMP-01', 'blocking', 'PAY-129'),
    ];
    const result = computeVerdict(signals, cov, release);

    expect(result.verdict).toBe('no-go');
    expect(result.counts.blocking).toBe(3);
    expect(result.blockingIssueKeys).toEqual(['PAY-129', 'PAY-131']);
  });

  it('returns conditional-go with listed condition when a blocking signal is waived', () => {
    const release = collected({ issues: [issue('PAY-1')] });
    const waived = makeSignal('COMP-01', 'blocking', 'PAY-1', 'waived');
    const result = computeVerdict([waived], fullCoverage(1), release);

    expect(result.verdict).toBe('conditional-go');
    expect(result.counts.blocking).toBe(0);
    expect(result.blockingIssueKeys).toEqual([]);
    expect(result.conditions).toEqual([
      {
        subjectType: 'issue',
        subjectId: 'id-pay-1',
        signalCode: 'COMP-01',
        severity: 'blocking',
        text: waived.finding,
      },
    ]);
  });

  it('returns conditional-go when only an active major signal is present', () => {
    const release = collected({ issues: [issue('PAY-1')] });
    const major = makeSignal('COMP-02', 'major', 'PAY-1');
    const result = computeVerdict([major], fullCoverage(1), release);

    expect(result.verdict).toBe('conditional-go');
    expect(result.counts).toEqual({ blocking: 0, major: 1, minor: 0, info: 0 });
    expect(result.conditions).toHaveLength(1);
    expect(result.conditions[0]?.signalCode).toBe('COMP-02');
  });

  it('returns go when only a minor signal is present (and ignores cleared signals)', () => {
    const release = collected({ issues: [issue('PAY-1')] });
    const signals = [
      makeSignal('COMP-04', 'minor', 'PAY-1', 'active'),
      makeSignal('COMP-01', 'blocking', 'PAY-1', 'cleared'),
    ];
    const result = computeVerdict(signals, fullCoverage(1), release);

    expect(result.verdict).toBe('go');
    expect(result.counts).toEqual({ blocking: 0, major: 0, minor: 1, info: 0 });
    expect(result.conditions).toEqual([]);
  });

  it('sorts conditions by severity then by signal code', () => {
    const release = collected({ issues: [issue('PAY-1'), issue('PAY-2')] });
    const signals = [
      makeSignal('QUAL-02', 'major', 'PAY-2', 'active'),
      makeSignal('COMP-02', 'major', 'PAY-1', 'active'),
      makeSignal('COMP-01', 'blocking', 'PAY-1', 'waived'),
    ];
    const result = computeVerdict(signals, fullCoverage(2), release);

    expect(result.conditions.map((c) => c.signalCode)).toEqual([
      'COMP-01',
      'COMP-02',
      'QUAL-02',
    ]);
  });

  it('returns not-applicable when the version has no issues', () => {
    const release = collected({ issues: [] });
    const result = computeVerdict([], fullCoverage(0), release);

    expect(result.verdict).toBe('not-applicable');
    expect(result.confidence).toBe('low');
  });

  it('returns not-applicable when the version has no releaseDate', () => {
    const release = collected({
      issues: [issue('PAY-1')],
      version: version({ releaseDate: undefined }),
    });
    const blocking = makeSignal('COMP-01', 'blocking', 'PAY-1');
    const result = computeVerdict([blocking], fullCoverage(1), release);

    expect(result.verdict).toBe('not-applicable');
  });
});

describe('computeConfidence', () => {
  it('respects exact boundary thresholds 0.90 / 0.80 / 0.70', () => {
    expect(
      computeConfidence(fullCoverage(10, { codeRatio: 0.9, serviceRatio: 0.8 })),
    ).toBe('high');
    expect(
      computeConfidence(fullCoverage(10, { codeRatio: 0.899, serviceRatio: 0.8 })),
    ).toBe('medium');
    expect(
      computeConfidence(fullCoverage(10, { codeRatio: 0.9, serviceRatio: 0.799 })),
    ).toBe('medium');
    expect(
      computeConfidence(fullCoverage(10, { codeRatio: 0.7, serviceRatio: 0 })),
    ).toBe('medium');
    expect(
      computeConfidence(fullCoverage(10, { codeRatio: 0.699, serviceRatio: 1 })),
    ).toBe('low');
    expect(computeConfidence(fullCoverage(0))).toBe('low');
  });

  it('acceptance §17.5: project with no linked repo yields low confidence and explanatory text', () => {
    const issues = Array.from({ length: 14 }, (_, i) =>
      issue(`PAY-${i + 1}`, { dev: unknownDev() }),
    );
    const release = collected({ issues });
    const cov = computeCoverage(release);
    const result = computeVerdict([], cov, release);

    expect(result.confidence).toBe('low');
    expect(confidenceTitle(result.confidence)).toEqual({ key: 'confidence.low' });
    expect(verdictTitle(result.verdict)).toEqual({ key: 'verdict.go' });
    expect(cov.notes).toContainEqual({
      key: 'confidence.low.detail',
      params: { missing: 14, total: 14 },
    });
    expect(t(cov.notes[0]!, 'fr')).toContain('14 tickets sur 14');
  });
});
