import { describe, expect, it } from 'vitest';
import type { CollectedRelease, JiraIssue, Signal } from '../../src/types';
import type { DetectionContext } from '../../src/signals/context';
import { detectQual, qualDetectors } from '../../src/signals/qual';
import {
  collected,
  healthyDev,
  issue,
  policy,
  unknownDev,
} from '../fixtures/builders';
import { paiementsPolicy, paiementsRelease } from '../fixtures/paiements';

/**
 * Tests for the QUAL signal family (SPEC §7, edge cases §16).
 *
 * Datasets are composed from tests/fixtures builders only; assertions target
 * MessageRef keys and params, never translated text. No SPEC §17 acceptance
 * point covers QUAL: the family is verified through nominal, limit and policy
 * cases instead.
 */

const NOW = '2026-11-11T06:00:00.000Z';

function ctxWith(
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

function oneIssue(issueUnderTest: JiraIssue): CollectedRelease {
  return collected({ issues: [issueUnderTest] });
}

function only(signals: Signal[], code: string): Signal[] {
  return signals.filter((s) => s.code === code);
}

const FAILING_DEV = healthyDev({ failingBuilds: 1, lastBuildState: 'failing' });

describe('qualDetectors', () => {
  it('expose les 3 détecteurs du catalogue', () => {
    expect(qualDetectors).toHaveLength(3);
  });
});

describe('QUAL-01 — dernier build en échec', () => {
  it('cas nominal : bloquant avec key/count et preuve issue', () => {
    const ctx = ctxWith(oneIssue(issue('PAY-129', { dev: FAILING_DEV })));
    const qual01 = only(detectQual(ctx), 'QUAL-01');
    expect(qual01).toHaveLength(1);
    expect(qual01[0].severity).toBe('blocking');
    expect(qual01[0].status).toBe('active');
    expect(qual01[0].subjectType).toBe('issue');
    expect(qual01[0].subjectId).toBe('id-pay-129');
    expect(qual01[0].id).toBe('QUAL-01:issue:id-pay-129');
    expect(qual01[0].finding).toEqual({
      key: 'signal.qual01.finding',
      params: { key: 'PAY-129', count: 1 },
    });
    expect(qual01[0].evidence).toHaveLength(1);
    expect(qual01[0].evidence[0].url).toBe(
      'https://pay.atlassian.net/browse/PAY-129',
    );
  });

  it('se déclenche sur lastBuildState = failing même sans build compté', () => {
    const ctx = ctxWith(
      oneIssue(
        issue('PAY-129', {
          dev: healthyDev({ failingBuilds: 0, lastBuildState: 'failing' }),
        }),
      ),
    );
    const qual01 = only(detectQual(ctx), 'QUAL-01');
    expect(qual01).toHaveLength(1);
    expect(qual01[0].finding.params).toEqual({ key: 'PAY-129', count: 0 });
  });

  it('cas limite : silencieux quand dev.known = false (SPEC §15)', () => {
    const ctx = ctxWith(oneIssue(issue('PAY-129', { dev: unknownDev() })));
    expect(only(detectQual(ctx), 'QUAL-01')).toHaveLength(0);
  });

  it('aucun signal sur un build vert', () => {
    const ctx = ctxWith(oneIssue(issue('PAY-127')));
    expect(only(detectQual(ctx), 'QUAL-01')).toHaveLength(0);
  });
});

describe('QUAL-02 — PR fusionnée sans approbation', () => {
  it('cas nominal : majeur avec key/count', () => {
    const ctx = ctxWith(
      oneIssue(
        issue('PAY-135', { dev: healthyDev({ mergedWithoutApproval: 2 }) }),
      ),
    );
    const qual02 = only(detectQual(ctx), 'QUAL-02');
    expect(qual02).toHaveLength(1);
    expect(qual02[0].severity).toBe('major');
    expect(qual02[0].subjectId).toBe('id-pay-135');
    expect(qual02[0].finding).toEqual({
      key: 'signal.qual02.finding',
      params: { key: 'PAY-135', count: 2 },
    });
  });

  it('cas limite : silencieux quand dev.known = false', () => {
    const ctx = ctxWith(oneIssue(issue('PAY-135', { dev: unknownDev() })));
    expect(only(detectQual(ctx), 'QUAL-02')).toHaveLength(0);
  });

  it('aucun signal quand toutes les PR ont été relues', () => {
    const ctx = ctxWith(oneIssue(issue('PAY-135')));
    expect(only(detectQual(ctx), 'QUAL-02')).toHaveLength(0);
  });
});

describe('QUAL-03 — bug rouvert pendant le cycle', () => {
  it('cas nominal : mineur avec key, restreint aux bugs', () => {
    const ctx = ctxWith(
      oneIssue(
        issue('PAY-134', { issueType: 'Bug', reopenedDuringCycle: true }),
      ),
    );
    const qual03 = only(detectQual(ctx), 'QUAL-03');
    expect(qual03).toHaveLength(1);
    expect(qual03[0].severity).toBe('minor');
    expect(qual03[0].finding).toEqual({
      key: 'signal.qual03.finding',
      params: { key: 'PAY-134' },
    });
  });

  it('cas limite : une story rouverte ne produit rien', () => {
    const ctx = ctxWith(
      oneIssue(
        issue('PAY-134', { issueType: 'Story', reopenedDuringCycle: true }),
      ),
    );
    expect(only(detectQual(ctx), 'QUAL-03')).toHaveLength(0);
  });

  it('aucun signal sur un bug jamais rouvert', () => {
    const ctx = ctxWith(oneIssue(issue('PAY-134', { issueType: 'Bug' })));
    expect(only(detectQual(ctx), 'QUAL-03')).toHaveLength(0);
  });
});

describe('release saine', () => {
  it('aucun signal sur un ticket terminé, relu, au build vert', () => {
    const ctx = ctxWith(oneIssue(issue('PAY-1')));
    expect(detectQual(ctx)).toEqual([]);
  });
});

describe('politique', () => {
  it('QUAL-01 désactivé : pas de signal, les autres continuent', () => {
    const ctx = ctxWith(
      oneIssue(
        issue('PAY-129', {
          dev: healthyDev({ failingBuilds: 1, mergedWithoutApproval: 1 }),
        }),
      ),
      { policy: policy({ disabledSignals: ['QUAL-01'] }) },
    );
    const signals = detectQual(ctx);
    expect(only(signals, 'QUAL-01')).toHaveLength(0);
    expect(only(signals, 'QUAL-02')).toHaveLength(1);
  });

  it('surcharge de gravité par projet (RI-11) : QUAL-03 passe en majeur', () => {
    const ctx = ctxWith(
      oneIssue(issue('PAY-134', { issueType: 'Bug', reopenedDuringCycle: true })),
      { policy: policy({ severityOverrides: { 'QUAL-03': 'major' } }) },
    );
    expect(only(detectQual(ctx), 'QUAL-03')[0].severity).toBe('major');
  });
});

describe('jeu canonique Paiements 2.4', () => {
  it('déclenche exactement QUAL-01 PAY-129, QUAL-02 PAY-135, QUAL-03 PAY-134', () => {
    const ctx = ctxWith(paiementsRelease());
    const qual01 = only(detectQual(ctx), 'QUAL-01');
    const qual02 = only(detectQual(ctx), 'QUAL-02');
    const qual03 = only(detectQual(ctx), 'QUAL-03');
    expect(qual01.map((s) => s.subjectId)).toEqual(['id-pay-129']);
    expect(qual01[0].finding.params).toEqual({ key: 'PAY-129', count: 1 });
    expect(qual02.map((s) => s.subjectId)).toEqual(['id-pay-135']);
    expect(qual02[0].finding.params).toEqual({ key: 'PAY-135', count: 1 });
    expect(qual03.map((s) => s.subjectId)).toEqual(['id-pay-134']);
  });
});
