/**
 * Read-only HTTP route for the acceptance harness (docs/ACCEPTANCE.md).
 *
 * Forge webtriggers are NOT authenticated by the platform, and no Atlassian
 * user identity is attached to invocations. This module therefore:
 * - exposes GET routes only — it never writes, never recomputes, never
 *   collects; every answer comes from the saved dossiers via `createStore()`
 *   (src/db/repo.ts is the only persistence adapter, zero duplicated query);
 * - checks a bearer token itself, against the app environment variable
 *   `RI_WEBTRIGGER_TOKEN` (`forge variables set RI_WEBTRIGGER_TOKEN=…`), with
 *   a constant-time comparison; when the variable is unset every data route
 *   refuses with 401 — no token, no data;
 * - answers bounded JSON well within the 55 s webtrigger limit: the store
 *   reads are single indexed SQL queries (repo.ts caps every list).
 *
 * Routes (after the webtrigger id):
 *   GET /health                         liveness + token configuration state
 *   GET /dossier?versionId=…            the whole saved dossier of a version
 *   GET /dossier?projectKey=…&versionName=…   same, resolved by name
 *   GET /snapshots?projectId=…[&limit=] last snapshots, each with its signals
 *
 * The pure helpers (route parsing, bearer extraction, token comparison) are
 * exported and unit-tested in tests/webtrigger/webtrigger.test.ts — no I/O.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */
import type { WebTriggerContext, WebTriggerRequest, WebTriggerResponse } from '@forge/api';
import { createStore } from './db/repo';
import { createJiraClient } from './collect/jira-client';
import type { ReleaseStore } from './ports';
import type { Snapshot } from './types';

/** App environment variable holding the harness bearer token. */
export const TOKEN_ENV_VAR = 'RI_WEBTRIGGER_TOKEN';

/** Hard cap of the /snapshots route (well below the repo MAX_LIST_LIMIT). */
export const MAX_SNAPSHOTS = 50;

/* ------------------------------------------------------------ pure route */

export type RouteName = 'health' | 'dossier' | 'snapshots' | 'unknown';

export interface ParsedRoute {
  name: RouteName;
  /** Only GET is served; anything else is a 405. */
  get: boolean;
  params: Record<string, string>;
}

/** First value of a header, looked up case-insensitively (webtrigger format). */
export function headerOf(headers: Record<string, string[]>, name: string): string | undefined {
  const wanted = name.toLowerCase();
  for (const [key, values] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() === wanted && Array.isArray(values) && values.length > 0) {
      return values[0];
    }
  }
  return undefined;
}

/** The bearer token of the Authorization header, or null when absent/malformed. */
export function bearerTokenOf(headers: Record<string, string[]>): string | null {
  const value = headerOf(headers, 'authorization');
  if (!value) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(value.trim());
  return match ? match[1] : null;
}

/** Constant-time string comparison: no early exit leaks the prefix length. */
export function tokensMatch(expected: string, provided: string): boolean {
  if (typeof expected !== 'string' || typeof provided !== 'string') return false;
  if (expected.length === 0) return false;
  let diff = expected.length ^ provided.length;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i % Math.max(provided.length, 1));
  }
  return diff === 0;
}

/**
 * The route path of the request: the documented `userPath` when the runtime
 * provides it, else `path` minus its first two segments (`/x1/{id}/…` v1 or
 * `/public/{id}/…` v2). Always starts with `/`.
 */
export function routePathOf(request: WebTriggerRequest & { userPath?: string }): string {
  if (typeof request.userPath === 'string') {
    return request.userPath === '' ? '/' : request.userPath;
  }
  const segments = (request.path ?? '').split('/').filter((s) => s.length > 0);
  return '/' + segments.slice(2).join('/');
}

/** First value of a query parameter, trimmed; undefined when blank. */
function param(query: Record<string, string[]>, name: string): string | undefined {
  const values = query?.[name];
  const raw = Array.isArray(values) && values.length > 0 ? String(values[0]).trim() : '';
  return raw.length > 0 ? raw : undefined;
}

/** Pure routing: method + path + query → a named route with its params. */
export function parseRoute(request: WebTriggerRequest & { userPath?: string }): ParsedRoute {
  const get = (request.method ?? 'GET').toUpperCase() === 'GET';
  const segments = routePathOf(request).split('/').filter((s) => s.length > 0);
  const query = request.queryParameters ?? {};
  if (segments.length === 0 || (segments.length === 1 && segments[0] === 'health')) {
    return { name: 'health', get, params: {} };
  }
  if (segments.length === 1 && segments[0] === 'dossier') {
    return {
      name: 'dossier',
      get,
      params: {
        versionId: param(query, 'versionId') ?? '',
        projectKey: param(query, 'projectKey') ?? '',
        versionName: param(query, 'versionName') ?? '',
      },
    };
  }
  if (segments.length === 1 && segments[0] === 'snapshots') {
    return {
      name: 'snapshots',
      get,
      params: { projectId: param(query, 'projectId') ?? '', limit: param(query, 'limit') ?? '' },
    };
  }
  return { name: 'unknown', get, params: {} };
}

/* ---------------------------------------------------------- pure responses */

/** JSON webtrigger response: headers are arrays of strings (platform format). */
export function jsonResponse(statusCode: number, body: unknown): WebTriggerResponse {
  return {
    statusCode,
    headers: { 'Content-Type': ['application/json'] },
    body: JSON.stringify(body),
  };
}

export function errorResponse(statusCode: number, code: string, message: string): WebTriggerResponse {
  return jsonResponse(statusCode, { ok: false, error: code, message });
}

/* --------------------------------------------------------------- readers */

/** The store is built per invocation: `createStore()` opens SQL lazily. */
function store(): ReleaseStore {
  return createStore();
}

/** Version name → id, via the existing Jira façade (no duplicated REST call). */
async function resolveVersionId(projectKey: string, versionName: string): Promise<string | null> {
  const versions = await createJiraClient().listProjectVersions(projectKey);
  const found = versions.find((candidate) => candidate.name === versionName);
  return found ? String(found.id) : null;
}

async function readDossier(params: Record<string, string>): Promise<WebTriggerResponse> {
  let versionId = params.versionId;
  if (!versionId) {
    if (!params.projectKey || !params.versionName) {
      return errorResponse(400, 'invalid-input', 'Provide versionId, or projectKey + versionName.');
    }
    const resolved = await resolveVersionId(params.projectKey, params.versionName);
    if (!resolved) {
      return errorResponse(404, 'version-unknown', `No version "${params.versionName}" in ${params.projectKey}.`);
    }
    versionId = resolved;
  }
  const dossier = await store().getDossier(versionId);
  if (!dossier) {
    // Never computed (or not yet): absence is data, not a "go" (SPEC §15).
    return jsonResponse(404, { ok: false, error: 'no-dossier', versionId });
  }
  return jsonResponse(200, { ok: true, versionId, dossier });
}

function boundedLimit(raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return 20;
  return Math.min(Math.max(parsed, 1), MAX_SNAPSHOTS);
}

/** Last snapshots of a project, each with its signals — the R8 corpus. */
async function readSnapshots(params: Record<string, string>): Promise<WebTriggerResponse> {
  if (!params.projectId) {
    return errorResponse(400, 'invalid-input', 'Query parameter "projectId" is required.');
  }
  const limit = boundedLimit(params.limit);
  const snapshots = await store().listSnapshots(params.projectId, limit);
  const withSignals = await Promise.all(
    snapshots.map(async (snapshot: Snapshot) => ({
      snapshot,
      signals: await store().getSignals(snapshot.id),
    })),
  );
  return jsonResponse(200, { ok: true, projectId: params.projectId, count: withSignals.length, snapshots: withSignals });
}

/* ----------------------------------------------------------------- handler */

/**
 * Webtrigger entry point: `(payload, context) → { statusCode, headers, body }`.
 * Auth is enforced here (the platform does not): a missing or wrong bearer
 * token never reaches a data route.
 */
export async function handler(
  payload: WebTriggerRequest & { userPath?: string },
  _context: WebTriggerContext,
): Promise<WebTriggerResponse> {
  const route = parseRoute(payload);
  if (!route.get) return errorResponse(405, 'method-not-allowed', 'Read-only module: GET only.');
  if (route.name === 'health') {
    const configured = typeof process.env[TOKEN_ENV_VAR] === 'string' && process.env[TOKEN_ENV_VAR] !== '';
    return jsonResponse(200, { ok: true, tokenConfigured: configured });
  }
  if (route.name === 'unknown') return errorResponse(404, 'unknown-route', 'Routes: /health, /dossier, /snapshots.');
  const expected = process.env[TOKEN_ENV_VAR] ?? '';
  const provided = bearerTokenOf(payload.headers ?? {});
  if (!expected || !provided || !tokensMatch(expected, provided)) {
    // Same answer whether the app token is unset or the caller token is wrong:
    // the refusal must not reveal which side is missing.
    return errorResponse(401, 'unauthorized', 'Bearer token required and verified.');
  }
  try {
    return route.name === 'dossier' ? await readDossier(route.params) : await readSnapshots(route.params);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(500, 'read-failed', message);
  }
}
