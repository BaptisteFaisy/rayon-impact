import { describe, expect, it } from 'vitest';
import {
  impactedServiceIds,
  resolveServiceForIncident,
  resolveServiceForIssue,
} from '../../src/collect/services';
import { graphFacts, incident, issue } from '../fixtures/builders';
import { paiementsIssues, paiementsPolicy } from '../fixtures/paiements';

/**
 * SPEC §7 — "Rattacher un ticket à un service": the three sources, in order.
 * All fixtures come from the builders and the canonical Paiements dataset.
 */

const policy = paiementsPolicy();

/** A ticket the app knows nothing about yet: no component, no service. */
function blankIssue(key: string) {
  return issue(key, { components: [], affectedServices: [], serviceId: null });
}

describe('resolveServiceForIssue — source 1: Teamwork Graph', () => {
  it('maps the ticket Compass component through the service map', () => {
    const target = blankIssue('PAY-901');
    const graph = graphFacts({
      componentsByIssueId: { [target.subjectId]: ['cmp-checkout'] },
    });

    expect(resolveServiceForIssue(target, policy, graph)).toEqual({
      serviceId: 'svc-checkout-api',
      serviceName: 'checkout-api',
    });
  });

  it('wins over the Jira component when both are present', () => {
    const target = issue('PAY-902', { components: ['checkout-api'], serviceId: null });
    const graph = graphFacts({
      componentsByIssueId: { [target.subjectId]: ['cmp-mobile'] },
    });

    expect(resolveServiceForIssue(target, policy, graph).serviceId).toBe('svc-mobile-app');
  });

  it('keeps a graph service id the mapping table does not know', () => {
    const target = blankIssue('PAY-903');
    const graph = graphFacts({
      servicesByIssueId: { [target.subjectId]: 'svc-unknown' },
    });

    expect(resolveServiceForIssue(target, policy, graph)).toEqual({
      serviceId: 'svc-unknown',
    });
  });
});

describe('resolveServiceForIssue — sources 2 and 3', () => {
  it('uses the "affected services" field before the Jira component', () => {
    const target = issue('PAY-904', {
      components: ['mobile-app'],
      affectedServices: ['checkout-api'],
      serviceId: null,
    });

    expect(resolveServiceForIssue(target, policy, null)).toEqual({
      serviceId: 'svc-checkout-api',
      serviceName: 'checkout-api',
    });
  });

  it('falls back to the Jira component mapping table', () => {
    const target = issue('PAY-905', { components: ['mobile-app'], serviceId: null });

    expect(resolveServiceForIssue(target, policy, null)).toEqual({
      serviceId: 'svc-mobile-app',
      serviceName: 'mobile-app',
    });
  });

  it('returns null for a ticket no source can place, never a guess', () => {
    expect(resolveServiceForIssue(blankIssue('PAY-906'), policy, null)).toEqual({
      serviceId: null,
    });
  });

  it('returns null for a ticket no source can place even with the graph', () => {
    const target = blankIssue('PAY-907');
    const graph = graphFacts({ componentsByIssueId: { [target.subjectId]: ['cmp-unmapped'] } });

    expect(resolveServiceForIssue(target, policy, graph).serviceId).toBeNull();
  });
});

describe('impactedServiceIds', () => {
  it('deduplicates, sorts and drops unknown tickets', () => {
    const issues = [
      issue('PAY-910', { components: ['checkout-api'] }),
      issue('PAY-911', { components: ['mobile-app'], serviceId: 'svc-mobile-app' }),
      blankIssue('PAY-912'),
      issue('PAY-913', { components: ['checkout-api'] }),
    ];

    expect(impactedServiceIds(issues)).toEqual(['svc-checkout-api', 'svc-mobile-app']);
  });

  it('is empty when no ticket has a known service', () => {
    expect(impactedServiceIds([blankIssue('PAY-914')])).toEqual([]);
  });

  it('covers the canonical Paiements release', () => {
    expect(impactedServiceIds(paiementsIssues())).toEqual(['svc-checkout-api']);
  });
});

describe('resolveServiceForIncident', () => {
  it('keeps the service the collector already resolved', () => {
    expect(resolveServiceForIncident(incident('INC-52'), policy)).toBe('svc-checkout-api');
  });

  it('maps an incident by its service name (Assets field unreadable)', () => {
    const orphan = incident('INC-60', { serviceId: null, serviceName: 'mobile-app' });

    expect(resolveServiceForIncident(orphan, policy)).toBe('svc-mobile-app');
  });

  it('returns null for an incident with no service at all (SPEC §16)', () => {
    const orphan = incident('INC-61', { serviceId: null, serviceName: '' });

    expect(resolveServiceForIncident(orphan, policy)).toBeNull();
  });
});
