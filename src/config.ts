/**
 * Site configuration: the few values that differ between Jira sites.
 *
 * Everything is overridable with a Forge environment variable (`forge
 * variables set KEY=value`), and falls back to the values discovered on the
 * Forge demo development site (SPEC §14, "points à valider par un prototype"):
 *
 *   customfield_10039  "Affected services" (service-entity custom field)
 *   [System] Incident  the JSM incident issue type on that site
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

/** Reads a Forge environment variable, trimmed, or the documented default. */
function env(name: string, fallback: string): string {
  const raw = process.env[name];
  const value = typeof raw === 'string' ? raw.trim() : '';
  return value.length > 0 ? value : fallback;
}

export interface SiteConfig {
  /** Custom field holding the services an issue affects. */
  affectedServicesFieldId: string;
  /** Issue type name the site uses for JSM incidents. */
  incidentIssueType: string;
  /** Custom field holding the Atlassian team of an issue, when present. */
  teamFieldId: string;
}

export const SITE_CONFIG: SiteConfig = {
  affectedServicesFieldId: env('RI_AFFECTED_SERVICES_FIELD', 'customfield_10039'),
  incidentIssueType: env('RI_INCIDENT_ISSUE_TYPE', '[System] Incident'),
  teamFieldId: env('RI_TEAM_FIELD', 'customfield_10001'),
};
