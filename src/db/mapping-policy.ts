/**
 * Row mappings for the settings and cached-collection tables: `collection`,
 * `policy`, `service_map`.
 *
 * Split out of `mapping.ts` to keep every file under 500 lines (project rule).
 * `mapping.ts` re-exports everything, so callers keep a single import path.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */
import type { CollectedRelease, Policy, ServiceMapEntry, Severity, SignalCode } from '../types';
import { SEVERITY_ORDER } from '../types';
import { listSignalCodes } from '../signals/registry';
import type { CollectionRow, PolicyRow, ServiceMapRow } from './rows';
import {
  fromSqlTimestamp,
  isObject,
  jsonText,
  optionalText,
  parseJson,
  parseStringList,
  text,
  toSqlTimestamp,
} from './rows';

/* ------------------------------------------------------------ collection */

/** The collection cached with the dossier (SPEC §12), with its date. */
export function collectionToRow(
  versionId: string,
  release: CollectedRelease,
  collectedAt: string,
): CollectionRow {
  return {
    version_id: versionId,
    collected_at: toSqlTimestamp(collectedAt) ?? '',
    payload_json: JSON.stringify(release),
  };
}

/** Reads the cached collection back; a corrupt payload yields `null`. */
export function rowToCollection(row: CollectionRow): {
  collectedAt: string;
  release: CollectedRelease | null;
} {
  const parsed = parseJson<CollectedRelease | null>(row.payload_json, null);
  return {
    collectedAt: fromSqlTimestamp(row.collected_at) ?? '',
    release: parsed ?? null,
  };
}

/* ---------------------------------------------------------------- policy */

/** Everything of `Policy` except the service map, which has its own table. */
export interface PolicyRules {
  severityOverrides: Partial<Record<SignalCode, Severity>>;
  disabledSignals: SignalCode[];
  waiverApprovers: string[];
  jsmProjectKeys: string[];
  observationMode: boolean;
  defaultWaiverHours: number;
}

/** Documented fallback of a corrupted `rules_json`: a project with no setting. */
export const DEFAULT_POLICY_RULES: PolicyRules = {
  severityOverrides: {},
  disabledSignals: [],
  waiverApprovers: [],
  jsmProjectKeys: [],
  observationMode: false,
  defaultWaiverHours: 48,
};

function parseSeverityOverrides(raw: unknown): Partial<Record<SignalCode, Severity>> {
  const codes: readonly string[] = listSignalCodes();
  const overrides: Partial<Record<SignalCode, Severity>> = {};
  if (!isObject(raw)) return overrides;
  for (const [code, severity] of Object.entries(raw)) {
    if (!codes.includes(code) || typeof severity !== 'string') continue;
    if (!(SEVERITY_ORDER as readonly string[]).includes(severity)) continue;
    overrides[code as SignalCode] = severity as Severity;
  }
  return overrides;
}

function parseSignalCodeList(value: unknown): SignalCode[] {
  const codes: readonly string[] = listSignalCodes();
  return parseStringList(value).filter((code): code is SignalCode => codes.includes(code));
}

function parseRules(raw: unknown): PolicyRules {
  const parsed = parseJson<Record<string, unknown>>(raw, {}, isObject);
  return {
    severityOverrides: parseSeverityOverrides(parsed.severityOverrides),
    disabledSignals: parseSignalCodeList(parsed.disabledSignals),
    waiverApprovers: parseStringList(parsed.waiverApprovers),
    jsmProjectKeys: parseStringList(parsed.jsmProjectKeys),
    observationMode: parsed.observationMode === true,
    defaultWaiverHours:
      typeof parsed.defaultWaiverHours === 'number' &&
      Number.isFinite(parsed.defaultWaiverHours)
        ? parsed.defaultWaiverHours
        : DEFAULT_POLICY_RULES.defaultWaiverHours,
  };
}

export function policyToRow(policy: Policy): PolicyRow {
  const rules: PolicyRules = {
    severityOverrides: policy.severityOverrides,
    disabledSignals: policy.disabledSignals,
    waiverApprovers: policy.waiverApprovers,
    jsmProjectKeys: policy.jsmProjectKeys,
    observationMode: policy.observationMode,
    defaultWaiverHours: policy.defaultWaiverHours,
  };
  return { project_id: policy.projectId, rules_json: jsonText(rules) };
}

export function rowToPolicy(row: PolicyRow, serviceMap: ServiceMapEntry[] = []): Policy {
  const rules = parseRules(row.rules_json);
  return {
    projectId: text(row.project_id),
    severityOverrides: rules.severityOverrides,
    disabledSignals: rules.disabledSignals,
    waiverApprovers: rules.waiverApprovers,
    jsmProjectKeys: rules.jsmProjectKeys,
    serviceMap,
    observationMode: rules.observationMode,
    defaultWaiverHours: rules.defaultWaiverHours,
  };
}

/* ----------------------------------------------------------- service map */

export function serviceMapToRows(
  projectId: string,
  entries: readonly ServiceMapEntry[],
): ServiceMapRow[] {
  return entries.map((entry) => ({
    project_id: projectId,
    service_id: entry.serviceId,
    service_name: entry.serviceName,
    jira_component: entry.jiraComponent ?? null,
    compass_component_id: entry.compassComponentId ?? null,
    jsm_service: entry.jsmService ?? null,
  }));
}

export function rowsToServiceMap(rows: readonly ServiceMapRow[]): ServiceMapEntry[] {
  return rows.flatMap((row) => {
    const serviceId = text(row.service_id);
    if (serviceId.length === 0) return [];
    const entry: ServiceMapEntry = { serviceId, serviceName: text(row.service_name) };
    const jiraComponent = optionalText(row.jira_component);
    if (jiraComponent) entry.jiraComponent = jiraComponent;
    const compassComponentId = optionalText(row.compass_component_id);
    if (compassComponentId) entry.compassComponentId = compassComponentId;
    const jsmService = optionalText(row.jsm_service);
    if (jsmService) entry.jsmService = jsmService;
    return [entry];
  });
}
