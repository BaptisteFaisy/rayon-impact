import type {
  CollectedRelease,
  Coverage,
  Evidence,
  MessageRef,
  MinimalRemoval,
  Signal,
  Simulation,
  VerdictResult,
} from '../types.js';

/** Maximum subset size for minimal removal search (SPEC §8 & RI-13). */
export const MAX_REMOVAL_SET = 3;

export type VerdictFn = (
  signals: Signal[],
  coverage: Coverage,
  release: CollectedRelease,
) => VerdictResult;

/** Builds lookup maps between issue key and Jira issue id. */
function buildKeyMaps(release: CollectedRelease): {
  keyToId: Map<string, string>;
  idToKey: Map<string, string>;
} {
  const keyToId = new Map<string, string>();
  const idToKey = new Map<string, string>();
  const register = (k: string, id: string) => {
    keyToId.set(k, id);
    idToKey.set(id, k);
  };
  for (const issue of release.issues) {
    register(issue.key, issue.subjectId);
  }
  for (const outside of release.linkedOutsideIssues) {
    register(outside.key, outside.subjectId);
  }
  return { keyToId, idToKey };
}

/** Resolves an array of issue keys or IDs into a normalized Set containing both keys and IDs. */
function resolveRemovedIds(
  issueKeys: string[],
  maps: { keyToId: Map<string, string>; idToKey: Map<string, string> },
): Set<string> {
  const removedIds = new Set<string>();
  for (const token of issueKeys) {
    removedIds.add(token);
    const id = maps.keyToId.get(token);
    if (id) removedIds.add(id);
    const key = maps.idToKey.get(token);
    if (key) removedIds.add(key);
  }
  return removedIds;
}

/** Checks whether an evidence item points to one of the removed issues. */
function evidenceMatchesRemoved(ev: Evidence, removedIds: Set<string>): boolean {
  return ev.subjectType === 'issue' && removedIds.has(ev.subjectId);
}

/**
 * Filter rule:
 * 1. Drops signals whose subject is an issue in the removed set.
 * 2. Drops DEP-01 if its blocker evidence is in the removed set.
 * 3. Drops signals whose issue evidence relates exclusively to removed issues.
 */
function shouldDropSignal(signal: Signal, removedIds: Set<string>): boolean {
  if (signal.subjectType === 'issue' && removedIds.has(signal.subjectId)) {
    return true;
  }
  const issueEvidences = signal.evidence.filter((e) => e.subjectType === 'issue');
  if (issueEvidences.length > 0) {
    if (signal.code === 'DEP-01' && issueEvidences.some((e) => evidenceMatchesRemoved(e, removedIds))) {
      return true;
    }
    if (issueEvidences.every((e) => evidenceMatchesRemoved(e, removedIds))) {
      return true;
    }
  }
  return false;
}

/**
 * Filters out signals directly attached to removed tickets (matched by subjectId or key)
 * and signals whose issue evidence relates exclusively to the removed tickets.
 */
export function signalsWithoutIssues(
  signals: Signal[],
  issueKeys: string[],
  release?: CollectedRelease,
): Signal[] {
  if (issueKeys.length === 0) {
    return [...signals];
  }
  const maps = release
    ? buildKeyMaps(release)
    : { keyToId: new Map<string, string>(), idToKey: new Map<string, string>() };
  const removedIds = resolveRemovedIds(issueKeys, maps);
  return signals.filter((signal) => !shouldDropSignal(signal, removedIds));
}

/**
 * Simulates the verdict if a given set of tickets were dropped from the release.
 */
export function simulateWithout(input: {
  signals: Signal[];
  coverage: Coverage;
  release: CollectedRelease;
  issueKeys: string[];
  verdict: VerdictFn;
}): Simulation {
  const remaining = signalsWithoutIssues(input.signals, input.issueKeys, input.release);
  const result = input.verdict(remaining, input.coverage, input.release);
  const droppedSignalCount = input.signals.length - remaining.length;
  return {
    removedIssueKeys: input.issueKeys,
    result,
    droppedSignalCount,
  };
}

/** Extracts candidate ticket keys carrying an active blocking signal. */
function extractCandidateBlockingKeys(
  signals: Signal[],
  release: CollectedRelease,
): string[] {
  const candidates = new Set<string>();
  const idToKey = new Map<string, string>();
  for (const issue of release.issues) {
    idToKey.set(issue.subjectId, issue.key);
  }

  for (const signal of signals) {
    if (signal.status === 'active' && signal.severity === 'blocking') {
      if (signal.subjectType === 'issue') {
        const key = idToKey.get(signal.subjectId) ?? signal.subjectId;
        candidates.add(key);
      }
      for (const ev of signal.evidence) {
        if (ev.subjectType === 'issue') {
          const key = idToKey.get(ev.subjectId) ?? ev.subjectId;
          candidates.add(key);
        }
      }
    }
  }
  return Array.from(candidates);
}

/** Generates combinations of size k from an array of items. */
function* combinations<T>(arr: T[], k: number): Generator<T[]> {
  if (k === 0) {
    yield [];
    return;
  }
  for (let i = 0; i <= arr.length - k; i++) {
    const head = arr[i];
    for (const tail of combinations(arr.slice(i + 1), k - 1)) {
      yield [head, ...tail];
    }
  }
}

/**
 * Finds the smallest set of tickets whose removal lifts the no-go verdict.
 * Searches candidate tickets bearing active blocking signals by increasing set size.
 */
export function minimalRemovalSet(input: {
  signals: Signal[];
  coverage: Coverage;
  release: CollectedRelease;
  verdict: VerdictFn;
  maxSetSize?: number;
}): MinimalRemoval {
  const max = input.maxSetSize ?? MAX_REMOVAL_SET;
  const initial = input.verdict(input.signals, input.coverage, input.release);
  if (initial.verdict !== 'no-go') {
    return { issueKeys: [], simulationsRun: 0, provenMinimal: true };
  }

  const candidates = extractCandidateBlockingKeys(input.signals, input.release);
  let simulationsRun = 0;

  for (let size = 1; size <= max; size++) {
    if (size > candidates.length) break;
    for (const subset of combinations(candidates, size)) {
      simulationsRun++;
      const sim = simulateWithout({
        signals: input.signals,
        coverage: input.coverage,
        release: input.release,
        issueKeys: subset,
        verdict: input.verdict,
      });
      if (sim.result.verdict !== 'no-go') {
        return { issueKeys: subset, simulationsRun, provenMinimal: true };
      }
    }
  }

  return { issueKeys: [], simulationsRun, provenMinimal: false };
}

/** Formats the minimal removal recommendation into a localizable MessageRef. */
export function describeRemoval(removal: MinimalRemoval): MessageRef {
  if (removal.issueKeys.length === 0) {
    return { key: 'simulation.noSolution' };
  }
  return {
    key: 'simulation.bestSet',
    params: {
      count: removal.issueKeys.length,
      keys: removal.issueKeys.join(', '),
    },
  };
}
