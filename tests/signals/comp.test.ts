import { describe, expect, it } from 'vitest';
import type { CollectedRelease, JiraIssue, Signal } from '../../src/types';
import type { DetectionContext } from '../../src/signals/context';
import { compDetectors, detectComp, issueUrl } from '../../src/signals/comp';
import {
  collected,
  healthyDev,
  issue,
  policy,
  unknownDev,
} from '../fixtures/builders';
import { paiementsPolicy, paiementsRelease } from '../fixtures/paiements';

/**
 * Tests for the COMP signal family (SPEC §7, edge cases §16, acceptance §17.1).
 *
 * Composed exclusively from tests/fixtures builders — no copied literals.
 * Assertions target MessageRef keys and params, never translated text.
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

describe('compDetectors', () => {
  it('expose les 4 détecteurs du catalogue', () => {
    expect(compDetectors).toHaveLength(4);
  });

  it("construit l'url de preuve via le projet de la release", () => {
    const release = oneIssue(issue('PAY-131'));
    expect(issueUrl(release, release.issues[0])).toBe(
      'https://pay.atlassian.net/browse/PAY-131',
    );
  });
});

describe('COMP-01 — ticket non terminé', () => {
  it('cas nominal : bloquant avec key/status/category et preuve issue', () => {
    const ctx = ctxWith(
      oneIssue(
        issue('PAY-131', {
          statusName: 'In Progress',
          statusCategory: 'in-progress',
        }),
      ),
    );
    const signals = detectComp(ctx);
    const comp01 = only(signals, 'COMP-01');
    expect(comp01).toHaveLength(1);
    const signal = comp01[0];
    expect(signal.severity).toBe('blocking');
    expect(signal.status).toBe('active');
    expect(signal.subjectType).toBe('issue');
    expect(signal.subjectId).toBe('id-pay-131');
    expect(signal.finding).toEqual({
      key: 'signal.comp01.finding',
      params: { key: 'PAY-131', status: 'In Progress', category: 'in-progress' },
    });
    expect(signal.evidence).toHaveLength(1);
    expect(signal.evidence[0]).toEqual({
      subjectType: 'issue',
      subjectId: 'id-pay-131',
      label: { key: 'evidence.view' },
      url: 'https://pay.atlassian.net/browse/PAY-131',
    });
  });
});

describe('COMP-02 — terminé sans commit ni PR', () => {
  it('cas nominal : majeur quand dev est connu et vide', () => {
    const ctx = ctxWith(
      oneIssue(
        issue('PAY-132', {
          dev: healthyDev({
            commits: 0,
            openPullRequests: 0,
            mergedPullRequests: 0,
          }),
        }),
      ),
    );
    const comp02 = only(detectComp(ctx), 'COMP-02');
    expect(comp02).toHaveLength(1);
    expect(comp02[0].severity).toBe('major');
    expect(comp02[0].finding).toEqual({
      key: 'signal.comp02.finding',
      params: { key: 'PAY-132' },
    });
    expect(comp02[0].evidence[0].url).toBe(
      'https://pay.atlassian.net/browse/PAY-132',
    );
  });

  it('cas limite : silencieux quand dev.known = false (SPEC §15 honnêteté)', () => {
    const ctx = ctxWith(oneIssue(issue('PAY-132', { dev: unknownDev() })));
    expect(only(detectComp(ctx), 'COMP-02')).toHaveLength(0);
  });

  it('ne se déclenche pas sur un ticket non terminé', () => {
    const ctx = ctxWith(
      oneIssue(
        issue('PAY-131', {
          statusName: 'In Progress',
          statusCategory: 'in-progress',
          dev: healthyDev({
            commits: 0,
            openPullRequests: 0,
            mergedPullRequests: 0,
          }),
        }),
      ),
    );
    expect(only(detectComp(ctx), 'COMP-02')).toHaveLength(0);
  });
});

describe('COMP-03 — PR encore ouverte', () => {
  it('cas nominal : bloquant avec key/count', () => {
    const ctx = ctxWith(
      oneIssue(issue('PAY-131', { dev: healthyDev({ openPullRequests: 2 }) })),
    );
    const comp03 = only(detectComp(ctx), 'COMP-03');
    expect(comp03).toHaveLength(1);
    expect(comp03[0].severity).toBe('blocking');
    expect(comp03[0].finding).toEqual({
      key: 'signal.comp03.finding',
      params: { key: 'PAY-131', count: 2 },
    });
  });

  it('cas limite : silencieux quand dev.known = false', () => {
    const ctx = ctxWith(oneIssue(issue('PAY-131', { dev: unknownDev() })));
    expect(only(detectComp(ctx), 'COMP-03')).toHaveLength(0);
  });
});

describe('COMP-04 — ajout récent à la version', () => {
  it('cas nominal : mineur avec key/hours arrondies à l’entier inférieur', () => {
    const ctx = ctxWith(
      oneIssue(
        issue('PAY-133', { addedToVersionAt: '2026-11-11T00:00:00.000Z' }),
      ),
    );
    const comp04 = only(detectComp(ctx), 'COMP-04');
    expect(comp04).toHaveLength(1);
    expect(comp04[0].severity).toBe('minor');
    expect(comp04[0].finding).toEqual({
      key: 'signal.comp04.finding',
      params: { key: 'PAY-133', hours: 6 },
    });
  });

  it('arrondit 6,5 h à 6 h', () => {
    const ctx = ctxWith(
      oneIssue(
        issue('PAY-133', { addedToVersionAt: '2026-11-10T23:30:00.000Z' }),
      ),
    );
    const comp04 = only(detectComp(ctx), 'COMP-04');
    expect(comp04).toHaveLength(1);
    expect(comp04[0].finding.params).toEqual({ key: 'PAY-133', hours: 6 });
  });

  it('cas limite : exactement 48 h → aucun signal', () => {
    const ctx = ctxWith(
      oneIssue(
        issue('PAY-133', { addedToVersionAt: '2026-11-09T06:00:00.000Z' }),
      ),
    );
    expect(only(detectComp(ctx), 'COMP-04')).toHaveLength(0);
  });

  it('cas limite : addedToVersionAt absent → aucun signal', () => {
    const ctx = ctxWith(oneIssue(issue('PAY-133')));
    expect(only(detectComp(ctx), 'COMP-04')).toHaveLength(0);
  });
});

describe('release saine', () => {
  it('aucun signal sur un ticket terminé, dev connu, sans ajout récent', () => {
    const ctx = ctxWith(oneIssue(issue('PAY-1')));
    expect(detectComp(ctx)).toEqual([]);
  });
});

describe('politique', () => {
  it('COMP-04 désactivé : pas de signal, les autres continuent', () => {
    const ctx = ctxWith(
      oneIssue(
        issue('PAY-133', {
          statusName: 'In Progress',
          statusCategory: 'in-progress',
          addedToVersionAt: '2026-11-11T00:00:00.000Z',
        }),
      ),
      { policy: policy({ disabledSignals: ['COMP-04'] }) },
    );
    const signals = detectComp(ctx);
    expect(only(signals, 'COMP-04')).toHaveLength(0);
    expect(only(signals, 'COMP-01')).toHaveLength(1);
  });
});

describe('recette SPEC §17', () => {
  it('acceptance §17.1 — ticket « En cours » : COMP-01 cite PAY-131 avec les bons params', () => {
    const ctx = ctxWith(paiementsRelease());
    const comp01 = only(detectComp(ctx), 'COMP-01');
    expect(comp01).toHaveLength(1);
    expect(comp01[0].subjectId).toBe('id-pay-131');
    expect(comp01[0].severity).toBe('blocking');
    expect(comp01[0].finding).toEqual({
      key: 'signal.comp01.finding',
      params: { key: 'PAY-131', status: 'In Progress', category: 'in-progress' },
    });
    // Le jeu canonique déclenche aussi COMP-03 (PR ouverte) et COMP-04 (PAY-133, 6 h).
    expect(only(detectComp(ctx), 'COMP-03').map((s) => s.subjectId)).toEqual([
      'id-pay-131',
    ]);
    const comp04 = only(detectComp(ctx), 'COMP-04');
    expect(comp04.map((s) => s.subjectId)).toEqual(['id-pay-133']);
    expect(comp04[0].finding.params).toEqual({ key: 'PAY-133', hours: 6 });
  });
});
