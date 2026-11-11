import type {
  CollectedRelease,
  GraphEdge,
  GraphNode,
  GraphNodeKind,
  ImpactGraph,
  MessageRef,
  Signal,
} from '../types.js';
import { GRAPH_NODE_LIMIT, SEVERITY_ORDER } from '../types.js';

/**
 * Impact graph construction (RI-12) and its mandatory list equivalent
 * (SPEC §11: "the graph view always has a list equivalent").
 *
 * Nodes: version (center), the release's tickets, services, teams, incidents,
 * pages, open pull requests. Edges: version→ticket, ticket→service,
 * service→team, incident→service, page→ticket, ticket→pull-request.
 *
 * Truncation rule (documented, deterministic): above `limit` nodes, keep in
 * priority order the nodes carrying a blocking signal, then a major one, then
 * the rest; stable sort by node id inside each priority class. The version
 * node is always kept (graph center). Edges only reference kept nodes.
 *
 * Pure domain module: no Forge import, no I/O.
 * Rule: files < 500 lines, functions < 50 lines.
 */

/** Node ids carry their kind so edges and truncation stay unambiguous. */
export function nodeId(kind: GraphNodeKind, id: string): string {
  return `${kind}:${id}`;
}

/** Severity carried by the signals raised on one node (best = most severe). */
function nodeSeverityRank(nodeIdStr: string, signals: Signal[]): number {
  let best = SEVERITY_ORDER.length; // worse than info = no signal
  for (const signal of signals) {
    const sid = nodeId(signal.subjectType as GraphNodeKind, signal.subjectId);
    if (sid !== nodeIdStr) continue;
    const rank = SEVERITY_ORDER.indexOf(signal.severity);
    if (rank >= 0 && rank < best) best = rank;
  }
  return best;
}

interface NodeDraft extends GraphNode {
  rank: number;
}

function collectNodes(release: CollectedRelease, signals: Signal[]): Map<string, NodeDraft> {
  const nodes = new Map<string, NodeDraft>();
  const add = (kind: GraphNodeKind, id: string, label: string, url?: string) => {
    const nid = nodeId(kind, id);
    if (nodes.has(nid)) return;
    nodes.set(nid, { id: nid, kind, label, url, rank: nodeSeverityRank(nid, signals) });
  };

  add('version', release.version.id, release.version.name);
  for (const issue of release.issues) {
    add('issue', issue.subjectId, issue.key);
    if (issue.serviceId) add('service', issue.serviceId, issue.serviceName ?? issue.serviceId);
    if (issue.dev.openPullRequests > 0) {
      add('pull-request', `open-${issue.subjectId}`, `${issue.key}: ${issue.dev.openPullRequests} open PR`);
    }
  }
  for (const team of release.teams) add('team', team.id, team.name);
  for (const incident of release.incidents) {
    add('incident', incident.subjectId, incident.key, incident.url);
    if (incident.serviceId) add('service', incident.serviceId, incident.serviceName ?? incident.serviceId);
  }
  for (const page of release.pages) add('page', page.subjectId, page.title, page.url);
  return nodes;
}

function teamIdsForService(release: CollectedRelease, serviceId: string): string[] {
  const ids = new Set<string>();
  for (const issue of release.issues) {
    if (issue.serviceId !== serviceId) continue;
    for (const team of release.graph?.teamsByIssueId[issue.subjectId] ?? []) {
      ids.add(team.id);
    }
  }
  return [...ids];
}

function collectEdges(release: CollectedRelease, nodeIds: Set<string>): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const link = (from: string, to: string, kind: string) => {
    if (nodeIds.has(from) && nodeIds.has(to)) edges.push({ from, to, kind });
  };
  const ver = nodeId('version', release.version.id);

  for (const issue of release.issues) {
    const iss = nodeId('issue', issue.subjectId);
    link(ver, iss, 'contains');
    if (issue.serviceId) link(iss, nodeId('service', issue.serviceId), 'touches');
    if (issue.dev.openPullRequests > 0) {
      link(iss, nodeId('pull-request', `open-${issue.subjectId}`), 'has-open-pr');
    }
  }
  for (const serviceNode of [...nodeIds].filter((id) => id.startsWith('service:'))) {
    const serviceId = serviceNode.slice('service:'.length);
    for (const teamId of teamIdsForService(release, serviceId)) {
      link(serviceNode, nodeId('team', teamId), 'owned-by');
    }
  }
  for (const incident of release.incidents) {
    if (incident.serviceId) {
      link(nodeId('incident', incident.subjectId), nodeId('service', incident.serviceId), 'impacts');
    }
  }
  for (const page of release.pages) {
    for (const issue of release.issues) {
      const mentionsPage = issue.remoteLinks.some((rl) => rl.url === page.url);
      if (mentionsPage) link(nodeId('page', page.subjectId), nodeId('issue', issue.subjectId), 'documents');
    }
  }
  return edges;
}

/**
 * Deterministic truncation: the version node (graph center) is always kept,
 * then nodes carrying a blocking signal, then a major one, then the rest;
 * stable sort by node id inside each priority class.
 */
function truncateNodes(drafts: NodeDraft[], limit: number): { kept: NodeDraft[]; truncated: boolean } {
  if (drafts.length <= limit) return { kept: drafts, truncated: false };
  const anchors = drafts.filter((draft) => draft.kind === 'version').slice(0, limit);
  const rest = drafts
    .filter((draft) => draft.kind !== 'version')
    .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
  return { kept: [...anchors, ...rest.slice(0, Math.max(0, limit - anchors.length))], truncated: true };
}

export function buildImpactGraph(
  release: CollectedRelease,
  signals: Signal[],
  limit: number = GRAPH_NODE_LIMIT,
): ImpactGraph {
  const drafts = collectNodes(release, signals);
  const { kept, truncated } = truncateNodes([...drafts.values()], limit);
  const nodes: GraphNode[] = kept.map(({ rank: _rank, ...node }) => node);
  const nodeIds = new Set(nodes.map((n) => n.id));
  return { nodes, edges: collectEdges(release, nodeIds), truncated };
}

/** Group label of the list equivalent, as a MessageRef (i18n, SPEC §11). */
const GROUP_KEYS: Record<GraphNodeKind, MessageRef> = {
  version: { key: 'graph.group.version' },
  issue: { key: 'graph.group.issue' },
  service: { key: 'graph.group.service' },
  team: { key: 'graph.group.team' },
  incident: { key: 'graph.group.incident' },
  page: { key: 'graph.group.page' },
  'pull-request': { key: 'graph.group.pull-request' },
};

/** Fixed group order of the list view, mirroring SPEC §11 screen order. */
const GROUP_ORDER: readonly GraphNodeKind[] = [
  'version',
  'issue',
  'pull-request',
  'service',
  'team',
  'incident',
  'page',
] as const;

/**
 * List equivalent of the graph (SPEC §11): same nodes, grouped by kind in a
 * fixed order (independent of node insertion), for accessibility and for
 * releases above GRAPH_NODE_LIMIT.
 */
export function graphToListView(
  graph: ImpactGraph,
): { group: MessageRef; items: { label: string; url?: string; restricted?: boolean }[] }[] {
  const groups = new Map<GraphNodeKind, { label: string; url?: string; restricted?: boolean }[]>();
  for (const node of graph.nodes) {
    const list = groups.get(node.kind) ?? [];
    list.push({ label: node.label, url: node.url, restricted: node.restricted });
    groups.set(node.kind, list);
  }
  return GROUP_ORDER.filter((kind) => groups.has(kind)).map((kind) => ({
    group: GROUP_KEYS[kind],
    items: groups.get(kind) ?? [],
  }));
}

export function countGraphNodes(graph: ImpactGraph): number {
  return graph.nodes.length;
}
