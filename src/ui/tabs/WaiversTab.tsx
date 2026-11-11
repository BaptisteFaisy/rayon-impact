import type { Waiver } from '../../types';

/**
 * Waivers tab: every waiver with its reason and its expiration. Waivers are
 * closed, never deleted (SPEC §15, traceability).
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

export function WaiversTab({ waivers }: { waivers: Waiver[] }) {
  if (waivers.length === 0) {
    return <p style={{ color: '#6B778C' }}>—</p>;
  }
  return (
    <ul>
      {waivers.map((waiver) => (
        <li key={waiver.id}>
          <strong>{waiver.signalCode}</strong> — {waiver.reason}
          <div style={{ color: '#6B778C', fontSize: '0.9em' }}>
            {waiver.grantedBy} · expire {waiver.expiresAt}
            {waiver.closedAt ? ` · close ${waiver.closedAt} (${waiver.closedReason})` : ''}
          </div>
        </li>
      ))}
    </ul>
  );
}
