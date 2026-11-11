import type { JiraIssue, Signal } from '../types.js';
import type { DetectionContext, Detector } from './context.js';
import { isSignalEnabled, makeSignal } from './context.js';
import { makeIssueEvidence } from './comp.js';

/**
 * QUAL signal family: code quality of the release's tickets (SPEC §7).
 *
 * Covers the three quality signals:
 *   QUAL-01 (blocking) latest build failed on a release ticket;
 *   QUAL-02 (major)    pull request merged without approval;
 *   QUAL-03 (minor)    bug reopened during the release cycle.
 *
 * Every QUAL signal hangs off an issue of the release, so the subject is always
 * the issue and the proof is its Jira browse link. Signals that depend on
 * development data stay silent when `dev.known` is false: a missing source is
 * never read as a good news (SPEC §15).
 *
 * Pure domain logic: no Forge import, no I/O, no real clock (`now` comes from
 * the DetectionContext). Severity, waiver status and `firstSeenAt` are applied
 * by `makeSignal`.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

/** Development data is only trustworthy when the source answered. */
function devKnown(issue: JiraIssue): boolean {
  return issue.dev.known;
}

/** A red CI on the latest build: either a counted failure or a failing state. */
function hasFailingBuild(issue: JiraIssue): boolean {
  const { dev } = issue;
  return devKnown(issue) && (dev.failingBuilds > 0 || dev.lastBuildState === 'failing');
}

/**
 * QUAL-01 (blocking): the latest build failed on a release ticket.
 * Params: `key`, `count` (= failingBuilds).
 */
export function detectQual01(ctx: DetectionContext): Signal[] {
  if (!isSignalEnabled('QUAL-01', ctx.policy)) return [];
  return ctx.release.issues
    .filter(hasFailingBuild)
    .map((issue) =>
      makeSignal(ctx, {
        code: 'QUAL-01',
        subject: { subjectType: 'issue', subjectId: issue.subjectId },
        finding: {
          key: 'signal.qual01.finding',
          params: { key: issue.key, count: issue.dev.failingBuilds },
        },
        evidence: [makeIssueEvidence(ctx.release, issue)],
      }),
    );
}

/** A merged PR that never went through a reviewer. */
function hasUnreviewedMerge(issue: JiraIssue): boolean {
  return devKnown(issue) && issue.dev.mergedWithoutApproval > 0;
}

/**
 * QUAL-02 (major): a pull request was merged without approval.
 * Params: `key`, `count` (= mergedWithoutApproval).
 */
export function detectQual02(ctx: DetectionContext): Signal[] {
  if (!isSignalEnabled('QUAL-02', ctx.policy)) return [];
  return ctx.release.issues
    .filter(hasUnreviewedMerge)
    .map((issue) =>
      makeSignal(ctx, {
        code: 'QUAL-02',
        subject: { subjectType: 'issue', subjectId: issue.subjectId },
        finding: {
          key: 'signal.qual02.finding',
          params: { key: issue.key, count: issue.dev.mergedWithoutApproval },
        },
        evidence: [makeIssueEvidence(ctx.release, issue)],
      }),
    );
}

/**
 * QUAL-03 (minor): a bug was reopened during the cycle.
 * Restricted to bugs: a reopened task is a planning detail, not a quality one.
 * Params: `key`.
 */
export function detectQual03(ctx: DetectionContext): Signal[] {
  if (!isSignalEnabled('QUAL-03', ctx.policy)) return [];
  return ctx.release.issues
    .filter(isReopenedBug)
    .map((issue) =>
      makeSignal(ctx, {
        code: 'QUAL-03',
        subject: { subjectType: 'issue', subjectId: issue.subjectId },
        finding: {
          key: 'signal.qual03.finding',
          params: { key: issue.key },
        },
        evidence: [makeIssueEvidence(ctx.release, issue)],
      }),
    );
}

function isReopenedBug(issue: JiraIssue): boolean {
  return issue.issueType === 'Bug' && issue.reopenedDuringCycle === true;
}

/** All 3 QUAL detectors in catalogue order. */
export const qualDetectors: Detector[] = [
  detectQual01,
  detectQual02,
  detectQual03,
];

/** Runs every QUAL detector, each one already filtering its disabled code. */
export function detectQual(ctx: DetectionContext): Signal[] {
  return qualDetectors.flatMap((detector) => detector(ctx));
}
