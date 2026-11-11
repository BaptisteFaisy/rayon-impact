/**
 * Shared plumbing for the Forge collectors (Jira, JSM, Confluence).
 *
 * Two things live here so that no collector copies them:
 *   1. the minimal transport port the collectors talk to — `api.asApp()
 *      .requestJira` / `requestConfluence` shaped, injected so every collector
 *      is testable with a fake and so that `@forge/api` stays confined to
 *      `src/collect/jira-client.ts` and `src/collect/graph.ts` (CONVENTIONS §2);
 *   2. bounded pagination: a page-token loop that always stops, on the item
 *      cap, on the last cursor, or on MAX_PAGE_FETCHES — never on hope.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */
import type { SourceName, SourceState, SourceStatus } from '../types';

/** What the collectors read from a Forge API response (nothing more). */
export interface ForgeResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface ForgeRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

/**
 * The only transport the collectors use. `src/collect/jira-client.ts` wires it
 * to `api.asApp().requestJira` (`createJiraForgeRequest`), which is the single
 * place allowed to import `@forge/api` for product REST calls. The Confluence
 * variant of that adapter belongs there too: `createConfluenceClient` below
 * takes the port, so it only needs `api.asApp().requestConfluence`.
 */
export type ForgeRequest = (
  path: string,
  init?: ForgeRequestInit,
) => Promise<ForgeResponseLike>;

/** A REST call the collector could not complete (non-2xx answer). */
export class CollectRequestError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
  ) {
    super(`HTTP ${status} on ${path}`);
    this.name = 'CollectRequestError';
  }
}

/** Parses a JSON body, turning a non-2xx answer into a typed error. */
export async function readJson<T>(
  response: ForgeResponseLike,
  path: string,
): Promise<T> {
  if (!response.ok) throw new CollectRequestError(response.status, path);
  return (await response.json()) as T;
}

/** Hard cap on HTTP round-trips: a broken cursor can never loop forever. */
export const MAX_PAGE_FETCHES = 20;

export interface PagedPage<T> {
  items: T[];
  /** Cursor of the next page; absent on the last one. */
  nextToken?: string;
}

export interface PagedResult<T> {
  items: T[];
  pages: number;
  /** True when items were left behind (item cap or page cap reached). */
  truncated: boolean;
}

export interface PagedOptions<T> {
  /** Fetches one page; `token` is undefined for the first call. */
  fetchPage(token?: string): Promise<PagedPage<T>>;
  /** Hard cap on retained items. */
  limit: number;
  /** Hard cap on calls (defaults to MAX_PAGE_FETCHES). */
  maxPages?: number;
}

/**
 * Follows the page cursor until the item cap, the cursor end or the page cap.
 * The result says whether something was left behind, so the caller can report
 * a `partial` source instead of pretending it saw everything (SPEC §15).
 */
export async function collectPaged<T>(
  options: PagedOptions<T>,
): Promise<PagedResult<T>> {
  const maxPages = options.maxPages ?? MAX_PAGE_FETCHES;
  const items: T[] = [];
  let token: string | undefined;
  let pages = 0;

  while (pages < maxPages) {
    const page = await options.fetchPage(token);
    pages += 1;
    const room = options.limit - items.length;
    if (page.items.length > room) {
      items.push(...page.items.slice(0, Math.max(room, 0)));
      return { items, pages, truncated: true };
    }
    items.push(...page.items);
    token = page.nextToken;
    if (!token) return { items, pages, truncated: false };
  }

  return { items, pages, truncated: true };
}

/* ------------------------------------------------------ value guards */

/**
 * Defensive readers for JSON payloads. The Jira/JSM/Confluence/graph payloads
 * are `unknown` by nature (custom fields, Assets objects, graph nodes), so the
 * collectors narrow them here, once, instead of each re-inventing a cast.
 * None of them throws: an unexpected shape degrades to "absent".
 */
export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** A JSON array, or a single value wrapped as a one-element array. */
export function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

export function asText(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

/** Same as `asText`, but "absent" rather than an empty string. */
export function optionalText(value: unknown): string | undefined {
  const text = asText(value);
  return text.length > 0 ? text : undefined;
}

export function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Property of an unknown node, as text. */
export function prop(node: unknown, key: string): string {
  return asText(asRecord(node)[key]);
}

/** Deduplicated, empty-free, stable order: JQL params and scope lists alike. */
export function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort();
}

/**
 * Status of a source the collector just read. `ok` carries no detail; every
 * other state carries the message the coverage screen shows, under the
 * `coverage.source.<state>` key convention already used by src/engine/coverage.
 */
export function sourceStatus(source: SourceName, state: SourceState): SourceStatus {
  if (state === 'ok') return { source, state };
  return { source, state, detail: { key: `coverage.source.${state}`, params: { source } } };
}
