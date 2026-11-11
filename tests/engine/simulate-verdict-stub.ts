import type {
  CollectedRelease,
  Coverage,
  Signal,
  Verdict,
  VerdictResult,
  SeverityCounts,
  Condition,
} from '../../src/types';

/**
 * Stub local minimal pour computeVerdict conforme à SPEC §8 (< 60 lignes).
 * Utilisé pour tester le moteur de simulation indépendamment du travail
 * en cours de l'autre agent sur src/engine/verdict.ts.
 */
export function computeVerdictStub(
  signals: Signal[],
  coverage: Coverage,
  _release: CollectedRelease,
): VerdictResult {
  const activeSignals = signals.filter((s) => s.status === 'active');
  const counts: SeverityCounts = { blocking: 0, major: 0, minor: 0, info: 0 };
  const blockingKeys = new Set<string>();

  for (const s of activeSignals) {
    counts[s.severity] = (counts[s.severity] ?? 0) + 1;
    if (s.severity === 'blocking' && s.subjectType === 'issue') {
      blockingKeys.add(s.subjectId);
    }
  }

  let verdict: Verdict = 'go';
  if (counts.blocking > 0) {
    verdict = 'no-go';
  } else if (counts.major > 0 || signals.some((s) => s.status === 'waived')) {
    verdict = 'conditional-go';
  }

  const conditions: Condition[] = activeSignals
    .filter((s) => s.severity === 'major')
    .map((s) => ({
      subjectType: s.subjectType,
      subjectId: s.subjectId,
      signalCode: s.code,
      severity: s.severity,
      text: s.finding,
    }));

  return {
    verdict,
    confidence: coverage.codeRatio >= 0.9 && coverage.serviceRatio >= 0.8 ? 'high' : 'medium',
    coverage,
    counts,
    conditions,
    blockingIssueKeys: Array.from(blockingKeys),
  };
}
