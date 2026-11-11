import {
  CONFIDENCE_RULES,
  SEVERITY_ORDER,
  type CollectedRelease,
  type Condition,
  type Confidence,
  type Coverage,
  type MessageRef,
  type SeverityCounts,
  type Signal,
  type Verdict,
  type VerdictResult,
} from '../types.js';

function countActiveBySeverity(signals: Signal[]): SeverityCounts {
  const counts: SeverityCounts = {
    blocking: 0,
    major: 0,
    minor: 0,
    info: 0,
  };
  for (const signal of signals) {
    if (signal.status === 'active') {
      counts[signal.severity] += 1;
    }
  }
  return counts;
}

function compareConditions(a: Condition, b: Condition): number {
  const sevDiff =
    SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
  if (sevDiff !== 0) return sevDiff;
  const codeDiff = a.signalCode.localeCompare(b.signalCode);
  if (codeDiff !== 0) return codeDiff;
  return a.subjectId.localeCompare(b.subjectId);
}

function buildConditions(signals: Signal[]): Condition[] {
  const conditions: Condition[] = [];
  for (const signal of signals) {
    const isActiveMajor =
      signal.status === 'active' && signal.severity === 'major';
    if (isActiveMajor || signal.status === 'waived') {
      conditions.push({
        subjectType: signal.subjectType,
        subjectId: signal.subjectId,
        signalCode: signal.code,
        severity: signal.severity,
        text: signal.finding,
      });
    }
  }
  return conditions.sort(compareConditions);
}

function collectBlockingIssueKeys(
  signals: Signal[],
  release: CollectedRelease,
): string[] {
  const keyBySubjectId = new Map<string, string>();
  for (const issue of release.issues) {
    keyBySubjectId.set(issue.subjectId, issue.key);
  }

  const keys = new Set<string>();
  for (const signal of signals) {
    if (
      signal.status === 'active' &&
      signal.severity === 'blocking' &&
      signal.subjectType === 'issue'
    ) {
      const key = keyBySubjectId.get(signal.subjectId);
      if (key) {
        keys.add(key);
      }
    }
  }
  return [...keys].sort();
}

function resolveVerdict(
  counts: SeverityCounts,
  hasWaived: boolean,
  release: CollectedRelease,
): Verdict {
  if (release.issues.length === 0 || !release.version.releaseDate?.trim()) {
    return 'not-applicable';
  }
  if (counts.blocking > 0) {
    return 'no-go';
  }
  if (counts.major > 0 || hasWaived) {
    return 'conditional-go';
  }
  return 'go';
}

/**
 * Computes data confidence from coverage ratios (SPEC §8).
 * Empty releases always yield `low` confidence.
 */
export function computeConfidence(coverage: Coverage): Confidence {
  if (coverage.issueCount === 0) {
    return 'low';
  }
  if (coverage.codeRatio < CONFIDENCE_RULES.lowCodeRatio) {
    return 'low';
  }
  if (
    coverage.codeRatio >= CONFIDENCE_RULES.highCodeRatio &&
    coverage.serviceRatio >= CONFIDENCE_RULES.highServiceRatio
  ) {
    return 'high';
  }
  return 'medium';
}

/**
 * Deterministic release verdict calculation (SPEC §8, §16).
 * Only `active` signals drive counts and no-go; `waived` signals require
 * `conditional-go` and appear in `conditions`.
 */
export function computeVerdict(
  signals: Signal[],
  coverage: Coverage,
  release: CollectedRelease,
): VerdictResult {
  const counts = countActiveBySeverity(signals);
  const hasWaived = signals.some((s) => s.status === 'waived');
  const verdict = resolveVerdict(counts, hasWaived, release);

  return {
    verdict,
    confidence: computeConfidence(coverage),
    coverage,
    counts,
    conditions: buildConditions(signals),
    blockingIssueKeys: collectBlockingIssueKeys(signals, release),
  };
}

export function verdictTitle(verdict: Verdict): MessageRef {
  return { key: `verdict.${verdict}` };
}

export function confidenceTitle(confidence: Confidence): MessageRef {
  return { key: `confidence.${confidence}` };
}
