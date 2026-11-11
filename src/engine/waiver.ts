import type {
  MessageRef,
  Policy,
  SignalCode,
  SubjectType,
  Waiver,
} from '../types';

export interface WaiverRequest {
  versionId: string;
  signalCode: SignalCode;
  subjectType: SubjectType;
  subjectId: string;
  reason: string;
  hours?: number;
  grantedBy: string;
}

export function validateWaiverRequest(
  req: WaiverRequest,
  policy: Policy,
  _now: string,
): { ok: true } | { ok: false; reason: MessageRef } {
  if (!req.reason || req.reason.trim().length === 0) {
    return {
      ok: false,
      reason: {
        key: 'waiver.reason.required',
        params: { signalCode: req.signalCode },
      },
    };
  }

  if (!policy.waiverApprovers.includes(req.grantedBy)) {
    return {
      ok: false,
      reason: {
        key: 'waiver.approver.unauthorized',
        params: { approver: req.grantedBy },
      },
    };
  }

  if (req.hours !== undefined && (req.hours <= 0 || req.hours > 720)) {
    return {
      ok: false,
      reason: {
        key: 'waiver.hours.invalid',
        params: { hours: req.hours },
      },
    };
  }

  return { ok: true };
}

export function grantWaiver(
  req: WaiverRequest,
  policy: Policy,
  now: string,
): Waiver {
  const durationHours = req.hours ?? policy.defaultWaiverHours;
  const expiresAtMs = new Date(now).getTime() + durationHours * 3_600_000;
  return {
    id: `wv-${req.versionId}-${req.signalCode}-${req.subjectId}`,
    versionId: req.versionId,
    signalCode: req.signalCode,
    subjectType: req.subjectType,
    subjectId: req.subjectId,
    grantedBy: req.grantedBy,
    reason: req.reason.trim(),
    grantedAt: now,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

export function closeWaiver(
  waiver: Waiver,
  now: string,
  reason: string,
): Waiver {
  return {
    ...waiver,
    closedAt: now,
    closedReason: reason,
  };
}

export function listLiveWaivers(waivers: Waiver[], now: string): Waiver[] {
  return waivers.filter((w) => !w.closedAt && w.expiresAt > now);
}

export function expiringSoon(
  waivers: Waiver[],
  now: string,
  withinHours: number,
): Waiver[] {
  const thresholdMs = new Date(now).getTime() + withinHours * 3_600_000;
  return waivers.filter((w) => {
    if (w.closedAt) return false;
    const expiresMs = new Date(w.expiresAt).getTime();
    const nowMs = new Date(now).getTime();
    return expiresMs > nowMs && expiresMs <= thresholdMs;
  });
}
