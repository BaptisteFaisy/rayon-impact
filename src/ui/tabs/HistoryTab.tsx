import type { Decision, Locale, Outcome } from '../../types.js';

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
          <li key={decision.id}>
            {decision.decidedAt} — <strong>{decision.decision}</strong> (
            {decision.verdictAtDecision}) par {decision.decidedBy}
            {decision.note ? ` · ${decision.note}` : ''}
          </li>
        ))}
      </ul>
      <OutcomeLine outcome={outcome} locale={locale} />
    </div>
  );
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
      {locale === 'fr' ? 'Bilan 72 h : ' : '72 h outcome: '}
      {outcome.incidents.length} {locale === 'fr' ? 'incident(s)' : 'incident(s)'}
      {outcome.rollback ? (locale === 'fr' ? ' · rollback' : ' · rollback') : ''}
    </p>
  );
}
