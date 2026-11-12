import { useIssue, useLocale, useProject, useScreen } from './hooks';
import { t } from '../i18n/index';
import type { Locale, ReleaseDossier } from '../types';
import { Box, List, ListItem, Text } from './kit';

/**
 * The issue panel: one line telling the developer whether this ticket holds a
 * release back, and why (SPEC §6.2, §11). No other screen to open.
 *
 * `IssueContextView` takes the resolver payload as props so the loaded state is
 * renderable in tests (`renderToStaticMarkup` never runs `useScreen`'s effect).
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

interface VersionDossier {
  versionId: string;
  versionName: string;
  dossier: ReleaseDossier | null;
}

export interface IssueContextPayload {
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

  if (screen.loading) {
    return <Box role="status">…</Box>;
  }
  if (!screen.data) {
    return <Text>{noDossierText(locale)}</Text>;
  }
  return (
    <IssueContextView data={screen.data} issueId={issue.id ?? ''} locale={locale} />
  );
}

/** The loaded panel: one line per tracked version of this ticket. */
export function IssueContextView({
  data,
  issueId,
  locale,
}: {
  data: IssueContextPayload;
  issueId: string;
  locale: Locale;
}) {
  if (data.observationMode) {
    return <Text>{noDossierText(locale)}</Text>;
  }
  const lines = data.versions.map((version) => describe(version, issueId, locale));
  if (lines.length === 0) {
    return (
      <Text>
        {locale === 'fr'
          ? 'Ce ticket ne concerne aucune version suivie.'
          : 'This ticket is not part of any tracked release.'}
      </Text>
    );
  }
  return (
    <List type="unordered">
      {lines.map((line, index) => (
        <ListItem key={index}>{line}</ListItem>
      ))}
    </List>
  );
}

function noDossierText(locale: Locale): string {
  return locale === 'fr'
    ? 'Aucun dossier pour ce ticket.'
    : 'No dossier for this ticket.';
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
