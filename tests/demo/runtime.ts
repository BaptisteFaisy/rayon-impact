import { recomputeRelease } from '../../src/engine/pipeline';
import { SCREENS } from '../../src/screens';
import { runAction } from '../../src/actions/registry';
import { makeViewer } from '../../src/actions/types';
import { FakeIndex, FakeStore, recordingLogger } from '../actions/fake-store';
import type { ActionDeps, DossierIndex } from '../../src/actions/types';
import type { PipelineDeps, RecomputeRequest, ReleaseCollector } from '../../src/ports';
import type { DemoScenario } from '../fixtures/demo-scenarios';
import type { Signal, Viewer } from '../../src/types';

/**
 * Demo runtime: plays a scenario through the PRODUCTION code paths.
 *
 * `recomputeRelease` (the real pipeline) writes the dossier, `SCREENS` answers
 * the four screens and `runAction` answers the nine Rovo/MCP actions — the same
 * calls the Forge router makes, against the in-memory store the tests already
 * ship. The demo is not a second implementation of the app: it is the app with
 * fake ports.
 *
 * The narrative writer deliberately fails: with no model reachable offline the
 * pipeline takes its deterministic fallback and marks `narrativeVerified:
 * false`. Claiming a summary came from a model would be exactly what SPEC §15
 * forbids.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

/** Account ids used by the demo: one approver, one plain reader. */
export const DEMO_LEAD = 'user-release-lead';
export const DEMO_READER = 'user-reader';

/** A release collector that serves the scenario's data and nothing else. */
function scenarioCollector(scenario: DemoScenario): ReleaseCollector {
  return {
    async collect() {
      return scenario.release;
    },
  };
}

/** A narrative writer that fails: the pipeline then uses its deterministic text. */
function offlineNarrative(): PipelineDeps['narrative'] {
  return {
    async write() {
      throw new Error('no model in the offline demo');
    },
  };
}

/** The pipeline dependencies of one scenario: real code, fake ports. */
function pipelineDeps(scenario: DemoScenario, store: FakeStore): PipelineDeps {
  return {
    store,
    collector: scenarioCollector(scenario),
    narrative: offlineNarrative(),
    clock: { now: () => scenario.now },
    logger: recordingLogger(),
  };
}

/** The recompute request the triggers would build for this version. */
function recomputeRequest(scenario: DemoScenario): RecomputeRequest {
  return {
    projectId: scenario.release.project.id,
    versionId: scenario.release.version.id,
    viewerAccountId: DEMO_LEAD,
    reason: 'manual',
  };
}

/** A reader who may not waive: the demo shows the refusal, never a hidden button. */
export function demoViewer(role: 'lead' | 'reader', locale: 'en' | 'fr'): Viewer {
  return makeViewer(role === 'lead' ? DEMO_LEAD : DEMO_READER, {
    locale,
    canWaive: role === 'lead',
  });
}

/** Everything the demo server needs: a seeded store, an index, and real calls. */
export interface DemoRuntime {
  scenario: DemoScenario;
  store: FakeStore;
  index: DossierIndex;
  signals: Signal[];
  /** One real screen resolver, called with the viewer of the demo. */
  screen(key: string, payload: Record<string, unknown>, viewer: Viewer): Promise<unknown>;
  /** One real Rovo/MCP action, called with the viewer of the demo. */
  action(key: string, raw: Record<string, unknown>, viewer: Viewer): Promise<unknown>;
}

/** The injected graph of one call: identity comes from the caller (R2 §2.3). */
function depsFor(
  store: FakeStore,
  index: DossierIndex,
  scenario: DemoScenario,
  viewer: Viewer,
): ActionDeps {
  return {
    store,
    index,
    clock: { now: () => scenario.now },
    logger: recordingLogger(),
    viewer,
  };
}

/** Plays a scenario: real recompute, then the index that answers the actions. */
export async function demoRuntime(scenario: DemoScenario): Promise<DemoRuntime> {
  const store = new FakeStore();
  const index = new FakeIndex();
  store.seedPolicy(scenario.policy);

  const result = await recomputeRelease(pipelineDeps(scenario, store), recomputeRequest(scenario));
  const versionId = scenario.release.version.id;
  index.addVersion({
    projectId: scenario.release.project.id,
    projectKey: scenario.release.project.key,
    versionId,
    versionName: scenario.release.version.name,
  });
  index.addFacts(versionId, { cachedAt: scenario.now, release: scenario.release });
  index.addSignals(versionId, result.signals);
  store.seedDossier({
    snapshot: result.snapshot,
    signals: result.signals,
    waivers: [],
    decisions: [],
    outcome: null,
  });

  const runtime: DemoRuntime = {
    scenario,
    store,
    index,
    /** Always the current signals: a write triggers a recompute (see `recompute`). */
    get signals(): Signal[] {
      return store.dossiers.get(versionId)?.signals ?? [];
    },
    screen: (key, payload, viewer) => callScreen(key, payload, viewer, store, index, scenario),
    action: (key, raw, viewer) => callAction(key, raw, viewer, store, index, scenario),
  };
  return runtime;
}

/**
 * Actions that write: the app recomputes the release after them — a waiver
 * changes the verdict only at the next computation. The demo replays that
 * computation with the real pipeline, so granting a waiver really moves the
 * verdict, the way it does on the site.
 */
const WRITING_ACTIONS = new Set(['request-waiver', 'close-waiver', 'record-decision']);

/** One screen call: unknown keys fail loudly, never as an empty module. */
async function callScreen(
  key: string,
  payload: Record<string, unknown>,
  viewer: Viewer,
  store: FakeStore,
  index: FakeIndex,
  scenario: DemoScenario,
): Promise<unknown> {
  const handler = SCREENS[key];
  if (!handler) throw new Error(`Unknown screen "${key}"`);
  return handler(payload, depsFor(store, index, scenario, viewer));
}

/** One action call: the same registry the `action` and `rovo:mcp` modules use. */
async function callAction(
  key: string,
  raw: Record<string, unknown>,
  viewer: Viewer,
  store: FakeStore,
  index: FakeIndex,
  scenario: DemoScenario,
): Promise<unknown> {
  const answer = await runAction(key, raw, depsFor(store, index, scenario, viewer));
  if (WRITING_ACTIONS.has(key)) await recompute(store, index, scenario);
  return answer;
}

/** Replays the recompute after a write, and re-seeds what the screens read. */
async function recompute(
  store: FakeStore,
  index: FakeIndex,
  scenario: DemoScenario,
): Promise<void> {
  const versionId = scenario.release.version.id;
  const result = await recomputeRelease(pipelineDeps(scenario, store), recomputeRequest(scenario));
  index.addSignals(versionId, result.signals);
  // The waivers and decisions live in the store; `seedDossier` writes them back,
  // so they are read from the store — not from the previous dossier — or a
  // granted waiver would be wiped by the recompute that is supposed to apply it.
  const [waivers, decisions, outcome] = await Promise.all([
    store.getWaivers(versionId),
    store.getDecisions(versionId),
    store.getOutcome(versionId),
  ]);
  store.seedDossier({
    snapshot: result.snapshot,
    signals: result.signals,
    waivers,
    decisions,
    outcome,
  });
}
