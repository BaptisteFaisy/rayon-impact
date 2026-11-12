import { t } from '../../i18n/index';
import type { Locale, Waiver } from '../../types';

/**
 * Waivers tab: every waiver with its reason and its expiration. Waivers are
 * closed, never deleted (SPEC §15, traceability).
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

export function WaiversTab({ waivers, locale }: { waivers: Waiver[]; locale: Locale }) {
  if (waivers.length === 0) {
    return <p style={{ color: '#6B778C' }}>—</p>;
  }
  return (
    <ul>
      {waivers.map((waiver) => (
        <li key={waiver.id}>
          <strong>{waiver.signalCode}</strong> — {waiver.reason}
          <div style={{ color: '#6B778C', fontSize: '0.9em' }}>
            {waiver.grantedBy} ·{' '}
            {t({ key: 'waivers.expires', params: { at: waiver.expiresAt } }, locale)}
            {waiver.closedAt && waiver.closedReason
              ? ` · ${t(
                  {
                    key: 'waivers.closed',
                    params: { at: waiver.closedAt, reason: waiver.closedReason },
                  },
                  locale,
                )}`
              : ''}
          </div>
        </li>
      ))}
    </ul>
  );
}
