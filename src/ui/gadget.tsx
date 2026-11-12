import { useLocale, useProject, useScreen } from './hooks';
import { VerdictBanner } from './components/VerdictBanner';
import type { Confidence, Locale, Verdict } from '../types';
import { Box, List, ListItem, Text, Strong } from './kit';

/**
 * Dashboard gadget: the versions of the next 14 days with their verdict
 * (SPEC §11, RI-16).
 *
 * `GadgetList` takes the rows as props so the loaded state is renderable in
 * tests (`renderToStaticMarkup` never runs `useScreen`'s effect).
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

export interface GadgetRow {
  versionId: string;
  versionName: string;
  verdict: Verdict;
  confidence: Confidence;
  computedAt: string;
  releaseDate: string | null;
}

const WINDOW_DAYS = 14;

export function DashboardGadget() {
  const locale = useLocale();
  const project = useProject();
  const screen = useScreen<GadgetRow[]>('screen.dashboardGadget', {
    projectId: project.id ?? '',
  });

  if (screen.loading) return <Box role="status">…</Box>;
  return <GadgetList rows={screen.data ?? []} locale={locale} />;
}

/** The loaded gadget: upcoming versions only, each with its verdict banner. */
export function GadgetList({ rows, locale }: { rows: GadgetRow[]; locale: Locale }) {
  const upcoming = rows.filter((row) => withinWindow(row.releaseDate));

  if (upcoming.length === 0) {
    return (
      <Text>
        {locale === 'fr'
          ? `Aucune version prévue dans les ${WINDOW_DAYS} prochains jours.`
          : `No release planned in the next ${WINDOW_DAYS} days.`}
      </Text>
    );
  }

  return (
    <List type="unordered">
      {upcoming.map((row) => (
        <ListItem key={row.versionId}>
          <Box>
            <Strong>{row.versionName}</Strong>{' '}
            <Text>{row.releaseDate}</Text>
          </Box>
          <VerdictBanner
            verdict={row.verdict}
            confidence={row.confidence}
            computedAt={row.computedAt}
            locale={locale}
          />
        </ListItem>
      ))}
    </List>
  );
}

/** A version without a date is not "upcoming": it is left out, not hidden. */
function withinWindow(releaseDate: string | null): boolean {
  if (!releaseDate) return false;
  const release = new Date(releaseDate).getTime();
  if (Number.isNaN(release)) return false;
  const now = Date.now();
  const horizon = now + WINDOW_DAYS * 86_400_000;
  return release >= now - 86_400_000 && release <= horizon;
}
