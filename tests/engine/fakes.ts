import type {
  Clock,
  LogLevel,
  Logger,
  NarrativeWriter,
  ReleaseCollector,
  ReleaseStore,
} from '../../src/ports';
import type {
  CollectedRelease,
  Decision,
  Outcome,
  Policy,
  ReleaseDossier,
  Signal,
  Snapshot,
  Waiver,
} from '../../src/types';
import { paiementsRelease } from '../fixtures/paiements';

/**
 * Reusable in-memory doubles for the pipeline tests (no I/O, no network).
 *
 * Every fake is deterministic: the store keeps insertion order, the clock is
 * injected, the narrative writer replays a scripted list of answers.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

/** Persists dossiers in plain maps so tests can inspect what was written. */
export class InMemoryReleaseStore implements ReleaseStore {
  readonly snapshots = new Map<string, Snapshot>();
  readonly snapshotSignals = new Map<string, Signal[]>();
  readonly waivers = new Map<string, Waiver[]>();
  readonly decisions = new Map<string, Decision[]>();
  readonly outcomes = new Map<string, Outcome>();
  readonly policies = new Map<string, Policy>();
  /** Snapshot ids in write order, to assert "nothing was saved" on failure. */
  readonly savedSnapshotIds: string[] = [];

  private readonly collections = new Map<string, { collectedAt: string; release: CollectedRelease }>();
  async getDossier(versionId: string): Promise<ReleaseDossier | null> {
    const snapshot = this.latestSnapshot(versionId);
    if (!snapshot) return null;
    return {
      snapshot,
      signals: await this.getSignals(snapshot.id),
      waivers: await this.getWaivers(versionId),
      decisions: await this.getDecisions(versionId),
      outcome: await this.getOutcome(versionId),
    };
  }

  async getSnapshot(snapshotId: string): Promise<Snapshot | null> {
    return this.snapshots.get(snapshotId) ?? null;
  }

  async listSnapshots(projectId: string, limit: number): Promise<Snapshot[]> {
    return [...this.snapshots.values()]
      .filter((s) => s.projectId === projectId)
      .sort((a, b) => b.computedAt.localeCompare(a.computedAt))
      .slice(0, limit);
  }

  async saveSnapshot(snapshot: Snapshot, signals: Signal[]): Promise<void> {
    this.snapshots.set(snapshot.id, snapshot);
    this.snapshotSignals.set(snapshot.id, [...signals]);
    this.savedSnapshotIds.push(snapshot.id);
  }

  async getSignals(snapshotId: string): Promise<Signal[]> {
    return [...(this.snapshotSignals.get(snapshotId) ?? [])];
  }

  /** One signal from its id, with the version it belongs to. */
  async getSignalById(
    signalId: string,
  ): Promise<{ versionId: string; signal: Signal } | null> {
    for (const [snapshotId, list] of this.snapshotSignals) {
      const found = list.find((signal) => signal.id === signalId);
      if (found) return { versionId: snapshotId, signal: found };
    }
    return null;
  }

  async getWaivers(versionId: string): Promise<Waiver[]> {
    return [...(this.waivers.get(versionId) ?? [])];
  }

  async saveWaiver(waiver: Waiver): Promise<void> {
    const list = this.waivers.get(waiver.versionId) ?? [];
    this.waivers.set(waiver.versionId, [...list, waiver]);
  }

  async getDecisions(versionId: string): Promise<Decision[]> {
    return [...(this.decisions.get(versionId) ?? [])];
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

  /** Latest snapshot of a version by `computedAt`, or null. */
  latestSnapshot(versionId: string): Snapshot | null {
    const matching = [...this.snapshots.values()]
      .filter((s) => s.versionId === versionId)
      .sort((a, b) => b.computedAt.localeCompare(a.computedAt));
    return matching[0] ?? null;
  }
}

/** Returns the canonical release; can fail or fire a hook on collect. */
export class FakeReleaseCollector implements ReleaseCollector {
  readonly calls: {
    projectId: string;
    versionId: string;
    viewerAccountId: string;
  }[] = [];

  constructor(
    private readonly release: CollectedRelease = paiementsRelease(),
    private readonly failure?: Error,
    private readonly onCollect?: () => void,
  ) {}

  async collect(
    projectId: string,
    versionId: string,
    viewerAccountId: string,
  ): Promise<CollectedRelease> {
    this.calls.push({ projectId, versionId, viewerAccountId });
    this.onCollect?.();
    if (this.failure) throw this.failure;
    return structuredClone(this.release);
  }
}

/** Replays a scripted list of answers; an `Error` entry makes `write` throw. */
export class ScriptedNarrativeWriter implements NarrativeWriter {
  readonly calls: { system: string; user: string }[] = [];

  constructor(private readonly script: (string | Error)[]) {}

  async write(payload: { system: string; user: string }): Promise<string> {
    this.calls.push(payload);
    const answer = this.script[Math.min(this.calls.length - 1, this.script.length - 1)];
    if (answer instanceof Error) throw answer;
    return answer;
  }
}

/** Frozen clock; `set`/`advanceMinutes` move it explicitly. */
export class FixedClock implements Clock {
  private current: string;

  constructor(initial = '2026-11-11T06:00:00.000Z') {
    this.current = initial;
  }

  now(): string {
    return this.current;
  }

  set(iso: string): void {
    this.current = iso;
  }

  advanceMinutes(minutes: number): void {
    const ms = new Date(this.current).getTime() + minutes * 60_000;
    this.current = new Date(ms).toISOString();
  }
}

/** Keeps every log line so tests can assert warnings. */
export class RecordingLogger implements Logger {
  readonly entries: { level: LogLevel; message: string; meta?: Record<string, unknown> }[] = [];

  log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    this.entries.push(meta === undefined ? { level, message } : { level, message, meta });
  }

  atLevel(level: LogLevel): string[] {
    return this.entries.filter((e) => e.level === level).map((e) => e.message);
  }
}
