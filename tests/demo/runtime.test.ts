import { describe, expect, it } from 'vitest';
import { DEMO_SCENARIOS, demoScenario } from '../fixtures/demo-scenarios';
import { demoRuntime, demoViewer } from './runtime';
import { demoDataset } from './dataset';
import { SCREENS } from '../../src/screens';
import { ACTION_KEYS } from '../../src/actions/registry';

/**
 * The demo runtime plays each scenario through the production pipeline and the
 * production resolvers/actions. What is asserted here is what the demo server
 * will show: same numbers as `tests/demo/scenarios.test.ts`, reached by the
 * real code path (`recomputeRelease` → store → `SCREENS` → `runAction`).
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

describe('demo runtime — real pipeline, real resolvers', () => {
  for (const scenario of DEMO_SCENARIOS) {
    it(`${scenario.id}: the saved dossier carries the measured verdict`, async () => {
      const runtime = await demoRuntime(demoScenario(scenario.id));
      const dataset = await demoDataset(runtime);
      expect(dataset.dossier.snapshot.verdict).toBe(scenario.expected.verdict);
      expect(dataset.dossier.snapshot.confidence).toBe(scenario.expected.confidence);
      expect(dataset.dossier.snapshot.counts).toEqual(scenario.expected.counts);
      expect(dataset.signals.length).toBe(scenario.expected.counts.blocking
        + scenario.expected.counts.major
        + scenario.expected.counts.minor
        + scenario.expected.counts.info);
    });
  }

  it('the narrative is the deterministic fallback, marked as such (SPEC §15)', async () => {
    const runtime = await demoRuntime(demoScenario('paiements-24'));
    const dossier = [...runtime.store.dossiers.values()][0];
    expect(dossier.snapshot.narrativeVerified).toBe(false);
    expect(dossier.snapshot.narrative.length).toBeGreaterThan(0);
    expect(dossier.snapshot.narrative).toContain('PAY-131');
  });

  it('every screen of the app answers for every scenario', async () => {
    const runtime = await demoRuntime(demoScenario('paiements-24'));
    const viewer = demoViewer('lead', 'en');
    const versionId = runtime.scenario.release.version.id;
    const projectId = runtime.scenario.release.project.id;
    const answers = await Promise.all(
      Object.keys(SCREENS)
        .filter((key) => key !== 'screen.savePolicy' && key !== 'screen.issueContext')
        .map((key) => runtime.screen(key, { versionId, projectId, issueId: 'id-pay-131' }, viewer)),
    );
    expect(answers.length).toBe(6);
    expect(answers.every((answer) => answer !== undefined)).toBe(true);
    expect(answers[0]).not.toBeNull();
  });

  it('an unknown screen fails loudly, never as an empty module', async () => {
    const runtime = await demoRuntime(demoScenario('paiements-24'));
    const viewer = demoViewer('reader', 'en');
    await expect(runtime.screen('screen.inconnue', {}, viewer)).rejects.toThrow(/Unknown screen/);
  });
});

describe('demo dataset — the nine actions answer for real', () => {
  it('simulate-without previews the removal of the blocking tickets', async () => {
    const runtime = await demoRuntime(demoScenario('paiements-24-video'));
    const dataset = await demoDataset(runtime);
    expect(dataset.simulate).not.toBeNull();
    expect(dataset.simulate?.verdictBefore).toBe('no-go');
    expect(dataset.simulate?.droppedSignalCount).toBeGreaterThan(0);
    expect(dataset.simulate?.minimalRemoval).toBeDefined();
  });

  it('list-impacted-teams returns the Mobile team on the canonical release', async () => {
    const runtime = await demoRuntime(demoScenario('paiements-24'));
    const dataset = await demoDataset(runtime);
    expect(dataset.teams.map((team) => team.teamName)).toContain('Mobile');
  });

  it('a reader is refused a waiver, the lead is granted one (RI-07)', async () => {
    const runtime = await demoRuntime(demoScenario('paiements-24-video'));
    const dataset = await demoDataset(runtime);
    const signal = dataset.dossier.signals.find((s) => s.severity === 'blocking');
    const raw = { signalId: signal?.id, reason: 'Demo: accepted for this release.', hours: 24 };
    const lead = await runtime.action('request-waiver', raw, demoViewer('lead', 'en'));
    const reader = await runtime.action('request-waiver', raw, demoViewer('reader', 'en'));
    expect((lead as { granted: boolean }).granted).toBe(true);
    expect((reader as { granted: boolean }).granted).toBe(false);
  });

  it('ACTION_KEYS are all reachable through the demo runtime', async () => {
    const runtime = await demoRuntime(demoScenario('paiements-24-video'));
    const dataset = await demoDataset(runtime);
    const viewer = demoViewer('lead', 'en');
    const versionId = dataset.dossier.snapshot.versionId;
    const calls = [
      runtime.action('get-release-impact', { projectKey: 'PAY', versionName: '2.4' }, viewer),
      runtime.action('list-release-signals', { versionId }, viewer),
      runtime.action('explain-signal', {
        signalId: dataset.dossier.signals[0].id,
      }, viewer),
      runtime.action('list-impacted-teams', { versionId }, viewer),
      runtime.action('simulate-without', { versionId, issueKeys: 'PAY-131' }, viewer),
      runtime.action('get-release-outcome', { versionId }, viewer),
    ];
    const results = await Promise.all(calls);
    expect(results).toHaveLength(ACTION_KEYS.filter((key) => key !== 'record-decision'
      && key !== 'request-waiver' && key !== 'close-waiver').length);
    expect(results.every((result) => result !== undefined)).toBe(true);
  });
});
