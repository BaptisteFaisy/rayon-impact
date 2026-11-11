import {
  CONFIDENCE_RULES,
  ISSUE_SAMPLE_THRESHOLD,
  type CollectedRelease,
  type Coverage,
  type JiraIssue,
  type MessageRef,
  type Signal,
  type SourceStatus,
} from '../types';

/** Maximum minor/info signals retained when issue count exceeds ISSUE_SAMPLE_THRESHOLD. */
export const MINOR_SIGNAL_CAP = 50;

function hasVisibleCode(issue: JiraIssue): boolean {
  const { dev } = issue;
  return (
    dev.known &&
    (dev.commits > 0 || dev.openPullRequests > 0 || dev.mergedPullRequests > 0)
  );
}

function buildSourceNote(status: SourceStatus): MessageRef {
  if (status.detail) {
    return status.detail;
  }
  return {
    key: `coverage.source.${status.state}`,
    params: { source: status.source },
  };
}

function buildCoverageNotes(
  sources: SourceStatus[],
  issueCount: number,
  issuesWithCode: number,
  issuesWithService: number,
  codeRatio: number,
): MessageRef[] {
  const notes: MessageRef[] = [];

  for (const src of sources) {
    if (src.state !== 'ok') {
      notes.push(buildSourceNote(src));
    }
  }

  if (issueCount > 0 && codeRatio < CONFIDENCE_RULES.lowCodeRatio) {
    notes.push({
      key: 'confidence.low.detail',
      params: { missing: issueCount - issuesWithCode, total: issueCount },
    });
  }

  if (issueCount > 0 && issuesWithService < issueCount) {
    notes.push({
      key: 'coverage.service.missing',
      params: { missing: issueCount - issuesWithService, total: issueCount },
    });
  }

  return notes;
}

/**
 * Computes data coverage for a collected release (SPEC §8, §15).
 * Missing data is surfaced explicitly in `notes` and never treated as healthy.
 */
export function computeCoverage(release: CollectedRelease): Coverage {
  const issueCount = release.issues.length;
  const issuesWithCode = release.issues.filter(hasVisibleCode).length;
  const issuesWithService = release.issues.filter(
    (issue) => issue.serviceId !== null,
  ).length;

  const codeRatio = issueCount === 0 ? 0 : issuesWithCode / issueCount;
  const serviceRatio = issueCount === 0 ? 0 : issuesWithService / issueCount;
  const sources = [...release.sources];

  return {
    issueCount,
    issuesWithCode,
    issuesWithService,
    codeRatio,
    serviceRatio,
    sources,
    sampledMinorSignals: issueCount > ISSUE_SAMPLE_THRESHOLD,
    notes: buildCoverageNotes(
      sources,
      issueCount,
      issuesWithCode,
      issuesWithService,
      codeRatio,
    ),
  };
}

/**
 * Above ISSUE_SAMPLE_THRESHOLD issues, caps minor and info signals at
 * MINOR_SIGNAL_CAP while keeping all blocking and major signals intact.
 */
export function applyMinorSampling(
  signals: Signal[],
  issueCount: number,
): { signals: Signal[]; sampled: boolean } {
  if (issueCount <= ISSUE_SAMPLE_THRESHOLD) {
    return { signals: [...signals], sampled: false };
  }

  const kept: Signal[] = [];
  let minorOrInfoKept = 0;
  let dropped = false;

  for (const signal of signals) {
    if (signal.severity === 'blocking' || signal.severity === 'major') {
      kept.push(signal);
    } else if (minorOrInfoKept < MINOR_SIGNAL_CAP) {
      kept.push(signal);
      minorOrInfoKept += 1;
    } else {
      dropped = true;
    }
  }

  return { signals: kept, sampled: dropped };
}
