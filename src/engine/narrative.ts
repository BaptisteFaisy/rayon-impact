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

const SYSTEM_PROMPT = [
  'You write the release summary shown to the release lead.',
  'Between 5 and 8 lines, no preamble, no markdown headings.',
  'Every line must cite at least one signal code from the list.',
  'Only mention the issues, services, incidents and pages present in the list.',
  'Say it plainly when the data is missing; absence of data is never good news.',
  'Answer in the requested language.',
].join(' ');

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
    if (typeof value === 'string' && value.length > 0) into.add(value);
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

/**
 * Checks a candidate summary against the signals: identifiers, service names,
 * line count and signal-code citation.
 */
export function verifyNarrative(
  text: string,
  input: NarrativeInput,
): { ok: boolean; violations: string[] } {
  const violations: string[] = [];
  const allowed = allowedTokens(input.signals);
  const lines = summaryLines(text);

  const knownCodes = new Set<string>(listSignalCodes());
  for (const identifier of findIdentifiers(text)) {
    // A signal code is not an identifier: `COMP-01` names a rule, not a ticket.
    if (knownCodes.has(identifier)) continue;
    if (!allowed.has(identifier)) {
      violations.push(`identifiant absent des signaux : ${identifier}`);
    }
  }

  for (const service of input.serviceNames ?? []) {
    if (text.includes(service) && !allowed.has(service)) {
      violations.push(`service absent des signaux : ${service}`);
    }
  }

  if (lines.length < 5 || lines.length > 8) {
    violations.push(`la synthèse doit tenir en 5 à 8 lignes (${lines.length} trouve(s))`);
  }

  const codes = new Set(input.signals.map((signal) => signal.code));
  for (const line of lines) {
    const cited = [...codes].some((code) => line.includes(code));
    if (!cited) {
      violations.push(`ligne sans code de signal : ${line.slice(0, 60)}`);
    }
  }

  return { ok: violations.length === 0, violations };
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
