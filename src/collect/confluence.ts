/**
 * Confluence page collection (SPEC §7 DOC-01, R5 §4.5).
 *
 * A release only cares about the pages its tickets link to, and Jira exposes
 * those as issue remote links of kind `confluence` (R5 §4.5). R5 also warns
 * that the url → page id conversion is not documented: the id is read from
 * the url itself, which is the only documented-enough path, and a link whose
 * id cannot be read is counted as skipped rather than silently dropped.
 *
 * The collector consumes a `ConfluenceClient`, so every rule (dedup, bound,
 * per-page failure) is testable with `createFakeConfluenceClient`.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */
import { route } from '@forge/api';
import type { ConfluencePage, JiraIssue, SourceStatus } from '../types';
import {
  CollectRequestError,
  pathLabel,
  type ForgeRequestPath,
  optionalText,
  readJson,
  sourceStatus,
  type ForgeRequest,
} from './paging';

/** Hard cap on pages fetched for one release (SPEC §15, bounded collection). */
export const MAX_PAGES = 100;

/** One page as the client hands it over. */
export interface ConfluencePageDto {
  id: string;
  title: string;
  url: string;
  spaceKey?: string;
  /** ISO 8601 of the last version — the DOC-01 reference point. */
  lastModified: string;
}

export interface ConfluenceClient {
  /** Returns null when the page is gone or not visible to the app. */
  getPage(id: string): Promise<ConfluencePageDto | null>;
}

export interface ConfluenceCollection {
  pages: ConfluencePage[];
  status: SourceStatus;
}

export interface LinkedPageIds {
  ids: string[];
  /** Confluence links whose page id could not be read, plus the ones over the cap. */
  skipped: number;
}

/**
 * Page id carried by a Confluence url: `/wiki/spaces/PAY/pages/9001/Title` or
 * `?pageId=9001`. Short links (`/x/AbCd`) carry no id — R5 documents no
 * conversion, so they are skipped and reported, never guessed.
 */
export function confluencePageId(url: string): string | null {
  const match = /\/pages\/(\d+)/.exec(url) ?? /[?&]pageId=(\d+)/.exec(url);
  return match ? match[1] : null;
}

/** Distinct Confluence page ids linked from these tickets, in ticket order. */
export function linkedConfluencePageIds(
  issues: JiraIssue[],
  limit: number = MAX_PAGES,
): LinkedPageIds {
  const ids: string[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  for (const issue of issues) {
    for (const link of issue.remoteLinks) {
      if (link.kind !== 'confluence') continue;
      const id = confluencePageId(link.url);
      if (!id) {
        skipped += 1;
        continue;
      }
      if (seen.has(id)) continue;
      seen.add(id);
      if (ids.length >= limit) {
        skipped += 1;
        continue;
      }
      ids.push(id);
    }
  }

  return { ids, skipped };
}

function toPage(dto: ConfluencePageDto): ConfluencePage {
  return {
    subjectType: 'page',
    subjectId: dto.id,
    title: dto.title,
    url: dto.url,
    spaceKey: dto.spaceKey,
    lastModified: dto.lastModified,
  };
}

/**
 * Fetches one page per distinct Confluence link of the release tickets.
 * A single missing page (deleted, restricted) degrades the source to
 * `partial`; nothing readable at all degrades it to `unavailable` — both are
 * reported, never mistaken for "the documentation is fine" (SPEC §15).
 */
export class ConfluencePageCollector {
  constructor(private readonly client: ConfluenceClient) {}

  async collect(issues: JiraIssue[]): Promise<ConfluenceCollection> {
    const { ids, skipped } = linkedConfluencePageIds(issues);
    if (ids.length === 0) {
      return { pages: [], status: sourceStatus('confluence', 'empty') };
    }

    const pages: ConfluencePage[] = [];
    let failures = 0;
    for (const id of ids) {
      try {
        const dto = await this.client.getPage(id);
        if (dto) pages.push(toPage(dto));
        else failures += 1;
      } catch {
        failures += 1;
      }
    }

    if (pages.length === 0) {
      return { pages, status: sourceStatus('confluence', 'unavailable') };
    }
    const degraded = failures > 0 || skipped > 0;
    return { pages, status: sourceStatus('confluence', degraded ? 'partial' : 'ok') };
  }
}

/* --------------------------------------------- Confluence v2 adapter */

interface ConfluencePageResponse {
  id?: string;
  title?: string;
  spaceId?: string;
  version?: { createdAt?: string };
  _links?: { base?: string; webui?: string };
}

interface ConfluenceSpaceResponse {
  key?: string;
}

/** One GET returning JSON, with the Accept header Confluence expects. */
async function getJson<T>(
  requestConfluence: ForgeRequest,
  path: ForgeRequestPath,
): Promise<T> {
  return readJson<T>(
    await requestConfluence(path, { headers: { Accept: 'application/json' } }),
    pathLabel(path),
  );
}

/**
 * `spaceKey` resolver: the page payload only carries `spaceId`, so the key
 * costs one extra call per distinct space, cached for the client's lifetime.
 * A failed lookup leaves the key undefined — a missing key must not cost the page.
 */
function createSpaceKeyResolver(
  requestConfluence: ForgeRequest,
): (spaceId: string | undefined) => Promise<string | undefined> {
  const cache = new Map<string, string | undefined>();
  return async (spaceId) => {
    if (!spaceId) return undefined;
    if (cache.has(spaceId)) return cache.get(spaceId);
    let key: string | undefined;
    try {
      key = optionalText(
        (await getJson<ConfluenceSpaceResponse>(requestConfluence, route`/wiki/api/v2/spaces/${spaceId}`)).key,
      );
    } catch {
      key = undefined;
    }
    cache.set(spaceId, key);
    return key;
  };
}

/** Reads one page, mapping "gone" and "restricted" to null (not a transport error). */
async function fetchPage(
  requestConfluence: ForgeRequest,
  id: string,
  spaceKeyFor: (spaceId: string | undefined) => Promise<string | undefined>,
): Promise<ConfluencePageDto | null> {
  const path = route`/wiki/api/v2/pages/${id}`;
  let json: ConfluencePageResponse;
  try {
    json = await getJson<ConfluencePageResponse>(requestConfluence, path);
  } catch (error) {
    if (error instanceof CollectRequestError && [403, 404].includes(error.status)) return null;
    throw error;
  }
  return {
    id: json.id ?? id,
    title: json.title ?? id,
    url: `${json._links?.base ?? ''}${json._links?.webui ?? ''}`,
    spaceKey: await spaceKeyFor(json.spaceId),
    lastModified: json.version?.createdAt ?? '',
  };
}

/**
 * Real client: Confluence REST v2 (R5 §4.5, scope `read:page:confluence`).
 *
 * Takes the `ForgeRequest` port, not `@forge/api` directly (CONVENTIONS §2):
 * the Confluence variant of the transport belongs beside
 * `createJiraForgeRequest` in src/collect/jira-client.ts, which is the module
 * allowed to import `@forge/api`. Until it exists, the adapter is exercised
 * through the same port with a stubbed transport in tests/collect.
 */
export function createConfluenceClient(requestConfluence: ForgeRequest): ConfluenceClient {
  const spaceKeyFor = createSpaceKeyResolver(requestConfluence);
  return {
    getPage: (id: string) => fetchPage(requestConfluence, id, spaceKeyFor),
  };
}

/** Test double: serves pages by id; a missing id resolves to null. */
export function createFakeConfluenceClient(
  pages: ConfluencePageDto[] | Error,
): ConfluenceClient {
  return {
    async getPage(id: string): Promise<ConfluencePageDto | null> {
      if (pages instanceof Error) throw pages;
      return pages.find((page) => page.id === id) ?? null;
    },
  };
}

/** Builds one page DTO for the fake, with a healthy default. */
export function confluencePageDto(
  id: string,
  partial: Partial<ConfluencePageDto> = {},
): ConfluencePageDto {
  return {
    id,
    title: partial.title ?? `Page ${id}`,
    url: partial.url ?? `https://pay.atlassian.net/wiki/spaces/PAY/pages/${id}/Page`,
    spaceKey: partial.spaceKey ?? 'PAY',
    lastModified: partial.lastModified ?? '2026-11-10T09:00:00.000Z',
  };
}
