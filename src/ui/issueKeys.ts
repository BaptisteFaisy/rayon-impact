import type { Signal } from '../types';

/**
 * Issue keys held by the blocking signals of a dossier.
 *
 * The simulation action expects issue **keys**, while a signal's subject is an
 * issue **id**. The keys are read from the signal's own finding params (every
 * detector puts the key there), and from the `issues` param of the signals
 * raised about an incident or a service.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

/** Keys carried by one signal, whatever its subject type. */
export function issueKeysOf(signal: Signal): string[] {
  const params = signal.finding.params ?? {};
  const keys: string[] = [];

  const single = params.key;
  if (typeof single === 'string' && single.length > 0) keys.push(single);

  const list = params.issues;
  if (typeof list === 'string' && list.length > 0) {
    for (const part of list.split(',')) {
      const key = part.trim();
      if (key.length > 0) keys.push(key);
    }
  }
  return keys;
}

/** Deduplicated keys of every active blocking signal, in reading order. */
export function blockingIssueKeys(signals: Signal[]): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const signal of signals) {
    if (signal.severity !== 'blocking' || signal.status !== 'active') continue;
    for (const key of issueKeysOf(signal)) {
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}
