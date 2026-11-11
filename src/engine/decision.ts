import type { Decision, DecisionKind, Verdict } from '../types';

export interface DecisionInput {
  versionId: string;
  snapshotId: string;
  decidedBy: string;
  decision: DecisionKind;
  verdictAtDecision: Verdict;
  note?: string;
  now: string;
}

export function recordDecision(input: DecisionInput): Decision {
  return {
    id: `dec-${input.versionId}-${input.snapshotId}-${input.now}`,
    versionId: input.versionId,
    snapshotId: input.snapshotId,
    decidedBy: input.decidedBy,
    decidedAt: input.now,
    decision: input.decision,
    verdictAtDecision: input.verdictAtDecision,
    ...(input.note !== undefined && input.note.trim().length > 0
      ? { note: input.note.trim() }
      : {}),
  };
}

export function latestDecision(decisions: Decision[]): Decision | null {
  if (decisions.length === 0) {
    return null;
  }
  return decisions.reduce((latest, current) => {
    return current.decidedAt > latest.decidedAt ? current : latest;
  });
}
