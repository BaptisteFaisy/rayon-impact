import type {
  Severity,
  Signal,
  Snapshot,
  SnapshotDiff,
  Verdict,
} from '../types.js';

export interface SnapshotInput {
  snapshot: Snapshot;
  signals: Signal[];
}

function findAddedSignals(
  prevSignals: Signal[],
  currSignals: Signal[],
): Signal[] {
  const prevIds = new Set(prevSignals.map((s) => s.id));
  return currSignals.filter((s) => !prevIds.has(s.id));
}

function findClearedSignals(
  prevSignals: Signal[],
  currSignals: Signal[],
): Signal[] {
  const currIds = new Set(currSignals.map((s) => s.id));
  return prevSignals.filter((s) => !currIds.has(s.id));
}

function findSeverityChanges(
  prevSignals: Signal[],
  currSignals: Signal[],
): { signalId: string; from: Severity; to: Severity }[] {
  const prevMap = new Map(prevSignals.map((s) => [s.id, s.severity]));
  const changes: { signalId: string; from: Severity; to: Severity }[] = [];

  for (const curr of currSignals) {
    const prevSev = prevMap.get(curr.id);
    if (prevSev !== undefined && prevSev !== curr.severity) {
      changes.push({
        signalId: curr.id,
        from: prevSev,
        to: curr.severity,
      });
    }
  }

  return changes;
}

function computeVerdictChange(
  prevVerdict: Verdict | undefined,
  currVerdict: Verdict,
): { from: Verdict; to: Verdict } | null {
  if (prevVerdict === undefined || prevVerdict === currVerdict) {
    return null;
  }
  return { from: prevVerdict, to: currVerdict };
}

export function diffSnapshots(
  previous: SnapshotInput | null,
  current: SnapshotInput,
): SnapshotDiff {
  if (!previous) {
    return {
      previousSnapshotId: null,
      added: [...current.signals],
      cleared: [],
      severityChanged: [],
      verdictChange: null,
    };
  }

  return {
    previousSnapshotId: previous.snapshot.id,
    added: findAddedSignals(previous.signals, current.signals),
    cleared: findClearedSignals(previous.signals, current.signals),
    severityChanged: findSeverityChanges(previous.signals, current.signals),
    verdictChange: computeVerdictChange(
      previous.snapshot.verdict,
      current.snapshot.verdict,
    ),
  };
}

export function diffIsEmpty(diff: SnapshotDiff): boolean {
  return (
    diff.added.length === 0 &&
    diff.cleared.length === 0 &&
    diff.severityChanged.length === 0 &&
    diff.verdictChange === null
  );
}
