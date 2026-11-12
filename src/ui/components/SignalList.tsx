import Lozenge from '@atlaskit/lozenge';
import { getSignalDefinition } from '../../signals/registry';
import { t } from '../../i18n/index';
import type { Locale, Severity, Signal } from '../../types';

/**
 * Signal list grouped by severity: observation, why it matters, proof, how to clear.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

export interface SignalListProps {
  signals: Signal[];
  locale: Locale;
}

const SEVERITY_APPEARANCE: Record<Severity, 'removed' | 'inprogress' | 'default' | 'new'> = {
  blocking: 'removed',
  major: 'inprogress',
  minor: 'default',
  info: 'new',
};

const ORDER: Severity[] = ['blocking', 'major', 'minor', 'info'];

export function SignalList(props: SignalListProps) {
  const { signals, locale } = props;
  if (signals.length === 0) {
    return (
      <p style={{ color: '#6B778C' }}>{t({ key: 'signals.none.active' }, locale)}</p>
    );
  }

  const bySeverity = new Map<Severity, Signal[]>();
  for (const signal of signals) {
    const list = bySeverity.get(signal.severity) ?? [];
    list.push(signal);
    bySeverity.set(signal.severity, list);
  }

  return (
    <div>
      {ORDER.map((severity) => {
        const list = bySeverity.get(severity) ?? [];
        if (list.length === 0) return null;
        return (
          <div key={severity} style={{ marginBottom: 16 }}>
            <h4 style={{ margin: '8px 0' }}>
              <Lozenge appearance={SEVERITY_APPEARANCE[severity]} isBold>
                {t({ key: `severity.${severity}` }, locale)} ({list.length})
              </Lozenge>
            </h4>
            <ul style={{ paddingLeft: 20 }}>
              {list.map((signal) => (
                <SignalItem key={signal.id} signal={signal} locale={locale} />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function SignalItem({ signal, locale }: { signal: Signal; locale: Locale }) {
  const def = getSignalDefinition(signal.code);
  const finding = t(signal.finding, locale);
  const why = t(def.why, locale);
  const clear = t(def.clear, locale);

  return (
    <li style={{ marginBottom: 12 }}>
      <div>
        <strong>{signal.code}</strong> — {finding}
      </div>
      <div style={{ color: '#6B778C', fontSize: '0.9em' }}>{why}</div>
      <div style={{ fontSize: '0.9em', marginTop: 2 }}>
        <em>{clear}</em>
      </div>
      {signal.evidence.map((evidence, index) => (
        <span key={index} style={{ marginRight: 8 }}>
          {evidence.url ? (
            <a href={evidence.url} target="_blank" rel="noreferrer">
              {t(evidence.label, locale)}
            </a>
          ) : (
            <span style={{ color: '#6B778C' }}>{t(evidence.label, locale)}</span>
          )}
        </span>
      ))}
    </li>
  );
}
