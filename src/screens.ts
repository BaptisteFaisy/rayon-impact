/**
 * The screen resolvers (SPEC §11): what each of the four Forge modules reads.
 *
 * Split out of `src/index.ts` so the router stays a router (CONVENTIONS §2)
 * and every file stays under the 500-line limit.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */
import { listVersionsForIssue } from './db/queries';
import { createForgeSqlClient } from './db/sql-client';
import type { SqlClient } from './db/sql-client';
import { resolvePolicy } from './engine/pipeline';
import { buildImpactGraph } from './engine/graph';
import { diffSnapshots } from './engine/diff';
import { ActionError } from './actions/types';
import type { ActionDeps } from './actions/types';
import type { Policy } from './types';

/** The payload of a screen invocation: free-form, checked field by field. */
export type ScreenPayload = Record<string, unknown>;

/** A screen resolver: reads the store, returns what the screen renders. */
export type ScreenHandler = (payload: ScreenPayload, deps: ActionDeps) => Promise<unknown>;

/** A required string field of the payload; absent or empty is a refusal. */
function required(payload: ScreenPayload, field: string): string {
  const value = payload[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ActionError('invalid-input', `Screen payload needs a "${field}" string.`);
  }
  return value;
}

/** A SQL client of its own for the read-only version queries. */
function sql(): SqlClient {
  return createForgeSqlClient();
}

/** RI-01: the versions of a project with their current verdict. */
async function projectVersions(payload: ScreenPayload, deps: ActionDeps): Promise<unknown> {
  const projectId = required(payload, 'projectId');
  const snapshots = await deps.store.listSnapshots(projectId, 50);
  return snapshots.map((snapshot) => ({
    versionId: snapshot.versionId,
    versionName: snapshot.versionName,
    verdict: snapshot.verdict,
    confidence: snapshot.confidence,
    computedAt: snapshot.computedAt,
    released: snapshot.versionReleased,
  }));
}

/** RI-11: the policy of the project, saved as a whole. */
async function savePolicy(payload: ScreenPayload, deps: ActionDeps): Promise<unknown> {
  const policy = payload.policy as Policy | undefined;
  if (!policy || typeof policy.projectId !== 'string') {
    throw new ActionError('invalid-input', 'A policy object with a projectId is required.');
  }
  await deps.store.savePolicy(policy);
  return { ok: true, projectId: policy.projectId };
}

/** RI-12: the impact graph, built from the cached collection and the signals. */
async function impactGraph(payload: ScreenPayload, deps: ActionDeps): Promise<unknown> {
  const versionId = required(payload, 'versionId');
  const cached = await deps.store.getCollection(versionId);
  const dossier = await deps.store.getDossier(versionId);
  if (!cached || !dossier) return null;
  return buildImpactGraph(cached.release, dossier.signals);
}

/** RI-14: what changed between the last two dossiers of a version. */
async function projectDiff(payload: ScreenPayload, deps: ActionDeps): Promise<unknown> {
  const projectId = required(payload, 'projectId');
  const versionId = required(payload, 'versionId');
  const snapshots = (await deps.store.listSnapshots(projectId, 10)).filter(
    (snapshot) => snapshot.versionId === versionId,
  );
  if (snapshots.length < 2) return null;
  const [current, previous] = snapshots;
  const [currentSignals, previousSignals] = await Promise.all([
    deps.store.getSignals(current.id),
    deps.store.getSignals(previous.id),
  ]);
  return diffSnapshots(
    { snapshot: previous, signals: previousSignals },
    { snapshot: current, signals: currentSignals },
  );
}

/** The versions of a project with their upcoming release dates (RI-16). */
async function dashboardGadget(payload: ScreenPayload, deps: ActionDeps): Promise<unknown> {
  const projectId = required(payload, 'projectId');
  const snapshots = await deps.store.listSnapshots(projectId, 20);
  // The release date lives in the cached collection, not in the snapshot.
  return Promise.all(
    snapshots.map(async (snapshot) => {
      const cached = await deps.store.getCollection(snapshot.versionId);
      return {
        versionId: snapshot.versionId,
        versionName: snapshot.versionName,
        verdict: snapshot.verdict,
        confidence: snapshot.confidence,
        computedAt: snapshot.computedAt,
        releaseDate: cached?.release.version.releaseDate ?? null,
      };
    }),
  );
}

/** The panel under a ticket: the versions it belongs to (SPEC §6.2). */
async function issueContext(payload: ScreenPayload, deps: ActionDeps): Promise<unknown> {
  const issueId = required(payload, 'issueId');
  const rows = await listVersionsForIssue(sql(), issueId);
  const versions = await Promise.all(
    rows.map(async (row) => ({
      versionId: row.version_id,
      versionName: row.version_name,
      dossier: await deps.store.getDossier(row.version_id),
    })),
  );
  // Observation mode: no verdict shown on the ticket (SPEC §20).
  const projectId = typeof payload.projectId === 'string' ? payload.projectId : '';
  const policy = projectId ? await deps.store.getPolicy(projectId) : null;
  return { issueId, versions, observationMode: Boolean(policy?.observationMode) };
}

/**
 * Every screen of the app, by resolver key.
 *
 * Why `screen.projectSettings` answers the *effective* policy: the stored one,
 * or the documented defaults when nothing is saved yet. A screen that answers
 * `null` is answered by the Forge bridge as an empty object — which the view
 * would take for a policy with no fields at all (2026-11-13).
 */
export const SCREENS: Record<string, ScreenHandler> = {
  'screen.projectPage': async (payload, deps) =>
    deps.store.getDossier(required(payload, 'versionId')),
  'screen.projectSettings': async (payload, deps) =>
    resolvePolicy(deps.store, required(payload, 'projectId')),
  'screen.dashboardGadget': dashboardGadget,
  'screen.impactGraph': impactGraph,
  'screen.projectDiff': projectDiff,
  'screen.projectVersions': projectVersions,
  'screen.savePolicy': savePolicy,
  'screen.issueContext': issueContext,
};
