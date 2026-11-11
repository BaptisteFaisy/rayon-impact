import { describe, expect, it } from 'vitest';
import type { GraphNodeKind, Signal, SignalCode, SubjectType } from '../../src/types.js';
import { GRAPH_NODE_LIMIT } from '../../src/types.js';
import { buildImpactGraph, countGraphNodes, graphToListView, nodeId } from '../../src/engine/graph.js';
import { collected, issue, okSources, page, version } from '../fixtures/builders.js';
import { paiementsIncidents, paiementsRelease } from '../fixtures/paiements.js';

/**
 * RI-12 impact graph + SPEC §11 list equivalent.
 * The canonical dataset (tests/fixtures/paiements.ts) is the reference release.
 */

const NOW = '2026-11-11T06:00:00.000Z';
const INC_52 = paiementsIncidents()[0];
const PAY_129 = { subjectType: 'issue' as SubjectType, subjectId: 'id-pay-129' };
const PAY_130 = { subjectType: 'issue' as SubjectType, subjectId: 'id-pay-130' };
const PAY_131 = { subjectType: 'issue' as SubjectType, subjectId: 'id-pay-131' };

function signalOn(
  code: SignalCode,
  subjectType: SubjectType,
  subjectId: string,
  severity: Signal['severity'],
): Signal {
  return {
    id: `${code}:${subjectType}:${subjectId}`,
    code,
    subjectType,
    subjectId,
    severity,
    status: 'active',
    finding: { key: 'evidence.restricted' },
    evidence: [],
    detectedAt: NOW,
    firstSeenAt: NOW,
  };
}

/** Blocking signals of the canonical release: QUAL-01, DEP-01, COMP-01/03, EXP-01. */
function canonicalSignals(): Signal[] {
  return [
    signalOn('QUAL-01', PAY_129.subjectType, PAY_129.subjectId, 'blocking'),
    signalOn('DEP-01', PAY_130.subjectType, PAY_130.subjectId, 'blocking'),
    signalOn('COMP-01', PAY_131.subjectType, PAY_131.subjectId, 'blocking'),
    signalOn('COMP-03', PAY_131.subjectType, PAY_131.subjectId, 'blocking'),
    signalOn('EXP-01', 'incident', INC_52.subjectId, 'blocking'),
    signalOn('COMP-02', 'issue', 'id-pay-132', 'major'),
  ];
}

function kindsOf(nodes: { kind: GraphNodeKind }[]): Record<string, number> {
  return nodes.reduce<Record<string, number>>((acc, node) => {
    acc[node.kind] = (acc[node.kind] ?? 0) + 1;
    return acc;
  }, {});
}

describe('buildImpactGraph', () => {
  it('construit le graphe complet du jeu canonique (nœuds et arêtes attendus)', () => {
    const graph = buildImpactGraph(paiementsRelease(), canonicalSignals());

    expect(graph.truncated).toBe(false);
    expect(countGraphNodes(graph)).toBe(22);
    expect(kindsOf(graph.nodes)).toEqual({
      version: 1,
      issue: 14,
      service: 1,
      team: 1,
      incident: 2,
      page: 2,
      'pull-request': 1,
    });

    const edgeCount = (kind: string) => graph.edges.filter((e) => e.kind === kind).length;
    expect(edgeCount('contains')).toBe(14); // version -> ticket
    expect(edgeCount('touches')).toBe(14); // ticket -> service
    expect(edgeCount('owned-by')).toBe(1); // service -> team
    expect(edgeCount('impacts')).toBe(2); // incident -> service
    expect(edgeCount('has-open-pr')).toBe(1); // ticket -> open PR (PAY-131)
    expect(edgeCount('documents')).toBe(1); // PAY-127 -> page 9001
    expect(graph.edges).toHaveLength(33);
  });

  it('relie une page Confluence aux tickets qui la référencent', () => {
    const release = collected({
      version: version(),
      issues: [
        issue('PAY-127', {
          remoteLinks: [
            {
              id: 'rl-1',
              url: 'https://pay.atlassian.net/wiki/pages/9001',
              title: 'Integration guide',
              kind: 'confluence',
            },
          ],
        }),
      ],
      pages: [page('9001', { title: 'Integration guide' })],
      sources: okSources(),
    });

    const graph = buildImpactGraph(release, []);
    expect(graph.edges).toEqual([
      { from: nodeId('version', 'ver-24'), to: nodeId('issue', 'id-pay-127'), kind: 'contains' },
      { from: nodeId('issue', 'id-pay-127'), to: nodeId('service', 'svc-checkout-api'), kind: 'touches' },
      { from: nodeId('page', '9001'), to: nodeId('issue', 'id-pay-127'), kind: 'documents' },
    ]);
  });

  it('ne produit aucune arête pointant vers un nœud absent', () => {
    const graph = buildImpactGraph(paiementsRelease(), canonicalSignals(), 8);
    const ids = new Set(graph.nodes.map((n) => n.id));
    expect(graph.edges.every((e) => ids.has(e.from) && ids.has(e.to))).toBe(true);
  });

  it('tronque au-delà de la limite en gardant d’abord les nœuds bloquants', () => {
    const graph = buildImpactGraph(paiementsRelease(), canonicalSignals(), 5);

    expect(graph.truncated).toBe(true);
    expect(countGraphNodes(graph)).toBe(5);
    expect(graph.nodes.map((n) => n.id)).toEqual([
      nodeId('version', 'ver-24'), // center, always kept
      nodeId('incident', INC_52.subjectId),
      nodeId('issue', PAY_129.subjectId),
      nodeId('issue', PAY_130.subjectId),
      nodeId('issue', PAY_131.subjectId),
    ]);
  });

  it('garde la limite par défaut GRAPH_NODE_LIMIT sans troncature sous le seuil', () => {
    const graph = buildImpactGraph(paiementsRelease(), canonicalSignals());
    expect(GRAPH_NODE_LIMIT).toBe(150);
    expect(countGraphNodes(graph)).toBeLessThan(GRAPH_NODE_LIMIT);
    expect(graph.truncated).toBe(false);
  });

  it('est déterministe : deux appels donnent le même graphe', () => {
    const a = buildImpactGraph(paiementsRelease(), canonicalSignals());
    const b = buildImpactGraph(paiementsRelease(), canonicalSignals());
    expect(a).toEqual(b);
  });
});

describe('graphToListView', () => {
  it('donne l’équivalent liste groupé par type, cohérent avec le graphe', () => {
    const graph = buildImpactGraph(paiementsRelease(), canonicalSignals());
    const groups = graphToListView(graph);

    expect(groups.map((g) => g.group.key)).toEqual([
      'graph.group.version',
      'graph.group.issue',
      'graph.group.pull-request',
      'graph.group.service',
      'graph.group.team',
      'graph.group.incident',
      'graph.group.page',
    ]);

    const listed = groups.reduce((total, g) => total + g.items.length, 0);
    expect(listed).toBe(countGraphNodes(graph));

    const issueGroup = groups.find((g) => g.group.key === 'graph.group.issue');
    expect(issueGroup?.items.map((i) => i.label)).toContain('PAY-131');
    expect(issueGroup?.items.every((i) => i.restricted === undefined)).toBe(true);
  });

  it('reste cohérent après troncature (mêmes nœuds que le graphe)', () => {
    const graph = buildImpactGraph(paiementsRelease(), canonicalSignals(), 5);
    const labels = graphToListView(graph)
      .flatMap((g) => g.items.map((i) => i.label))
      .sort();

    expect(labels).toEqual(graph.nodes.map((n) => n.label).sort());
  });

  it('transporte l’url et le drapeau restricted des nœuds', () => {
    const groups = graphToListView({
      nodes: [
        { id: 'page:1', kind: 'page', label: 'Guide', url: 'https://x/1' },
        { id: 'page:2', kind: 'page', label: 'Secret', restricted: true },
      ],
      edges: [],
      truncated: false,
    });

    expect(groups).toHaveLength(1);
    expect(groups[0].items).toEqual([
      { label: 'Guide', url: 'https://x/1', restricted: undefined },
      { label: 'Secret', url: undefined, restricted: true },
    ]);
  });

  it('countGraphNodes compte les nœuds, pas les arêtes', () => {
    const graph = buildImpactGraph(paiementsRelease(), canonicalSignals());
    expect(countGraphNodes(graph)).toBe(graph.nodes.length);
    expect(countGraphNodes(graph)).not.toBe(graph.edges.length);
  });
});
