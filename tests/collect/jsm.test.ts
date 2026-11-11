import { describe, expect, it } from 'vitest';
import {
  JsmIncidentCollector,
  MAX_INCIDENTS,
  createFakeJsmClient,
  createJsmClient,
  discoverAffectedServicesField,
  jsmIncidentDto,
  jsmIncidentJql,
} from '../../src/collect/jsm.js';
import type { JsmCollectInput } from '../../src/collect/jsm.js';
import type { ForgeRequest, ForgeResponseLike } from '../../src/collect/paging.js';

/**
 * JSM incident collection (SPEC §7 EXP-01/EXP-02, §16, R5 §2.4/§4.6).
 *
 * No network: every case drives `createFakeJsmClient`, so what is asserted is
 * the collector's contract — which incidents survive, with which state, and
 * how a dead source is reported.
 */

const CHECKOUT = 'svc-checkout-api';
const MOBILE = 'svc-mobile-app';

function input(partial: Partial<JsmCollectInput> = {}): JsmCollectInput {
  return {
    projectKeys: ['INC'],
    serviceIds: [CHECKOUT],
    ...partial,
  };
}

describe('JsmIncidentCollector', () => {
  it('keeps an open incident and a resolved one, with state and resolvedAt', async () => {
    const collector = new JsmIncidentCollector(
      createFakeJsmClient([
        jsmIncidentDto('INC-52', { state: 'open', majorIncident: true }),
        jsmIncidentDto('INC-48', {
          state: 'resolved',
          resolvedAt: '2026-11-08T08:00:00.000Z',
          createdAt: '2026-11-07T08:00:00.000Z',
        }),
      ]),
    );

    const { incidents, status } = await collector.collect(input());

    expect(status).toEqual({ source: 'jsm', state: 'ok' });
    expect(incidents.map((incident) => incident.key)).toEqual(['INC-52', 'INC-48']);
    expect(incidents[0]).toMatchObject({
      subjectType: 'incident',
      subjectId: 'id-inc-52',
      state: 'open',
      majorIncident: true,
      serviceId: CHECKOUT,
      url: 'https://pay.atlassian.net/browse/INC-52',
    });
    expect(incidents[1]).toMatchObject({
      state: 'resolved',
      resolvedAt: '2026-11-08T08:00:00.000Z',
      majorIncident: false,
    });
  });

  it('keeps an incident without a service, with a null serviceId (SPEC §16)', async () => {
    const collector = new JsmIncidentCollector(
      createFakeJsmClient([jsmIncidentDto('INC-60', { serviceId: null, serviceName: undefined })]),
    );

    const { incidents, status } = await collector.collect(input());

    expect(status.state).toBe('ok');
    expect(incidents).toHaveLength(1);
    expect(incidents[0].serviceId).toBeNull();
    expect(incidents[0].key).toBe('INC-60');
  });

  it('drops an incident from a JSM project the policy does not watch', async () => {
    const collector = new JsmIncidentCollector(
      createFakeJsmClient([
        jsmIncidentDto('INC-52'),
        jsmIncidentDto('OPS-9', { projectKey: 'OPS' }),
      ]),
    );

    const { incidents } = await collector.collect(input());

    expect(incidents.map((incident) => incident.key)).toEqual(['INC-52']);
  });

  it('drops an incident on a service the release does not touch', async () => {
    const collector = new JsmIncidentCollector(
      createFakeJsmClient([
        jsmIncidentDto('INC-52'),
        jsmIncidentDto('INC-53', { serviceId: MOBILE, serviceName: 'mobile-app' }),
      ]),
    );

    const { incidents } = await collector.collect(input());

    expect(incidents.map((incident) => incident.key)).toEqual(['INC-52']);
  });

  it('reports an unavailable source with a detail instead of "no incident"', async () => {
    const collector = new JsmIncidentCollector(
      createFakeJsmClient(new Error('502 Bad Gateway')),
    );

    const { incidents, status } = await collector.collect(input());

    expect(incidents).toEqual([]);
    expect(status).toEqual({
      source: 'jsm',
      state: 'unavailable',
      detail: { key: 'coverage.source.unavailable', params: { source: 'jsm' } },
    });
  });

  it('reports empty when no JSM project is watched', async () => {
    const collector = new JsmIncidentCollector(createFakeJsmClient([jsmIncidentDto('INC-52')]));

    const { incidents, status } = await collector.collect(input({ projectKeys: [] }));

    expect(incidents).toEqual([]);
    expect(status.state).toBe('empty');
  });

  it('reports empty when the watched projects hold no incident', async () => {
    const collector = new JsmIncidentCollector(createFakeJsmClient([]));

    const { status } = await collector.collect(input());

    expect(status.state).toBe('empty');
  });

  it('bounds the collection to MAX_INCIDENTS and says the source is partial', async () => {
    const many = Array.from({ length: MAX_INCIDENTS }, (_, index) =>
      jsmIncidentDto(`INC-${1000 + index}`),
    );
    const collector = new JsmIncidentCollector(createFakeJsmClient(many));

    const { incidents, status } = await collector.collect(input());

    expect(incidents).toHaveLength(MAX_INCIDENTS);
    expect(status.state).toBe('partial');
  });

  it('deduplicates an incident returned twice by the client', async () => {
    const collector = new JsmIncidentCollector(
      createFakeJsmClient([jsmIncidentDto('INC-52'), jsmIncidentDto('INC-52')]),
    );

    const { incidents } = await collector.collect(input());

    expect(incidents).toHaveLength(1);
  });
});

describe('jsmIncidentJql', () => {
  it('quotes the watched projects and filters on the incident issue type', () => {
    expect(jsmIncidentJql(['INC', 'OPS'], 'Incident')).toBe(
      'project IN ("INC", "OPS") AND issuetype = "Incident" ORDER BY created DESC',
    );
  });

  it('drops a project key that cannot be injected into JQL', () => {
    expect(jsmIncidentJql(['INC', 'bad"key'], 'Incident')).toBe(
      'project IN ("INC") AND issuetype = "Incident" ORDER BY created DESC',
    );
  });
});

/* ------------------------------------------- real client, stubbed transport */

/** A transport that answers with the queued bodies, in order. */
function stubTransport(bodies: unknown[], ok = true): ForgeRequest {
  let call = 0;
  return async (): Promise<ForgeResponseLike> => {
    const body = bodies[Math.min(call, bodies.length - 1)];
    call += 1;
    return { ok, status: ok ? 200 : 500, json: async () => body };
  };
}

/** One issue of `/rest/api/3/search/jql`: the envelope, plus its fields. */
function jiraIncident(
  overrides: Record<string, unknown> = {},
  fieldOverrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: '20001',
    key: 'INC-52',
    self: 'https://pay.atlassian.net/rest/api/3/issue/20001',
    ...overrides,
    fields: {
      summary: 'Checkout latency',
      status: { name: 'Investigating', statusCategory: { key: 'indeterminate' } },
      created: '2026-11-10T08:00:00.000Z',
      priority: { name: 'High' },
      labels: [],
      ...fieldOverrides,
    },
  };
}

describe('discoverAffectedServicesField', () => {
  it('finds the "Affected services" custom field id (R5 §4.6.2)', async () => {
    const request = stubTransport([
      [
        { id: 'summary', name: 'Summary' },
        { id: 'customfield_10100', name: 'Affected services' },
      ],
    ]);

    expect(await discoverAffectedServicesField(request)).toBe('customfield_10100');
  });

  it('returns undefined when the field is absent or the call fails', async () => {
    expect(await discoverAffectedServicesField(stubTransport([[{ id: 'summary', name: 'Summary' }]])))
      .toBeUndefined();
    expect(await discoverAffectedServicesField(stubTransport([{}], false))).toBeUndefined();
  });
});

describe('createJsmClient (Jira search adapter)', () => {
  it('maps an issue to an incident: state, major flag, service and url', async () => {
    const client = createJsmClient(
      stubTransport([
        {
          issues: [
            jiraIncident(),
            jiraIncident(
              { id: '20002', key: 'INC-48', self: 'https://pay.atlassian.net/rest/api/3/issue/20002' },
              {
                summary: 'Refund lag',
                status: { name: 'Resolved', statusCategory: { key: 'done' } },
                created: '2026-11-07T08:00:00.000Z',
                resolutiondate: '2026-11-08T08:00:00.000Z',
                priority: { name: 'Medium' },
                labels: ['major-incident'],
                customfield_10100: [{ value: 'checkout-api' }],
              },
            ),
          ],
        },
      ]),
      { affectedServicesFieldId: 'customfield_10100' },
    );

    const incidents = await client.listIncidents({
      projectKeys: ['INC'],
      serviceIds: ['checkout-api'],
      limit: MAX_INCIDENTS,
    });

    expect(incidents).toHaveLength(2);
    expect(incidents[0]).toMatchObject({
      key: 'INC-52',
      state: 'open',
      majorIncident: true,
      serviceId: null,
      url: 'https://pay.atlassian.net/browse/INC-52',
    });
    expect(incidents[1]).toMatchObject({
      state: 'resolved',
      resolvedAt: '2026-11-08T08:00:00.000Z',
      majorIncident: true,
      serviceId: 'checkout-api',
      serviceName: 'checkout-api',
    });
  });

  it('follows the page cursor and stops at the requested limit', async () => {
    const client = createJsmClient(
      stubTransport([
        { issues: [jiraIncident()], nextPageToken: 'page-2' },
        { issues: [jiraIncident({ id: '20003', key: 'INC-53' })] },
      ]),
    );

    const incidents = await client.listIncidents({
      projectKeys: ['INC'],
      serviceIds: [],
      limit: MAX_INCIDENTS,
    });

    expect(incidents.map((incident) => incident.key)).toEqual(['INC-52', 'INC-53']);
  });

  it('turns a non-2xx answer into a failing client (the collector reports it)', async () => {
    const client = createJsmClient(stubTransport([{ issues: [] }], false));

    await expect(
      client.listIncidents({ projectKeys: ['INC'], serviceIds: [], limit: MAX_INCIDENTS }),
    ).rejects.toThrow(/HTTP 500/);
  });
});
