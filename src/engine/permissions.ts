import type {
  Evidence,
  MessageRef,
  Policy,
  ReleaseDossier,
  Signal,
  Snapshot,
  SubjectRef,
  Viewer,
  Waiver,
} from '../types.js';

/**
 * Viewer-rights filtering of a release dossier (SPEC §15 "Droits", RI-10).
 *
 * The dossier is computed in the app's name; every proof is filtered at display
 * time against the viewer's rights. A non-visible item becomes
 * "1 hidden item (restricted access)" (`evidence.restricted`) and STILL counts
 * in the verdict: sanitizeDossierForViewer never removes a signal and never
 * touches snapshot.verdict / counts / confidence (SPEC §15).
 *
 * Documented choice for findings — a signal keeps its finding, EXCEPT when the
 * finding would reveal an identifier the viewer may not see (RI-10: never
 * reveal a ticket or incident the reader cannot see). Two cases mask it:
 *   1. the signal subject itself is invisible to the viewer;
 *   2. one of the finding params contains an identifier of a hidden evidence
 *      item (subject id, or a label param), compared case-insensitively after
 *      stripping the common id prefixes (`id-`, `inc-`, `svc-`, `page-`,
 *      `team-`) so `id-pay-131` matches the key `PAY-131`.
 * In both cases the finding becomes the generic `evidence.restricted` ref.
 *
 * Pure domain module: no Forge import, no I/O, and the inputs are never mutated
 * (every returned object is a fresh copy).
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

/** The dossier as one viewer may see it (SPEC §15, RI-10). */
export interface SanitizedDossier {
  snapshot: Snapshot;
  signals: Signal[];
  waivers: Waiver[];
  hiddenEvidenceCount: number;
  hiddenSubjects: SubjectRef[];
}

const RESTRICTED: MessageRef = { key: 'evidence.restricted' };

/** Id prefixes used by collectors/fixtures, stripped before key comparison. */
const ID_PREFIXES = ['id-', 'inc-', 'svc-', 'page-', 'team-'];

/**
 * Subject types whose identifiers are access-controlled (RI-10: "never reveal a
 * ticket or an incident the reader may not see"). Service, team and version
 * names stay readable — they are not personal/private objects.
 */
const RESTRICTED_SUBJECT_TYPES: ReadonlySet<string> = new Set(['issue', 'incident', 'page']);

function refKey(ref: SubjectRef): string {
  return `${ref.subjectType}:${ref.subjectId}`;
}

function normalizeToken(token: string): string {
  let out = token.toLowerCase();
  for (const prefix of ID_PREFIXES) {
    if (out.startsWith(prefix)) {
      out = out.slice(prefix.length);
      break;
    }
  }
  return out;
}

function paramStrings(ref: MessageRef): string[] {
  return Object.values(ref.params ?? {}).filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
}

/** Identifier strings of one hidden evidence item: what the finding must not leak. */
function leakTokensOf(evidence: Evidence): string[] {
  if (!RESTRICTED_SUBJECT_TYPES.has(evidence.subjectType)) return [];
  return [evidence.subjectId, ...paramStrings(evidence.label)]
    .map(normalizeToken)
    .filter((token) => token.length > 2);
}

/** True when a finding param exposes one of the hidden identifiers. */
function findingLeaks(finding: MessageRef, tokens: string[]): boolean {
  const values = paramStrings(finding).map((v) => v.toLowerCase());
  return tokens.some((token) => values.some((value) => value.includes(token)));
}

function isVisibleTo(viewer: Viewer, ref: SubjectRef): boolean {
  return viewer.visibility.isVisible({
    subjectType: ref.subjectType,
    subjectId: ref.subjectId,
  });
}

/** Filters one evidence item; hidden items lose label details and their url. */
function sanitizeEvidence(evidence: Evidence, viewer: Viewer): Evidence {
  if (isVisibleTo(viewer, evidence)) return { ...evidence };
  return {
    subjectType: evidence.subjectType,
    subjectId: evidence.subjectId,
    label: { ...RESTRICTED },
    restricted: true,
  };
}

/** Sanitizes one signal: evidence filtered, finding masked only when it leaks. */
function sanitizeSignal(signal: Signal, viewer: Viewer): Signal {
  const hidden = signal.evidence.filter((ev) => !isVisibleTo(viewer, ev));
  const evidence = signal.evidence.map((ev) => sanitizeEvidence(ev, viewer));
  const subjectHidden = !isVisibleTo(viewer, signal);
  const leaks = findingLeaks(signal.finding, hidden.flatMap(leakTokensOf));
  const finding = subjectHidden || leaks ? { ...RESTRICTED } : signal.finding;
  return { ...signal, finding, evidence };
}

function hiddenRefsOf(signal: Signal, viewer: Viewer): SubjectRef[] {
  return signal.evidence
    .filter((ev) => !isVisibleTo(viewer, ev))
    .map((ev) => ({ subjectType: ev.subjectType, subjectId: ev.subjectId }));
}

function dedupeRefs(refs: SubjectRef[]): SubjectRef[] {
  const seen = new Set<string>();
  const out: SubjectRef[] = [];
  for (const ref of refs) {
    const key = refKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

function copySnapshot(snapshot: Snapshot): Snapshot {
  return {
    ...snapshot,
    coverage: {
      ...snapshot.coverage,
      sources: snapshot.coverage.sources.map((source) => ({ ...source })),
      notes: snapshot.coverage.notes.map((note) => ({ ...note })),
    },
    counts: { ...snapshot.counts },
  };
}

/**
 * Filters a dossier for one viewer. Verdict, counts and confidence are copied
 * untouched: a hidden item still counts in the advice (SPEC §15).
 */
export function sanitizeDossierForViewer(
  dossier: ReleaseDossier,
  viewer: Viewer,
): SanitizedDossier {
  const signals = dossier.signals.map((signal) => sanitizeSignal(signal, viewer));
  const allHiddenRefs = dossier.signals.flatMap((signal) => hiddenRefsOf(signal, viewer));
  return {
    snapshot: copySnapshot(dossier.snapshot),
    signals,
    waivers: dossier.waivers.map((waiver) => ({ ...waiver })),
    hiddenEvidenceCount: allHiddenRefs.length,
    hiddenSubjects: dedupeRefs(allHiddenRefs),
  };
}

/**
 * Waiver right (RI-07): the viewer is flagged `canWaive` by the caller (project
 * role) or listed among the policy's approvers.
 */
export function canViewerWaive(viewer: Viewer, policy: Policy): boolean {
  if (viewer.canWaive) return true;
  return policy.waiverApprovers.includes(viewer.accountId);
}
