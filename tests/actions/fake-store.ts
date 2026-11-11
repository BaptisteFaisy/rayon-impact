/**
 * In-memory `ReleaseStore` + `DossierIndex` for the action tests.
 *
 * No SQL, no network, no clock: the actions are pure `(input, deps)` handlers,
 * so a plain Map is enough and each test states exactly which dossier it feeds
 * them. `depsFor` builds the injected graph once, so no test recopies it.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */
import type { ReleaseStore } from '../../src/ports';
import type {
  CollectedRelease,
  Decision,
  Outcome,
  Policy,
  ReleaseDossier,
  Signal,
  Snapshot,
  Viewer,
  Waiver,
} from '../../src/types';
import { makeViewer } from '../../src/actions/types';
import type { ActionDeps, DossierIndex, LocatedSignal, ReleaseFacts, ResolvedVersion } from '../../src/actions/types';

/** Fixed evaluation instant: no test depends on the real clock. */
export const NOW = '2026-11-11T10:00:00.000Z';

/** The project role holder of the fixtures (`policy().waiverApprovers`). */
export const RELEASE_LEAD = 'user-release-lead';

export class FakeStore implements ReleaseStore {
  readonly dossiers = new Map<string, ReleaseDossier>();
  readonly policies = new Map<string, Policy>();
  readonly waivers = new Map<string, Waiver[]>();
  readonly decisions = new Map<string, Decision[]>();
  readonly outcomes = new Map<string, Outcome>();
  private readonly signals = new Map<string, Signal[]>();
  private readonly collections = new Map<string, { collectedAt: string; release: CollectedRelease }>();

  seedDossier(dossier: ReleaseDossier): this {
    this.dossiers.set(dossier.snapshot.versionId, dossier);
    this.policies.set(dossier.snapshot.projectId, this.policies.get(dossier.snapshot.projectId) ?? defaultPolicy(dossier.snapshot.projectId));
    this.waivers.set(dossier.snapshot.versionId, dossier.waivers);
    this.decisions.set(dossier.snapshot.versionId, dossier.decisions);
    if (dossier.outcome) this.outcomes.set(dossier.snapshot.versionId, dossier.outcome);
    this.signals.set(dossier.snapshot.id, dossier.signals);
    return this;
  }

  seedPolicy(policy: Policy): this {
    this.policies.set(policy.projectId, policy);
    return this;
  }

  async getDossier(versionId: string): Promise<ReleaseDossier | null> {
    return this.dossiers.get(versionId) ?? null;
  }

  async getSnapshot(snapshotId: string): Promise<Snapshot | null> {
    for (const dossier of this.dossiers.values()) {
      if (dossier.snapshot.id === snapshotId) return dossier.snapshot;
    }
    return null;
  }

  async listSnapshots(projectId: string, limit: number): Promise<Snapshot[]> {
    return [...this.dossiers.values()]
      .map((dossier) => dossier.snapshot)
      .filter((snapshot) => snapshot.projectId === projectId)
      .slice(0, limit);
  }

  async saveSnapshot(snapshot: Snapshot, signals: Signal[]): Promise<void> {
    this.signals.set(snapshot.id, signals);
  }

  async getSignals(snapshotId: string): Promise<Signal[]> {
    return this.signals.get(snapshotId) ?? [];
  }

  /** One signal from its id, with the version it belongs to. */
  async getSignalById(
    signalId: string,
  ): Promise<{ versionId: string; signal: Signal } | null> {
    for (const [snapshotId, list] of this.signals) {
      const found = list.find((signal) => signal.id === signalId);
      if (found) return { versionId: snapshotId, signal: found };
    }
    return null;
  }

  async getWaivers(versionId: string): Promise<Waiver[]> {
    return this.waivers.get(versionId) ?? [];
  }

  async getWaiverById(waiverId: string): Promise<Waiver | null> {
    for (const list of this.waivers.values()) {
      const found = list.find((waiver) => waiver.id === waiverId);
      if (found) return found;
    }
    return null;
  }

  /** Upsert by id, like the real store (`insertOrUpdate(..., ['id'])`): a
   * closed waiver replaces its live copy and is never deleted (SPEC §15). */
  async saveWaiver(waiver: Waiver): Promise<void> {
    const list = this.waivers.get(waiver.versionId) ?? [];
    const kept = list.filter((candidate) => candidate.id !== waiver.id);
    this.waivers.set(waiver.versionId, [...kept, waiver]);
  }

  async getDecisions(versionId: string): Promise<Decision[]> {
    return this.decisions.get(versionId) ?? [];
  }

  async saveDecision(decision: Decision): Promise<void> {
    const list = this.decisions.get(decision.versionId) ?? [];
    this.decisions.set(decision.versionId, [...list, decision]);
  }

  async getOutcome(versionId: string): Promise<Outcome | null> {
    return this.outcomes.get(versionId) ?? null;
  }

  async saveOutcome(outcome: Outcome): Promise<void> {
    this.outcomes.set(outcome.versionId, outcome);
  }

  async getPolicy(projectId: string): Promise<Policy | null> {
    return this.policies.get(projectId) ?? null;
  }

  /** The collection cached with the dossier (SPEC §12). */
  async getCollection(
    versionId: string,
  ): Promise<{ collectedAt: string; release: CollectedRelease } | null> {
    return this.collections.get(versionId) ?? null;
  }

  async saveCollection(
    versionId: string,
    release: CollectedRelease,
    collectedAt: string,
  ): Promise<void> {
    this.collections.set(versionId, { collectedAt, release });
  }

  async savePolicy(policy: Policy): Promise<void> {
    this.policies.set(policy.projectId, policy);
  }
}

/** Fallback policy of a seeded dossier: a project nobody can waive in. */
function defaultPolicy(projectId: string): Policy {
  return {
    projectId,
    severityOverrides: {},
    disabledSignals: [],
    waiverApprovers: [],
    jsmProjectKeys: [],
    serviceMap: [],
    observationMode: false,
    defaultWaiverHours: 24,
  };
}

export class FakeIndex implements DossierIndex {
  private readonly versions = new Map<string, ResolvedVersion>();
  private readonly facts = new Map<string, ReleaseFacts>();
  private readonly signals = new Map<string, LocatedSignal>();

  addVersion(resolved: ResolvedVersion): this {
    this.versions.set(`${resolved.projectKey}/${resolved.versionName}`, resolved);
    return this;
  }

  addFacts(versionId: string, facts: ReleaseFacts): this {
    this.facts.set(versionId, facts);
    return this;
  }

  addSignals(versionId: string, signals: Signal[]): this {
    for (const signal of signals) this.signals.set(signal.id, { versionId, signal });
    return this;
  }

  async resolveVersion(projectKey: string, versionName: string): Promise<ResolvedVersion | null> {
    return this.versions.get(`${projectKey}/${versionName}`) ?? null;
  }

  async getFacts(versionId: string): Promise<ReleaseFacts | null> {
    return this.facts.get(versionId) ?? null;
  }

  async findSignal(signalId: string): Promise<LocatedSignal | null> {
    return this.signals.get(signalId) ?? null;
  }
}

/** Logger that keeps what was logged, so a test can assert the trace. */
export interface RecordingLogger {
  lines: { level: string; message: string }[];
  log: ActionDeps['logger']['log'];
}

export function recordingLogger(): RecordingLogger {
  const lines: { level: string; message: string }[] = [];
  return {
    lines,
    log(level, message) {
      lines.push({ level, message });
    },
  };
}

export interface DepsOptions {
  viewer?: Partial<Omit<Viewer, 'accountId'>> & { accountId?: string };
  logger?: ActionDeps['logger'];
}

/** The injected dependency graph of one action call. */
export function depsFor(store: FakeStore, index: FakeIndex, options: DepsOptions = {}): ActionDeps {
  const { accountId = RELEASE_LEAD, ...viewer } = options.viewer ?? {};
  return {
    store,
    index,
    clock: { now: () => NOW },
    logger: options.logger ?? recordingLogger(),
    viewer: makeViewer(accountId, viewer),
  };
}
