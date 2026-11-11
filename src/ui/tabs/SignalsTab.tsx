import { SignalList } from '../components/SignalList.js';
import type { Locale, Signal } from '../../types.js';

/**
 * Signals tab: the list grouped by severity, plus a waiver button on every
 * active blocking signal (SPEC §6.1 step 6).
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

export interface SignalsTabProps {
  signals: Signal[];
  locale: Locale;
  waiving: Signal | null;
  onWaive: (signal: Signal | null) => void;
}

export function SignalsTab({ signals, locale, waiving, onWaive }: SignalsTabProps) {
  const waivable = signals.filter(
    (signal) => signal.severity === 'blocking' && signal.status === 'active',
  );
  return (
    <div>
      <SignalList signals={signals} locale={locale} />
      {waivable.map((signal) => (
        <button
          key={signal.id}
          type="button"
          onClick={() => onWaive(waiving?.id === signal.id ? null : signal)}
          style={{ marginRight: 8 }}
        >
          {locale === 'fr' ? 'Déroger' : 'Waive'} {signal.code}
        </button>
      ))}
    </div>
  );
}
