#!/usr/bin/env node
/**
 * The offline demo server: plain Node, no dependency, no network.
 *
 * It only routes and streams: every byte of content comes from the bundle
 * (`demo/build.mjs`), which is the app's own pipeline, resolvers and actions.
 *
 *   node demo/build.mjs      # once, or after a source change
 *   node demo/server.mjs     # http://localhost:8791 (DEMO_PORT for another port)
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = resolve(ROOT, 'demo/.build/entry.mjs');
const PORT = Number(process.env.DEMO_PORT ?? 8791);

/** Builds the bundle if it is missing, so one command is enough to start. */
function ensureBundle() {
  if (existsSync(BUNDLE)) return;
  const build = spawnSync(process.execPath, [resolve(ROOT, 'demo/build.mjs')], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

ensureBundle();
const demo = await import(BUNDLE);

/** The four screens of the app, by URL segment. */
const SCREENS = new Set(['project', 'settings', 'gadget', 'issue']);

/** Parses a query string into the flat map the demo API expects. */
function paramsOf(url) {
  const query = {};
  for (const [key, value] of new URL(url, 'http://demo').searchParams) query[key] = value;
  return query;
}

/** The locale and identity of a request, defaulted to the release lead. */
function identityOf(query) {
  return {
    locale: query.locale === 'fr' ? 'fr' : 'en',
    role: query.role === 'reader' ? 'reader' : 'lead',
  };
}

/** Sends HTML with the no-cache headers a live demo needs. */
function html(response, body, status = 200) {
  response.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  response.end(body);
}

/** Sends JSON, same no-store rule. */
function json(response, body, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body, null, 1));
}

/** `GET /` and `GET /index`: the landing page with every playable release. */
async function serveIndex(request, response) {
  const { locale } = identityOf(paramsOf(request.url));
  html(response, await demo.indexPage(locale));
}

/** `GET /s/<scenario>/<screen>`: one screen of the app, played for real. */
async function serveScreen(scenarioId, screen, request, response) {
  if (!SCREENS.has(screen)) return notFound(response, screen);
  const query = paramsOf(request.url);
  html(response, await demo.screenPage(scenarioId, screen, query));
}

/** `GET /api/<scenario>/dossier|reads|actions`: what the resolvers answered. */
async function serveApi(scenarioId, what, request, response) {
  const query = paramsOf(request.url);
  const { locale, role } = identityOf(query);
  if (what === 'dossier') return json(response, await demo.dossierJson(scenarioId, role, locale));
  if (what === 'reads') return json(response, await demo.readsJson(scenarioId, role, locale));
  if (what === 'actions') return json(response, demo.actionKeys());
  if (what === 'action') return serveActionCall(scenarioId, query, role, locale, response);
  return notFound(response, what);
}

/** `GET /api/<scenario>/action?key=…&payload={…}`: one real Rovo/MCP action. */
async function serveActionCall(scenarioId, query, role, locale, response) {
  if (!query.key) return json(response, { ok: false, error: { message: 'missing ?key' } }, 400);
  let raw = {};
  try {
    raw = query.payload ? JSON.parse(query.payload) : {};
  } catch {
    return json(response, { ok: false, error: { message: 'payload must be JSON' } }, 400);
  }
  json(response, await demo.actionJson(scenarioId, query.key, raw, role, locale));
}

/** A 404 that says what the demo can serve, so a typo is never a dead end. */
function notFound(response, what) {
  const help = [
    `Unknown path segment: ${what}`,
    '',
    'Try:',
    '  /',
    '  /s/paiements-24/project?tab=graph&locale=fr',
    '  /api/paiements-24/reads',
    '  /api/paiements-24/action?key=get-release-impact',
    '  &payload={"projectKey":"PAY","versionName":"2.4"}',
  ].join('\n');
  html(response, `<pre>${help.replace(/</g, '&lt;')}</pre>`, 404);
}

/** Dispatches one request; every branch returns a response, none hangs. */
async function handle(request, response) {
  const path = new URL(request.url, 'http://demo').pathname;
  if (path === '/' || path === '/index') return serveIndex(request, response);
  const screen = path.match(/^\/s\/([^/]+)\/([^/]+)\/?$/);
  if (screen) return serveScreen(screen[1], screen[2], request, response);
  const api = path.match(/^\/api\/([^/]+)\/([^/]+)\/?$/);
  if (api) return serveApi(api[1], api[2], request, response);
  return notFound(response, path);
}

const server = createServer((request, response) => {
  handle(request, response).catch((error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    html(response, `<pre>${message.replace(/</g, '&lt;')}</pre>`, 500);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Démo : http://localhost:${PORT}  (port : DEMO_PORT)`);
  console.log('Moteur, résolveurs et actions = ceux de l\u2019app ; données = fixtures de test.');
});
