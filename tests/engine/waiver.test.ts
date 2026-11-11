import { describe, expect, it } from 'vitest';
import {
  closeWaiver,
  expiringSoon,
  grantWaiver,
  listLiveWaivers,
  validateWaiverRequest,
  type WaiverRequest,
} from '../../src/engine/waiver';
import { makeSignal } from '../../src/signals/context';
import { issue, policy } from '../fixtures/builders';
import { paiementsPolicy, paiementsRelease } from '../fixtures/paiements';

describe('engine/waiver', () => {
  const defaultPol = policy({
    waiverApprovers: ['user-release-lead'],
    defaultWaiverHours: 48,
  });
  const now = '2026-11-11T10:00:00.000Z';

  const validReq: WaiverRequest = {
    versionId: 'ver-24',
    signalCode: 'COMP-01',
    subjectType: 'issue',
    subjectId: 'id-pay-131',
    reason: 'Approved for late cut',
    hours: 24,
    grantedBy: 'user-release-lead',
  };

  it('refuse une dérogation sans motif (RI-07)', () => {
    const emptyReasonReq: WaiverRequest = { ...validReq, reason: '   ' };
    const res = validateWaiverRequest(emptyReasonReq, defaultPol, now);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason.key).toBe('waiver.reason.required');
      expect(res.reason.params).toEqual({ signalCode: 'COMP-01' });
    }
  });

  it('refuse une dérogation demandée par une personne non habilitée', () => {
    const badApproverReq: WaiverRequest = {
      ...validReq,
      grantedBy: 'user-intruder',
    };
    const res = validateWaiverRequest(badApproverReq, defaultPol, now);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason.key).toBe('waiver.approver.unauthorized');
      expect(res.reason.params).toEqual({ approver: 'user-intruder' });
    }
  });

  it('accepte un demandeur habilité et refuse des hours invalides (<=0 ou > 720)', () => {
    expect(validateWaiverRequest(validReq, defaultPol, now).ok).toBe(true);

    const zeroHours = validateWaiverRequest(
      { ...validReq, hours: 0 },
      defaultPol,
      now,
    );
    expect(zeroHours.ok).toBe(false);
    if (!zeroHours.ok) {
      expect(zeroHours.reason.key).toBe('waiver.hours.invalid');
    }

    const tooManyHours = validateWaiverRequest(
      { ...validReq, hours: 721 },
      defaultPol,
      now,
    );
    expect(tooManyHours.ok).toBe(false);

    const okMax = validateWaiverRequest(
      { ...validReq, hours: 720 },
      defaultPol,
      now,
    );
    expect(okMax.ok).toBe(true);
  });

  it('accorde une dérogation avec un id déterministe et le défaut policy.defaultWaiverHours', () => {
    const reqWithoutHours: WaiverRequest = {
      ...validReq,
      hours: undefined,
    };
    const waiver = grantWaiver(reqWithoutHours, defaultPol, now);
    expect(waiver.id).toBe('wv-ver-24-COMP-01-id-pay-131');
    expect(waiver.grantedAt).toBe(now);
    expect(waiver.expiresAt).toBe('2026-11-13T10:00:00.000Z');
    expect(waiver.closedAt).toBeUndefined();
  });

  it('clôt une dérogation sans jamais la supprimer (SPEC §15)', () => {
    const waiver = grantWaiver(validReq, defaultPol, now);
    const closeTime = '2026-11-11T14:00:00.000Z';
    const closed = closeWaiver(waiver, closeTime, 'Feature dropped from scope');
    expect(closed.closedAt).toBe(closeTime);
    expect(closed.closedReason).toBe('Feature dropped from scope');
    expect(closed.id).toBe(waiver.id);
    expect(closed.reason).toBe(waiver.reason);

    const live = listLiveWaivers([closed], closeTime);
    expect(live).toHaveLength(0);
  });

  it('dérogation expirée la nuit : plus dans listLiveWaivers (SPEC §16)', () => {
    const waiver = grantWaiver({ ...validReq, hours: 12 }, defaultPol, now);
    // expires at 2026-11-11T22:00:00.000Z
    const afternoon = '2026-11-11T18:00:00.000Z';
    const nextMorning = '2026-11-12T08:00:00.000Z';

    expect(listLiveWaivers([waiver], afternoon)).toHaveLength(1);
    expect(listLiveWaivers([waiver], nextMorning)).toHaveLength(0);
  });

  it('détecte les dérogations qui expirent bientôt', () => {
    const waiver = grantWaiver({ ...validReq, hours: 5 }, defaultPol, now);
    expect(expiringSoon([waiver], now, 6)).toHaveLength(1);
    expect(expiringSoon([waiver], now, 4)).toHaveLength(0);

    const closed = closeWaiver(waiver, now, 'revoked');
    expect(expiringSoon([closed], now, 6)).toHaveLength(0);
  });

  it('acceptance §17.3 : signal bloquant + dérogation 24 h accordée par une personne habilitée → le signal passe waived', () => {
    const pol = paiementsPolicy();
    const req: WaiverRequest = {
      versionId: 'ver-24',
      signalCode: 'COMP-01',
      subjectType: 'issue',
      subjectId: 'id-pay-131',
      reason: 'Doc will follow within 24h',
      hours: 24,
      grantedBy: 'user-release-lead',
    };
    expect(validateWaiverRequest(req, pol, now).ok).toBe(true);
    const waiver = grantWaiver(req, pol, now);

    const ctx = {
      release: paiementsRelease(),
      policy: pol,
      now,
      waivers: [waiver],
      previousSignals: [],
      pastOutcomes: [],
    };

    const signal = makeSignal(ctx, {
      code: 'COMP-01',
      subject: issue('PAY-131', {
        statusName: 'In Progress',
        statusCategory: 'in-progress',
      }),
      finding: {
        key: 'signal.comp01.finding',
        params: {
          key: 'PAY-131',
          status: 'In Progress',
          category: 'in-progress',
        },
      },
      evidence: [],
    });

    expect(signal.severity).toBe('blocking');
    expect(signal.status).toBe('waived');
    expect(signal.waiverId).toBe(waiver.id);
  });
});
