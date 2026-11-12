import { useEffect, useState } from 'react';
import { invoke } from '@forge/bridge';
import { useProductContext } from '@forge/react';
import type { Locale } from '../types';

/**
 * Shared screen plumbing: one hook to call the resolver, one to read the
 * locale. Every screen uses these, so no screen re-implements loading,
 * error handling or locale detection (no duplication).
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

export interface ScreenState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/** Calls a resolver key once per payload change and keeps its answer. */
export function useScreen<T>(
  key: string,
  payload: Record<string, unknown>,
): ScreenState<T> {
  const [state, setState] = useState<ScreenState<T>>({
    data: null,
    loading: true,
    error: null,
  });
  const fingerprint = `${key}|${JSON.stringify(payload)}`;

  useEffect(() => {
    let alive = true;
    invoke<T>(key, payload)
      .then((data) => {
        if (alive) setState({ data, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (alive) {
          setState({
            data: null,
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint]);

  return state;
}

/** The locale of the site: French when it starts with "fr", English otherwise. */
export function useLocale(): Locale {
  const context = useProductContext();
  const raw = String(context?.locale ?? 'en');
  return raw.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

/** The Jira project of the current module, when the host provides one. */
export function useProject(): { id?: string; key?: string } {
  const context = useProductContext();
  const extension = (context?.extension ?? {}) as Record<string, unknown>;
  // Jira appelle désormais les projets « spaces » : selon le module, le
  // contexte porte `project` ou `space` (l'écran de réglages ne recevait que
  // `space`, et le résolveur ne recevait donc aucun projectId).
  const project = (extension.project ?? extension.space ?? {}) as Record<string, unknown>;
  return {
    ...(typeof project.id === 'string' ? { id: project.id } : {}),
    ...(typeof project.key === 'string' ? { key: project.key } : {}),
  };
}

/** The issue of the current module, when the host provides one. */
export function useIssue(): { id?: string; key?: string } {
  const context = useProductContext();
  const extension = (context?.extension ?? {}) as Record<string, unknown>;
  const issue = (extension.issue ?? {}) as Record<string, unknown>;
  return {
    ...(typeof issue.id === 'string' ? { id: issue.id } : {}),
    ...(typeof issue.key === 'string' ? { key: issue.key } : {}),
  };
}
