import { detectAllSignals } from '../../src/engine/pipeline';
import { computeCoverage } from '../../src/engine/coverage';
import { computeVerdict } from '../../src/engine/verdict';
import { buildImpactGraph } from '../../src/engine/graph';
import { DEMO_SCENARIOS } from '../../tests/fixtures/demo-scenarios';
import type { DetectionContext } from '../../src/signals/context';

/**
 * Mesure des verdicts réels de chaque scénario de démo : ce que le moteur
 * rend, pas ce que le commentaire prétend. Les valeurs imprimées deviennent
 * les `expected` de tests/fixtures/demo-scenarios.ts (règle CONVENTIONS :
 * le code gagne toujours sur le commentaire).
 */
for (const scenario of DEMO_SCENARIOS) {
  const ctx: DetectionContext = {
    release: scenario.release,
    policy: scenario.policy,
    now: scenario.now,
    waivers: [],
    previousSignals: [],
    pastOutcomes: [],
  };
  const signals = detectAllSignals(ctx);
  const coverage = computeCoverage(scenario.release);
  const verdict = computeVerdict(signals, coverage, scenario.release);
  const graph = buildImpactGraph(scenario.release, signals);
  const codes = signals.map((s) => `${s.code}/${s.severity}`).join(' ');
  console.log('---', scenario.id);
  console.log('  verdict   :', verdict.verdict, verdict.confidence);
  console.log('  counts    :', JSON.stringify(verdict.counts));
  console.log('  signaux   :', signals.length, '->', codes);
  console.log('  couverture:', 'code', verdict.coverage.codeRatio, 'service', verdict.coverage.serviceRatio);
  console.log('  blocages  :', verdict.blockingIssueKeys.join(', ') || '(aucun)');
  console.log('  graphe    :', graph.nodes.length, 'nœuds,', graph.edges.length, 'arêtes');
}
