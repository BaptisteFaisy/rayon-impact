import type { SignalCode, SignalDefinition } from '../types';

/**
 * Full signal catalogue from SPEC §7.
 *
 * Every signal carries its default severity, delivery lot (M/S/C), human-readable
 * source, and the three text components: what was found (templated at detection
 * time), why it matters, and how to clear it.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */
export const SIGNAL_CATALOGUE: Record<SignalCode, SignalDefinition> = {
  'COMP-01': {
    code: 'COMP-01',
    lot: 'M',
    defaultSeverity: 'blocking',
    subjectType: 'issue',
    alwaysAvailable: true,
    source: { key: 'signal.source.jira' },
    title: { key: 'signal.comp01.title' },
    why: { key: 'signal.comp01.why' },
    clear: { key: 'signal.comp01.clear' },
  },
  'COMP-02': {
    code: 'COMP-02',
    lot: 'M',
    defaultSeverity: 'major',
    subjectType: 'issue',
    alwaysAvailable: false,
    source: { key: 'signal.source.dev' },
    title: { key: 'signal.comp02.title' },
    why: { key: 'signal.comp02.why' },
    clear: { key: 'signal.comp02.clear' },
  },
  'COMP-03': {
    code: 'COMP-03',
    lot: 'M',
    defaultSeverity: 'blocking',
    subjectType: 'issue',
    alwaysAvailable: false,
    source: { key: 'signal.source.dev' },
    title: { key: 'signal.comp03.title' },
    why: { key: 'signal.comp03.why' },
    clear: { key: 'signal.comp03.clear' },
  },
  'COMP-04': {
    code: 'COMP-04',
    lot: 'S',
    defaultSeverity: 'minor',
    subjectType: 'issue',
    alwaysAvailable: true,
    source: { key: 'signal.source.jiraHistory' },
    title: { key: 'signal.comp04.title' },
    why: { key: 'signal.comp04.why' },
    clear: { key: 'signal.comp04.clear' },
  },
  'QUAL-01': {
    code: 'QUAL-01',
    lot: 'M',
    defaultSeverity: 'blocking',
    subjectType: 'issue',
    alwaysAvailable: false,
    source: { key: 'signal.source.dev' },
    title: { key: 'signal.qual01.title' },
    why: { key: 'signal.qual01.why' },
    clear: { key: 'signal.qual01.clear' },
  },
  'QUAL-02': {
    code: 'QUAL-02',
    lot: 'S',
    defaultSeverity: 'major',
    subjectType: 'issue',
    alwaysAvailable: false,
    source: { key: 'signal.source.graph' },
    title: { key: 'signal.qual02.title' },
    why: { key: 'signal.qual02.why' },
    clear: { key: 'signal.qual02.clear' },
  },
  'QUAL-03': {
    code: 'QUAL-03',
    lot: 'S',
    defaultSeverity: 'minor',
    subjectType: 'issue',
    alwaysAvailable: true,
    source: { key: 'signal.source.jiraHistory' },
    title: { key: 'signal.qual03.title' },
    why: { key: 'signal.qual03.why' },
    clear: { key: 'signal.qual03.clear' },
  },
  'DEP-01': {
    code: 'DEP-01',
    lot: 'M',
    defaultSeverity: 'blocking',
    subjectType: 'issue',
    alwaysAvailable: true,
    source: { key: 'signal.source.jiraLinks' },
    title: { key: 'signal.dep01.title' },
    why: { key: 'signal.dep01.why' },
    clear: { key: 'signal.dep01.clear' },
  },
  'DEP-02': {
    code: 'DEP-02',
    lot: 'M',
    defaultSeverity: 'major',
    subjectType: 'issue',
    alwaysAvailable: true,
    source: { key: 'signal.source.jiraLinks' },
    title: { key: 'signal.dep02.title' },
    why: { key: 'signal.dep02.why' },
    clear: { key: 'signal.dep02.clear' },
  },
  'DEP-03': {
    code: 'DEP-03',
    lot: 'S',
    defaultSeverity: 'minor',
    subjectType: 'service',
    alwaysAvailable: false,
    source: { key: 'signal.source.compass' },
    title: { key: 'signal.dep03.title' },
    why: { key: 'signal.dep03.why' },
    clear: { key: 'signal.dep03.clear' },
  },
  'EXP-01': {
    code: 'EXP-01',
    lot: 'M',
    defaultSeverity: 'blocking',
    subjectType: 'incident',
    alwaysAvailable: true,
    source: { key: 'signal.source.jsm' },
    title: { key: 'signal.exp01.title' },
    why: { key: 'signal.exp01.why' },
    clear: { key: 'signal.exp01.clear' },
  },
  'EXP-02': {
    code: 'EXP-02',
    lot: 'M',
    defaultSeverity: 'major',
    subjectType: 'incident',
    alwaysAvailable: true,
    source: { key: 'signal.source.jsm' },
    title: { key: 'signal.exp02.title' },
    why: { key: 'signal.exp02.why' },
    clear: { key: 'signal.exp02.clear' },
  },
  'EXP-03': {
    code: 'EXP-03',
    lot: 'S',
    defaultSeverity: 'blocking',
    subjectType: 'version',
    alwaysAvailable: true,
    source: { key: 'signal.source.freeze' },
    title: { key: 'signal.exp03.title' },
    why: { key: 'signal.exp03.why' },
    clear: { key: 'signal.exp03.clear' },
  },
  'EXP-04': {
    code: 'EXP-04',
    lot: 'S',
    defaultSeverity: 'major',
    subjectType: 'version',
    alwaysAvailable: true,
    source: { key: 'signal.source.jiraVersions' },
    title: { key: 'signal.exp04.title' },
    why: { key: 'signal.exp04.why' },
    clear: { key: 'signal.exp04.clear' },
  },
  'DOC-01': {
    code: 'DOC-01',
    lot: 'M',
    defaultSeverity: 'minor',
    subjectType: 'page',
    alwaysAvailable: true,
    source: { key: 'signal.source.confluence' },
    title: { key: 'signal.doc01.title' },
    why: { key: 'signal.doc01.why' },
    clear: { key: 'signal.doc01.clear' },
  },
  'HIST-01': {
    code: 'HIST-01',
    lot: 'C',
    defaultSeverity: 'major',
    subjectType: 'service',
    alwaysAvailable: true,
    source: { key: 'signal.source.pastOutcomes' },
    title: { key: 'signal.hist01.title' },
    why: { key: 'signal.hist01.why' },
    clear: { key: 'signal.hist01.clear' },
  },
  'OBJ-01': {
    code: 'OBJ-01',
    lot: 'C',
    defaultSeverity: 'info',
    subjectType: 'version',
    alwaysAvailable: false,
    source: { key: 'signal.source.graph' },
    title: { key: 'signal.obj01.title' },
    why: { key: 'signal.obj01.why' },
    clear: { key: 'signal.obj01.clear' },
  },
};

export function getSignalDefinition(code: SignalCode): SignalDefinition {
  const def = SIGNAL_CATALOGUE[code];
  if (!def) {
    throw new Error(`Unknown signal code: ${code}`);
  }
  return def;
}

export function listSignalCodes(): SignalCode[] {
  return Object.keys(SIGNAL_CATALOGUE) as SignalCode[];
}
