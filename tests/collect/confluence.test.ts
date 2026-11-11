import { describe, expect, it } from 'vitest';
import {
  ConfluencePageCollector,
  MAX_PAGES,
  confluencePageDto,
  confluencePageId,
  createConfluenceClient,
  createFakeConfluenceClient,
  linkedConfluencePageIds,
} from '../../src/collect/confluence';
import { CollectRequestError, type ForgeRequest, type ForgeResponseLike } from '../../src/collect/paging';
import { issue } from '../fixtures/builders';
import type { RemoteLink } from '../../src/types';

/**
 * Confluence page collection (SPEC §7 DOC-01, R5 §4.5).
 *
 * The tickets are built with the shared `issue()` fixture, and the pages with
 * the DTO builder that ships next to the fake client: no literal duplication,
 * no network.
 */

function link(url: string, kind: RemoteLink['kind'] = 'confluence'): RemoteLink {
  return { id: `rl-${url}`, url, title: 'linked', kind };
}

const PAGE_9001 = 'https://pay.atlassian.net/wiki/spaces/PAY/pages/9001/Integration+guide';
const PAGE_9002 = 'https://pay.atlassian.net/wiki/spaces/PAY/pages/9002/Release+notes';

describe('confluencePageId', () => {
  it('reads the id from a modern page url', () => {
    expect(confluencePageId(PAGE_9001)).toBe('9001');
  });

  it('reads the id from a legacy pageId query string', () => {
    expect(confluencePageId('https://pay.atlassian.net/wiki/pages/viewpage.action?pageId=9002')).toBe(
      '9002',
    );
  });

  it('returns null for a short link, which carries no id (R5 §4.5)', () => {
    expect(confluencePageId('https://pay.atlassian.net/wiki/x/AbCd')).toBeNull();
  });
});

describe('linkedConfluencePageIds', () => {
  it('deduplicates a page linked by two tickets and skips non-confluence links', () => {
    const result = linkedConfluencePageIds([
      issue('PAY-127', { remoteLinks: [link(PAGE_9001), link('https://github.com/x/y', 'other')] }),
      issue('PAY-128', { remoteLinks: [link(PAGE_9001), link(PAGE_9002)] }),
    ]);

    expect(result.ids).toEqual(['9001', '9002']);
    expect(result.skipped).toBe(0);
  });

  it('counts an unreadable url and the overflow over the cap as skipped', () => {
    const links = Array.from({ length: MAX_PAGES + 1 }, (_, index) =>
      link(`https://pay.atlassian.net/wiki/spaces/PAY/pages/${8000 + index}/Page`),
    );
    const result = linkedConfluencePageIds([issue('PAY-127', { remoteLinks: links })]);

    expect(result.ids).toHaveLength(MAX_PAGES);
    expect(result.skipped).toBe(1);
  });
});

describe('ConfluencePageCollector', () => {
  it('returns one page per id, with title, url, spaceKey and lastModified', async () => {
    const collector = new ConfluencePageCollector(
      createFakeConfluenceClient([
        confluencePageDto('9001', { title: 'Integration guide', lastModified: '2026-11-10T09:00:00.000Z' }),
        confluencePageDto('9002', { title: 'Release notes', lastModified: '2026-09-01T09:00:00.000Z' }),
      ]),
    );

    const { pages, status } = await collector.collect([
      issue('PAY-127', { remoteLinks: [link(PAGE_9001)] }),
      issue('PAY-128', { remoteLinks: [link(PAGE_9001), link(PAGE_9002)] }),
    ]);

    expect(status).toEqual({ source: 'confluence', state: 'ok' });
    expect(pages.map((page) => page.subjectId)).toEqual(['9001', '9002']);
    expect(pages[0]).toMatchObject({
      subjectType: 'page',
      title: 'Integration guide',
      spaceKey: 'PAY',
      lastModified: '2026-11-10T09:00:00.000Z',
    });
    // The untouched page keeps its old timestamp: DOC-01 compares it to the cycle start.
    expect(pages[1].lastModified).toBe('2026-09-01T09:00:00.000Z');
  });

  it('fetches a page linked twice only once', async () => {
    let calls = 0;
    const collector = new ConfluencePageCollector({
      async getPage(id: string) {
        calls += 1;
        return confluencePageDto(id);
      },
    });

    await collector.collect([
      issue('PAY-127', { remoteLinks: [link(PAGE_9001)] }),
      issue('PAY-128', { remoteLinks: [link(PAGE_9001)] }),
    ]);

    expect(calls).toBe(1);
  });

  it('degrades to partial when one page is gone or restricted', async () => {
    const collector = new ConfluencePageCollector(
      createFakeConfluenceClient([confluencePageDto('9001')]),
    );

    const { pages, status } = await collector.collect([
      issue('PAY-127', { remoteLinks: [link(PAGE_9001), link(PAGE_9002)] }),
    ]);

    expect(pages).toHaveLength(1);
    expect(status).toEqual({
      source: 'confluence',
      state: 'partial',
      detail: { key: 'coverage.source.partial', params: { source: 'confluence' } },
    });
  });

  it('reports unavailable when no linked page could be read', async () => {
    const collector = new ConfluencePageCollector(
      createFakeConfluenceClient(new Error('503 Service Unavailable')),
    );

    const { pages, status } = await collector.collect([
      issue('PAY-127', { remoteLinks: [link(PAGE_9001)] }),
    ]);

    expect(pages).toEqual([]);
    expect(status).toEqual({
      source: 'confluence',
      state: 'unavailable',
      detail: { key: 'coverage.source.unavailable', params: { source: 'confluence' } },
    });
  });

  it('reports empty when no ticket links a Confluence page', async () => {
    const collector = new ConfluencePageCollector(createFakeConfluenceClient([]));

    const { status } = await collector.collect([
      issue('PAY-127', { remoteLinks: [link('https://github.com/x/y', 'other')] }),
    ]);

    expect(status.state).toBe('empty');
  });

  it('stops at MAX_PAGES and says the collection is partial', async () => {
    const pages = Array.from({ length: MAX_PAGES }, (_, index) => confluencePageDto(`${8000 + index}`));
    const collector = new ConfluencePageCollector(createFakeConfluenceClient(pages));
    const links = Array.from({ length: MAX_PAGES + 5 }, (_, index) =>
      link(`https://pay.atlassian.net/wiki/spaces/PAY/pages/${8000 + index}/Page`),
    );

    const { pages: collected, status } = await collector.collect([
      issue('PAY-127', { remoteLinks: links }),
    ]);

    expect(collected).toHaveLength(MAX_PAGES);
    expect(status.state).toBe('partial');
  });
});

/* ------------------------------------------- real client, stubbed transport */

/** Answers by path: a page, a space, or an HTTP error status. */
function stubConfluence(
  answers: Record<string, unknown | number>,
): { request: ForgeRequest; paths: string[] } {
  const paths: string[] = [];
  const request: ForgeRequest = async (path): Promise<ForgeResponseLike> => {
    paths.push(path);
    const answer = answers[path];
    if (typeof answer === 'number') {
      return { ok: false, status: answer, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => answer ?? {} };
  };
  return { request, paths };
}

const PAGE_PATH = '/wiki/api/v2/pages/9001';
const SPACE_PATH = '/wiki/api/v2/spaces/space-1';

function pagePayload(partial: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '9001',
    title: 'Integration guide',
    spaceId: 'space-1',
    version: { createdAt: '2026-11-10T09:00:00.000Z' },
    _links: { base: 'https://pay.atlassian.net', webui: '/spaces/PAY/pages/9001/Integration+guide' },
    ...partial,
  };
}

describe('createConfluenceClient (v2 adapter)', () => {
  it('reads a page: title, absolute url, lastModified and the resolved spaceKey', async () => {
    const { request } = stubConfluence({
      [PAGE_PATH]: pagePayload(),
      [SPACE_PATH]: { id: 'space-1', key: 'PAY' },
    });
    const client = createConfluenceClient(request);

    expect(await client.getPage('9001')).toEqual({
      id: '9001',
      title: 'Integration guide',
      url: 'https://pay.atlassian.net/spaces/PAY/pages/9001/Integration+guide',
      spaceKey: 'PAY',
      lastModified: '2026-11-10T09:00:00.000Z',
    });
  });

  it('resolves each space once, and keeps the page when the space lookup fails', async () => {
    const { request, paths } = stubConfluence({
      [PAGE_PATH]: pagePayload(),
      '/wiki/api/v2/pages/9002': pagePayload({ id: '9002' }),
      [SPACE_PATH]: 403,
    });
    const client = createConfluenceClient(request);

    const first = await client.getPage('9001');
    const second = await client.getPage('9002');

    expect(first?.spaceKey).toBeUndefined();
    expect(second?.spaceKey).toBeUndefined();
    // Two pages, one space: the failed lookup is cached too, so one call only.
    expect(paths.filter((path) => path === SPACE_PATH)).toHaveLength(1);
  });

  it('maps a gone or restricted page to null instead of throwing', async () => {
    const { request } = stubConfluence({ [PAGE_PATH]: 404 });
    const client = createConfluenceClient(request);

    expect(await client.getPage('9001')).toBeNull();
  });

  it('lets a real transport failure through, so the collector reports it', async () => {
    const client = createConfluenceClient(async () => {
      throw new CollectRequestError(502, PAGE_PATH);
    });

    await expect(client.getPage('9001')).rejects.toThrow(/HTTP 502/);
  });
});
