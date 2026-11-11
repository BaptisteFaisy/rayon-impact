import { useLocale, useProject, useScreen } from './hooks.js';
import { VerdictBanner } from './components/VerdictBanner.js';
import type { Confidence, Locale, Verdict } from '../types.js';

/**
 * Dashboard gadget: the versions of the next 14 days with their verdict
 * (SPEC §11, RI-16).
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

interface GadgetRow {
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

  if (screen.loading) return <p>…</p>;
  const rows = (screen.data ?? []).filter((row) => withinWindow(row.releaseDate));

  if (rows.length === 0) {
    return (
      <p style={{ padding: 8, color: '#6B778C' }}>
        {locale === 'fr'
          ? `Aucune version prévue dans les ${WINDOW_DAYS} prochains jours.`
          : `No release planned in the next ${WINDOW_DAYS} days.`}
      </p>
    );
  }

  return (
    <div>
      {rows.map((row) => (
        <div key={row.versionId} style={{ borderBottom: '1px solid #DFE1E6' }}>
          <div style={{ padding: '4px 8px' }}>
            <strong>{row.versionName}</strong>{' '}
            <span style={{ color: '#6B778C' }}>{row.releaseDate}</span>
          </div>
          <VerdictBanner
            verdict={row.verdict}
            confidence={row.confidence}
            computedAt={row.computedAt}
            locale={locale as Locale}
          />
        </div>
      ))}
    </div>
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
