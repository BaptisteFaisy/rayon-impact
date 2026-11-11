import { describe, expect, it } from 'vitest';
import type { CollectedRelease } from '../../src/types.js';
import type { DetectionContext } from '../../src/signals/context.js';
import { detectExp, expDetectors, impactedServices } from '../../src/signals/exp.js';
import { collected, incident, issue, version } from '../fixtures/builders.js';
import { paiementsPolicy, paiementsRelease } from '../fixtures/paiements.js';

/**
 * EXP family tests (SPEC §7, §16, §17.2).
 *
 * Local `context()` helper: DetectionContext is a plain object and the shared
 * fixtures deliberately expose no context builder, so each signal test file
 * composes it here in four lines instead of duplicating a whole release.
 */

const NOW = '2026-11-11T06:00:00.000Z';

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

function codes(ctx: DetectionContext): string[] {
  return detectExp(ctx).map((s) => s.code);
}

describe('impactedServices', () => {
  it('collects the non-null service ids of the release tickets', () => {
    const release = collected({
      issues: [
        issue('PAY-1'),
        issue('PAY-2', { serviceId: 'svc-mobile-app', serviceName: 'mobile-app' }),
        issue('PAY-3', { serviceId: null, serviceName: undefined }),
      ],
    });

    expect([...impactedServices(release)].sort()).toEqual([
      'svc-checkout-api',
      'svc-mobile-app',
    ]);
  });
});

describe('EXP-01 — open incident on an impacted service', () => {
  it('raises one blocking signal per open incident, citing key, service and tickets', () => {
    const [signal] = detectExp(context(paiementsRelease())).filter((s) => s.code === 'EXP-01');

    expect(signal).toBeDefined();
    expect(signal.severity).toBe('blocking');
    expect(signal.subjectType).toBe('incident');
    expect(signal.subjectId).toBe(incident('INC-52').subjectId);
    expect(signal.finding.key).toBe('signal.exp01.finding');
    expect(signal.finding.params?.incidentKey).toBe('INC-52');
    expect(signal.finding.params?.service).toBe('checkout-api');
    expect(String(signal.finding.params?.issues)).toContain('PAY-127');
    expect(String(signal.finding.params?.issues)).toContain('PAY-131');
    expect(signal.evidence[0].url).toBe('https://pay.atlassian.net/browse/INC-52');
  });

  it('acceptance §17.2 open incident on a service tied to a release ticket raises EXP-01 with an incident link', () => {
    const release = collected({
      issues: [issue('PAY-127')],
      incidents: [incident('INC-52')],
    });

    const signals = detectExp(context(release));

    expect(signals).toHaveLength(1);
    expect(signals[0].code).toBe('EXP-01');
    expect(signals[0].evidence).toHaveLength(1);
    expect(signals[0].evidence[0].url).toBe('https://pay.atlassian.net/browse/INC-52');
    expect(signals[0].evidence[0].subjectId).toBe(incident('INC-52').subjectId);
  });

  it('ignores an incident whose service is unknown (SPEC §16) without raising a signal', () => {
    const release = collected({
      issues: [issue('PAY-127')],
      incidents: [incident('INC-77', { serviceId: null, serviceName: undefined })],
    });

    expect(codes(context(release))).not.toContain('EXP-01');
  });

  it('ignores an open incident on a service the release does not touch', () => {
    const release = collected({
      issues: [issue('PAY-127')],
      incidents: [incident('INC-78', { serviceId: 'svc-other', serviceName: 'other' })],
    });

    expect(codes(context(release))).not.toContain('EXP-01');
  });

  it('stays silent when the project disabled EXP-01', () => {
    const release = collected({
      issues: [issue('PAY-127')],
      incidents: [incident('INC-52')],
    });
    const policy = paiementsPolicy();
    policy.disabledSignals = ['EXP-01'];

    expect(codes(context(release, { policy }))).not.toContain('EXP-01');
  });
});

describe('EXP-02 — incident resolved less than 7 days ago', () => {
  it('raises a major signal with the floored number of days', () => {
    const release = collected({
      issues: [issue('PAY-127')],
      incidents: [
        incident('INC-48', {
          state: 'resolved',
          resolvedAt: '2026-11-08T09:40:00.000Z',
        }),
      ],
    });

    const [signal] = detectExp(context(release));

    expect(signal.code).toBe('EXP-02');
    expect(signal.severity).toBe('major');
    expect(signal.subjectId).toBe(incident('INC-48').subjectId);
    expect(signal.finding.params).toEqual({
      incidentKey: 'INC-48',
      days: 2,
      service: 'checkout-api',
    });
    expect(signal.evidence[0].url).toBe('https://pay.atlassian.net/browse/INC-48');
  });

  it('raises nothing once the resolution is 7 days old or older', () => {
    const release = collected({
      issues: [issue('PAY-127')],
      incidents: [
        incident('INC-40', {
          state: 'resolved',
          resolvedAt: '2026-11-04T06:00:00.000Z',
        }),
      ],
    });

    expect(codes(context(release))).not.toContain('EXP-02');
  });

  it('raises nothing for a resolved incident without a resolution date', () => {
    const release = collected({
      issues: [issue('PAY-127')],
      incidents: [incident('INC-41', { state: 'closed' })],
    });

    expect(codes(context(release))).not.toContain('EXP-02');
  });
});

describe('EXP-03 — deployment freeze window', () => {
  const frozen = collected({
    version: version({ releaseDate: '2026-11-12' }),
    issues: [issue('PAY-127')],
    freezeWindows: [
      { id: 'fz-1', name: 'Black Friday', from: '2026-11-10', to: '2026-11-15', scope: 'all' },
    ],
  });

  it('raises a blocking signal on the version with the window bounds', () => {
    const [signal] = detectExp(context(frozen));

    expect(signal.code).toBe('EXP-03');
    expect(signal.severity).toBe('blocking');
    expect(signal.subjectType).toBe('version');
    expect(signal.subjectId).toBe('ver-24');
    expect(signal.finding.params).toEqual({
      date: '2026-11-12',
      freezeName: 'Black Friday',
      from: '2026-11-10',
      to: '2026-11-15',
    });
  });

  it('honours a window scoped to an impacted service', () => {
    const release = collected({
      version: version({ releaseDate: '2026-11-12' }),
      issues: [issue('PAY-127')],
      freezeWindows: [
        {
          id: 'fz-2',
          name: 'Payments change advisory',
          from: '2026-11-11',
          to: '2026-11-13',
          scope: 'services',
          serviceIds: ['svc-checkout-api'],
        },
      ],
    });

    expect(codes(context(release))).toContain('EXP-03');
  });

  it('ignores a service-scoped window on services the release does not touch', () => {
    const release = collected({
      version: version({ releaseDate: '2026-11-12' }),
      issues: [issue('PAY-127')],
      freezeWindows: [
        {
          id: 'fz-3',
          name: 'Mobile freeze',
          from: '2026-11-11',
          to: '2026-11-13',
          scope: 'services',
          serviceIds: ['svc-mobile-app'],
        },
      ],
    });

    expect(codes(context(release))).not.toContain('EXP-03');
  });

  it('ignores a window that does not cover the release date', () => {
    const release = collected({
      version: version({ releaseDate: '2026-11-20' }),
      issues: [issue('PAY-127')],
      freezeWindows: [
        { id: 'fz-4', name: 'Too early', from: '2026-11-10', to: '2026-11-15', scope: 'all' },
      ],
    });

    expect(codes(context(release))).not.toContain('EXP-03');
  });
});

describe('EXP-04 — sibling version on the same day and services', () => {
  function releaseWithSibling(releaseDate?: string, siblingDate?: string): CollectedRelease {
    return collected({
      version: version({ releaseDate }),
      issues: [issue('PAY-127')],
      siblingVersions: [version({ id: 'ver-25', name: '2.5', releaseDate: siblingDate })],
      issuesOfSiblingVersions: { 'ver-25': [issue('PAY-201')] },
    });
  }

  it('raises a major signal per sibling version sharing the day and a service', () => {
    const [signal] = detectExp(context(releaseWithSibling('2026-11-12', '2026-11-12')));

    expect(signal.code).toBe('EXP-04');
    expect(signal.severity).toBe('major');
    expect(signal.subjectType).toBe('version');
    expect(signal.subjectId).toBe('ver-25');
    expect(signal.finding.params).toEqual({
      siblingVersion: '2.5',
      date: '2026-11-12',
      service: 'checkout-api',
    });
  });

  it('raises nothing when the sibling ships another day', () => {
    expect(codes(context(releaseWithSibling('2026-11-12', '2026-11-13')))).not.toContain(
      'EXP-04',
    );
  });

  it('raises nothing when the sibling touches no shared service', () => {
    const release = collected({
      version: version({ releaseDate: '2026-11-12' }),
      issues: [issue('PAY-127')],
      siblingVersions: [version({ id: 'ver-26', name: '2.6', releaseDate: '2026-11-12' })],
      issuesOfSiblingVersions: {
        'ver-26': [issue('PAY-301', { serviceId: 'svc-mobile-app', serviceName: 'mobile-app' })],
      },
    });

    expect(codes(context(release))).not.toContain('EXP-04');
  });
});

describe('EXP — date-less version (SPEC §16)', () => {
  it('raises neither EXP-03 nor EXP-04 when the version has no release date', () => {
    const release = collected({
      version: version({ releaseDate: undefined }),
      issues: [issue('PAY-127')],
      freezeWindows: [
        { id: 'fz-5', name: 'Any window', from: '2020-01-01', to: '2030-01-01', scope: 'all' },
      ],
      siblingVersions: [version({ id: 'ver-25', name: '2.5', releaseDate: undefined })],
      issuesOfSiblingVersions: { 'ver-25': [issue('PAY-201')] },
    });

    const found = codes(context(release));

    expect(found).not.toContain('EXP-03');
    expect(found).not.toContain('EXP-04');
  });
});

describe('expDetectors', () => {
  it('exposes the four EXP detectors in catalogue order', () => {
    expect(expDetectors).toHaveLength(4);
  });
});
