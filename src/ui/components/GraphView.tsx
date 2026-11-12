import type { GraphNode, GraphNodeKind, ImpactGraph, Locale } from '../../types';
import { GRAPH_NODE_LIMIT } from '../../types';
import { graphToListView } from '../../engine/graph';
import { t } from '../../i18n/index';

/**
 * Impact graph view, with its list equivalent (SPEC §11: the graph always has a
 * list counterpart, for accessibility and for releases above 150 nodes).
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

export interface GraphViewProps {
  graph: ImpactGraph;
  locale: Locale;
}

const RADIUS: Record<GraphNodeKind, number> = {
  version: 0,
  issue: 120,
  service: 200,
  team: 260,
  incident: 260,
  page: 320,
  'pull-request': 320,
};

const COLOR: Record<GraphNodeKind, string> = {
  version: '#0052CC',
  issue: '#36B37E',
  service: '#FF8B00',
  team: '#6554C0',
  incident: '#DE350B',
  page: '#00B8D9',
  'pull-request': '#8777D9',
};

/** Deterministic layout: one ring per kind, nodes spread evenly on it. */
function positionOf(nodes: GraphNode[], node: GraphNode): { x: number; y: number } {
  const ring = RADIUS[node.kind];
  if (ring === 0) return { x: 360, y: 260 };
  const sameKind = nodes.filter((candidate) => candidate.kind === node.kind);
  const index = sameKind.findIndex((candidate) => candidate.id === node.id);
  const angle = (2 * Math.PI * index) / Math.max(sameKind.length, 1);
  return { x: 360 + ring * Math.cos(angle), y: 260 + ring * Math.sin(angle) };
}

export function GraphView({ graph, locale }: GraphViewProps) {
  const positions = new Map<string, { x: number; y: number }>();
  for (const node of graph.nodes) {
    positions.set(node.id, positionOf(graph.nodes, node));
  }

  return (
    <div>
      {graph.truncated ? (
        <p style={{ color: '#6B778C' }}>
          {locale === 'fr'
            ? `Graphe tronqué : plus de ${GRAPH_NODE_LIMIT} nœuds. La liste ci-dessous reste complète.`
            : `Graph truncated: more than ${GRAPH_NODE_LIMIT} nodes. The list below stays complete.`}
        </p>
      ) : null}
      <svg width="720" height="520" role="img" aria-label="impact graph">
        {graph.edges.map((edge, index) => {
          const from = positions.get(edge.from);
          const to = positions.get(edge.to);
          if (!from || !to) return null;
          return (
            <line
              key={`${edge.from}-${edge.to}-${index}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke="#C1C7D0"
              strokeWidth={1}
            />
          );
        })}
        {graph.nodes.map((node) => {
          const position = positions.get(node.id);
          if (!position) return null;
          return (
            <g key={node.id}>
              <circle cx={position.x} cy={position.y} r={node.kind === 'version' ? 10 : 6} fill={COLOR[node.kind]} />
              <text x={position.x + 10} y={position.y + 4} fontSize={10} fill="#172B4D">
                {node.restricted ? '•' : node.label}
              </text>
            </g>
          );
        })}
      </svg>
      <ListEquivalent graph={graph} locale={locale} />
    </div>
  );
}

/** The accessible counterpart: the engine's list view, with translated groups. */
function ListEquivalent({ graph, locale }: GraphViewProps) {
  return (
    <div style={{ marginTop: 12 }}>
      {graphToListView(graph).map((section) => (
        <div key={section.group.key} style={{ marginBottom: 8 }}>
          <strong>{t(section.group, locale)}</strong> ({section.items.length})
          <ul style={{ paddingLeft: 20, margin: '4px 0' }}>
            {section.items.map((item, index) => (
              <li key={`${item.label}-${index}`}>
                {item.url ? (
                  <a href={item.url} target="_blank" rel="noreferrer">
                    {item.label}
                  </a>
                ) : (
                  item.label
                )}
                {item.restricted ? (
                  <span style={{ color: '#6B778C' }}>
                    {' '}
                    — {locale === 'fr' ? 'masqué' : 'hidden'}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
