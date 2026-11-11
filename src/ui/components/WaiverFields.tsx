import type { Locale } from '../../types.js';

/**
 * The two inputs of the waiver dialog, extracted so `WaiverDialog` stays under
 * the 50-line function limit (project rule).
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

export interface WaiverFieldsProps {
  locale: Locale;
  reason: string;
  hours: number;
  onReason: (reason: string) => void;
  onHours: (hours: number) => void;
}

export function WaiverFields({ locale, reason, hours, onReason, onHours }: WaiverFieldsProps) {
  return (
    <div>
      <label style={{ display: 'block', margin: '8px 0' }}>
        <div>{locale === 'fr' ? 'Motif (obligatoire) :' : 'Reason (mandatory):'}</div>
        <textarea
          value={reason}
          onChange={(event) => onReason(event.target.value)}
          rows={3}
          style={{ width: '100%', boxSizing: 'border-box' }}
        />
      </label>
      <label style={{ display: 'block', margin: '8px 0' }}>
        <div>{locale === 'fr' ? 'Durée (heures) :' : 'Duration (hours):'}</div>
        <input
          type="number"
          min={1}
          max={720}
          value={hours}
          onChange={(event) => onHours(Number(event.target.value) || 48)}
        />
      </label>
    </div>
  );
}
