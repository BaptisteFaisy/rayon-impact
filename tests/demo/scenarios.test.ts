import { describe, expect, it } from 'vitest';
import { detectAllSignals } from '../../src/engine/pipeline';
import { computeCoverage } from '../../src/engine/coverage';
import { computeVerdict } from '../../src/engine/verdict';
import { buildImpactGraph } from '../../src/engine/graph';
import { minimalRemovalSet, simulateWithout } from '../../src/engine/simulate';
import { grantWaiver } from '../../src/engine/waiver';
import { DEMO_SCENARIOS, demoScenario } from '../fixtures/demo-scenarios';
import type { DemoScenario } from '../fixtures/demo-scenarios';
import type { Signal, VerdictResult, Waiver } from '../../src/types';

/**
 * The demo scenarios are locked to what the real engine measures: same data,
 * same verdict, every time (SPEC §8 — nothing here is a model's opinion).
 *
 * `expected` in tests/fixtures/demo-scenarios.ts is the MEASURED output, not a
 * wish: when a scenario changes, this test fails and says which number moved.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

/** Runs the whole pure pipeline over a scenario, exactly like the app does. */
function assess(scenario: DemoScenario, waivers: Waiver[] = []): VerdictResult {
  const signals = detectAllSignals({
    release: scenario.release,
    policy: scenario.policy,
    now: scenario.now,
    waivers,
    previousSignals: [],
    pastOutcomes: [],
  });
  return computeVerdict(signals, computeCoverage(scenario.release), scenario.release);
}

function signalsOf(scenario: DemoScenario, waivers: Waiver[] = []): Signal[] {
  return detectAllSignals({
    release: scenario.release,
    policy: scenario.policy,
    now: scenario.now,
    waivers,
    previousSignals: [],
    pastOutcomes: [],
  });
}

/** The waiver a release lead grants on a signal, at the scenario's instant. */
function waiverFor(scenario: DemoScenario, signal: Signal, hours: number): Waiver {
  return grantWaiver(
    {
      versionId: scenario.release.version.id,
      signalCode: signal.code,
      subjectType: signal.subjectType,
      subjectId: signal.subjectId,
      reason: 'Demo: accepted for this release, post-mortem scheduled.',
      hours,
      grantedBy: scenario.policy.waiverApprovers[0],
    },
    scenario.policy,
    scenario.now,
  );
}

describe('demo scenarios — measured verdict', () => {
  for (const scenario of DEMO_SCENARIOS) {
    it(`${scenario.id}: ${scenario.expected.verdict}, ${scenario.expected.confidence}, ${JSON.stringify(
      scenario.expected.counts,
    )}`, () => {
      const result = assess(scenario);
      expect(result.verdict).toBe(scenario.expected.verdict);
      expect(result.confidence).toBe(scenario.expected.confidence);
      expect(result.counts).toEqual(scenario.expected.counts);
    });
  }

  it('every scenario is reachable by id and unique', () => {
    const ids = DEMO_SCENARIOS.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(demoScenario(id).id).toBe(id);
    expect(() => demoScenario('inconnu')).toThrow(/Unknown demo scenario/);
  });

  it('every scenario carries a bilingual label and story', () => {
    for (const scenario of DEMO_SCENARIOS) {
      for (const text of [scenario.label, scenario.story]) {
        expect(text.en.length).toBeGreaterThan(0);
        expect(text.fr.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('demo scenarios — graph is built for every release', () => {
  for (const scenario of DEMO_SCENARIOS) {
    it(`${scenario.id}: nodes and edges, version at the centre`, () => {
      const graph = buildImpactGraph(scenario.release, signalsOf(scenario));
      expect(graph.nodes.length).toBeGreaterThan(0);
      const kinds = new Set(graph.nodes.map((node) => node.kind));
      expect(kinds.has('version')).toBe(true);
      expect(kinds.has('issue')).toBe(true);
    });
  }
});

/**
 * The SPEC §18 walkthrough on the video variant: no-go, the simulation tells
 * the truth, removing PAY-131 leaves the incident, and a waiver moves the
 * verdict to conditional-go without erasing the signal (DEMO-DATA §4).
 *
 * Stages are cumulative, as filmed: C removes PAY-131 from the version, then D
 * waives the incident, then E waives the stale page.
 */
describe('demo scenario paiements-24-video — sequence A→E', () => {
  const scenario = demoScenario('paiements-24-video');

  /** Stage C: the ticket is out of the version, the release is 11 tickets. */
  const afterC = (): DemoScenario => ({
    ...scenario,
    release: {
      ...scenario.release,
      issues: scenario.release.issues.filter((ticket) => ticket.key !== 'PAY-131'),
    },
  });

  it('A. as filmed: no-go, 3 blocking / 3 major / 3 minor', () => {
    const result = assess(scenario);
    expect(result.verdict).toBe('no-go');
    expect(result.blockingIssueKeys).toEqual(['PAY-131']);
  });

  it('B. preview "simulate without PAY-131" drops 2 signals and stays no-go', () => {
    const signals = signalsOf(scenario);
    const sim = simulateWithout({
      signals,
      coverage: computeCoverage(scenario.release),
      release: scenario.release,
      issueKeys: ['PAY-131'],
      verdict: computeVerdict,
    });
    expect(sim.droppedSignalCount).toBe(2);
    expect(sim.result.verdict).toBe('no-go');
  });

  it('C. minimal removal set alone finds no solution (EXP-01 hangs off an incident)', () => {
    const removal = minimalRemovalSet({
      signals: signalsOf(scenario),
      coverage: computeCoverage(scenario.release),
      release: scenario.release,
      verdict: computeVerdict,
    });
    expect(removal.issueKeys).toEqual([]);
    expect(removal.provenMinimal).toBe(false);
  });

  it('C. removing PAY-131 leaves the incident blocking: still no-go', () => {
    const result = assess(afterC());
    expect(result.verdict).toBe('no-go');
    expect(result.counts.blocking).toBe(1);
  });

  it('D. a 24 h waiver on EXP-01 moves the verdict to conditional-go', () => {
    const stage = afterC();
    const exp01 = signalsOf(stage).find((signal) => signal.code === 'EXP-01') as Signal;
    const result = assess(stage, [waiverFor(stage, exp01, 24)]);
    expect(result.verdict).toBe('conditional-go');
    expect(result.counts.blocking).toBe(0);
    expect(result.conditions.some((condition) => condition.signalCode === 'EXP-01')).toBe(true);
  });

  it('E. a further 48 h waiver on DOC-01 keeps conditional-go and samples a minor', () => {
    const stage = afterC();
    const signals = signalsOf(stage);
    const exp01 = signals.find((signal) => signal.code === 'EXP-01') as Signal;
    const doc01 = signals.find((signal) => signal.code === 'DOC-01') as Signal;
    const waivers = [waiverFor(stage, exp01, 24), waiverFor(stage, doc01, 48)];
    const result = assess(stage, waivers);
    expect(result.verdict).toBe('conditional-go');
    const codes = result.conditions.map((condition) => condition.signalCode);
    expect(codes).toContain('EXP-01');
    expect(codes).toContain('DOC-01');
    expect(result.counts.minor).toBe(2);
  });
});
