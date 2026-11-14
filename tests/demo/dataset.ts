import { demoViewer } from './runtime';
import type { DemoRuntime } from './runtime';
import type { DemoScenario } from '../fixtures/demo-scenarios';
import type {
  Confidence,
  ImpactGraph,
  ImpactedTeam,
  Locale,
  Policy,
  ReleaseDossier,
  Signal,
  SnapshotDiff,
  Verdict,
  Waiver,
} from '../../src/types';
import type { SimulateWithoutOutput, RequestWaiverOutput } from '../../src/actions/types';

/**
 * The demo dataset: the exact shapes the four screens and the nine actions
 * return, read from the real resolvers through `runtime` — never recomposed by
 * hand, so the demo cannot drift from what production would answer.
 *
 * `tests/ui/screenData.ts` builds the canonical dataset from fixtures for the
 * render tests; this one builds any scenario from the app itself.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

/** Row shape of `screen.projectVersions`. */
export interface VersionRow {
  versionId: string;
  versionName: string;
  verdict: Verdict;
  confidence: Confidence;
  computedAt: string;
  released: boolean;
}

/** Row shape of `screen.dashboardGadget`. */
export interface GadgetRow {
  versionId: string;
  versionName: string;
  verdict: Verdict;
  confidence: Confidence;
  computedAt: string;
  releaseDate: string | null;
}

/** Payload shape of `screen.issueContext`. */
export interface IssueContextPayload {
  issueId: string;
  versions: { versionId: string; versionName: string; dossier: ReleaseDossier | null }[];
  observationMode: boolean;
}

/** Everything the screens and the panels need, all read from the real code. */
export interface DemoDataset {
  scenario: DemoScenario;
  dossier: ReleaseDossier;
  versionRows: VersionRow[];
  graph: ImpactGraph | null;
  diff: SnapshotDiff | null;
  teams: ImpactedTeam[];
  gadgetRows: GadgetRow[];
  issueContext: IssueContextPayload;
  policy: Policy;
  simulate: SimulateWithoutOutput | null;
  requestWaiver: RequestWaiverOutput | null;
  closeWaiver: Waiver | null;
  signals: Signal[];
}

/** Who is watching the demo: the lead may waive, a reader may not (RI-07). */
export interface DemoIdentity {
  role: 'lead' | 'reader';
  locale: Locale;
}

/** The viewer of an identity, exactly as the Forge context would build it. */
export function viewerOf(identity: DemoIdentity) {
  return demoViewer(identity.role, identity.locale);
}

/** The four reads of the project screen, in one parallel call each. */
async function readsOf(runtime: DemoRuntime, identity: DemoIdentity) {
  const viewer = viewerOf(identity);
  const versionId = runtime.scenario.release.version.id;
  const projectId = runtime.scenario.release.project.id;
  const [dossier, versionRows, graph, diff, gadgetRows, policy] = await Promise.all([
    runtime.screen('screen.projectPage', { versionId }, viewer) as Promise<ReleaseDossier>,
    runtime.screen('screen.projectVersions', { projectId }, viewer) as Promise<VersionRow[]>,
    runtime.screen('screen.impactGraph', { versionId }, viewer) as Promise<ImpactGraph | null>,
    runtime.screen('screen.projectDiff', { projectId, versionId }, viewer) as Promise<
      SnapshotDiff | null
    >,
    runtime.screen('screen.dashboardGadget', { projectId }, viewer) as Promise<GadgetRow[]>,
    runtime.screen('screen.projectSettings', { projectId }, viewer) as Promise<Policy>,
  ]);
  return { versionId, dossier, versionRows, graph, diff, gadgetRows, policy };
}

/** The tickets the simulation panel may offer: those holding the release back. */
function blockingKeys(dossier: ReleaseDossier, release: DemoScenario['release']): string[] {
  const keyOf = new Map(release.issues.map((issue) => [issue.subjectId, issue.key]));
  const held = dossier.signals.filter(
    (signal) => signal.status === 'active' && signal.severity === 'blocking',
  );
  return [...new Set(held.map((signal) => keyOf.get(signal.subjectId) ?? ''))].filter(Boolean);
}

/** `simulate-without` on the blocking tickets: the preview the panel shows. */
async function simulateOf(
  runtime: DemoRuntime,
  identity: DemoIdentity,
  dossier: ReleaseDossier,
): Promise<SimulateWithoutOutput | null> {
  const keys = blockingKeys(dossier, runtime.scenario.release);
  if (keys.length === 0) return null;
  return runtime.action(
    'simulate-without',
    { versionId: dossier.snapshot.versionId, issueKeys: keys.join(',') },
    viewerOf(identity),
  ) as Promise<SimulateWithoutOutput>;
}

/** `list-impacted-teams`: the teams, services and tickets of the release. */
async function teamsOf(
  runtime: DemoRuntime,
  identity: DemoIdentity,
  versionId: string,
): Promise<ImpactedTeam[]> {
  const output = (await runtime.action(
    'list-impacted-teams',
    { versionId },
    viewerOf(identity),
  )) as { teams: ImpactedTeam[] };
  return output.teams;
}

/**
 * `screen.issueContext` reads SQL through `createForgeSqlClient()`, which only
 * exists inside the Forge runtime. The demo answers the same payload from the
 * seeded store instead: every tracked version of the ticket it opens on.
 */
function issueContextOf(runtime: DemoRuntime): IssueContextPayload {
  const versions = [...runtime.store.dossiers.values()].map((dossier) => ({
    versionId: dossier.snapshot.versionId,
    versionName: dossier.snapshot.versionName,
    dossier,
  }));
  return {
    issueId: focusIssueOf(runtime),
    versions,
    observationMode: runtime.scenario.policy.observationMode,
  };
}

/** The ticket the demo opens on: the one holding the release back, else the first. */
function focusIssueOf(runtime: DemoRuntime): string {
  const blocking = runtime.signals.find(
    (signal) => signal.subjectType === 'issue' && signal.severity === 'blocking',
  );
  return blocking?.subjectId ?? runtime.scenario.release.issues[0]?.subjectId ?? '';
}

/** Builds the whole dataset of one runtime, for one identity. */
export async function demoDataset(
  runtime: DemoRuntime,
  identity: DemoIdentity = { role: 'lead', locale: 'en' },
): Promise<DemoDataset> {
  const reads = await readsOf(runtime, identity);
  const [teams, simulate] = await Promise.all([
    teamsOf(runtime, identity, reads.versionId),
    simulateOf(runtime, identity, reads.dossier),
  ]);
  return {
    scenario: runtime.scenario,
    dossier: reads.dossier,
    versionRows: reads.versionRows,
    graph: reads.graph,
    diff: reads.diff,
    teams,
    gadgetRows: reads.gadgetRows,
    issueContext: issueContextOf(runtime),
    policy: reads.policy,
    simulate,
    requestWaiver: null,
    closeWaiver: null,
    signals: runtime.signals,
  };
}
