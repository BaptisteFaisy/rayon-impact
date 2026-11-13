/**
 * Lecture d'une réponse de résolveur côté vue.
 *
 * Deux réalités du pont Forge, constatées en production (2026-11-12/13) :
 * - un résolveur qui répond `null` (ou rien) arrive à la vue comme un **objet
 *   vide `{}`** — qui est *truthy*, donc confondu avec une donnée ;
 * - un écran qui échoue envoie le **refus** `{ ok: false, error: { code,
 *   message } }` de `src/index.ts` : sans filtrage, la vue le rend comme une
 *   donnée (`severityOverrides` undefined → TypeError → module vide).
 *
 * `useScreen` applique cette lecture à chaque réponse : une réponse vide ou un
 * refus devient soit `null` (aucune donnée), soit une erreur lisible — jamais
 * un objet à mi-chemin qu'un écran planterait à rendre.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

export interface Answer<T> {
  data: T | null;
  error: string | null;
}

/** Un objet non-tableau sans aucune clé propre : la forme de `null` sur le pont. */
function isEmptyObject(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value as object).length === 0
  );
}

/** Le refus `{ ok: false, error: { code, message } }` d'un écran en erreur. */
function refusalMessage(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const refusal = value as { ok?: unknown; error?: unknown };
  if (refusal.ok !== false) return null;
  const error = refusal.error;
  if (typeof error === 'string' && error.length > 0) return error;
  if (typeof error === 'object' && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0) return message;
  }
  return 'Unavailable — the backend refused this request.';
}

/**
 * Classe la réponse en « donnée », « vide » ou « erreur ».
 * Une réponse vide (`null`, `undefined` ou `{}`) n'est pas une donnée.
 */
export function readAnswer<T>(value: unknown): Answer<T> {
  if (value === null || value === undefined || isEmptyObject(value)) return { data: null, error: null };
  const refusal = refusalMessage(value);
  if (refusal) return { data: null, error: refusal };
  return { data: value as T, error: null };
}