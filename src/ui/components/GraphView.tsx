import type { GraphNode, GraphNodeKind, ImpactGraph, Locale } from '../../types';
import { GRAPH_NODE_LIMIT } from '../../types';
import { graphToListView } from '../../engine/graph';
import { t } from '../../i18n/index';
import { Box, Image, Link, List, ListItem, Text, Strong } from '../kit';

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

/** Échappe le texte SVG (les libellés de tickets peuvent contenir & ou <). */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Le graphe en image SVG (data-URI).
 *
 * UI Kit 2 n'a pas de primitive SVG : le document rendu ne contient que des
 * composants que la plateforme dessine. Le graphe part donc en image, et la
 * liste équivalente ci-dessous reste l'équivalent accessible (SPEC §11).
 */
function graphImage(
  graph: ImpactGraph,
  positions: Map<string, { x: number; y: number }>,
): string {
  const edges = graph.edges
    .map((edge) => {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      if (!from || !to) return '';
      return `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="#C1C7D0" stroke-width="1"/>`;
    })
    .join('');
  const nodes = graph.nodes
    .map((node) => {
      const position = positions.get(node.id);
      if (!position) return '';
      const radius = node.kind === 'version' ? 10 : 6;
      const label = escapeXml(node.restricted ? '•' : node.label);
      return `<circle cx="${position.x}" cy="${position.y}" r="${radius}" fill="${COLOR[node.kind]}"/><text x="${position.x + 10}" y="${position.y + 4}" font-size="10" fill="#172B4D">${label}</text>`;
    })
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="520">${edges}${nodes}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function GraphView({ graph, locale }: GraphViewProps) {
  const positions = new Map<string, { x: number; y: number }>();
  for (const node of graph.nodes) {
    positions.set(node.id, positionOf(graph.nodes, node));
  }

  return (
    <Box>
      {graph.truncated ? (
        <Text>
          {locale === 'fr'
            ? `Graphe tronqué : plus de ${GRAPH_NODE_LIMIT} nœuds. La liste ci-dessous reste complète.`
            : `Graph truncated: more than ${GRAPH_NODE_LIMIT} nodes. The list below stays complete.`}
        </Text>
      ) : null}
      <Image src={graphImage(graph, positions)} alt={locale === 'fr' ? "Graphe d'impact" : 'Impact graph'} />
      <ListEquivalent graph={graph} locale={locale} />
    </Box>
  );
}

/** The accessible counterpart: the engine's list view, with translated groups. */
function ListEquivalent({ graph, locale }: GraphViewProps) {
  return (
    <Box>
      {graphToListView(graph).map((section) => (
        <Box key={section.group.key}>
          <Strong>{t(section.group, locale)}</Strong> ({section.items.length})
          <List type="unordered">
            {section.items.map((item, index) => (
              <ListItem key={`${item.label}-${index}`}>
                {item.url ? (
                  <Link href={item.url} openNewTab>
                    {item.label}
                  </Link>
                ) : (
                  item.label
                )}
                {item.restricted ? (
                  <Text>
                    {' '}
                    — {locale === 'fr' ? 'masqué' : 'hidden'}
                  </Text>
                ) : null}
              </ListItem>
            ))}
          </List>
        </Box>
      ))}
    </Box>
  );
}
