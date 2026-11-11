import { afterEach, describe, expect, it } from 'vitest';
import { defaultPolicyOverrides, SITE_CONFIG } from '../src/config';
import { resolvePolicy } from '../src/engine/pipeline';
import { InMemoryReleaseStore } from './engine/fakes';

/**
 * Environment-supplied policy: what lets a fresh installation resolve services
 * (and raise EXP/DEP-03) before anyone opens the settings screen.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

const ORIGINAL = process.env.RI_DEFAULT_POLICY_JSON;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.RI_DEFAULT_POLICY_JSON;
  else process.env.RI_DEFAULT_POLICY_JSON = ORIGINAL;
});

describe('defaultPolicyOverrides', () => {
  it('returns nothing when the variable is absent', () => {
    delete process.env.RI_DEFAULT_POLICY_JSON;
    expect(defaultPolicyOverrides()).toEqual({});
  });

  it('reads a service map and the watched JSM projects', () => {
    process.env.RI_DEFAULT_POLICY_JSON = JSON.stringify({
      serviceMap: [{ serviceId: 'svc-checkout-api', serviceName: 'checkout-api', jiraComponent: 'checkout-api' }],
      jsmProjectKeys: ['ITO'],
      waiverApprovers: ['user-1'],
    });
    const overrides = defaultPolicyOverrides();
    expect(overrides.serviceMap).toHaveLength(1);
    expect(overrides.jsmProjectKeys).toEqual(['ITO']);
    expect(overrides.waiverApprovers).toEqual(['user-1']);
  });

  it('ignores a malformed value instead of half-applying it', () => {
    process.env.RI_DEFAULT_POLICY_JSON = '{serviceMap: [oops';
    expect(defaultPolicyOverrides()).toEqual({});
    process.env.RI_DEFAULT_POLICY_JSON = '[1,2,3]';
    expect(defaultPolicyOverrides()).toEqual({});
    process.env.RI_DEFAULT_POLICY_JSON = '   ';
    expect(defaultPolicyOverrides()).toEqual({});
  });
});

describe('resolvePolicy', () => {
  it('prefers the saved policy over the environment default', async () => {
    process.env.RI_DEFAULT_POLICY_JSON = JSON.stringify({ jsmProjectKeys: ['FROM-ENV'] });
    const store = new InMemoryReleaseStore();
    await store.savePolicy({
      projectId: 'proj-pay',
      severityOverrides: {},
      disabledSignals: [],
      waiverApprovers: [],
      jsmProjectKeys: ['FROM-STORE'],
      serviceMap: [],
      observationMode: false,
      defaultWaiverHours: 48,
    });

    const policy = await resolvePolicy(store, 'proj-pay');
    expect(policy.jsmProjectKeys).toEqual(['FROM-STORE']);
  });

  it('falls back to the environment default when nothing is saved', async () => {
    process.env.RI_DEFAULT_POLICY_JSON = JSON.stringify({ jsmProjectKeys: ['ITO'] });
    const store = new InMemoryReleaseStore();

    const policy = await resolvePolicy(store, 'proj-pay');
    expect(policy.projectId).toBe('proj-pay');
    expect(policy.jsmProjectKeys).toEqual(['ITO']);
    expect(policy.defaultWaiverHours).toBe(48);
  });
});

describe('SITE_CONFIG', () => {
  it('defaults to the demo site fields and stays overridable', () => {
    expect(SITE_CONFIG.affectedServicesFieldId).toBe('customfield_10039');
    expect(SITE_CONFIG.incidentIssueType).toBe('[System] Incident');
  });
});
