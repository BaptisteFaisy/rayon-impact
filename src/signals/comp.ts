import type {
  CollectedRelease,
  Evidence,
  JiraIssue,
  Signal,
} from '../types.js';
import { RECENT_ADD_HOURS } from '../types.js';
import type { DetectionContext, Detector } from './context.js';
import { hoursBetween, isSignalEnabled, makeSignal } from './context.js';

/**
 * COMP signal family: code completeness (SPEC §7).
 *
 * Evaluates whether tickets in a release are finished, backed by code, have no
 * dangling pull requests, and were not rushed into the release at the last minute.
 *
 * Pure domain logic: no Forge imports, no side effects, deterministic.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

/**
 * Fallback domain for Jira browse URLs.
 * The Forge adapter will supply the real runtime site URL.
 */
export const DEFAULT_JIRA_DOMAIN = 'atlassian.net';

/**
 * Builds the canonical browse URL for a Jira issue.
 * Documented fallback: the Forge adapter will supply the real tenant host.
 */
export function issueUrl(release: CollectedRelease, issue: JiraIssue): string {
  const subdomain = release.project.key.toLowerCase();
  return `https://${subdomain}.${DEFAULT_JIRA_DOMAIN}/browse/${issue.key}`;
}

/**
 * Builds the standard evidence linking to an issue.
 */
export function makeIssueEvidence(
  release: CollectedRelease,
  issue: JiraIssue,
): Evidence {
  return {
    subjectType: 'issue',
    subjectId: issue.subjectId,
    label: { key: 'evidence.view' },
    url: issueUrl(release, issue),
  };
}

/**
 * COMP-01 (blocking): Unfinished ticket in release.
 * Raised for any issue whose statusCategory is not 'done'.
 */
export function detectComp01(ctx: DetectionContext): Signal[] {
  if (!isSignalEnabled('COMP-01', ctx.policy)) return [];
  const signals: Signal[] = [];
  for (const issue of ctx.release.issues) {
    if (issue.statusCategory !== 'done') {
      signals.push(
        makeSignal(ctx, {
          code: 'COMP-01',
          subject: { subjectType: 'issue', subjectId: issue.subjectId },
          finding: {
            key: 'signal.comp01.finding',
            params: {
              key: issue.key,
              status: issue.statusName,
              category: issue.statusCategory,
            },
          },
          evidence: [makeIssueEvidence(ctx.release, issue)],
        }),
      );
    }
  }
  return signals;
}

/**
 * COMP-02 (major): Done ticket with no commit or PR.
 * Only raised if dev.known is true; stays silent if data is unavailable (SPEC §15 honesty).
 */
export function detectComp02(ctx: DetectionContext): Signal[] {
  if (!isSignalEnabled('COMP-02', ctx.policy)) return [];
  const signals: Signal[] = [];
  for (const issue of ctx.release.issues) {
    if (issue.statusCategory !== 'done') continue;
    if (!issue.dev.known) continue;
    const { commits, openPullRequests, mergedPullRequests } = issue.dev;
    if (commits === 0 && openPullRequests === 0 && mergedPullRequests === 0) {
      signals.push(
        makeSignal(ctx, {
          code: 'COMP-02',
          subject: { subjectType: 'issue', subjectId: issue.subjectId },
          finding: {
            key: 'signal.comp02.finding',
            params: { key: issue.key },
          },
          evidence: [makeIssueEvidence(ctx.release, issue)],
        }),
      );
    }
  }
  return signals;
}

/**
 * COMP-03 (blocking): Open PR on release ticket.
 * Only raised if dev.known is true; stays silent if data is unavailable.
 */
export function detectComp03(ctx: DetectionContext): Signal[] {
  if (!isSignalEnabled('COMP-03', ctx.policy)) return [];
  const signals: Signal[] = [];
  for (const issue of ctx.release.issues) {
    if (!issue.dev.known) continue;
    if (issue.dev.openPullRequests > 0) {
      signals.push(
        makeSignal(ctx, {
          code: 'COMP-03',
          subject: { subjectType: 'issue', subjectId: issue.subjectId },
          finding: {
            key: 'signal.comp03.finding',
            params: {
              key: issue.key,
              count: issue.dev.openPullRequests,
            },
          },
          evidence: [makeIssueEvidence(ctx.release, issue)],
        }),
      );
    }
  }
  return signals;
}

/**
 * COMP-04 (minor): Ticket added to release less than 48h ago.
 * Hours are floored to the nearest integer.
 */
export function detectComp04(ctx: DetectionContext): Signal[] {
  if (!isSignalEnabled('COMP-04', ctx.policy)) return [];
  const signals: Signal[] = [];
  for (const issue of ctx.release.issues) {
    if (!issue.addedToVersionAt) continue;
    const hours = hoursBetween(issue.addedToVersionAt, ctx.now);
    if (hours >= 0 && hours < RECENT_ADD_HOURS) {
      signals.push(
        makeSignal(ctx, {
          code: 'COMP-04',
          subject: { subjectType: 'issue', subjectId: issue.subjectId },
          finding: {
            key: 'signal.comp04.finding',
            params: {
              key: issue.key,
              hours: Math.floor(hours),
            },
          },
          evidence: [makeIssueEvidence(ctx.release, issue)],
        }),
      );
    }
  }
  return signals;
}

/** All 4 COMP detectors in catalog order. */
export const compDetectors: Detector[] = [
  detectComp01,
  detectComp02,
  detectComp03,
  detectComp04,
];

/**
 * Runs all COMP detectors against the given context, omitting disabled signals.
 */
export function detectComp(ctx: DetectionContext): Signal[] {
  return compDetectors.flatMap((detector) => detector(ctx));
}
