import { JiraReleaseCollector } from './jira.js';
import { JsmIncidentCollector } from './jsm.js';
import { ConfluencePageCollector } from './confluence.js';
import { TeamworkGraphCollector } from './graph.js';
import { impactedServiceIds, resolveServiceForIncident, resolveServiceForIssue } from './services.js';
import type { ConfluenceClient } from './confluence.js';
import type { GraphRunner } from './graph.js';
import type { JiraClient } from './jira-client.js';
import type { JsmClient } from './jsm.js';
import type {
  CollectedRelease,
  GraphFacts,
  Incident,
  JiraIssue,
  Policy,
  SourceStatus,
} from '../types.js';
import type { Clock, Logger, ReleaseCollector } from '../ports.js';

/**
 * The collector that actually feeds the engine: Jira first, then the other
 * sources, then the services are resolved.
 *
 * Order matters (SPEC §7 and §12): the tickets tell which services are
 * touched, the incidents are filtered on those services, the graph refines the
 * development information, and the services are resolved last, because the
 * graph can carry a Compass component the policy knows about.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

export interface CollectorDeps {
  policy: Policy;
  jiraClient: JiraClient;
  jsmClient: JsmClient;
  confluenceClient: ConfluenceClient;
  /** `null` when the graph cannot be read (no scope, no session). */
  graphRunner: GraphRunner | null;
  /** Cloud id, needed to build the ARIs the graph expects. */
  cloudId: string | null;
  clock: Clock;
  logger: Logger;
}

/** `ari:cloud:jira:<cloudId>:<issueId>` — the identifier the graph accepts. */
export function issueAri(cloudId: string, issueId: string): string {
  return `ari:cloud:jira:${cloudId}:${issueId}`;
}

export class ComposedReleaseCollector implements ReleaseCollector {
  constructor(private readonly deps: CollectorDeps) {}

  async collect(
    projectId: string,
    versionId: string,
    viewerAccountId: string,
  ): Promise<CollectedRelease> {
    const policy = this.deps.policy;
    const jira = new JiraReleaseCollector({
      client: this.deps.jiraClient,
      policy,
      clock: this.deps.clock,
    });
    const base = await jira.collect(projectId, versionId, viewerAccountId);

    const services = impactedServiceIds(base.issues);
    const jsm = await new JsmIncidentCollector(this.deps.jsmClient).collect({
      projectKeys: policy.jsmProjectKeys,
      serviceIds: services,
    });
    const confluence = await new ConfluencePageCollector(this.deps.confluenceClient).collect(
      base.issues,
    );
    const graph = await this.collectGraph(base.issues, jsm.incidents, viewerAccountId);

    const issues = base.issues.map((issue) => this.withServices(issue, policy, graph));
    const incidents = jsm.incidents.map((incident) => this.withService(incident, policy));

    return {
      ...base,
      issues,
      incidents,
      pages: confluence.pages,
      graph,
      sources: mergeSources(base.sources, [
        jsm.status,
        confluence.status,
        graphStatus(graph),
      ]),
    };
  }

  /** Development information from the graph wins over the JQL fallback. */
  private withServices(
    issue: JiraIssue,
    policy: Policy,
    graph: GraphFacts | null,
  ): JiraIssue {
    const dev = graph?.devByIssueId[issue.subjectId] ?? issue.dev;
    const resolved = resolveServiceForIssue(issue, policy, graph);
    return {
      ...issue,
      dev,
      serviceId: resolved.serviceId,
      serviceName: resolved.serviceName ?? issue.serviceName,
    };
  }

  private withService(incident: Incident, policy: Policy): Incident {
    const serviceId = resolveServiceForIncident(incident, policy) ?? incident.serviceId;
    return { ...incident, serviceId };
  }

  /**
   * The graph is read as the human who opened the page. Without a cloud id
   * there is no ARI to query, and the app falls back to the JQL development
   * information (SPEC §14, repli documenté).
   */
  private async collectGraph(
    issues: JiraIssue[],
    incidents: Incident[],
    viewerAccountId: string,
  ): Promise<GraphFacts | null> {
    const runner = this.deps.graphRunner;
    const cloudId = this.deps.cloudId;
    if (!runner || !cloudId || !viewerAccountId || issues.length === 0) return null;
    const collector = new TeamworkGraphCollector(runner);
    try {
      return await collector.collect({
        viewerAccountId,
        now: this.deps.clock.now(),
        issues: issues.map((issue) => ({
          id: issue.subjectId,
          ari: issueAri(cloudId, issue.subjectId),
        })),
        incidents: incidents.map((incident) => ({
          id: incident.key,
          ari: issueAri(cloudId, incident.subjectId),
        })),
      });
    } catch (error) {
      this.deps.logger.log('warn', 'le Teamwork Graph est indisponible', {
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}

/** One status per source: the first one wins, the others are ignored. */
function mergeSources(base: SourceStatus[], extra: SourceStatus[]): SourceStatus[] {
  const merged = new Map<string, SourceStatus>();
  for (const status of [...base, ...extra]) {
    if (!merged.has(status.source)) merged.set(status.source, status);
  }
  return [...merged.values()];
}

/** The graph status is derived: absent means "not available", not "empty". */
function graphStatus(graph: GraphFacts | null): SourceStatus {
  if (graph) {
    return {
      source: 'teamwork-graph',
      state: 'ok',
      ...(graph.missingScopes.length > 0
        ? { detail: { key: 'evidence.restricted', params: { count: graph.missingScopes.length } } }
        : {}),
    };
  }
  return {
    source: 'teamwork-graph',
    state: 'unavailable',
    detail: { key: 'evidence.restricted', params: { count: 0 } },
  };
}

/** Builds the collector used by the runtime. */
export function createReleaseCollector(deps: CollectorDeps): ReleaseCollector {
  return new ComposedReleaseCollector(deps);
}
