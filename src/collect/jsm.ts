/**
 * JSM incident collection (SPEC §7 EXP-01/EXP-02, §6.4, §16).
 *
 * R5 (§2.4, §4.6) is blunt: there is **no** JSM "incidents" endpoint. A JSM
 * incident is a Jira issue of type Incident, so it is read with the Jira
 * search API (`POST /rest/api/3/search/jql`), and its "Affected services"
 * value is a custom field whose id is only discoverable at runtime
 * (`GET /rest/api/3/field`) — hence `JsmClientOptions.affectedServicesFieldId`.
 *
 * The collector itself is transport-agnostic: it consumes a `JsmClient`, so
 * every rule below (watched project, impacted service, state, bound) is
 * testable with `createFakeJsmClient` and no network.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */
import type { Incident, SourceStatus } from '../types';
import {
  asArray,
  asList,
  asRecord,
  asText,
  optionalText,
  collectPaged,
  readJson,
  sourceStatus,
  uniqueSorted,
  type ForgeRequest,
} from './paging';

/** Hard cap on retained incidents (SPEC §15, bounded collection). */
export const MAX_INCIDENTS = 200;

/** One incident as the client hands it over, already normalised. */
export interface JsmIncidentDto {
  id: string;
  key: string;
  summary: string;
  /** Project the incident belongs to: must be one of the watched JSM projects. */
  projectKey: string;
  state: Incident['state'];
  majorIncident: boolean;
  /** App service id resolved from "Affected services"; null when the field is empty. */
  serviceId: string | null;
  serviceName?: string;
  createdAt: string;
  resolvedAt?: string;
  url: string;
}

export interface JsmQuery {
  projectKeys: string[];
  /** App service ids the release touches; empty = no service filter. */
  serviceIds: string[];
  limit: number;
}

export interface JsmClient {
  listIncidents(query: JsmQuery): Promise<JsmIncidentDto[]>;
}

export interface JsmCollection {
  incidents: Incident[];
  status: SourceStatus;
}

export interface JsmCollectInput {
  /** `policy.jsmProjectKeys`: the JSM projects this project watches. */
  projectKeys: string[];
  /** Services the release touches (`impactedServices`). */
  serviceIds: string[];
}

function toIncident(dto: JsmIncidentDto): Incident {
  return {
    subjectType: 'incident',
    subjectId: dto.id,
    key: dto.key,
    summary: dto.summary,
    state: dto.state,
    majorIncident: dto.majorIncident,
    serviceId: dto.serviceId,
    serviceName: dto.serviceName,
    createdAt: dto.createdAt,
    resolvedAt: dto.resolvedAt,
    url: dto.url,
  };
}

/**
 * Keeps only the incidents that can matter for this release: a watched JSM
 * project, and a service the release touches. An incident **without** a known
 * service is kept with `serviceId: null` rather than dropped silently — the
 * EXP detectors ignore it (SPEC §16) and coverage can still report it.
 */
function relevantIncidents(
  dtos: JsmIncidentDto[],
  projectKeys: string[],
  serviceIds: string[],
): Incident[] {
  const watched = new Set(projectKeys);
  const touched = new Set(serviceIds);
  const seen = new Set<string>();
  const incidents: Incident[] = [];
  for (const dto of dtos) {
    if (incidents.length >= MAX_INCIDENTS) break;
    if (!watched.has(dto.projectKey) || seen.has(dto.id)) continue;
    if (dto.serviceId !== null && touched.size > 0 && !touched.has(dto.serviceId)) continue;
    seen.add(dto.id);
    incidents.push(toIncident(dto));
  }
  return incidents;
}

/**
 * Reads the incidents of the watched JSM projects that touch the impacted
 * services. Never throws: a failing source becomes `unavailable` with a
 * `detail`, which coverage surfaces instead of reading it as "no incident"
 * (SPEC §15).
 */
export class JsmIncidentCollector {
  constructor(private readonly client: JsmClient) {}

  async collect(input: JsmCollectInput): Promise<JsmCollection> {
    const projectKeys = uniqueSorted(input.projectKeys);
    if (projectKeys.length === 0) {
      // Nothing watched: the app cannot see JSM at all for this project.
      return { incidents: [], status: sourceStatus('jsm', 'empty') };
    }

    let dtos: JsmIncidentDto[];
    try {
      dtos = await this.client.listIncidents({
        projectKeys,
        serviceIds: uniqueSorted(input.serviceIds),
        limit: MAX_INCIDENTS,
      });
    } catch {
      return { incidents: [], status: sourceStatus('jsm', 'unavailable') };
    }

    const incidents = relevantIncidents(dtos, projectKeys, uniqueSorted(input.serviceIds));
    if (incidents.length === 0) {
      return { incidents, status: sourceStatus('jsm', 'empty') };
    }
    const saturated = dtos.length >= MAX_INCIDENTS;
    return { incidents, status: sourceStatus('jsm', saturated ? 'partial' : 'ok') };
  }
}

/* ------------------------------------------------- Jira search adapter */

export interface JsmClientOptions {
  /** Custom field id of "Affected services" (R5 §4.6: not documented, discover it). */
  affectedServicesFieldId?: string;
  /** Maps an "Affected services" value (Assets name or ARI) to an app service id. */
  resolveServiceId?: (raw: string) => string | null;
  /** JQL issue type name used by the site for incidents. */
  incidentIssueType?: string;
  pageSize?: number;
}

const DEFAULT_INCIDENT_TYPE = 'Incident';
const INCIDENT_PAGE_SIZE = 50;
const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;

interface JiraSearchIssue {
  id: string;
  key: string;
  self?: string;
  fields?: Record<string, unknown>;
}

interface JiraSearchResponse {
  issues?: JiraSearchIssue[];
  nextPageToken?: string;
}

/** JQL of the incidents of the watched projects, newest first. */
export function jsmIncidentJql(projectKeys: string[], issueType: string): string {
  const projects = projectKeys
    .filter((key) => PROJECT_KEY_PATTERN.test(key))
    .map((key) => `"${key}"`)
    .join(', ');
  return `project IN (${projects}) AND issuetype = "${issueType}" ORDER BY created DESC`;
}

/**
 * JSM workflow state, from the status name and its category. JSM sites name
 * the terminal states "Resolved" and "Closed"; both live in the done category.
 */
function incidentState(
  statusName: string,
  categoryKey: string,
): Incident['state'] {
  if (categoryKey !== 'done') return 'open';
  return /clos/i.test(statusName) ? 'closed' : 'resolved';
}

/** "Major incident" is not a documented field: priority or label carries it. */
function isMajorIncident(priorityName: string, labels: string[]): boolean {
  if (labels.some((label) => /^major/i.test(label))) return true;
  return priorityName === 'Highest' || priorityName === 'High';
}

/** Browse url derived from the issue `self` link: no site config needed. */
function browseUrl(self: string | undefined, key: string): string {
  if (!self) return '';
  return self.replace(/\/rest\/api\/3\/issue\/.*$/, `/browse/${key}`);
}

/** Raw "Affected services" values: Assets objects, strings, or nothing. */
function serviceValues(raw: unknown): string[] {
  return asList(raw)
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      const record = asRecord(entry);
      return optionalText(record.value) ?? optionalText(record.name) ?? optionalText(record.id) ?? '';
    })
    .filter((value) => value.length > 0);
}

/** App service ids of one incident, through the injected resolver. */
function resolveServices(
  raw: unknown,
  resolve: (value: string) => string | null,
): string[] {
  const ids = serviceValues(raw).map(resolve).filter((id): id is string => Boolean(id));
  return [...new Set(ids)];
}

function dtoFromIssue(
  issue: JiraSearchIssue,
  options: JsmClientOptions,
): JsmIncidentDto {
  const fields = asRecord(issue.fields);
  const status = asRecord(fields.status);
  const category = asRecord(status.statusCategory);
  const priority = asRecord(fields.priority);
  const labels = asArray(fields.labels).map(String);
  const rawServices = options.affectedServicesFieldId
    ? fields[options.affectedServicesFieldId]
    : undefined;
  const resolve = options.resolveServiceId ?? ((value: string) => value);
  const [serviceId = null] = resolveServices(rawServices, resolve);
  const serviceName = serviceValues(rawServices)[0];

  return {
    id: issue.id,
    key: issue.key,
    summary: asText(fields.summary, issue.key),
    projectKey: issue.key.split('-')[0],
    state: incidentState(asText(status.name), asText(category.key)),
    majorIncident: isMajorIncident(asText(priority.name), labels),
    serviceId,
    serviceName,
    createdAt: asText(fields.created),
    resolvedAt: optionalText(fields.resolutiondate),
    url: browseUrl(issue.self, issue.key),
  };
}

/**
 * Discovers the custom field id of "Affected services" (R5 §4.6.2: the name is
 * documented, the id is not). Returns undefined when the field is not there —
 * the incidents then keep `serviceId: null` and coverage reports them, instead
 * of the collector inventing an attribution.
 */
export async function discoverAffectedServicesField(
  requestJira: ForgeRequest,
): Promise<string | undefined> {
  const path = '/rest/api/3/field';
  try {
    const response = await requestJira(path, { headers: { Accept: 'application/json' } });
    const fields = await readJson<unknown>(response, path);
    const match = asArray(fields)
      .map((field) => asRecord(field))
      .find((field) => /affected services/i.test(asText(field.name)));
    return match ? optionalText(match.id) ?? optionalText(match.key) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Real client: Jira search API as the app (R5 §4.6, path 1) — there is no JSM
 * "incidents" endpoint (R5 §2.4). Incidents are filtered on the impacted
 * services here, on the resolved app service ids.
 */
export function createJsmClient(
  requestJira: ForgeRequest,
  options: JsmClientOptions = {},
): JsmClient {
  const issueType = options.incidentIssueType ?? DEFAULT_INCIDENT_TYPE;
  const pageSize = options.pageSize ?? INCIDENT_PAGE_SIZE;
  const fields = ['summary', 'status', 'created', 'resolutiondate', 'priority', 'labels'];
  if (options.affectedServicesFieldId) fields.push(options.affectedServicesFieldId);

  return {
    async listIncidents(query: JsmQuery): Promise<JsmIncidentDto[]> {
      const path = '/rest/api/3/search/jql';
      const jql = jsmIncidentJql(query.projectKeys, issueType);
      const touched = new Set(query.serviceIds);
      const paged = await collectPaged<JiraSearchIssue>({
        limit: query.limit,
        fetchPage: async (token) => {
          const body: Record<string, unknown> = { jql, fields, maxResults: pageSize };
          if (token) body.nextPageToken = token;
          const response = await requestJira(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(body),
          });
          const json = await readJson<JiraSearchResponse>(response, path);
          return { items: json.issues ?? [], nextToken: json.nextPageToken };
        },
      });

      return paged.items
        .map((issue) => dtoFromIssue(issue, options))
        .filter((dto) => touched.size === 0 || dto.serviceId === null || touched.has(dto.serviceId));
    },
  };
}

/** Test double: serves the given incidents, or throws when given an Error. */
export function createFakeJsmClient(
  incidents: JsmIncidentDto[] | Error,
): JsmClient {
  return {
    async listIncidents(query: JsmQuery): Promise<JsmIncidentDto[]> {
      if (incidents instanceof Error) throw incidents;
      return incidents.slice(0, query.limit);
    },
  };
}

/** Builds one incident DTO for the fake, with a healthy default. */
export function jsmIncidentDto(
  key: string,
  partial: Partial<JsmIncidentDto> = {},
): JsmIncidentDto {
  return {
    id: partial.id ?? `id-${key.toLowerCase()}`,
    key,
    summary: partial.summary ?? `${key} summary`,
    projectKey: partial.projectKey ?? key.split('-')[0],
    state: partial.state ?? 'open',
    majorIncident: partial.majorIncident ?? false,
    serviceId: partial.serviceId !== undefined ? partial.serviceId : 'svc-checkout-api',
    serviceName: partial.serviceName ?? 'checkout-api',
    createdAt: partial.createdAt ?? '2026-11-10T08:00:00.000Z',
    resolvedAt: partial.resolvedAt,
    url: partial.url ?? `https://pay.atlassian.net/browse/${key}`,
  };
}
