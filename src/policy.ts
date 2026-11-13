/**
 * The policy of a project: what the operator tunes (SPEC §11, RI-11).
 *
 * One implementation, two consumers: the engine (which applies the policy when
 * it computes a dossier) and the settings screen (which edits it). They used to
 * build the neutral policy separately, which let the two drift.
 *
 * No Forge import: this module is pure and testable outside a runtime.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */
import type { Policy } from './types';

/** The neutral policy of a project: nothing overridden, nothing disabled. */
export function basePolicy(projectId: string): Policy {
  return {
    projectId,
    severityOverrides: {},
    disabledSignals: [],
    waiverApprovers: [],
    jsmProjectKeys: [],
    serviceMap: [],
    observationMode: false,
    defaultWaiverHours: 48,
  };
}

/**
 * Completes a partial policy with the neutral values.
 *
 * Why: a policy read back from an older schema (or a bridge answer truncated to
 * an empty object) must never reach a screen as a half-object — a missing
 * `severityOverrides` made the settings screen crash on `COMP-01` and left the
 * module blank (2026-11-13).
 */
export function withPolicyDefaults(policy: Partial<Policy> | null, projectId: string): Policy {
  const base = basePolicy(projectId);
  if (!policy || typeof policy !== 'object') return base;
  return {
    ...base,
    ...policy,
    projectId: typeof policy.projectId === 'string' && policy.projectId ? policy.projectId : projectId,
    severityOverrides: policy.severityOverrides ?? base.severityOverrides,
    disabledSignals: policy.disabledSignals ?? base.disabledSignals,
    waiverApprovers: policy.waiverApprovers ?? base.waiverApprovers,
    jsmProjectKeys: policy.jsmProjectKeys ?? base.jsmProjectKeys,
    serviceMap: policy.serviceMap ?? base.serviceMap,
    observationMode: policy.observationMode ?? base.observationMode,
    defaultWaiverHours: policy.defaultWaiverHours ?? base.defaultWaiverHours,
  };
}