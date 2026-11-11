import { describe, expect, it } from 'vitest';
import type {
  CollectedRelease,
  IssueLinkRef,
  JiraIssue,
  Signal,
} from '../../src/types';
import type { DetectionContext } from '../../src/signals/context';
import { depDetectors, detectDep, resolveServiceId } from '../../src/signals/dep';
import {
  PROJECT_KEY,
  collected,
  graphFacts,
  issue,
  policy,
  team,
} from '../fixtures/builders';
import {
  BLOCKER_OUTSIDE_VERSION,
  LINKED_OUTSIDE_ISSUES,
  MOB_77,
  paiementsPolicy,
  paiementsRelease,
} from '../fixtures/paiements';

/**
 * Tests for the DEP signal family (SPEC §7, edge cases §16, acceptance §17.6).
 *
 * Datasets come from tests/fixtures builders and the canonical Paiements set;
 * assertions target MessageRef keys and params, never translated text.
 */

const NOW = '2026-11-11T06:00:00.000Z';

/** Jira "Blocks" link from a release ticket to its blocker. */
function blockingLink(overrides: Partial<IssueLinkRef> = {}): IssueLinkRef {
  return {
    id: 'link-pay130-pay118',
    type: 'Blocks',
    inward: true,
    targetKey: 'PAY-118',
    targetId: 'id-pay-118',
    targetProjectKey: PROJECT_KEY,
    targetStatusCategory: 'in-progress',
    targetFixVersions: [],
    ...overrides,
  };
}

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
  return collected({
    issues: [issueUnderTest],
    linkedOutsideIssues: [BLOCKER_OUTSIDE_VERSION],
  });
}

function only(signals: Signal[], code: string): Signal[] {
  return signals.filter((s) => s.code === code);
}

const CHECKOUT_TEAM = team('team-checkout', {
  name: 'Checkout',
  componentIds: ['cmp-checkout'],
});

describe('depDetectors', () => {
  it('expose les 3 détecteurs du catalogue', () => {
    expect(depDetectors).toHaveLength(3);
  });
});

describe('DEP-01 — bloqué par un ticket ouvert', () => {
  it('cas nominal : bloquant, params du bloquant, deux preuves', () => {
    const ctx = ctxWith(
      oneIssue(issue('PAY-130', { links: [blockingLink()] })),
    );
    const dep01 = only(detectDep(ctx), 'DEP-01');
    expect(dep01).toHaveLength(1);
    expect(dep01[0].severity).toBe('blocking');
    expect(dep01[0].subjectType).toBe('issue');
    expect(dep01[0].subjectId).toBe('id-pay-130');
    expect(dep01[0].finding).toEqual({
      key: 'signal.dep01.finding',
      params: {
        key: 'PAY-130',
        blockerKey: 'PAY-118',
        blockerStatus: 'in-progress',
      },
    });
    expect(dep01[0].evidence).toHaveLength(2);
    expect(dep01[0].evidence[0].subjectId).toBe('id-pay-130');
    expect(dep01[0].evidence[1].subjectId).toBe('id-pay-118');
    expect(dep01[0].evidence[1].url).toBe(
      'https://pay.atlassian.net/browse/PAY-118',
    );
  });

  it('type de lien insensible à la casse et au français', () => {
    const ctx = ctxWith(
      oneIssue(
        issue('PAY-130', { links: [blockingLink({ type: 'est bloqué par' })] }),
      ),
    );
    expect(only(detectDep(ctx), 'DEP-01')).toHaveLength(1);
  });

  it('sens du lien : un ticket qui BLOQUE un ticket ouvert ne lève pas DEP-01', () => {
    // SPEC §7 : DEP-01 vise le ticket « bloqué par » un ticket encore ouvert.
    // Un ticket de la version qui en bloque un autre n'est pas retenu par lui.
    const ctx = ctxWith(
      oneIssue(issue('PAY-130', { links: [blockingLink({ inward: false })] })),
    );
    expect(only(detectDep(ctx), 'DEP-01')).toHaveLength(0);
  });

  it('cas limite : lien non bloquant → aucun signal', () => {
    const ctx = ctxWith(
      oneIssue(issue('PAY-130', { links: [blockingLink({ type: 'Relates' })] })),
    );
    expect(only(detectDep(ctx), 'DEP-01')).toHaveLength(0);
  });

  it('cas limite : bloquant déjà terminé → aucun signal', () => {
    const ctx = ctxWith(
      oneIssue(
        issue('PAY-130', {
          links: [blockingLink({ targetStatusCategory: 'done' })],
        }),
      ),
    );
    expect(only(detectDep(ctx), 'DEP-01')).toHaveLength(0);
  });

  it('statut du bloquant inconnu → blockerStatus = unknown', () => {
    const ctx = ctxWith(
      oneIssue(
        issue('PAY-130', {
          links: [blockingLink({ targetStatusCategory: undefined })],
        }),
      ),
    );
    const dep01 = only(detectDep(ctx), 'DEP-01');
    expect(dep01).toHaveLength(1);
    expect(dep01[0].finding.params).toEqual({
      key: 'PAY-130',
      blockerKey: 'PAY-118',
      blockerStatus: 'unknown',
    });
  });

  it('bloquant hors release : preuve reconstruite depuis son projet', () => {
    const release = collected({
      issues: [issue('PAY-130', { links: [blockingLink()] })],
      linkedOutsideIssues: [],
    });
    const dep01 = only(detectDep(ctxWith(release)), 'DEP-01');
    expect(dep01[0].evidence[1]).toEqual({
      subjectType: 'issue',
      subjectId: 'id-pay-118',
      label: { key: 'evidence.view' },
      url: 'https://pay.atlassian.net/browse/PAY-118',
    });
  });

  it('un seul signal par ticket même avec deux bloquants ouverts', () => {
    const second = blockingLink({
      id: 'link-pay130-pay119',
      targetKey: 'PAY-119',
      targetId: 'id-pay-119',
    });
    const ctx = ctxWith(
      oneIssue(issue('PAY-130', { links: [blockingLink(), second] })),
    );
    expect(only(detectDep(ctx), 'DEP-01')).toHaveLength(1);
  });
});

describe('DEP-02 — dépendance d’un autre projet', () => {
  it('cas nominal : un signal par ticket extérieur, sujet = ticket extérieur', () => {
    const release = collected({
      issues: [issue('PAY-127')],
      linkedOutsideIssues: LINKED_OUTSIDE_ISSUES,
    });
    const dep02 = only(detectDep(ctxWith(release)), 'DEP-02');
    expect(dep02).toHaveLength(1);
    expect(dep02[0].severity).toBe('major');
    expect(dep02[0].subjectType).toBe('issue');
    expect(dep02[0].subjectId).toBe('id-mob-77');
    expect(dep02[0].finding).toEqual({
      key: 'signal.dep02.finding',
      params: { key: 'PAY-127', targetKey: 'MOB-77', projectKey: 'MOB' },
    });
    expect(dep02[0].evidence[0].subjectId).toBe('id-mob-77');
  });

  it('cas limite : ticket extérieur du même projet → aucun signal', () => {
    const release = collected({
      issues: [issue('PAY-127')],
      linkedOutsideIssues: [BLOCKER_OUTSIDE_VERSION],
    });
    expect(only(detectDep(ctxWith(release)), 'DEP-02')).toHaveLength(0);
  });

  it('cas limite : ticket extérieur sans lien vers la version → aucun signal', () => {
    const unrelated = issue('MOB-78', { projectKey: 'MOB', links: [] });
    const release = collected({
      issues: [issue('PAY-127')],
      linkedOutsideIssues: [unrelated],
    });
    expect(only(detectDep(ctxWith(release)), 'DEP-02')).toHaveLength(0);
  });

  it('deux tickets extérieurs → deux signaux distincts', () => {
    const second = issue('WEB-12', {
      projectKey: 'WEB',
      links: [
        {
          id: 'link-web12-pay128',
          type: 'Depends on',
          inward: false,
          targetKey: 'PAY-128',
          targetId: 'id-pay-128',
          targetProjectKey: PROJECT_KEY,
          targetStatusCategory: 'done',
        },
      ],
    });
    const release = collected({
      issues: [issue('PAY-127'), issue('PAY-128')],
      linkedOutsideIssues: [MOB_77, second],
    });
    const dep02 = only(detectDep(ctxWith(release)), 'DEP-02');
    expect(dep02.map((s) => s.subjectId)).toEqual(['id-mob-77', 'id-web-12']);
  });
});

describe('DEP-03 — service touché sans ticket de son équipe', () => {
  function releaseWithTeams(teamsByIssueId: Record<string, ReturnType<typeof team>[]>) {
    return collected({
      issues: [issue('PAY-127')],
      teams: [CHECKOUT_TEAM],
      graph: graphFacts({
        componentsByIssueId: { 'id-pay-127': ['cmp-checkout'] },
        teamsByIssueId,
      }),
    });
  }

  it('cas nominal : mineur sur le service, param = nom du service', () => {
    const ctx = ctxWith(releaseWithTeams({}));
    const dep03 = only(detectDep(ctx), 'DEP-03');
    expect(dep03).toHaveLength(1);
    expect(dep03[0].severity).toBe('minor');
    expect(dep03[0].subjectType).toBe('service');
    expect(dep03[0].subjectId).toBe('svc-checkout-api');
    expect(dep03[0].finding).toEqual({
      key: 'signal.dep03.finding',
      params: { service: 'checkout-api' },
    });
    expect(dep03[0].evidence[0].subjectType).toBe('service');
  });

  it('aucun signal quand l’équipe propriétaire a un ticket lié', () => {
    const ctx = ctxWith(releaseWithTeams({ 'id-pay-127': [CHECKOUT_TEAM] }));
    expect(only(detectDep(ctx), 'DEP-03')).toHaveLength(0);
  });

  it('cas limite : graph = null → aucun signal (SPEC §15, §16)', () => {
    const release = collected({
      issues: [issue('PAY-127')],
      teams: [CHECKOUT_TEAM],
      graph: null,
    });
    expect(only(detectDep(ctxWith(release)), 'DEP-03')).toHaveLength(0);
  });

  it('cas limite : équipe propriétaire inconnue → aucun signal inventé', () => {
    const release = collected({
      issues: [issue('PAY-127')],
      teams: [],
      graph: graphFacts({ componentsByIssueId: { 'id-pay-127': ['cmp-checkout'] } }),
    });
    expect(only(detectDep(ctxWith(release)), 'DEP-03')).toHaveLength(0);
  });
});

describe('resolveServiceId', () => {
  it('la relation du graphe gagne sur le composant Jira', () => {
    const release = paiementsRelease();
    const target = release.issues[0];
    const graph = graphFacts({
      servicesByIssueId: { [target.subjectId]: 'svc-mobile-app' },
    });
    expect(resolveServiceId(target, paiementsPolicy(), graph)).toBe(
      'svc-mobile-app',
    );
  });

  it('retombe sur le composant Jira, puis sur le service collecté, puis null', () => {
    const policyUnderTest = paiementsPolicy();
    const issueWithService = issue('PAY-127');
    expect(resolveServiceId(issueWithService, policyUnderTest, null)).toBe(
      'svc-checkout-api',
    );
    const orphan = issue('PAY-999', { components: [], serviceId: null });
    expect(resolveServiceId(orphan, policyUnderTest, null)).toBeNull();
  });
});

describe('release saine', () => {
  it('aucun signal sur un ticket sans lien ni graph', () => {
    const release = collected({ issues: [issue('PAY-1')] });
    expect(detectDep(ctxWith(release))).toEqual([]);
  });
});

describe('politique', () => {
  it('DEP-01 désactivé : pas de signal, les autres continuent', () => {
    const release = collected({
      issues: [issue('PAY-127'), issue('PAY-130', { links: [blockingLink()] })],
      linkedOutsideIssues: LINKED_OUTSIDE_ISSUES,
    });
    const ctx = ctxWith(release, {
      policy: policy({ disabledSignals: ['DEP-01'] }),
    });
    const signals = detectDep(ctx);
    expect(only(signals, 'DEP-01')).toHaveLength(0);
    expect(only(signals, 'DEP-02')).toHaveLength(1);
  });
});

describe('recette SPEC §17', () => {
  it('acceptance §17.6 — le bloquant passe à Terminé, DEP-01 disparaît au recalcul', () => {
    const blocked = oneIssue(issue('PAY-130', { links: [blockingLink()] }));
    expect(only(detectDep(ctxWith(blocked)), 'DEP-01')).toHaveLength(1);

    const unblocked = collected({
      issues: [
        issue('PAY-130', {
          links: [blockingLink({ targetStatusCategory: 'done' })],
        }),
      ],
      linkedOutsideIssues: [
        issue('PAY-118', {
          statusName: 'Done',
          statusCategory: 'done',
          fixVersions: [],
        }),
      ],
    });
    expect(only(detectDep(ctxWith(unblocked)), 'DEP-01')).toHaveLength(0);
  });
});

describe('jeu canonique Paiements 2.4', () => {
  it('déclenche DEP-01 PAY-130 et DEP-02 MOB-77, sans DEP-03', () => {
    const ctx = ctxWith(
      collected({
        ...paiementsRelease(),
        linkedOutsideIssues: LINKED_OUTSIDE_ISSUES,
      }),
    );
    const signals = detectDep(ctx);
    const dep01 = only(signals, 'DEP-01');
    expect(dep01.map((s) => s.subjectId)).toEqual(['id-pay-130']);
    expect(dep01[0].finding.params).toEqual({
      key: 'PAY-130',
      blockerKey: 'PAY-118',
      blockerStatus: 'in-progress',
    });
    const dep02 = only(signals, 'DEP-02');
    expect(dep02.map((s) => s.subjectId)).toEqual(['id-mob-77']);
    expect(dep02[0].finding.params).toEqual({
      key: 'PAY-127',
      targetKey: 'MOB-77',
      projectKey: 'MOB',
    });
    expect(only(signals, 'DEP-03')).toHaveLength(0);
  });
});
