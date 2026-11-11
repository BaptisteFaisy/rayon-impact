/**
 * Ports: the only boundary between the pure engine and the Forge runtime.
 *
 * The engine (src/signals, src/engine) never imports `@forge/api`. Adapters
 * (src/db, src/collect, src/triggers, src/actions) implement these interfaces,
 * so the whole decision path is testable with plain in-memory fakes.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */
import type {
  CollectedRelease,
  Decision,
  Outcome,
  Policy,
  ReleaseDossier,
  Signal,
  Snapshot,
  Waiver,
} from './types.js';

/** Persistence of dossiers, waivers, decisions, outcomes and policies. */
export interface ReleaseStore {
  getDossier(versionId: string): Promise<ReleaseDossier | null>;
  getSnapshot(snapshotId: string): Promise<Snapshot | null>;
  listSnapshots(projectId: string, limit: number): Promise<Snapshot[]>;
  saveSnapshot(snapshot: Snapshot, signals: Signal[]): Promise<void>;
  getSignals(snapshotId: string): Promise<Signal[]>;
  /** One signal from its id, with the version it belongs to. */
  getSignalById(signalId: string): Promise<{ versionId: string; signal: Signal } | null>;

  getWaivers(versionId: string): Promise<Waiver[]>;
  saveWaiver(waiver: Waiver): Promise<void>;

  getDecisions(versionId: string): Promise<Decision[]>;
  saveDecision(decision: Decision): Promise<void>;

  getOutcome(versionId: string): Promise<Outcome | null>;
  saveOutcome(outcome: Outcome): Promise<void>;

  getPolicy(projectId: string): Promise<Policy | null>;
  savePolicy(policy: Policy): Promise<void>;

  /** The collection cached with the dossier, with its date (SPEC §12). */
  saveCollection(
    versionId: string,
    release: CollectedRelease,
    collectedAt: string,
  ): Promise<void>;
  getCollection(
    versionId: string,
  ): Promise<{ collectedAt: string; release: CollectedRelease } | null>;
}

/**
 * Collects one release from Jira, JSM, Confluence and (as a user) the Teamwork
 * Graph. `viewerAccountId` is the human whose rights are used for the graph.
 */
export interface ReleaseCollector {
  collect(projectId: string, versionId: string, viewerAccountId: string): Promise<CollectedRelease>;
}

/** Forge LLM adapter: the only place allowed to call the hosted model. */
export interface NarrativeWriter {
  write(payload: { system: string; user: string }): Promise<string>;
}

/** Injected clock: every timestamp in the engine comes from here. */
export interface Clock {
  now(): string;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  log(level: LogLevel, message: string, meta?: Record<string, unknown>): void;
}

/** Background recompute queue (Forge `consumer`). */
export interface JobQueue {
  publish(message: RecomputeMessage): Promise<void>;
}

export interface RecomputeMessage {
  projectId: string;
  versionId: string;
  reason: 'event' | 'schedule' | 'manual' | 'outcome';
  requestedAt: string;
}

/** Everything the recompute pipeline needs, injected (no globals). */
export interface PipelineDeps {
  store: ReleaseStore;
  collector: ReleaseCollector;
  narrative: NarrativeWriter;
  clock: Clock;
  logger: Logger;
}

export interface RecomputeRequest {
  projectId: string;
  versionId: string;
  /** Human whose graph rights are used; `null` = app-only collection. */
  viewerAccountId: string | null;
  reason: RecomputeMessage['reason'];
}

export interface RecomputeResult {
  snapshot: Snapshot;
  signals: Signal[];
  /** False when the narrative was rejected and the deterministic fallback used. */
  narrativeFromModel: boolean;
  durationMs: number;
}
