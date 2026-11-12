import { t } from '../../i18n/index';
import type { Decision, Locale, Outcome } from '../../types';

/**
 * History tab: the decisions taken, with the verdict that was on screen at the
 * time, and the 72 h outcome once the window is closed (RI-08, RI-15).
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

export interface HistoryTabProps {
  decisions: Decision[];
  outcome: Outcome | null;
  locale: Locale;
}

export function HistoryTab({ decisions, outcome, locale }: HistoryTabProps) {
  return (
    <div>
      <ul>
        {decisions.map((decision) => (
          <li key={decision.id}>{decisionLine(decision, locale)}</li>
        ))}
      </ul>
      <OutcomeLine outcome={outcome} locale={locale} />
    </div>
  );
}

/** One decision, fully localized: date, kind, verdict of the moment, author. */
function decisionLine(decision: Decision, locale: Locale): string {
  const line = t(
    {
      key: 'history.entry',
      params: {
        at: decision.decidedAt,
        decision: t({ key: `decision.${decision.decision}` }, locale),
        verdict: t({ key: `verdict.${decision.verdictAtDecision}` }, locale),
        by: decision.decidedBy,
      },
    },
    locale,
  );
  return decision.note ? `${line} · ${decision.note}` : line;
}

/** No outcome yet is stated as such: absence of data is never good news. */
function OutcomeLine({ outcome, locale }: { outcome: Outcome | null; locale: Locale }) {
  if (!outcome) {
    return (
      <p style={{ color: '#6B778C' }}>
        {locale === 'fr'
          ? 'Bilan à 72 h : pas encore disponible.'
          : '72 h outcome: not available yet.'}
      </p>
    );
  }
  return (
    <p>
      {t(
        {
          key: 'history.outcome',
          params: { count: outcome.incidents.length },
        },
        locale,
      )}
      {outcome.rollback ? ` · ${t({ key: 'history.rollback' }, locale)}` : ''}
    </p>
  );
}
