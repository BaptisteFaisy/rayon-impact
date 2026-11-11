import { describe, expect, it } from 'vitest';
import {
  applyMinorSampling,
  computeCoverage,
  MINOR_SIGNAL_CAP,
} from '../../src/engine/coverage';
import { t } from '../../src/i18n/index';
import {
  ISSUE_SAMPLE_THRESHOLD,
  type Severity,
  type Signal,
  type SignalCode,
} from '../../src/types';
import {
  collected,
  healthyDev,
  issue,
  okSources,
  unknownDev,
} from '../fixtures/builders';
import { paiementsRelease } from '../fixtures/paiements';

function makeDummySignal(
  index: number,
  severity: Severity,
  code: SignalCode = 'COMP-04',
): Signal {
  return {
    id: `${code}:issue:id-${index}`,
    code,
    subjectType: 'issue',
    subjectId: `id-${index}`,
    severity,
    status: 'active',
    finding: { key: 'signal.comp04.finding', params: { key: `PAY-${index}`, hours: 4 } },
    evidence: [],
    detectedAt: '2026-11-11T06:00:00.000Z',
    firstSeenAt: '2026-11-11T06:00:00.000Z',
  };
}

describe('computeCoverage', () => {
  it('computes full coverage on a healthy release without notes', () => {
    const release = collected({
      issues: [issue('PAY-1'), issue('PAY-2')],
    });
    const cov = computeCoverage(release);

    expect(cov.issueCount).toBe(2);
    expect(cov.issuesWithCode).toBe(2);
    expect(cov.issuesWithService).toBe(2);
    expect(cov.codeRatio).toBe(1);
    expect(cov.serviceRatio).toBe(1);
    expect(cov.sampledMinorSignals).toBe(false);
    expect(cov.notes).toEqual([]);
  });

  it('returns zero ratios and no code/service notes on an empty release', () => {
    const cov = computeCoverage(collected({ issues: [] }));

    expect(cov.issueCount).toBe(0);
    expect(cov.issuesWithCode).toBe(0);
    expect(cov.issuesWithService).toBe(0);
    expect(cov.codeRatio).toBe(0);
    expect(cov.serviceRatio).toBe(0);
    expect(cov.notes).toEqual([]);
  });

  it('requires dev.known AND at least one commit or PR for issuesWithCode', () => {
    const release = collected({
      issues: [
        issue('PAY-1', { dev: healthyDev({ commits: 0, mergedPullRequests: 0 }) }),
        issue('PAY-2', { dev: healthyDev({ commits: 0, openPullRequests: 1, mergedPullRequests: 0 }) }),
        issue('PAY-3', { dev: unknownDev() }),
      ],
    });
    const cov = computeCoverage(release);

    expect(cov.issuesWithCode).toBe(1);
    expect(cov.codeRatio).toBeCloseTo(1 / 3);
  });

  it('computes expected coverage on paiementsRelease()', () => {
    const cov = computeCoverage(paiementsRelease());

    expect(cov.issueCount).toBe(14);
    expect(cov.issuesWithCode).toBe(13);
    expect(cov.issuesWithService).toBe(14);
    expect(cov.codeRatio).toBeCloseTo(13 / 14);
  });

  it('emits notes for unavailable/empty/partial sources, reusing detail when provided', () => {
    const customDetail = {
      key: 'signal.source.graph',
      params: { scope: 'dev' },
    };
    const release = collected({
      issues: [issue('PAY-1')],
      sources: [
        ...okSources().filter((s) => s.source !== 'jsm' && s.source !== 'confluence'),
        { source: 'jsm', state: 'unavailable', detail: customDetail },
        { source: 'confluence', state: 'empty' },
        { source: 'compass', state: 'partial' },
      ],
    });
    const cov = computeCoverage(release);

    expect(cov.notes).toContainEqual(customDetail);
    expect(cov.notes).toContainEqual({
      key: 'coverage.source.empty',
      params: { source: 'confluence' },
    });
    expect(cov.notes).toContainEqual({
      key: 'coverage.source.partial',
      params: { source: 'compass' },
    });
  });

  it('emits honesty note confidence.low.detail when codeRatio < 0.7 and missing-service note', () => {
    const issues = [
      ...Array.from({ length: 8 }, (_, i) => issue(`PAY-${i + 1}`)),
      ...Array.from({ length: 6 }, (_, i) =>
        issue(`PAY-${i + 9}`, { dev: unknownDev(), serviceId: null }),
      ),
    ];
    const cov = computeCoverage(collected({ issues }));

    expect(cov.codeRatio).toBeCloseTo(8 / 14);
    expect(cov.notes).toContainEqual({
      key: 'confidence.low.detail',
      params: { missing: 6, total: 14 },
    });
    expect(cov.notes).toContainEqual({
      key: 'coverage.service.missing',
      params: { missing: 6, total: 14 },
    });
    const rendered = t(
      { key: 'confidence.low.detail', params: { missing: 6, total: 14 } },
      'fr',
    );
    expect(rendered).toContain('6');
    expect(rendered).toContain('14');
  });

  it('flags sampledMinorSignals above ISSUE_SAMPLE_THRESHOLD', () => {
    const issues = Array.from({ length: ISSUE_SAMPLE_THRESHOLD + 1 }, (_, i) =>
      issue(`PAY-${i + 1}`),
    );
    const cov = computeCoverage(collected({ issues }));
    expect(cov.sampledMinorSignals).toBe(true);
  });
});

describe('applyMinorSampling', () => {
  it('does not sample when issueCount <= ISSUE_SAMPLE_THRESHOLD', () => {
    const signals = Array.from({ length: MINOR_SIGNAL_CAP + 10 }, (_, i) =>
      makeDummySignal(i, 'minor'),
    );
    const res = applyMinorSampling(signals, ISSUE_SAMPLE_THRESHOLD);

    expect(res.sampled).toBe(false);
    expect(res.signals).toHaveLength(MINOR_SIGNAL_CAP + 10);
  });

  it('caps minor and info signals at MINOR_SIGNAL_CAP above threshold while keeping blocking/major intact', () => {
    const blocking = [makeDummySignal(1, 'blocking', 'COMP-01')];
    const major = [makeDummySignal(2, 'major', 'COMP-02')];
    const minors = Array.from({ length: MINOR_SIGNAL_CAP + 15 }, (_, i) =>
      makeDummySignal(i + 10, 'minor', 'COMP-04'),
    );
    const infos = Array.from({ length: 10 }, (_, i) =>
      makeDummySignal(i + 200, 'info', 'OBJ-01'),
    );

    const res = applyMinorSampling(
      [...minors, ...blocking, ...infos, ...major],
      ISSUE_SAMPLE_THRESHOLD + 1,
    );

    expect(res.sampled).toBe(true);
    const minorInfoCount = res.signals.filter(
      (s) => s.severity === 'minor' || s.severity === 'info',
    ).length;
    expect(minorInfoCount).toBe(MINOR_SIGNAL_CAP);
    expect(res.signals.filter((s) => s.severity === 'blocking')).toHaveLength(1);
    expect(res.signals.filter((s) => s.severity === 'major')).toHaveLength(1);
  });
});
