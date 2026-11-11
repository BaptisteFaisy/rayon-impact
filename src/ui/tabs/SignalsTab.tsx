import { SignalList } from '../components/SignalList';
import { SimulationPanel } from '../components/SimulationPanel';
import { blockingIssueKeys } from '../issueKeys';
import type { Locale, Signal } from '../../types';

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
  /** Version the signals belong to: the simulation needs it. */
  versionId: string;
}

export function SignalsTab({
  signals,
  locale,
  waiving,
  onWaive,
  versionId,
}: SignalsTabProps) {
  const waivable = signals.filter(
    (signal) => signal.severity === 'blocking' && signal.status === 'active',
  );
  const held = blockingIssueKeys(signals);
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
      {held.length > 0 ? (
        <SimulationPanel versionId={versionId} issueKeys={held} locale={locale} />
      ) : null}
    </div>
  );
}
