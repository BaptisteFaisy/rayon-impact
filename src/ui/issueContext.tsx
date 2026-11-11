import { useIssue, useLocale, useProject, useScreen } from './hooks.js';
import { t } from '../i18n/index.js';
import type { Locale, ReleaseDossier } from '../types.js';

/**
 * The issue panel: one line telling the developer whether this ticket holds a
 * release back, and why (SPEC §6.2, §11). No other screen to open.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

interface VersionDossier {
  versionId: string;
  versionName: string;
  dossier: ReleaseDossier | null;
}

interface IssueContextPayload {
  issueId: string;
  versions: VersionDossier[];
  observationMode: boolean;
}

export function IssueContext() {
  const locale = useLocale();
  const issue = useIssue();
  const project = useProject();
  const screen = useScreen<IssueContextPayload>('screen.issueContext', {
    issueId: issue.id ?? '',
    projectId: project.id ?? '',
  });

  if (screen.loading) return <span>…</span>;
  if (!screen.data || screen.data.observationMode) {
    return <span>{locale === 'fr' ? 'Aucun dossier pour ce ticket.' : 'No dossier for this ticket.'}</span>;
  }

  const lines = screen.data.versions.map((version) => describe(version, issue.id ?? '', locale));
  if (lines.length === 0) {
    return (
      <span>{locale === 'fr' ? 'Ce ticket ne concerne aucune version suivie.' : 'This ticket is not part of any tracked release.'}</span>
    );
  }
  return (
    <div>
      {lines.map((line, index) => (
        <div key={index}>{line}</div>
      ))}
    </div>
  );
}

/** The one line the developer reads: held back, or not. */
function describe(version: VersionDossier, issueId: string, locale: Locale): string {
  const dossier = version.dossier;
  if (!dossier) {
    return locale === 'fr'
      ? `${version.versionName} : pas encore de dossier.`
      : `${version.versionName}: no dossier yet.`;
  }
  const holding = dossier.signals.filter(
    (signal) =>
      signal.subjectId === issueId &&
      signal.status === 'active' &&
      signal.severity === 'blocking',
  );
  if (holding.length === 0) {
    return locale === 'fr'
      ? `${version.versionName} : rien ne retient la version à cause de ce ticket.`
      : `${version.versionName}: this ticket does not hold the release back.`;
  }
  const reasons = holding
    .map((signal) => `${signal.code} — ${t(signal.finding, locale)}`)
    .join(' · ');
  return locale === 'fr'
    ? `Ce ticket retient la version ${version.versionName} : ${reasons}`
    : `This ticket holds back ${version.versionName}: ${reasons}`;
}
