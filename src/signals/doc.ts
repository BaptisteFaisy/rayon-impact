import type { ConfluencePage, Evidence, Signal } from '../types.js';
import type { DetectionContext, Detector } from './context.js';
import { isSignalEnabled, makeSignal } from './context.js';
import { isoDay } from './exp.js';

/**
 * DOC signal family: documentation (SPEC §7).
 *
 * A release ships customer-facing behaviour; the Confluence pages its tickets
 * link to must have moved since the cycle started, otherwise support learns
 * about the change from a customer.
 *
 * Pure domain logic: no Forge imports, no side effects, deterministic.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

/**
 * Resolves one remote link to a page of the release when the link is a
 * Confluence one: exact url match first, then the page id embedded in the url.
 * A page outside `release.pages` is not linked to this release and is skipped.
 */
function pageForLink(ctx: DetectionContext, url: string): ConfluencePage | undefined {
  const exact = ctx.release.pages.find((p) => p.url === url);
  if (exact) return exact;
  return ctx.release.pages.find((p) => url.includes(p.subjectId));
}

/**
 * Pages linked by at least one release ticket, deduplicated: two tickets may
 * point at the same page and DOC-01 must fire once for it.
 */
export function linkedPages(ctx: DetectionContext): ConfluencePage[] {
  const seen = new Set<string>();
  const pages: ConfluencePage[] = [];
  for (const issue of ctx.release.issues) {
    for (const link of issue.remoteLinks) {
      if (link.kind !== 'confluence') continue;
      const page = pageForLink(ctx, link.url);
      if (!page || seen.has(page.subjectId)) continue;
      seen.add(page.subjectId);
      pages.push(page);
    }
  }
  return pages;
}

/** Evidence pointing at the stale page, with its Confluence url. */
function pageEvidence(page: ConfluencePage): Evidence {
  return {
    subjectType: 'page',
    subjectId: page.subjectId,
    label: { key: 'evidence.view' },
    url: page.url,
  };
}

/**
 * DOC-01 (minor): a linked page untouched since the release cycle started.
 * No `cycleStartedAt` → no reference point, so no signal (SPEC §15: absent
 * data is never read as good news, coverage reports it).
 */
function detectDoc01(ctx: DetectionContext): Signal[] {
  if (!isSignalEnabled('DOC-01', ctx.policy)) return [];
  const cycleStart = ctx.release.cycleStartedAt;
  if (!cycleStart) return [];
  const signals: Signal[] = [];
  for (const page of linkedPages(ctx)) {
    if (page.lastModified >= cycleStart) continue;
    signals.push(
      makeSignal(ctx, {
        code: 'DOC-01',
        subject: { subjectType: 'page', subjectId: page.subjectId },
        finding: {
          key: 'signal.doc01.finding',
          params: { pageTitle: page.title, cycleStart: isoDay(cycleStart) },
        },
        evidence: [pageEvidence(page)],
      }),
    );
  }
  return signals;
}

/** All DOC detectors in catalog order. */
export const docDetectors: Detector[] = [detectDoc01];

/** Runs all DOC detectors against the given context. */
export function detectDoc(ctx: DetectionContext): Signal[] {
  return docDetectors.flatMap((detector) => detector(ctx));
}
