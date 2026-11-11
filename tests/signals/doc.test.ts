import { describe, expect, it } from 'vitest';
import type { CollectedRelease, RemoteLink } from '../../src/types';
import type { DetectionContext } from '../../src/signals/context';
import { detectDoc, docDetectors, linkedPages } from '../../src/signals/doc';
import { collected, issue } from '../fixtures/builders';
import { paiementsPages, paiementsPolicy, paiementsRelease } from '../fixtures/paiements';

/**
 * DOC family tests (SPEC §7, §15, §16).
 *
 * Local `context()` helper: DetectionContext is a plain object and the shared
 * fixtures expose no context builder, so each signal test file composes it in
 * four lines rather than duplicating a whole release.
 */

const NOW = '2026-11-11T06:00:00.000Z';
const CYCLE_START = '2026-10-29T00:00:00.000Z';

function context(
  release: CollectedRelease,
  partial: Partial<DetectionContext> = {},
): DetectionContext {
  return {
    release,
    policy: paiementsPolicy(),
    now: NOW,
    waivers: [],
    previousSignals: [],
    pastOutcomes: [],
    ...partial,
  };
}

/** Confluence remote link, built from the canonical page fixtures. */
function confluenceLink(pageId: string, kind: RemoteLink['kind'] = 'confluence'): RemoteLink {
  return {
    id: `rl-${pageId}`,
    url: `https://pay.atlassian.net/wiki/pages/${pageId}`,
    title: `Page ${pageId}`,
    kind,
  };
}

/** Release 2.4 whose PAY-127 links the given pages. */
function releaseLinking(...pageIds: string[]): CollectedRelease {
  const links = pageIds.map((id) => confluenceLink(id));
  return collected({
    issues: [issue('PAY-127', { remoteLinks: links })],
    pages: paiementsPages(),
    cycleStartedAt: CYCLE_START,
  });
}

describe('linkedPages', () => {
  it('resolves remote links to pages of the release and deduplicates them', () => {
    const release = collected({
      issues: [
        issue('PAY-127', { remoteLinks: [confluenceLink('9001')] }),
        issue('PAY-128', { remoteLinks: [confluenceLink('9001'), confluenceLink('9002')] }),
      ],
      pages: paiementsPages(),
    });

    expect(linkedPages(context(release)).map((p) => p.subjectId)).toEqual(['9001', '9002']);
  });

  it('ignores non-Confluence links and pages outside the release', () => {
    const release = collected({
      issues: [
        issue('PAY-127', {
          remoteLinks: [confluenceLink('9001', 'other'), confluenceLink('9999')],
        }),
      ],
      pages: paiementsPages(),
    });

    expect(linkedPages(context(release))).toEqual([]);
  });
});

describe('DOC-01 — linked page not updated this cycle', () => {
  it('raises a minor signal on the page with its title, cycle start and url', () => {
    const [signal] = detectDoc(context(releaseLinking('9001')));

    expect(signal.code).toBe('DOC-01');
    expect(signal.severity).toBe('minor');
    expect(signal.subjectType).toBe('page');
    expect(signal.subjectId).toBe('9001');
    expect(signal.finding.key).toBe('signal.doc01.finding');
    expect(signal.finding.params).toEqual({
      pageTitle: 'Integration guide',
      cycleStart: '2026-10-29',
    });
    expect(signal.evidence[0].url).toBe('https://pay.atlassian.net/wiki/pages/9001');
  });

  it('fires once per page even when several tickets link it', () => {
    const release = collected({
      issues: [
        issue('PAY-127', { remoteLinks: [confluenceLink('9001')] }),
        issue('PAY-128', { remoteLinks: [confluenceLink('9001')] }),
      ],
      pages: paiementsPages(),
      cycleStartedAt: CYCLE_START,
    });

    const signals = detectDoc(context(release));

    expect(signals).toHaveLength(1);
    expect(signals[0].subjectId).toBe('9001');
  });

  it('raises nothing for a page modified after the cycle start', () => {
    const release = releaseLinking('9002');

    expect(detectDoc(context(release))).toEqual([]);
  });

  it('raises nothing when the release has no cycle start (no reference point)', () => {
    const release: CollectedRelease = {
      ...releaseLinking('9001'),
      cycleStartedAt: undefined,
    };

    expect(detectDoc(context(release))).toEqual([]);
  });

  it('raises DOC-01 for the stale page linked to PAY-127 on the demo dataset', () => {
    const signals = detectDoc(context(paiementsRelease()));
    expect(signals).toHaveLength(1);
    expect(signals[0].code).toBe('DOC-01');
    expect(signals[0].subjectId).toBe('9001');
    expect(signals[0].finding.key).toBe('signal.doc01.finding');
  });

  it('stays silent when the project disabled DOC-01', () => {
    const policy = paiementsPolicy();
    policy.disabledSignals = ['DOC-01'];

    expect(detectDoc(context(releaseLinking('9001'), { policy }))).toEqual([]);
  });
});

describe('docDetectors', () => {
  it('exposes the single DOC detector', () => {
    expect(docDetectors).toHaveLength(1);
  });
});
