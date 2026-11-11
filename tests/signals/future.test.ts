import { describe, expect, it } from 'vitest';
import type { CollectedRelease, GraphFacts, Outcome } from '../../src/types';
import type { DetectionContext } from '../../src/signals/context';
import {
  detectFuture,
  futureDetectors,
  incidentsByService,
  objectiveFacts,
} from '../../src/signals/future';
import { collected, graphFacts, incident, issue } from '../fixtures/builders';
import { paiementsPolicy, paiementsRelease } from '../fixtures/paiements';

/**
 * Vision signals (lot C): HIST-01 and OBJ-01 (SPEC §6.4, §7).
 *
 * Local `context()` helper: DetectionContext is a plain object and the shared
 * fixtures expose no context builder, so each signal test file composes it in
 * four lines rather than duplicating a whole release.
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

/** Past 72 h outcome, as stored after a previous release. */
function outcome(versionId: string, keys: string[]): Outcome {
  return {
    versionId,
    checkedAt: '2026-10-01T00:00:00.000Z',
    rollback: false,
    notes: '',
    incidents: keys.map((key) => ({
      key,
      severity: 'major',
      url: `https://pay.atlassian.net/browse/${key}`,
    })),
  };
}

/** Release whose only ticket touches checkout-api. */
function release(): CollectedRelease {
  return collected({ issues: [issue('PAY-127')] });
}

describe('incidentsByService', () => {
  it('attributes past incidents to an impacted service through the graph', () => {
    const graph = graphFacts({ servicesByIncidentId: { 'INC-90': 'svc-checkout-api' } });
    const ctx = context(collected({ issues: [issue('PAY-127')], graph }), {
      pastOutcomes: [outcome('ver-23', ['INC-90'])],
    });

    expect([...incidentsByService(ctx).keys()]).toEqual(['svc-checkout-api']);
  });

  it('falls back on the collected JSM incident when the graph is silent', () => {
    const ctx = context(
      collected({
        issues: [issue('PAY-127')],
        incidents: [incident('INC-90', { state: 'closed' })],
        graph: null,
      }),
      { pastOutcomes: [outcome('ver-23', ['INC-90'])] },
    );

    expect([...incidentsByService(ctx).keys()]).toEqual(['svc-checkout-api']);
  });

  it('drops incidents whose service cannot be resolved', () => {
    const ctx = context(release(), { pastOutcomes: [outcome('ver-23', ['INC-404'])] });

    expect(incidentsByService(ctx).size).toBe(0);
  });
});

describe('HIST-01 — risk zone', () => {
  it('raises one major signal per service with past post-release incidents', () => {
    const graph = graphFacts({ servicesByIncidentId: { 'INC-90': 'svc-checkout-api' } });
    const ctx = context(collected({ issues: [issue('PAY-127')], graph }), {
      pastOutcomes: [outcome('ver-23', ['INC-90'])],
    });

    const [signal] = detectFuture(ctx);

    expect(signal.code).toBe('HIST-01');
    expect(signal.severity).toBe('major');
    expect(signal.subjectType).toBe('service');
    expect(signal.subjectId).toBe('svc-checkout-api');
    expect(signal.finding.key).toBe('signal.hist01.finding');
    expect(signal.finding.params).toEqual({ service: 'checkout-api', count: 1 });
    expect(signal.evidence[0].url).toBe('https://pay.atlassian.net/browse/INC-90');
  });

  it('counts incidents across several past outcomes', () => {
    const graph = graphFacts({
      servicesByIncidentId: { 'INC-90': 'svc-checkout-api', 'INC-91': 'svc-checkout-api' },
    });
    const ctx = context(collected({ issues: [issue('PAY-127')], graph }), {
      pastOutcomes: [outcome('ver-22', ['INC-90']), outcome('ver-23', ['INC-91'])],
    });

    const [signal] = detectFuture(ctx);

    expect(signal.finding.params?.count).toBe(2);
  });

  it('raises nothing when no past outcome is available', () => {
    expect(detectFuture(context(paiementsRelease()))).toEqual([]);
  });

  it('raises nothing for a past incident on a service the release does not touch', () => {
    const graph = graphFacts({ servicesByIncidentId: { 'INC-90': 'svc-other' } });
    const ctx = context(collected({ issues: [issue('PAY-127')], graph }), {
      pastOutcomes: [outcome('ver-23', ['INC-90'])],
    });

    expect(detectFuture(ctx)).toEqual([]);
  });

  it('stays silent when the project disabled HIST-01', () => {
    const graph = graphFacts({ servicesByIncidentId: { 'INC-90': 'svc-checkout-api' } });
    const policy = paiementsPolicy();
    policy.disabledSignals = ['HIST-01'];
    const ctx = context(collected({ issues: [issue('PAY-127')], graph }), {
      policy,
      pastOutcomes: [outcome('ver-23', ['INC-90'])],
    });

    expect(detectFuture(ctx)).toEqual([]);
  });
});

describe('OBJ-01 — objective milestone (lot C reserve)', () => {
  it('returns null facts while the graph is unavailable', () => {
    expect(objectiveFacts(null)).toBeNull();
  });

  it('returns null facts while the graph carries no objective', () => {
    expect(objectiveFacts(graphFacts())).toBeNull();
  });

  it('raises nothing on the canonical dataset (no objective in the graph)', () => {
    expect(detectFuture(context(paiementsRelease()))).toEqual([]);
  });

  it('raises an info signal once the graph exposes an objective', () => {
    const graph = { ...graphFacts(), objective: { milestone: 'PSD3', due: '2026-12-01' } };
    const ctx = context(collected({ issues: [issue('PAY-127')], graph: graph as GraphFacts }));

    const [signal] = detectFuture(ctx);

    expect(signal.code).toBe('OBJ-01');
    expect(signal.severity).toBe('info');
    expect(signal.subjectType).toBe('version');
    expect(signal.finding.params).toEqual({ milestone: 'PSD3', due: '2026-12-01' });
  });

  it('stays silent when the project disabled OBJ-01', () => {
    const graph = { ...graphFacts(), objective: { milestone: 'PSD3', due: '2026-12-01' } };
    const policy = paiementsPolicy();
    policy.disabledSignals = ['OBJ-01'];
    const ctx = context(collected({ issues: [issue('PAY-127')], graph: graph as GraphFacts }), {
      policy,
    });

    expect(detectFuture(ctx)).toEqual([]);
  });
});

describe('futureDetectors', () => {
  it('exposes both vision detectors in catalogue order', () => {
    expect(futureDetectors).toHaveLength(2);
  });
});
