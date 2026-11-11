/**
 * Tests des parties pures de src/webtrigger.ts : parsing de route, extraction
 * du bearer, comparaison de jetons, forme des réponses. Aucune E/S, aucun
 * runtime Forge (CONVENTIONS §5).
 */
import { describe, expect, it } from 'vitest';
import type { WebTriggerRequest } from '@forge/api';
import {
  MAX_SNAPSHOTS,
  TOKEN_ENV_VAR,
  bearerTokenOf,
  errorResponse,
  headerOf,
  jsonResponse,
  parseRoute,
  routePathOf,
  tokensMatch,
} from '../../src/webtrigger';

/** Un request webtrigger minimal (format documenté : headers = tableaux). */
function request(partial: Partial<WebTriggerRequest & { userPath?: string }> = {}): WebTriggerRequest {
  return {
    method: 'GET',
    body: '',
    path: '/x1/WEBTRIGGERID',
    headers: {},
    queryParameters: {},
    ...partial,
  } as WebTriggerRequest;
}

describe('headerOf / bearerTokenOf', () => {
  it('trouve un header sans tenir compte de la casse', () => {
    expect(headerOf({ Authorization: ['Bearer abc'] }, 'authorization')).toBe('Bearer abc');
    expect(headerOf({ 'content-type': ['application/json'] }, 'Content-Type')).toBe('application/json');
  });

  it('retourne undefined quand le header est absent ou vide', () => {
    expect(headerOf({}, 'authorization')).toBeUndefined();
    expect(headerOf({ Authorization: [] }, 'authorization')).toBeUndefined();
  });

  it('extrait le jeton bearer, sinon null', () => {
    expect(bearerTokenOf({ Authorization: ['Bearer s3cret'] })).toBe('s3cret');
    expect(bearerTokenOf({ authorization: ['bearer  s3cret '] })).toBe('s3cret');
    expect(bearerTokenOf({ Authorization: ['Basic abc'] })).toBeNull();
    expect(bearerTokenOf({ Authorization: ['Bearer'] })).toBeNull();
    expect(bearerTokenOf({})).toBeNull();
  });
});

describe('tokensMatch', () => {
  it('accepte le jeton exact', () => {
    expect(tokensMatch('abc123', 'abc123')).toBe(true);
  });

  it('refuse un jeton faux, vide ou de type invalide', () => {
    expect(tokensMatch('abc123', 'abc124')).toBe(false);
    expect(tokensMatch('abc123', 'abc12')).toBe(false);
    expect(tokensMatch('abc123', '')).toBe(false);
    expect(tokensMatch('', 'abc')).toBe(false);
    expect(tokensMatch(undefined as unknown as string, 'abc')).toBe(false);
  });
});

describe('routePathOf', () => {
  it('utilise userPath quand le runtime le fournit', () => {
    expect(routePathOf(request({ userPath: '/dossier' }))).toBe('/dossier');
    expect(routePathOf(request({ userPath: '' }))).toBe('/');
  });

  it('retire les deux premiers segments de path sinon (v1 et v2)', () => {
    expect(routePathOf(request({ path: '/x1/ID123/dossier' }))).toBe('/dossier');
    expect(routePathOf(request({ path: '/public/ID123/snapshots' }))).toBe('/snapshots');
    expect(routePathOf(request({ path: '/x1/ID123' }))).toBe('/');
  });
});

describe('parseRoute', () => {
  it('route / et /health vers health, sans authentification de données', () => {
    expect(parseRoute(request({ userPath: '/' })).name).toBe('health');
    expect(parseRoute(request({ userPath: '/health' })).name).toBe('health');
  });

  it('route /dossier avec ses paramètres de requête', () => {
    const route = parseRoute(
      request({ userPath: '/dossier', queryParameters: { versionId: [' 10100 '] } }),
    );
    expect(route).toEqual({
      name: 'dossier',
      get: true,
      params: { versionId: '10100', projectKey: '', versionName: '' },
    });
  });

  it('route /dossier par nom de version', () => {
    const route = parseRoute(
      request({
        userPath: '/dossier',
        queryParameters: { projectKey: ['PAY'], versionName: ['2.4'] },
      }),
    );
    expect(route.params.projectKey).toBe('PAY');
    expect(route.params.versionName).toBe('2.4');
  });

  it('route /snapshots avec projectId et limit', () => {
    const route = parseRoute(
      request({ userPath: '/snapshots', queryParameters: { projectId: ['10000'], limit: ['5'] } }),
    );
    expect(route).toEqual({ name: 'snapshots', get: true, params: { projectId: '10000', limit: '5' } });
  });

  it('marque les méthodes non GET et les routes inconnues', () => {
    expect(parseRoute(request({ method: 'POST', userPath: '/dossier' })).get).toBe(false);
    expect(parseRoute(request({ method: 'DELETE', userPath: '/health' })).get).toBe(false);
    expect(parseRoute(request({ userPath: '/policy' })).name).toBe('unknown');
    expect(parseRoute(request({ userPath: '/dossier/10100' })).name).toBe('unknown');
  });
});

describe('réponses JSON', () => {
  it('jsonResponse sérialise le corps et le Content-Type', () => {
    const response = jsonResponse(200, { ok: true });
    expect(response.statusCode).toBe(200);
    expect(response.headers).toEqual({ 'Content-Type': ['application/json'] });
    expect(JSON.parse(response.body ?? '')).toEqual({ ok: true });
  });

  it('errorResponse porte un code et un message, sans jeton', () => {
    const response = errorResponse(401, 'unauthorized', 'Bearer token required and verified.');
    const body = JSON.parse(response.body ?? '');
    expect(response.statusCode).toBe(401);
    expect(body).toEqual({ ok: false, error: 'unauthorized', message: 'Bearer token required and verified.' });
  });
});

describe('constantes exportées', () => {
  it('nomme la variable d environnement du jeton et borne /snapshots', () => {
    expect(TOKEN_ENV_VAR).toBe('RI_WEBTRIGGER_TOKEN');
    expect(MAX_SNAPSHOTS).toBeLessThanOrEqual(100);
  });
});
