/**
 * Ticket → service resolution, and the incident variant (SPEC §7).
 *
 * Everything on the operations side (EXP-01/02, DEP-03, HIST-01, coverage)
 * hangs off this mapping, so it has to be one implementation, not three.
 * The SPEC gives three sources, in this order:
 *
 *   1. the Teamwork Graph relation "Jira work item impacts Compass component"
 *      — the ticket's Compass components, matched on `compassComponentId`;
 *   2. the "affected services" field, then the Jira component field;
 *   3. the app mapping table (`serviceMap[].jiraComponent`).
 *
 * A ticket with no known service is *not* dropped silently: it keeps
 * `serviceId: null` and lowers coverage (SPEC §7, §15). The Jira-side matching
 * is delegated to `resolveServiceId` from the DEP family so the order lives in
 * one place instead of being recopied here.
 *
 * Pure module: no Forge import, no I/O, no clock.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */
import type { GraphFacts, Incident, JiraIssue, Policy, ServiceMapEntry } from '../types.js';
import { resolveServiceId } from '../signals/dep.js';

export interface ResolvedService {
  /** `null` when no source knows the service; coverage reports it. */
  serviceId: string | null;
  serviceName?: string;
}

/** Compass components the graph attached to this ticket (source 1). */
function compassServiceId(
  issue: JiraIssue,
  policy: Policy,
  graph: GraphFacts | null,
): string | null {
  const components = graph?.componentsByIssueId[issue.subjectId] ?? [];
  if (components.length === 0) return null;
  const entry = policy.serviceMap.find(
    (candidate) =>
      candidate.compassComponentId !== undefined &&
      components.includes(candidate.compassComponentId),
  );
  return entry?.serviceId ?? null;
}

/** Service-map entry for a resolved id, if the operator declared one. */
export function serviceEntryFor(
  policy: Policy,
  serviceId: string,
): ServiceMapEntry | undefined {
  return policy.serviceMap.find((entry) => entry.serviceId === serviceId);
}

/**
 * Resolves the service a release ticket touches (SPEC §7, three sources in
 * order). Returns the operator's service name when the mapping table knows it.
 */
export function resolveServiceForIssue(
  issue: JiraIssue,
  policy: Policy,
  graph: GraphFacts | null,
): ResolvedService {
  const serviceId = compassServiceId(issue, policy, graph) ?? resolveServiceId(issue, policy, graph);
  if (!serviceId) return { serviceId: null };
  const name = serviceEntryFor(policy, serviceId)?.serviceName;
  return name === undefined ? { serviceId } : { serviceId, serviceName: name };
}

/** Services the release touches: deduplicated, stable order, no `null`. */
export function impactedServiceIds(issues: JiraIssue[]): string[] {
  const ids = new Set<string>();
  for (const issue of issues) {
    if (issue.serviceId) ids.add(issue.serviceId);
  }
  return [...ids].sort();
}

/**
 * Service of a JSM incident. The "affected services" field is an Assets custom
 * field whose id is undocumented (R5 §4.6.2): the collector fills
 * `incident.serviceId` when it can read it, and this falls back to a name match
 * on the mapping table. Neither known → `null`, and the incident is reported in
 * the coverage instead of being attributed to a service by guesswork (SPEC §16).
 */
export function resolveServiceForIncident(
  incident: Incident,
  policy: Policy,
): string | null {
  if (incident.serviceId) return incident.serviceId;
  const name = incident.serviceName;
  if (!name) return null;
  const entry = policy.serviceMap.find(
    (candidate) => candidate.serviceName === name || candidate.jsmService === name,
  );
  return entry?.serviceId ?? null;
}
