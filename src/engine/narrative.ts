import type {
  Coverage,
  Confidence,
  Locale,
  MessageRef,
  Signal,
  Verdict,
} from '../types';
import { t } from '../i18n/index';
import { listSignalCodes } from '../signals/registry';

/**
 * Written summary of a release dossier (SPEC §8, RI-06).
 *
 * The language model only ever sees the structured list of signals; the text it
 * returns is then checked against that same list. A summary mentioning a ticket
 * or a service that is not in the signals is rejected and replaced by a
 * deterministic fallback.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

export interface NarrativeInput {
  signals: Signal[];
  verdict: Verdict;
  confidence: Confidence;
  coverage: Coverage;
  versionName: string;
  projectKey: string;
  locale: Locale;
  /** Every service name the project knows (policy service map). */
  serviceNames?: string[];
}

/** How many times the model is asked before falling back. */
export const NARRATIVE_MAX_ATTEMPTS = 3;

// Few-shot sans identifiant réel : un exemple contenant `PAY-131` serait recopié
// par le modèle puis rejeté par la vérification (identifiant absent des signaux).
// `TICKETKEY` ne ressemble à aucune clé Jira et ne peut donc pas fuiter.
const SYSTEM_PROMPT = [
  'You write the release summary shown to the release lead.',
  'Output EXACTLY 5 to 8 lines of plain text, and nothing else.',
  'No title, no markdown heading, no bold, no bullet character, no preamble,',
  'no closing sentence, no "WARN" or "INFO" prefix.',
  'Every line starts with one signal code from the input list, then " — ",',
  'then a single sentence about that signal.',
  'Copy the identifiers (issue keys, service names, incident keys, page titles)',
  'exactly as they appear in the input list. Never invent one.',
  'If the input list is empty, say in 5 lines that no signal is active and state',
  'the coverage: absence of data is never good news.',
  'Answer in the requested language.',
  '',
  'Shape example (one input line, then its output line):',
  'input:  COMP-01 | blocking | active | id-42 | TICKETKEY is still In Progress.',
  'output: COMP-01 — TICKETKEY is still In Progress.',
].join('\n');

/** Every string value carried by the signals' messages: the allowed vocabulary. */
export function allowedTokens(signals: Signal[]): Set<string> {
  const tokens = new Set<string>();
  for (const signal of signals) {
    collectTokens(signal.finding, tokens);
    for (const evidence of signal.evidence) {
      collectTokens(evidence.label, tokens);
    }
  }
  return tokens;
}

function collectTokens(ref: MessageRef, into: Set<string>): void {
  if (!ref?.params) return;
  for (const value of Object.values(ref.params)) {
    if (typeof value !== 'string' || value.length === 0) continue;
    into.add(value);
    // A param may carry a list ("PAY-127, PAY-128"): every element is allowed
    // too, otherwise a truthful summary citing one of them would be rejected.
    if (value.includes(',')) {
      for (const part of value.split(',')) {
        const token = part.trim();
        if (token.length > 0) into.add(token);
      }
    }
  }
}

/** Issue-like and incident-like identifiers: `PAY-131`, `INC-52`. */
export function findIdentifiers(text: string): string[] {
  const matches = text.match(/\b[A-Z][A-Z0-9]+-\d+\b/g);
  return matches ? [...new Set(matches)] : [];
}

/** Non-empty lines of the summary. */
export function summaryLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export interface NarrativeCheck {
  /** No hard violation: the text may be published. */
  ok: boolean;
  /** SPEC §8: a ticket/service/incident absent from the signals. Blocking. */
  hardViolations: string[];
  /** Formatting: line count, one code per line. Retried, never blocking. */
  softViolations: string[];
  violations: string[];
}

/**
 * Checks a candidate summary against the signals.
 *
 * Two levels, because a real model does not always respect the layout:
 * - **hard** (SPEC §8): the text mentions a ticket, service, incident or page
 *   that is not in the signals. Such a text is never published.
 * - **soft**: 5 to 8 lines, one signal code per line. Retried, and accepted
 *   after the attempts rather than throwing away a truthful summary.
 */
export function verifyNarrative(
  text: string,
  input: NarrativeInput,
): NarrativeCheck {
  const hardViolations: string[] = [];
  const softViolations: string[] = [];
  const allowed = allowedTokens(input.signals);
  const lines = summaryLines(text);

  const knownCodes = new Set<string>(listSignalCodes());
  for (const identifier of findIdentifiers(text)) {
    // A signal code is not an identifier: `COMP-01` names a rule, not a ticket.
    if (knownCodes.has(identifier)) continue;
    if (!allowed.has(identifier)) {
      hardViolations.push(`identifiant absent des signaux : ${identifier}`);
    }
  }

  for (const service of input.serviceNames ?? []) {
    if (text.includes(service) && !allowed.has(service)) {
      hardViolations.push(`service absent des signaux : ${service}`);
    }
  }

  if (lines.length < 5 || lines.length > 8) {
    softViolations.push(`la synthèse doit tenir en 5 à 8 lignes (${lines.length} trouve(s))`);
  }

  const codes = new Set(input.signals.map((signal) => signal.code));
  for (const line of lines) {
    const cited = [...codes].some((code) => line.includes(code));
    if (!cited) {
      softViolations.push(`ligne sans code de signal : ${line.slice(0, 60)}`);
    }
  }

  return {
    ok: hardViolations.length === 0,
    hardViolations,
    softViolations,
    violations: [...hardViolations, ...softViolations],
  };
}

/** A non-empty text without an error marker is usable. */
export function isNarrativeUsable(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && !trimmed.startsWith('[error');
}

/** The structured payload handed to the language model. */
export function buildNarrativePayload(input: NarrativeInput): {
  system: string;
  user: string;
} {
  const signalLines = input.signals.map((signal) => {
    const finding = t(signal.finding, input.locale);
    const status = signal.status === 'waived' ? 'waived' : 'active';
    return `${signal.code} | ${signal.severity} | ${status} | ${signal.subjectId} | ${finding}`;
  });
  const user = [
    `Verdict: ${input.verdict}`,
    `Confidence: ${input.confidence}`,
    `Coverage: ${input.coverage.issuesWithCode}/${input.coverage.issueCount} tickets with code, ${input.coverage.issuesWithService}/${input.coverage.issueCount} with a service`,
    `Release: ${input.projectKey} ${input.versionName}`,
    `Language: ${input.locale}`,
    'Signals:',
    ...(signalLines.length > 0 ? signalLines : ['(no signal)']),
  ].join('\n');
  return { system: SYSTEM_PROMPT, user };
}

/**
 * Deterministic summary, used when the model is unavailable or its text is
 * rejected. It always passes `verifyNarrative`: it cites the codes it knows.
 */
export function fallbackNarrative(input: NarrativeInput): string {
  const locale = input.locale;
  const bySeverity = new Map<string, Signal[]>();
  for (const signal of input.signals) {
    const bucket = bySeverity.get(signal.severity) ?? [];
    bucket.push(signal);
    bySeverity.set(signal.severity, bucket);
  }
  const lines: string[] = [];
  lines.push(
    locale === 'fr'
      ? `${input.projectKey} ${input.versionName} : avis ${input.verdict} (confiance ${input.confidence}).`
      : `${input.projectKey} ${input.versionName}: ${input.verdict} verdict (${input.confidence} confidence).`,
  );
  lines.push(
    locale === 'fr'
      ? `Couverture : ${input.coverage.issuesWithCode}/${input.coverage.issueCount} tickets avec du code, ${input.coverage.issuesWithService}/${input.coverage.issueCount} avec un service connu.`
      : `Coverage: ${input.coverage.issuesWithCode}/${input.coverage.issueCount} tickets with code, ${input.coverage.issuesWithService}/${input.coverage.issueCount} with a known service.`,
  );
  for (const severity of ['blocking', 'major', 'minor', 'info'] as const) {
    const bucket = bySeverity.get(severity) ?? [];
    for (const signal of bucket.slice(0, 3)) {
      lines.push(`${signal.code} — ${t(signal.finding, locale)}`);
    }
  }
  if (lines.length < 5) {
    lines.push(
      locale === 'fr'
        ? 'Aucun signal bloquant ni majeur actif sur cette version.'
        : 'No blocking nor major signal is active on this release.',
    );
  }
  return lines.slice(0, 8).join('\n');
}
