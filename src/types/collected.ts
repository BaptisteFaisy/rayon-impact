/**
 * Collected data types: what the app reads from Jira, Jira Service Management,
 * Confluence and the Teamwork Graph for one release.
 *
 * Pure TypeScript, no import (except the core domain types), so the whole
 * collection layer can be faked in tests.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */
import type { SourceStatus, SubjectRef } from './core';

/* ------------------------------------------------------------------ Jira */

export type IssueStatusCategory = 'to-do' | 'in-progress' | 'done';

export interface DevSummary {
  /** False when no source could answer: the code signals stay silent. */
  known: boolean;
  commits: number;
  openPullRequests: number;
  mergedPullRequests: number;
  mergedWithoutApproval: number;
  failingBuilds: number;
  lastBuildState?: 'success' | 'failing' | 'unknown';
}

export interface IssueLinkRef {
  id: string;
  /** Jira link type name, e.g. "Blocks", "Depends on". */
  type: string;
  /** True when this issue is the inward side of the link. */
  inward: boolean;
  targetKey: string;
  targetId: string;
  targetProjectKey: string;
  targetStatusCategory?: IssueStatusCategory;
  targetFixVersions?: string[];
}

export interface RemoteLink {
  id: string;
  url: string;
  title: string;
  kind: 'confluence' | 'other';
}

export interface JiraIssue extends SubjectRef {
  subjectType: 'issue';
  subjectId: string;
  key: string;
  summary: string;
  statusName: string;
  statusCategory: IssueStatusCategory;
  issueType: string;
  projectKey: string;
  assigneeAccountId?: string;
  /** Jira components, one of the three service-mapping sources (SPEC §7). */
  components: string[];
  /** Values of the "affected services" custom field, when configured. */
  affectedServices: string[];
  fixVersions: string[];
  /** From the changelog: when the issue joined this version (COMP-04). */
  addedToVersionAt?: string;
  /** From the changelog: reopened at least once during the cycle (QUAL-03). */
  reopenedDuringCycle: boolean;
  links: IssueLinkRef[];
  remoteLinks: RemoteLink[];
  dev: DevSummary;
  /** Resolved service, or null when unknown — lowers coverage (SPEC §7). */
  serviceId: string | null;
  serviceName?: string;
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
  /** Team-managed projects may not have the Versions feature (SPEC §16). */
  versionsEnabled: boolean;
}

export interface JiraVersion {
  id: string;
  name: string;
  projectId: string;
  released: boolean;
  archived: boolean;
  releaseDate?: string;
  startDate?: string;
}

export interface Incident extends SubjectRef {
  subjectType: 'incident';
  subjectId: string;
  key: string;
  summary: string;
  state: 'open' | 'resolved' | 'closed';
  majorIncident: boolean;
  serviceId: string | null;
  serviceName?: string;
  createdAt: string;
  resolvedAt?: string;
  url: string;
}

export interface ConfluencePage extends SubjectRef {
  subjectType: 'page';
  subjectId: string;
  title: string;
  url: string;
  spaceKey?: string;
  lastModified: string;
}

export interface Team {
  id: string;
  name: string;
  componentIds: string[];
}

/**
 * Teamwork Graph facts. Only readable as a user, so the whole block is cached
 * in the dossier with its timestamp and may be null (SPEC §12).
 */
export interface GraphFacts {
  fetchedAt: string;
  fetchedByAccountId: string;
  devByIssueId: Record<string, DevSummary>;
  servicesByIssueId: Record<string, string | null>;
  teamsByIssueId: Record<string, Team[]>;
  componentsByIssueId: Record<string, string[]>;
  servicesByIncidentId: Record<string, string | null>;
  /** Graph scopes silently omit objects when missing (SPEC §14). */
  missingScopes: string[];
}

export interface FreezeWindow {
  id: string;
  /** Operator-entered label (settings screen): user data, never translated. */
  name: string;
  /** Inclusive bounds, ISO 8601 dates. */
  from: string;
  to: string;
  /** `all` = every service; otherwise the listed service ids. */
  scope: 'all' | 'services';
  serviceIds?: string[];
}

/** Everything a detector may look at for one release. */
export interface CollectedRelease {
  project: JiraProject;
  version: JiraVersion;
  issues: JiraIssue[];
  /** Issues outside the release that link to one of its issues (DEP-01/02). */
  linkedOutsideIssues: JiraIssue[];
  incidents: Incident[];
  pages: ConfluencePage[];
  teams: Team[];
  graph: GraphFacts | null;
  /** Other versions shipping the same day, for EXP-04. */
  siblingVersions: JiraVersion[];
  issuesOfSiblingVersions: Record<string, JiraIssue[]>;
  freezeWindows: FreezeWindow[];
  /** Start of the release cycle: the reference for DOC-01 staleness. */
  cycleStartedAt?: string;
  collectedAt: string;
  sources: SourceStatus[];
}
