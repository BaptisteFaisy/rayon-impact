import { describe, expect, it } from 'vitest';
import type {
  Evidence,
  MessageRef,
  ReleaseDossier,
  Signal,
  SignalCode,
  SubjectRef,
  SubjectType,
  Viewer,
} from '../../src/types';
import { getSignalDefinition } from '../../src/signals/registry';
import { canViewerWaive, sanitizeDossierForViewer } from '../../src/engine/permissions';
import { policy, snapshot } from '../fixtures/builders';
import { paiementsIncidents, paiementsPages } from '../fixtures/paiements';

/**
 * SPEC §15 "Droits" / RI-10: proof filtering per viewer rights.
 * Assertions are made on MessageRef keys and params, never on translated text.
 */

const NOW = '2026-11-11T06:00:00.000Z';
const INC_52 = paiementsIncidents()[0];
const PAGE_9001 = paiementsPages()[0];

/** Visibility oracle built from a set of visible `subjectType:subjectId` keys. */
function viewerSeeing(visible: string[], overrides: Partial<Viewer> = {}): Viewer {
  return {
    accountId: 'user-reader',
    locale: 'fr',
    canWaive: false,
    visibility: { isVisible: (ref: SubjectRef) => visible.includes(`${ref.subjectType}:${ref.subjectId}`) },
    ...overrides,
  };
}

function viewerSeeingAll(): Viewer {
  return viewerSeeing([], {
    visibility: { isVisible: () => true },
  });
}

function evidenceOf(subjectType: SubjectType, subjectId: string, code: SignalCode, url: string): Evidence {
  return {
    subjectType,
    subjectId,
    label: { ...getSignalDefinition(code).title },
    url,
  };
}

function signalOf(input: {
  code: SignalCode;
  subjectType: SubjectType;
  subjectId: string;
  finding: MessageRef;
  evidence: Evidence[];
}): Signal {
  return {
    id: `${input.code}:${input.subjectType}:${input.subjectId}`,
    code: input.code,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    severity: getSignalDefinition(input.code).defaultSeverity,
    status: 'active',
    finding: input.finding,
    evidence: input.evidence,
    detectedAt: NOW,
    firstSeenAt: NOW,
  };
}

/** EXP-01 on INC-52: the JSM incident is the proof and also named in the finding. */
function exp01Signal(): Signal {
  return signalOf({
    code: 'EXP-01',
    subjectType: 'incident',
    subjectId: INC_52.subjectId,
    finding: {
      key: 'signal.exp01.finding',
      params: { incidentKey: INC_52.key, service: 'checkout-api', issues: 'PAY-127' },
    },
    evidence: [evidenceOf('incident', INC_52.subjectId, 'EXP-01', INC_52.url)],
  });
}

/** DOC-01 on page 9001: hidden proof, finding only carries the page title. */
function doc01Signal(): Signal {
  return signalOf({
    code: 'DOC-01',
    subjectType: 'page',
    subjectId: PAGE_9001.subjectId,
    finding: {
      key: 'signal.doc01.finding',
      params: { pageTitle: PAGE_9001.title, cycleStart: '2026-10-29' },
    },
    evidence: [evidenceOf('page', PAGE_9001.subjectId, 'DOC-01', PAGE_9001.url)],
  });
}

/** DEP-03 on a visible service whose only proof is an invisible ticket. */
function dep03Signal(): Signal {
  const issue = { subjectType: 'issue' as const, subjectId: 'id-pay-130' };
  return signalOf({
    code: 'DEP-03',
    subjectType: 'service',
    subjectId: 'svc-checkout-api',
    finding: { key: 'signal.dep03.finding', params: { service: 'checkout-api' } },
    evidence: [evidenceOf(issue.subjectType, issue.subjectId, 'DEP-03', 'https://pay.atlassian.net/browse/PAY-130')],
  });
}

function dossierOf(signals: Signal[]): ReleaseDossier {
  return {
    snapshot: snapshot({
      verdict: 'no-go',
      confidence: 'medium',
      counts: { blocking: signals.filter((s) => s.severity === 'blocking').length, major: 0, minor: 0, info: 0 },
    }),
    signals,
    waivers: [],
    decisions: [],
    outcome: null,
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

describe('sanitizeDossierForViewer', () => {
  it('masque une preuve invisible : label evidence.restricted, url retirée, restricted', () => {
    const dossier = dossierOf([exp01Signal()]);
    const viewer = viewerSeeing([]);

    const result = sanitizeDossierForViewer(dossier, viewer);
    const evidence = result.signals[0].evidence[0];

    expect(evidence.label).toEqual({ key: 'evidence.restricted' });
    expect(evidence.url).toBeUndefined();
    expect(evidence.restricted).toBe(true);
    expect(result.hiddenEvidenceCount).toBe(1);
    expect(result.hiddenSubjects).toEqual([{ subjectType: 'incident', subjectId: INC_52.subjectId }]);
  });

  it('masque le finding quand il cite un identifiant invisible (RI-10)', () => {
    const result = sanitizeDossierForViewer(dossierOf([exp01Signal()]), viewerSeeing([]));
    expect(result.signals[0].finding).toEqual({ key: 'evidence.restricted' });
  });

  it('garde le finding générique quand toutes les preuves sont masquées sans fuite', () => {
    const result = sanitizeDossierForViewer(dossierOf([dep03Signal()]), viewerSeeing(['service:svc-checkout-api']));
    const signal = result.signals[0];

    expect(signal.finding).toEqual({ key: 'signal.dep03.finding', params: { service: 'checkout-api' } });
    expect(signal.evidence[0].restricted).toBe(true);
    expect(result.hiddenEvidenceCount).toBe(1);
  });

  it('ne retire jamais un signal masqué et ne touche ni verdict, ni counts, ni confidence', () => {
    const dossier = dossierOf([exp01Signal(), doc01Signal(), dep03Signal()]);
    const result = sanitizeDossierForViewer(dossier, viewerSeeing([]));

    expect(result.signals).toHaveLength(3);
    expect(result.snapshot.verdict).toBe(dossier.snapshot.verdict);
    expect(result.snapshot.counts).toEqual(dossier.snapshot.counts);
    expect(result.snapshot.confidence).toBe(dossier.snapshot.confidence);
    expect(result.hiddenEvidenceCount).toBe(3);
  });

  it('lecteur qui voit tout : aucun masquage, dossier identique au contenu près', () => {
    const dossier = dossierOf([exp01Signal(), doc01Signal(), dep03Signal()]);
    const result = sanitizeDossierForViewer(dossier, viewerSeeingAll());

    expect(result.hiddenEvidenceCount).toBe(0);
    expect(result.hiddenSubjects).toEqual([]);
    expect(result.signals).toEqual(dossier.signals);
    expect(result.waivers).toEqual(dossier.waivers);
    expect(result.snapshot).toEqual(dossier.snapshot);
  });

  it('ne mute jamais les objets reçus (immuabilité)', () => {
    const dossier = deepFreeze(dossierOf([exp01Signal(), doc01Signal()]));
    const before = JSON.stringify(dossier);

    const result = sanitizeDossierForViewer(dossier, viewerSeeing([]));

    expect(JSON.stringify(dossier)).toBe(before);
    expect(dossier.signals[0].evidence[0].url).toBe(INC_52.url);
    expect(dossier.signals[0].evidence[0].restricted).toBeUndefined();
    expect(result.signals[0]).not.toBe(dossier.signals[0]);
    expect(result.signals[0].evidence[0]).not.toBe(dossier.signals[0].evidence[0]);
    expect(result.snapshot).not.toBe(dossier.snapshot);
  });

  it('acceptance §17.4 lecteur sans accès au projet JSM : preuve de EXP-01 masquée, avis inchangé', () => {
    const dossier = dossierOf([exp01Signal()]);
    // The viewer sees the Jira project but not the JSM project: INC-52 is hidden.
    const viewer = viewerSeeing(['issue:id-pay-127', 'service:svc-checkout-api']);

    const result = sanitizeDossierForViewer(dossier, viewer);

    expect(result.signals[0].code).toBe('EXP-01');
    expect(result.signals[0].evidence[0].label).toEqual({ key: 'evidence.restricted' });
    expect(result.signals[0].evidence[0].url).toBeUndefined();
    expect(result.hiddenEvidenceCount).toBe(1);
    expect(result.snapshot.verdict).toBe(dossier.snapshot.verdict);
    expect(result.snapshot.counts).toEqual(dossier.snapshot.counts);
  });

  it('compte une fois par preuve et déduplique hiddenSubjects', () => {
    const duplicated: Signal = { ...exp01Signal(), id: 'EXP-01:incident:bis' };
    const result = sanitizeDossierForViewer(dossierOf([exp01Signal(), duplicated]), viewerSeeing([]));

    expect(result.hiddenEvidenceCount).toBe(2);
    expect(result.hiddenSubjects).toHaveLength(1);
  });
});

describe('canViewerWaive', () => {
  it('vrai quand le lecteur est marqué habilité', () => {
    const viewer = viewerSeeing([], { canWaive: true });
    expect(canViewerWaive(viewer, policy())).toBe(true);
  });

  it('vrai quand le lecteur figure parmi les approbateurs de la politique', () => {
    const viewer = viewerSeeing([], { accountId: 'user-release-lead', canWaive: false });
    expect(canViewerWaive(viewer, policy())).toBe(true);
  });

  it('faux pour un lecteur ordinaire', () => {
    expect(canViewerWaive(viewerSeeing([]), policy())).toBe(false);
  });
});
